import { shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/audio', () => ({
  separateTrack: vi.fn(),
}));

vi.mock('@/lib/video', () => ({
  default: {
    createVideo: vi.fn(),
    getProgressParser: vi.fn(),
  },
}));

import SubmitTab from './SubmitTab.vue';
import video from '@/lib/video';
import {
  useMediaStore,
  BACKING_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
} from '@/stores/media';
import { useLyricsStore } from '@/stores/lyrics';
import { useTimingsStore } from '@/stores/timings';
import { KEY_CODES } from '@/constants';

vi.stubGlobal(
  'AudioContext',
  class {
    decodeAudioData(_buffer: ArrayBuffer, onSuccess: (b: unknown) => void) {
      onSuccess({ duration: 0 });
    }
  }
);

// The settings store reads localStorage at construction, which this Node
// build does not provide without --localstorage-file.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
});

// This spec exercises createVideo. Rendering the real template would evaluate
// the audioDelay computed, which needs a fully timed song, so mount a subclass
// that keeps the component's logic but renders nothing.
function mountTab() {
  const Headless = {
    ...SubmitTab,
    render: () => null,
  };
  return shallowMount(Headless);
}

describe('SubmitTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(video.createVideo).mockReset();
  });

  // Regression guard: SubmitTab used to read a musicSeparationModel prop that
  // App.vue never updated, so the "Include Backing Vocals" toggle in the song
  // info tab had no effect on the separation used for the final video.
  test('separates using the model currently held in the store', async () => {
    const mediaStore = useMediaStore();
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();

    mediaStore.songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
    mediaStore.separationModel = NO_VOCALS_SEPARATOR_MODEL;
    lyricsStore.setLyrics('a line');
    // Real timings so the audioDelay computed can evaluate.
    timingsStore.add(0, KEY_CODES.SPACEBAR, 1.0);
    timingsStore.add(0, KEY_CODES.ENTER, 3.0);
    vi.spyOn(timingsStore, 'areTimingsFinished', 'get').mockReturnValue(true);

    const separatedTrack = {
      backing: new Blob(['backing']),
      vocals: new Blob(['vocals']),
    };
    const wrapper = mountTab();
    const separateTrackSpy = vi
      .spyOn(wrapper.vm, 'separateTrack')
      .mockResolvedValue(separatedTrack as never);
    vi.mocked(video.createVideo).mockResolvedValue(new Uint8Array() as never);
    vi.spyOn(wrapper.vm, 'zipAndSendFiles').mockResolvedValue(undefined as never);

    await wrapper.vm.createVideo();

    expect(separateTrackSpy).toHaveBeenCalledWith(
      mediaStore.songFile,
      NO_VOCALS_SEPARATOR_MODEL
    );
  });

  test('picks up a later change to the separation model', async () => {
    const mediaStore = useMediaStore();
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();

    mediaStore.songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
    lyricsStore.setLyrics('a line');
    // Real timings so the audioDelay computed can evaluate.
    timingsStore.add(0, KEY_CODES.SPACEBAR, 1.0);
    timingsStore.add(0, KEY_CODES.ENTER, 3.0);
    vi.spyOn(timingsStore, 'areTimingsFinished', 'get').mockReturnValue(true);

    const wrapper = mountTab();
    const separateTrackSpy = vi.spyOn(wrapper.vm, 'separateTrack').mockResolvedValue({
      backing: new Blob(['backing']),
      vocals: new Blob(['vocals']),
    } as never);
    vi.mocked(video.createVideo).mockResolvedValue(new Uint8Array() as never);
    vi.spyOn(wrapper.vm, 'zipAndSendFiles').mockResolvedValue(undefined as never);

    // The toggle in the song info tab writes straight to the store.
    mediaStore.separationModel = BACKING_VOCALS_SEPARATOR_MODEL;
    await wrapper.vm.createVideo();

    expect(separateTrackSpy).toHaveBeenCalledWith(
      mediaStore.songFile,
      BACKING_VOCALS_SEPARATOR_MODEL
    );
  });
});
