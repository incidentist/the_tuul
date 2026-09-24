import { defineStore } from 'pinia';
import { ref, watchEffect } from 'vue';

import { separateTrack } from '@/lib/audioSeparation';
import { BACKING_VOCALS_SEPARATOR_MODEL } from '@/lib/separationModels';
import { SeparationModel, SeparationProgress } from '@/types';
import jsmediatags from "@/jsmediatags.min.js";


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

    async function duration(songFile: File): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async (event) => {
                try {
                    const audioContext = new AudioContext();
                    const arrayBuffer = event.target.result as ArrayBuffer;

                    audioContext.decodeAudioData(
                        arrayBuffer,
                        (audioBuffer) => {
                            const duration = audioBuffer.duration;
                            resolve(duration);
                        },
                        (error) => {
                            console.error("Error decoding audio data:", error);
                            reject(
                                new Error(
                                    "Failed to decode audio data: " +
                                    (error?.message || "Unknown error")
                                )
                            );
                        }
                    );
                } catch (error) {
                    console.error("Audio context error:", error);
                    reject(
                        new Error(
                            "Failed to create or use AudioContext: " +
                            (error?.message || "Unknown error")
                        )
                    );
                }
            };

            reader.onerror = (event) => {
                console.error("FileReader error:", reader.error);
                reject(
                    new Error(
                        "Failed to read audio file: " +
                        (reader.error?.message || "Unknown error")
                    )
                );
            };

            reader.readAsArrayBuffer(songFile);
        });
    };

    async function getMetadata(songFile: File): Promise<{ title: string | null; artist: string | null }> {
        return new Promise((resolve, reject) => {
            if (!songFile) {
                resolve({ title: null, artist: null });
                return;
            }
            jsmediatags.read(songFile, {
                async onSuccess(tag) {
                    resolve({ title: tag.tags.title, artist: tag.tags.artist });
                },
                onFailure(error) {
                    console.error(error);
                    reject(
                        new Error(
                            "Failed to read metadata: " +
                            (error?.message || "Unknown error")
                        )
                    );
                },
            });
        });
    }

    watchEffect(async () => {
        // Update song metadata when the song file changes
        if (songFile.value) {
            const [metadata, durationValue] = await Promise.all([
                getMetadata(songFile.value),
                duration(songFile.value)
            ]);
            songTitle.value = metadata.title || songTitle.value;
            songArtist.value = metadata.artist || songArtist.value;
            songDuration.value = durationValue;
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
