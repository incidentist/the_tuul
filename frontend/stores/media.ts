import { defineStore } from 'pinia';
import { ref, watchEffect } from 'vue';

import { separateTrack } from '@/lib/audioSeparation';
import { BACKING_VOCALS_SEPARATOR_MODEL } from '@/lib/separationModels';
import { SeparationModel, SeparationProgress } from '@/types';
import { parseBlob } from "music-metadata";


export interface SeparatedTrack {
    // Blob URL of the separated backing track
    backing: Blob;
    // Blob URL of the separated vocals track
    vocals: Blob;
}

// Re-exported so existing importers keep working; the catalogue lives in lib/separationModels.
export { BACKING_VOCALS_SEPARATOR_MODEL, NO_VOCALS_SEPARATOR_MODEL } from '@/lib/separationModels';

export const useMediaStore = defineStore('media', () => {
    // The mixed song file (uploaded by user)
    const songFile = ref<File | null>(null);

    // Background video (if the song is from YouTube)
    const backgroundVideo = ref<Blob | null>(null);

    // Song metadata
    const songTitle = ref<string | null>(null);
    const songDuration = ref<number | null>(null);
    const songArtist = ref<string | null>(null);
    const youtubeUrl = ref<string | null>(null);

    // Track separation state
    const isProcessing = ref(false);
    const separationModel = ref<SeparationModel>(BACKING_VOCALS_SEPARATOR_MODEL);
    const separatedTrack = ref<SeparatedTrack | null>(null);
    const error = ref<string | null>(null);
    const separationStartTime = ref<Date | null>(null);
    // Progress reported by the separation backend, or null when it reports none
    const separationProgress = ref<SeparationProgress | null>(null);

    // True when the backing track came from the user rather than from separation
    const isBackingTrackUserUploaded = ref(false);

    async function startSeparation(inputData: File, model: SeparationModel): Promise<SeparatedTrack> {
        if (isProcessing.value) {
            return;
        }
        isProcessing.value = true;
        error.value = null;
        separationStartTime.value = new Date();
        separationProgress.value = null;
        try {
            const result = await separateTrack(inputData, model, (progress) => {
                separationProgress.value = progress;
            });
            separatedTrack.value = result;
            isBackingTrackUserUploaded.value = false;
            return separatedTrack.value;
        } catch (err) {
            console.error(err);
            error.value = (err as Error).message;
        } finally {
            isProcessing.value = false;
            separationProgress.value = null;
        }
    };

    async function setBackingTrack(file: File | null) {
        if (file == null) {
            // Clearing the upload discards the track entirely. Leaving a null
            // `backing` behind would break every consumer of separatedTrack.
            separatedTrack.value = null;
            isBackingTrackUserUploaded.value = false;
            return;
        }
        if (separatedTrack.value == null) {
            separatedTrack.value = { backing: file, vocals: new Blob() };
        } else {
            separatedTrack.value.backing = file;
        }
        isBackingTrackUserUploaded.value = true;
        // A user-supplied backing track makes an earlier separation failure moot
        error.value = null;
    }

    // Fallback for when the file headers don't give a duration: decode the
    // whole song, which is slow but works for anything the browser can play.
    async function decodeDuration(songFile: File): Promise<number> {
        const audioContext = new AudioContext();
        try {
            const audioBuffer = await audioContext.decodeAudioData(await songFile.arrayBuffer());
            return audioBuffer.duration;
        } finally {
            audioContext.close();
        }
    }

    async function readSongInfo(songFile: File): Promise<{ title: string | null; artist: string | null; duration: number | null }> {
        let title: string | null = null;
        let artist: string | null = null;
        let duration: number | null = null;
        try {
            // duration: true scans the file when the headers only give an estimate (e.g. VBR MP3s)
            const { common, format } = await parseBlob(songFile, { duration: true });
            title = common.title ?? null;
            artist = common.artist ?? null;
            duration = format.duration ?? null;
        } catch (e) {
            // A file without readable tags is normal; the user can fill in the title and artist
            console.warn("Couldn't read song metadata:", e);
        }
        if (duration === null) {
            try {
                duration = await decodeDuration(songFile);
            } catch (e) {
                console.error("Couldn't determine song duration:", e);
            }
        }
        return { title, artist, duration };
    }

    watchEffect(async () => {
        // Update song metadata when the song file changes
        if (songFile.value) {
            const info = await readSongInfo(songFile.value);
            songTitle.value = info.title || songTitle.value;
            songArtist.value = info.artist || songArtist.value;
            songDuration.value = info.duration;
        } else {
            songTitle.value = null;
            songArtist.value = null;
            songDuration.value = null;
        }
    });

    return {
        // Media files
        songFile,
        backgroundVideo,

        songTitle,
        songArtist,
        songDuration,
        youtubeUrl,

        // Track separation
        isProcessing,
        separationModel,
        separatedTrack,
        error,
        separationStartTime,
        separationProgress,
        isBackingTrackUserUploaded,

        // Methods
        startSeparation,
        setBackingTrack,
    };
});

// Fake API call to demonstrate functionality
async function fakeMusicSeparationAPI(inputData: any) {
    return new Promise<string>((resolve) => {
        setTimeout(() => {
            resolve('instrumental.wav');
        }, 2000);
    });
}
