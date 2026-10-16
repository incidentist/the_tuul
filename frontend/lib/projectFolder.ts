// Loading a project back from an extracted folder of the files the Submit tab exports.
//
// The folder is whatever the user points at, so classification is lenient: the names the exporter writes win,
// an unfamiliar name falls back to its extension, and anything left over is listed rather than refused.
// A backing or vocal track loads into its model's pair when its name gives one, and into the uploaded
// tracks otherwise, never as the song.
// Lyrics and timings are matched by name only, since both can be `.txt`, and so can any notes beside them.
// A folder holding only some of the files loads those.

import { extensionForBlob } from "@/lib/audio";
import { backgroundExtension, hasBackgroundExtension } from "@/lib/background";
import { SEPARATION_MODELS, separationModelShortName } from "@/lib/separationModels";
import { parseFileSource } from "@/lib/trackSources";
import type { TrackPair } from "@/stores/media";
import type { SeparationModel, TrackKind, TrackSource } from "@/types";

export interface ProjectFolder {
  song?: File;
  // A model's first track of each kind.
  modelTracks: Partial<Record<SeparationModel, Partial<Record<TrackKind, File>>>>;
  // Every other backing and vocal track, in name order.
  uploadedTracks: Record<TrackKind, File[]>;
  lyrics?: File;
  timings?: File;
  settings?: File;
  fonts: File[];
  background?: File;
  // Paths of the other files that matched nothing, or a slot already taken.
  ignored: string[];
}

type Slot = Exclude<keyof ProjectFolder, "ignored" | "modelTracks" | "uploadedTracks" | "fonts">;

const FONT_EXTENSIONS = ["ttf", "otf", "ttc"];

const SONG_STEM = "song";
const BACKGROUND_STEM = "background";

// The stems of the tracks the exporter writes without a model, whose container is a backend
// setting rather than a fixed extension. Accompaniment is an older name for the backing track.
const TRACK_STEMS: Record<string, TrackKind> = {
  backing: "backing",
  accompaniment: "backing",
  vocals: "vocals",
};

const NAMED_SLOTS: Record<string, Slot> = {
  "lyrics.txt": "lyrics",
  "timings.txt": "timings",
  "timings.json": "timings",
  "settings.yaml": "settings",
  "settings.yml": "settings",
};

// The legacy names, which give way to the current one whichever sorts first.
const SUPERSEDED_BY: Record<string, string> = { "timings.json": "timings.txt" };

export const TITLE_FRAME_ENTRY_NAME = "title.png";

// Made from the rest of the project, so there is nothing to load back.
const DERIVED_NAMES = ["subtitles.ass", TITLE_FRAME_ENTRY_NAME];

// What an unrecognized name falls back to. Video extensions are deliberately absent:
// the rendered karaoke video sits in the same folder, and the song and background are matched by
// name.
const EXTENSION_SLOTS: Record<string, Slot> = {
  yaml: "settings",
  yml: "settings",
  mp3: "song",
  wav: "song",
  m4a: "song",
  aac: "song",
  flac: "song",
  ogg: "song",
  opus: "song",
  aiff: "song",
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).toLowerCase();
}

function supersedes(name: string, taken: string): boolean {
  return (
    SUPERSEDED_BY[taken] === name ||
    // The exported song wins over any audio file that only took the slot by its extension.
    (stemOf(name) === SONG_STEM && stemOf(taken) !== SONG_STEM)
  );
}

/**
 * The name the exporter gives a backing or vocal track. A model's tracks carry its short name.
 * An uploaded track keeps its own name, with the kind added when the name doesn't already say it,
 * so that loading the folder back finds it as a track.
 */
export function trackEntryName(source: TrackSource, kind: TrackKind, extension: string): string {
  const file = parseFileSource(source);
  if (!file) {
    return `${separationModelShortName(source as SeparationModel)}-${kind}.${extension}`;
  }
  const dot = file.name.lastIndexOf(".");
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
  const ownExtension = dot > 0 ? file.name.slice(dot + 1) : extension;
  return trackKindOf(stem) === kind ? `${stem}.${ownExtension}` : `${stem}-${kind}.${ownExtension}`;
}

/**
 * The file name and contents of every track in the pairs, as the project download writes them.
 * A name already taken gets a number in front, which still reads back as an uploaded track.
 */
