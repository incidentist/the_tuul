import { defineStore } from "pinia";
import { computed, shallowRef, watch } from "vue";
import { BUNDLED_FONTS, FALLBACK_FONTS } from "@/lib/fonts";
import { useLyricsStore } from "./lyrics";
import { useMediaStore } from "./media";
import { useSettingsStore } from "./settings";

type FontFamily = keyof typeof BUNDLED_FONTS;

// The fallback fonts are downloaded into memory as soon as the text needs them,
// so the preview and the render read them without going back to the network.
export const useFallbackFontsStore = defineStore("fallbackFonts", () => {
  const lyricsStore = useLyricsStore();
  const mediaStore = useMediaStore();
  const settingsStore = useSettingsStore();

  // These URLs are never revoked,
  // since every preview worker and every render reads them for the rest of the session.
  const downloaded = shallowRef<Partial<Record<FontFamily, string>>>({});
  // Settles with the in-memory URL, or with undefined when the download fails.
  const downloads = new Map<FontFamily, Promise<string | undefined>>();

  const neededFamilies = computed(() => {
    const text = [
      lyricsStore.lyricText,
      mediaStore.songTitle,
      mediaStore.songArtist,
      settingsStore.videoOptions.countInText,
    ].join("\n");
    return FALLBACK_FONTS.filter(({ chars }) => new RegExp(chars, "u").test(text)).map(
      ({ family }) => family as FontFamily,
    );
  });

  /**
   * Download a bundled font into memory, once per session.
   * A failed download is retried the next time the text changes.
   */
  function download(family: FontFamily): void {
    if (downloads.has(family)) {
      return;
    }
    downloads.set(
      family,
      (async () => {
        try {
          const response = await fetch(BUNDLED_FONTS[family]);
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const url = URL.createObjectURL(await response.blob());
          downloaded.value = { ...downloaded.value, [family]: url };
          return url;
        } catch (e) {
          console.error(`Could not download the ${family} font`, e);
          downloads.delete(family);
          return undefined;
        }
      })(),
    );
  }

  /**
   * The in-memory URL of a bundled font this store is downloading or has downloaded, once it is
   * ready. Undefined when the store hasn't started on the font. The promise settles with
   * undefined when the download fails.
   */
  function inMemoryUrl(family: string): Promise<string | undefined> | undefined {
    return downloads.get(family as FontFamily);
  }

  // Sync, so that a font is already downloading when whatever renders the new text asks for it.
  watch(neededFamilies, (families) => families.forEach(download), {
    immediate: true,
    flush: "sync",
  });

  // Every bundled font by family name, with the downloaded ones pointing at their in-memory copy.
  const fontUrls = computed<Record<string, string>>(() => ({
    ...BUNDLED_FONTS,
    ...downloaded.value,
  }));

  return { fontUrls, inMemoryUrl };
});
