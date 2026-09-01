import { defineStore } from 'pinia';
import { reactive, watch } from 'vue';
import { VerticalAlignment } from '@/lib/timing';
import { NO_VOCALS_SEPARATOR_MODEL, BACKING_VOCALS_SEPARATOR_MODEL } from './media';
import Color from 'buefy/src/utils/color';
import { SeparationModel } from '@/types';


// Define interface for settings with simple hex string colors
export type VideoSettings = {
  vocalSeparationModel: SeparationModel;
  addTitleScreen: boolean;
  addCountIns: boolean;
  addInstrumentalScreens: boolean;
  addStaggeredLines: boolean;
  useBackgroundVideo: boolean;
  verticalAlignment: VerticalAlignment;
  font: {
    size: number;
    name: string;
  };
  color: {
    background: Color;
    primary: Color;
    secondary: Color;
  };
}

// Define StoredSettings by overriding the color fields in VideoSettings
type StoredSettings = Omit<VideoSettings, 'color'> & {
  color: {
    background: string;
    primary: string;
    secondary: string;
  };
};

// Default settings with simple hex strings
const DEFAULT_SETTINGS: VideoSettings = {
  addTitleScreen: true,
  addCountIns: true,
  addInstrumentalScreens: true,
  addStaggeredLines: true,
  useBackgroundVideo: false,
  verticalAlignment: VerticalAlignment.Middle,
  vocalSeparationModel: BACKING_VOCALS_SEPARATOR_MODEL,
  font: {
    size: 20,
    name: "Arial Narrow",
  },
  color: {
    background: Color.parse("#000000"), // black
    primary: Color.parse("#FF00FF"),    // magenta
    secondary: Color.parse("#00FFFF"),  // cyan
  },
};

export const useSettingsStore = defineStore('settings', () => {
  // Initialize with default settings
  const videoOptions = reactive<VideoSettings>({ ...DEFAULT_SETTINGS });

  // Load saved settings when the store is initialized
  loadSettings();

  // Automatically save settings when they change
  watch(videoOptions, () => {
    saveSettings();
  }, { deep: true });

  function loadSettings(): void {
    const optionsStr = localStorage.videoOptions;
    if (!optionsStr) {
      return;
    }

    try {
      const options = JSON.parse(optionsStr) as StoredSettings;
      // Convert string colors back to Color objects
      const newVideoOptions = {
        ...options, color: {
          background: Color.parse(options.color.background),
          primary: Color.parse(options.color.primary),
          secondary: Color.parse(options.color.secondary)
        }
      } as VideoSettings;

      // Handle legacy vocalSeparationModel setting
      if (
        newVideoOptions.vocalSeparationModel as string === "model_mel_band_roformer_ep_3005_sdr_11.4360.ckpt"
      ) {
        newVideoOptions.vocalSeparationModel = NO_VOCALS_SEPARATOR_MODEL;
      }

      // Handle legacy font name. "Trebuchet" is not the font's real family name,
      // so libass can't match it and renders no text at all in the final video.
      if (newVideoOptions.font?.name === "Trebuchet") {
        newVideoOptions.font.name = "Trebuchet MS";
      }

      // Update the reactive state with loaded options
      Object.assign(videoOptions, newVideoOptions);
    } catch (e) {
      console.error("Error loading settings:", e);
    }
  }

  function saveSettings(): void {
    try {
      const storageOptions = {
        ...videoOptions, color: {
          background: videoOptions.color.background.toString(),
          primary: videoOptions.color.primary.toString(),
          secondary: videoOptions.color.secondary.toString()
        }
      } as StoredSettings;

      localStorage.videoOptions = JSON.stringify(storageOptions);
    } catch (e) {
      console.error("Error saving settings:", e);
    }
  }

  function resetSettings(): void {
    Object.assign(videoOptions, DEFAULT_SETTINGS);
  }

  return {
    videoOptions,
    loadSettings,
    saveSettings,
    resetSettings
  };
});