export function trackEntries(pairs: TrackPair[]): { name: string; kind: TrackKind; blob: Blob }[] {
  const taken = new Set<string>();
  return pairs.flatMap((pair) =>
    (["vocals", "backing"] as const)
      .filter((kind) => pair[kind].size > 0)
      .map((kind) => {
        const base = trackEntryName(pair.source, kind, extensionForBlob(pair[kind]));
        let name = base;
        for (let copy = 2; taken.has(name.toLowerCase()); copy++) {
          name = `${copy}-${base}`;
        }
        taken.add(name.toLowerCase());
        return { name, kind, blob: pair[kind] };
      }),
  );
}

// A stem ending in a hyphen and the kind, such as an export's "MDX-Kara-vocals".
const NAMED_TRACK_STEM = /^(?:.+-)?(backing|vocals)$/i;

/**
 * The kind of track a file stem names, if it names one.
 */
function trackKindOf(stem: string): TrackKind | undefined {
  const lower = stem.toLowerCase();
  return TRACK_STEMS[lower] ?? (NAMED_TRACK_STEM.exec(lower)?.[1] as TrackKind | undefined);
}

// Lowercased, since names are matched without case.
const MODEL_TRACK_STEMS: Record<string, { model: SeparationModel; kind: TrackKind }> =
  Object.fromEntries(
    (SEPARATION_MODELS as SeparationModel[]).flatMap((model) =>
      (["backing", "vocals"] as const).map((kind) => [
        `${separationModelShortName(model)}-${kind}`.toLowerCase(),
        { model, kind },
      ]),
    ),
  );

function pathOf(file: File): string {
  return file.webkitRelativePath || file.name;
}

// The name the exporter gives the source song,
// which is what tells it apart from the rendered karaoke video sitting beside it.
export function projectSongEntryName(sourceName: string): string {
  const extension = extensionOf(sourceName);
  return extension ? `${SONG_STEM}.${extension}` : SONG_STEM;
}

/**
 * The name the exporter gives the background, which tells it apart from the rendered video beside it.
 */
export function projectBackgroundEntryName(background: Blob): string {
  return `${BACKGROUND_STEM}.${backgroundExtension(background)}`;
}

export function classifyProjectFolder(files: File[]): ProjectFolder {
  const project: ProjectFolder = {
    modelTracks: {},
    uploadedTracks: { backing: [], vocals: [] },
    fonts: [],
    ignored: [],
  };
  // A directory picker hands its files over in whatever order it walked them.
  // Sort to make "the first candidate wins" mean the same thing twice running.
  const ordered = [...files].sort((a, b) => pathOf(a).localeCompare(pathOf(b)));

  for (const file of ordered) {
    const name = file.name.toLowerCase();
    if (name.startsWith(".") || DERIVED_NAMES.includes(name)) {
      continue;
    }
    // A .kbp or .ass loads through its own input only. Without this, song.kbp would take the song
    // slot, since the stems are matched by name whatever their extension.
    if (["kbp", "ass"].includes(extensionOf(name))) {
      project.ignored.push(pathOf(file));
      continue;
    }
    const modelTrack = MODEL_TRACK_STEMS[stemOf(name)];
    if (modelTrack && !project.modelTracks[modelTrack.model]?.[modelTrack.kind]) {
      (project.modelTracks[modelTrack.model] ??= {})[modelTrack.kind] = file;
      continue;
    }
    if (FONT_EXTENSIONS.includes(extensionOf(name))) {
      project.fonts.push(file);
      continue;
    }
    const kind = trackKindOf(stemOf(name));
    if (kind) {
      project.uploadedTracks[kind].push(file);
      continue;
    }
    const slot =
      NAMED_SLOTS[name] ??
      (stemOf(name) === SONG_STEM ? "song" : undefined) ??
      (stemOf(name) === BACKGROUND_STEM && hasBackgroundExtension(name)
        ? "background"
        : undefined) ??
      EXTENSION_SLOTS[extensionOf(name)];
    const taken = slot ? project[slot] : undefined;
    if (slot && taken && supersedes(name, taken.name.toLowerCase())) {
      project.ignored.push(pathOf(taken));
      project[slot] = file;
      continue;
    }
    if (!slot || taken) {
      project.ignored.push(pathOf(file));
      continue;
    }
    project[slot] = file;
  }
  return project;
}
