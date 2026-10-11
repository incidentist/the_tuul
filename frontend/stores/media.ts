import { defineStore } from "pinia";
import { computed, ref, shallowRef, watch } from "vue";

import { resumeSeparation, separateTrack, SeparationProgressCallback } from "@/lib/audio";
import { maxUploadBytes } from "@/constants";
import { SeparationModel, TrackKind, TrackSource } from "@/types";
import { fileSource, MAX_UPLOADED_TRACKS, parseFileSource } from "@/lib/trackSources";
import jsmediatags from "@/jsmediatags.min.js";
import {
  clearPersistence,
  persistBlobRef,
  persistJsonRef,
  takeLegacyBlob,
} from "@/lib/persistence";
import { useLyricsLookupStore } from "@/stores/lyricsLookup";
import { useSettingsStore } from "@/stores/settings";
import {
  BACKING_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL,
  NO_VOCALS_HQ_SEPARATOR_MODEL,
  SEPARATION_MODELS,
} from "@/lib/separationModels";

const MEDIA_LOCALSTORAGE_KEYS = [
  "media.youtubeUrl",
  "media.separationModel",
  "media.songTitle",
  "media.songArtist",
  "media.songDuration",
  "media.runningSeparation",
  "media.renderTrackSource",
  "media.backgroundVideoOffset",
  "media.hintNote",
];
const MEDIA_IDB_KEYS = [
  "media.songFile",
  "media.background",
  "media.trackPairs",
  "media.timingsFile",
  "media.lyricsFile",
  "media.backingTrackFile",
  "media.vocalTrackFile",
  "media.settingsFile",
  "media.kbpFile",
  "media.assFile",
];

export interface SeparatedTrack {
  // Blob URL of the separated backing track
  backing: Blob;
  // Blob URL of the separated vocals track
  vocals: Blob;
}

export interface TrackPair extends SeparatedTrack {
  source: TrackSource;
}

// How the last separation ended. The duration runs from the request, so it includes the wait in line.
export interface SeparationOutcome {
  status: "succeeded" | "failed" | "cancelled";
  durationSeconds: number;
}

// A separation job the backend is running for this session, which a reload follows again.
interface RunningSeparation {
  pollUrl: string;
  // A job remembered by an older version has no model.
  model?: SeparationModel;
  // When the separation was asked for, in milliseconds since the epoch.
  requestedAt: number;
}

export {
  BACKING_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_SEPARATOR_MODEL,
  BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL,
  NO_VOCALS_HQ_SEPARATOR_MODEL,
  SEPARATION_MODELS,
};

/**
 * The model preselected until the user picks one, from the DEFAULT_SEPARATION_MODEL setting the
 * server renders into the page.
 */
export function defaultSeparationModel(): SeparationModel {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="tuul-default-separation-model"]',
  );
  const name = meta?.content;
  return name && SEPARATION_MODELS.includes(name)
    ? (name as SeparationModel)
    : BACKING_VOCALS_HQ_ALT_SEPARATOR_MODEL;
}

/**
 * Explains why a song is over the server's upload limit, or returns null if it is not.
 */
function tooLargeMessage(song: Blob | null): string | null {
  const limit = maxUploadBytes();
  if (!song || song.size <= limit) {
    return null;
  }
  const megabytes = (bytes: number) => Math.ceil(bytes / 1_000_000);
  return (
    `This song is ${megabytes(song.size)} MB, over the ${megabytes(limit)} MB the server ` +
    "accepts for separation. You can load a backing track of your own instead."
  );
}

