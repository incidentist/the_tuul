import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { useFallbackFontsStore } from "./fallbackFonts";
import { useLyricsStore } from "./lyrics";
import { useMediaStore } from "./media";
import { useSettingsStore } from "./settings";
import { BUNDLED_FONTS, CJK_FONT, SYMBOL_FONT } from "@/lib/fonts";

describe("Fallback fonts store", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
    fetchMock = vi.fn(async (url: string) => new Response(new Blob([url])));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockImplementation(
      () => `blob:${fetchMock.mock.calls.length}`,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("downloads nothing while the text needs no fallback font", async () => {
    const store = useFallbackFontsStore();
    useLyricsStore().setLyrics("Went_out_last/night");
    await flushPromises();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.fontUrls).toEqual(BUNDLED_FONTS);
  });

  test("downloads the CJK font as soon as the lyrics contain CJK", async () => {
    const store = useFallbackFontsStore();
    useLyricsStore().setLyrics("Went_out\n残/酷/な");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(BUNDLED_FONTS[CJK_FONT]);
    expect(store.fontUrls[CJK_FONT]).toBe("blob:1");
    expect(store.fontUrls[SYMBOL_FONT]).toBe(BUNDLED_FONTS[SYMBOL_FONT]);
  });

  test("downloads the CJK font for a CJK song title", async () => {
    useFallbackFontsStore();
    useMediaStore().songTitle = "残酷な天使のテーゼ";
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(BUNDLED_FONTS[CJK_FONT]);
  });

  test("downloads the symbol font for a count-in made of symbols", async () => {
    useFallbackFontsStore();
    useSettingsStore().videoOptions.countInText = "➤";
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(BUNDLED_FONTS[SYMBOL_FONT]);
  });

  test("gives the in-memory URL of a font it is downloading once the download ends", async () => {
    const store = useFallbackFontsStore();
    expect(store.inMemoryUrl(CJK_FONT)).toBeUndefined();

    useLyricsStore().setLyrics("残");
    const url = store.inMemoryUrl(CJK_FONT);
    expect(url).toBeDefined();

    expect(await url).toBe("blob:1");
    expect(store.inMemoryUrl(SYMBOL_FONT)).toBeUndefined();
  });

  test("downloads a font only once however often the text changes", async () => {
    useFallbackFontsStore();
    const lyrics = useLyricsStore();
    lyrics.setLyrics("残");
    lyrics.setLyrics("残酷");
    await flushPromises();
    lyrics.setLyrics("残酷な");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test("retries a failed download the next time the text changes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const store = useFallbackFontsStore();
    const lyrics = useLyricsStore();
    lyrics.setLyrics("残");
    await flushPromises();

    expect(store.fontUrls[CJK_FONT]).toBe(BUNDLED_FONTS[CJK_FONT]);

    lyrics.setLyrics("残酷");
    await flushPromises();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.fontUrls[CJK_FONT]).toBe("blob:2");
  });
});
