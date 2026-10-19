import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { parseLyrics } from '@/lib/timing';
import { splitLinesIntoWords } from '@/lib/lyrics';

export const useLyricsStore = defineStore('lyrics', () => {
  const lyricText = ref('');
  // When true, every word is timed (and highlighted) separately instead of every line
  const syncByWord = ref(false);

  // The lyrics actually used for timing and subtitles, with word markup applied if needed
  const timedLyricText = computed(() => {
    return syncByWord.value ? splitLinesIntoWords(lyricText.value) : lyricText.value;
  });

  // Parse marked up lyrics into segments using shared logic
  const lyricSegments = computed(() => {
    return parseLyrics(timedLyricText.value, true);
  });

  function setLyrics(text: string) {
    lyricText.value = text;
  }

  function setSyncByWord(value: boolean) {
    syncByWord.value = value;
  }

  return {
    lyricText,
    syncByWord,
    timedLyricText,
    lyricSegments,
    setLyrics,
    setSyncByWord
  };
});