export const useMediaStore = defineStore("media", () => {
  // The mixed song file (uploaded by user)
  const songFile = shallowRef<File | null>(null);

  // The image or video behind the lyrics, from a YouTube download or picked on the Submit tab.
  const background = shallowRef<Blob | null>(null);
  // Seconds the background video is moved against the backing track, which need not come from
  // the video's own audio. A positive offset delays the video, and a negative one skips its start.
  const backgroundVideoOffset = ref(0);
  // The note played during the title screen, as typed: a note such as "A3", or a frequency in Hz.
  const hintNote = ref<string | null>(null);

  // The semantic state these map to (timings array, lyric text, separatedTrack.backing) is held elsewhere;
  // these refs exist so the FileUpload widgets can re-display the user's selection after a reload.
  const timingsFile = shallowRef<File | null>(null);
  const lyricsFile = shallowRef<File | null>(null);
  const kbpFile = shallowRef<File | null>(null);
  const assFile = shallowRef<File | null>(null);
  const backingTrackFile = shallowRef<File | null>(null);
  const vocalTrackFile = shallowRef<File | null>(null);
  const settingsFile = shallowRef<File | null>(null);

  const projectFolderName = ref<string | null>(null);

  // Song metadata
  const songTitle = ref<string | null>(null);
  const songDuration = ref<number | null>(null);
  const songArtist = ref<string | null>(null);
  const youtubeUrl = ref<string | null>(null);

  // Track separation state
  const isProcessing = ref(false);
  const separationModel = ref<SeparationModel>(defaultSeparationModel());
  // Oldest first, one per source, and null rather than empty so a saved list can be restored.
  // A side the source has no track for is an empty blob.
  const trackPairs = shallowRef<TrackPair[] | null>(null);
  // The pair the video renders with, as the user picked it, or the full song.
  // The full song only counts in advanced mode.
  const renderTrackSource = ref<"full" | TrackSource | null>(null);
  const error = ref<string | null>(null);
  const separationStartTime = shallowRef<Date | null>(null);

  // Fraction of the running separation that is done, null while the backend reports no figure
  // (e.g. a GCS-cached job, or an architecture whose progress can't be read)
  // Consumers fall back to an elapsed-time estimate.
  const separationProgress = ref<number | null>(null);
  const separationStage = ref<string | null>(null);
  const separationSongsAhead = ref<number | null>(null);
  const lastSeparation = ref<SeparationOutcome | null>(null);
  const runningSeparation = ref<RunningSeparation | null>(null);

  // Held outside the store state: Vue would proxy the controller, whose methods need the instance itself.
  let activeSeparation: AbortController | null = null;
  let pendingSeparation: Promise<SeparatedTrack | undefined> | null = null;

  function trackPair(source: TrackSource): TrackPair | undefined {
    return trackPairs.value?.find((pair) => pair.source === source);
  }

  /**
   * Sources with a track of that kind, oldest first.
   */
  function sourcesWith(kind: keyof SeparatedTrack): TrackSource[] {
    return (trackPairs.value ?? [])
      .filter((pair) => pair[kind].size > 0)
      .map((pair) => pair.source);
  }

  const vocalSources = computed(() => sourcesWith("vocals"));
  const backingSources = computed(() => sourcesWith("backing"));

  // The pair the video renders with, or whose tracks it carries beside the full song.
  // Until the user picks one, it is the latest with a backing track.
  const separatedTrack = computed<TrackPair | null>(() => {
    const choice = renderTrackSource.value;
    const picked = choice && choice !== "full" && trackPair(choice);
    if (picked && picked.backing.size > 0) {
      return picked;
    }
    const latest = backingSources.value.at(-1);
    return latest ? trackPair(latest)! : null;
  });

  /**
   * The source's track of that kind, or null when the choice is the full song or a track that is
   * not there.
   */
  function trackFor(kind: keyof SeparatedTrack, choice: "full" | TrackSource | null): Blob | null {
    const track = choice && choice !== "full" ? trackPair(choice)?.[kind] : undefined;
    return track && track.size > 0 ? track : null;
  }

  /**
   * Stores the pair as the latest from its source, replacing any it had before.
   * A pair with no audio on either side is dropped.
   */
  function putTrackPair(source: TrackSource, track: SeparatedTrack) {
    const pairs = (trackPairs.value ?? []).filter((pair) => pair.source !== source);
    if (track.backing.size > 0 || track.vocals.size > 0) {
      pairs.push({ source, backing: track.backing, vocals: track.vocals });
    }
    trackPairs.value = pairs.length > 0 ? pairs : null;
  }
  // separationStartTime restarts when the song leaves the line, and the outcome's duration must not.
  let separationRequestedAt = 0;

  function recordOutcome(status: SeparationOutcome["status"]) {
    lastSeparation.value = {
      status,
      durationSeconds: (Date.now() - separationRequestedAt) / 1000,
    };
  }

  // Why the song cannot be sent for separation, or null if it can.
  const songTooLargeMessage = computed(() => tooLargeMessage(songFile.value));

  // Resolves with the separated track, or undefined if the separation failed
  // (the reason is in `error`) or was cancelled.
  // A separation already in flight is joined rather than started again.
  async function startSeparation(
    inputData: any,
    modelName: SeparationModel,
  ): Promise<SeparatedTrack | undefined> {
    if (pendingSeparation) {
      return pendingSeparation;
    }
    const tooLarge = tooLargeMessage(inputData);
    if (tooLarge) {
      error.value = tooLarge;
      return undefined;
    }
    const requestedAt = Date.now();
    return follow(requestedAt, modelName, (onProgress, signal) =>
      separateTrack(inputData, modelName, onProgress, signal, (pollUrl) => {
        runningSeparation.value = { pollUrl, model: modelName, requestedAt };
      }),
    );
  }

  // Follows the job a previous page left running, if there is one.
  function resumeRunningSeparation() {
    const running = runningSeparation.value;
    if (!running || pendingSeparation) {
      return;
    }
    follow(running.requestedAt, running.model ?? separationModel.value, (onProgress, signal) =>
      resumeSeparation(running.pollUrl, onProgress, signal),
    );
  }

  // Tracks a separation through to its outcome, whichever way it was started.
  function follow(
    requestedAt: number,
    model: SeparationModel,
    run: (onProgress: SeparationProgressCallback, signal: AbortSignal) => Promise<SeparatedTrack>,
  ): Promise<SeparatedTrack | undefined> {
    const abort = new AbortController();
    activeSeparation = abort;
    isProcessing.value = true;
    error.value = null;
    separationRequestedAt = requestedAt;
    separationStartTime.value = new Date();
    separationProgress.value = null;
    separationStage.value = null;
    separationSongsAhead.value = null;
    pendingSeparation = (async () => {
      try {
        const track = await run(({ progress, stage, songsAhead }) => {
          // The elapsed-time estimate counts from when the song left the line, not from submission.
          if (separationSongsAhead.value !== null && songsAhead === null) {
            separationStartTime.value = new Date();
          }
          separationProgress.value = progress;
          separationStage.value = stage;
          separationSongsAhead.value = songsAhead;
        }, abort.signal);
        putTrackPair(model, track);
        recordOutcome("succeeded");
        return track;
      } catch (err) {
        if (abort.signal.aborted) {
          return undefined;
        }
        console.error(err);
        error.value = (err as Error).message;
        recordOutcome("failed");
        return undefined;
      } finally {
        // A cancel clears this synchronously and a later separation may already own it,
        // so only the current run winds the state down.
        if (activeSeparation === abort) {
          clearSeparationState();
        }
      }
    })();
    return pendingSeparation;
  }

  function clearSeparationState() {
    activeSeparation = null;
    pendingSeparation = null;
    runningSeparation.value = null;
    isProcessing.value = false;
    separationProgress.value = null;
    separationStage.value = null;
    separationSongsAhead.value = null;
  }

  // Cancels the running separation, calling off the work on the backend where that is possible.
  // Leaves the tracks separated by earlier runs in place.
  function cancelSeparation() {
    if (!activeSeparation) {
      return;
    }
    recordOutcome("cancelled");
    activeSeparation.abort();
    // The rejection lands a tick later, and until then a new separation would join the dying one.
    clearSeparationState();
  }

  // Whether a backing or vocal track is loaded, from an upload or an earlier separation.
  const hasSeparatedTrack = computed(() => (trackPairs.value?.length ?? 0) > 0);

  // Drops the tracks uploads or earlier separations left behind,
  // so a render waits for the next separation instead of using an old backing track.
  // Calls off a run still in flight first: its result would otherwise land here after the clear.
  function oneSided(kind: TrackKind, track: Blob): SeparatedTrack {
    return kind === "backing"
      ? { backing: track, vocals: new Blob() }
      : { backing: new Blob(), vocals: track };
  }

  /**
   * Swaps one uploaded file of that kind for another. Either can be null, to only add or only
   * remove one. A file with the name of one already loaded replaces it. Returns false, adding
   * nothing, when the kind already has MAX_UPLOADED_TRACKS files.
   */
  function replaceUploadedTrack(
    kind: TrackKind,
    previous: File | null,
    next: File | null,
  ): boolean {
    if (previous) {
      putTrackPair(fileSource(kind, previous.name), oneSided(kind, new Blob()));
    }
    if (!next) {
      return true;
    }
    const source = fileSource(kind, next.name);
    const others = (trackPairs.value ?? []).filter(
      (pair) => pair.source !== source && parseFileSource(pair.source)?.kind === kind,
    );
    if (others.length >= MAX_UPLOADED_TRACKS) {
      return false;
    }
    putTrackPair(source, oneSided(kind, next));
    return true;
  }

  /**
   * Brings back the background older versions saved, which was always a YouTube download's video.
   */
  async function restoreLegacyBackground() {
    const legacy = await takeLegacyBlob<Blob>("media.backgroundVideo");
    if (legacy && !background.value) {
      background.value = new File([legacy], "video.mp4", { type: legacy.type || "video/mp4" });
    }
  }

  /**
   * Brings back the single pair older versions saved. The model that made it was not saved,
   * so it goes to the model picked at the time, or to the uploaded files if there were any.
   */
  async function restoreLegacyTrack() {
    const legacy = await takeLegacyBlob<SeparatedTrack>("media.separatedTrack");
    if (!legacy || trackPairs.value) {
      return;
    }
    if (!backingTrackFile.value && !vocalTrackFile.value) {
      putTrackPair(separationModel.value, legacy);
      return;
    }
    for (const kind of ["backing", "vocals"] as const) {
      const name = (kind === "backing" ? backingTrackFile : vocalTrackFile).value?.name ?? kind;
      putTrackPair(fileSource(kind, name), oneSided(kind, legacy[kind]));
    }
  }

  async function duration(songFile: File): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = async () => {
        try {
          const audioContext = new AudioContext();
          const arrayBuffer = reader.result as ArrayBuffer;

          await audioContext.decodeAudioData(
            arrayBuffer,
            (audioBuffer) => {
              const duration = audioBuffer.duration;
              resolve(duration);
            },
            (error) => {
              console.error("Error decoding audio data:", error);
              reject(
                new Error("Failed to decode audio data: " + (error?.message || "Unknown error")),
              );
            },
          );
        } catch (error) {
          console.error("Audio context error:", error);
          reject(
            new Error(
              "Failed to create or use AudioContext: " +
                (error instanceof Error ? error.message : "Unknown error"),
            ),
          );
        }
      };

      reader.onerror = () => {
        console.error("FileReader error:", reader.error);
        reject(
          new Error("Failed to read audio file: " + (reader.error?.message || "Unknown error")),
        );
      };

      reader.readAsArrayBuffer(songFile);
    });
  }

  async function getMetadata(
    songFile: File,
  ): Promise<{ title: string | null; artist: string | null }> {
    return new Promise((resolve, reject) => {
      if (!songFile) {
        resolve({ title: null, artist: null });
        return;
      }
      jsmediatags.read(songFile, {
        onSuccess(tag) {
          resolve({ title: tag.tags.title ?? null, artist: tag.tags.artist ?? null });
        },
        onError(error) {
          console.error(error);
          reject(
            new Error("Failed to read metadata: " + (error.info || error.type || "Unknown error")),
          );
        },
      });
    });
  }

  // While persisted blobs are being read from IDB, the songFile ref may flip from null to a restored File.
  // Suppress metadata re-derivation during that window so the persisted (and possibly user-edited)
  // title/artist/duration aren't overwritten by re-reading the file's embedded tags.
  let isHydrating = true;

  // The derivation the current song file set off.
  // Awaited by anything that restores a title or artist of its own,
  // so the file's embedded tags don't land on top of it.
  let pendingMetadata: Promise<unknown> = Promise.resolve();

  function metadataSettled(): Promise<void> {
    return pendingMetadata.then(
      () => undefined,
      () => undefined,
    );
  }

  // flush: 'sync' so the isHydrating check runs in the same tick as the hydration assignment to songFile.value,
  // before any later microtask can flip the flag.
  watch(
    songFile,
    async (newFile) => {
      if (isHydrating) return;
      // The tracks stay, since they may well come from elsewhere. A separation still running
      // would bring tracks of the old song.
      cancelSeparation();
      error.value = null;
      if (!newFile) {
        songTitle.value = null;
        songArtist.value = null;
        songDuration.value = null;
        return;
      }
      const derivation = Promise.all([getMetadata(newFile), duration(newFile)]);
      pendingMetadata = derivation;
      const [metadata, durationValue] = await derivation;
      songTitle.value = metadata.title || songTitle.value;
      songArtist.value = metadata.artist || songArtist.value;
      songDuration.value = durationValue;
      void useLyricsLookupStore().lookUp();
    },
    { flush: "sync" },
  );

  // A new background is one the user wants to see, and the offset lines up the video it replaces.
  watch(
    background,
    (newBackground) => {
      if (isHydrating) return;
      backgroundVideoOffset.value = 0;
      if (newBackground) {
        useSettingsStore().videoOptions.useBackground = true;
      }
    },
    { flush: "sync" },
  );

  // JSON-serializable state → localStorage (synchronous load)
  persistJsonRef("media.youtubeUrl", youtubeUrl);
  persistJsonRef("media.separationModel", separationModel);
  persistJsonRef("media.songTitle", songTitle);
  persistJsonRef("media.songArtist", songArtist);
  persistJsonRef("media.songDuration", songDuration);
  persistJsonRef("media.runningSeparation", runningSeparation);
  persistJsonRef("media.renderTrackSource", renderTrackSource);
  persistJsonRef("media.backgroundVideoOffset", backgroundVideoOffset);
  persistJsonRef("media.hintNote", hintNote);

  // Blobs → IndexedDB (async load)
  Promise.all([
    persistBlobRef("media.songFile", songFile),
    persistBlobRef("media.background", background),
    persistBlobRef("media.trackPairs", trackPairs),
    persistBlobRef("media.timingsFile", timingsFile),
    persistBlobRef("media.lyricsFile", lyricsFile),
    persistBlobRef("media.backingTrackFile", backingTrackFile),
    persistBlobRef("media.vocalTrackFile", vocalTrackFile),
    persistBlobRef("media.settingsFile", settingsFile),
    persistBlobRef("media.kbpFile", kbpFile),
    persistBlobRef("media.assFile", assFile),
  ])
    .then(() => Promise.all([restoreLegacyTrack(), restoreLegacyBackground()]))
    .finally(() => {
      isHydrating = false;
      resumeRunningSeparation();
    });

  async function clearSession(): Promise<void> {
    cancelSeparation();
    songFile.value = null;
    background.value = null;
    backgroundVideoOffset.value = 0;
    hintNote.value = null;
    trackPairs.value = null;
    renderTrackSource.value = null;
    timingsFile.value = null;
    lyricsFile.value = null;
    backingTrackFile.value = null;
    vocalTrackFile.value = null;
    settingsFile.value = null;
    kbpFile.value = null;
    assFile.value = null;
    projectFolderName.value = null;
    songTitle.value = null;
    songArtist.value = null;
    songDuration.value = null;
    youtubeUrl.value = null;
    error.value = null;
    separationStartTime.value = null;
    separationProgress.value = null;
    separationStage.value = null;
    separationSongsAhead.value = null;
    lastSeparation.value = null;
    await clearPersistence(MEDIA_LOCALSTORAGE_KEYS, MEDIA_IDB_KEYS);
  }

  return {
    // Media files
    songFile,
    background,
    backgroundVideoOffset,
    hintNote,
    timingsFile,
    lyricsFile,
    kbpFile,
    assFile,
    backingTrackFile,
    vocalTrackFile,
    settingsFile,
    projectFolderName,

    songTitle,
    songArtist,
    songDuration,
    youtubeUrl,

    // Track separation
    isProcessing,
    separationModel,
    trackPairs,
    renderTrackSource,
    separatedTrack,
    vocalSources,
    backingSources,
    error,
    separationStartTime,
    separationProgress,
    separationStage,
    separationSongsAhead,
    lastSeparation,
    songTooLargeMessage,
    hasSeparatedTrack,

    // Methods
    metadataSettled,
    trackPair,
    trackFor,
    putTrackPair,
    startSeparation,
    cancelSeparation,
    replaceUploadedTrack,
    clearSession,
  };
});
