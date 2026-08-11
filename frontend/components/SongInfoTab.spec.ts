import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Stub the network calls made from this tab.
vi.mock('@/lib/audio', () => ({
  separateTrack: vi.fn(),
}));

// Setting songFile triggers the store's metadata watchEffect, which decodes
// audio. happy-dom has no AudioContext, so give it one that resolves nothing.
vi.stubGlobal(
  'AudioContext',
  class {
    decodeAudioData(_buffer: ArrayBuffer, onSuccess: (b: unknown) => void) {
      onSuccess({ duration: 0 });
    }
  }
);

import SongInfoTab from './SongInfoTab.vue';
import {
  useMediaStore,
  BACKING_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
} from '@/stores/media';

// b-tab-item expects a b-tabs parent, and Buefy is not installed in the test
// environment, so render the b-* elements as inert stubs. The component's own
// logic lives in computeds and methods, which mount exposes either way.
function mountTab() {
  return mount(SongInfoTab, {
    global: {
      stubs: {
        'b-tab-item': { template: '<div><slot /></div>' },
        'b-collapse': { template: '<div><slot /></div>' },
        'b-tooltip': { template: '<div><slot /></div>' },
        'b-field': { template: '<div><slot /></div>' },
        'b-input': true,
        'b-button': true,
        'b-switch': true,
        'b-icon': true,
        'file-upload': true,
      },
    },
  });
}

describe('SongInfoTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('includeBackingVocals', () => {
    test('reflects the separation model held in the store', () => {
      const mediaStore = useMediaStore();
      const wrapper = mountTab();

      mediaStore.separationModel = BACKING_VOCALS_SEPARATOR_MODEL;
      expect(wrapper.vm.includeBackingVocals).toBe(true);

      mediaStore.separationModel = NO_VOCALS_SEPARATOR_MODEL;
      expect(wrapper.vm.includeBackingVocals).toBe(false);
    });

    // Regression guard: the toggle used to write to the store while SubmitTab
    // read a stale prop, so turning it off had no effect on the final video.
    test('writes the chosen model back to the store', () => {
      const mediaStore = useMediaStore();
      const wrapper = mountTab();

      wrapper.vm.includeBackingVocals = false;
      expect(mediaStore.separationModel).toBe(NO_VOCALS_SEPARATOR_MODEL);

      wrapper.vm.includeBackingVocals = true;
      expect(mediaStore.separationModel).toBe(BACKING_VOCALS_SEPARATOR_MODEL);
    });
  });

  describe('backing track', () => {
    test('reads the backing track and its origin from the store', async () => {
      const mediaStore = useMediaStore();
      const wrapper = mountTab();

      expect(wrapper.vm.backingTrackFile).toBeNull();
      expect(wrapper.vm.isBackingTrackUserUploaded).toBe(false);

      const file = new File(['backing'], 'backing.mp3', { type: 'audio/mpeg' });
      await mediaStore.setBackingTrack(file);

      expect(wrapper.vm.backingTrackFile?.name).toBe('backing.mp3');
      expect(wrapper.vm.isBackingTrackUserUploaded).toBe(true);
    });

    // The upload used to live in component data, so it did not survive a remount.
    test('surviving state is held in the store, not the component', async () => {
      const mediaStore = useMediaStore();
      await mediaStore.setBackingTrack(
        new File(['backing'], 'backing.mp3', { type: 'audio/mpeg' })
      );

      const wrapper = mountTab();

      expect(wrapper.vm.isBackingTrackUserUploaded).toBe(true);
      expect(wrapper.vm.backingTrackFile?.name).toBe('backing.mp3');
    });

    test('clearing the upload resets the store', async () => {
      const mediaStore = useMediaStore();
      const wrapper = mountTab();

      await wrapper.vm.onBackingTrackFileChange(
        new File(['backing'], 'backing.mp3', { type: 'audio/mpeg' })
      );
      expect(mediaStore.isBackingTrackUserUploaded).toBe(true);

      await wrapper.vm.onBackingTrackFileChange(null);

      expect(mediaStore.separatedTrack).toBeNull();
      expect(mediaStore.isBackingTrackUserUploaded).toBe(false);
    });
  });

  describe('separateTrack', () => {
    test('separates using the model currently held in the store', async () => {
      const mediaStore = useMediaStore();
      const startSeparation = vi
        .spyOn(mediaStore, 'startSeparation')
        .mockResolvedValue(undefined as never);
      const songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
      mediaStore.songFile = songFile;
      mediaStore.separationModel = NO_VOCALS_SEPARATOR_MODEL;

      const wrapper = mountTab();
      await wrapper.vm.separateTrack();

      expect(startSeparation).toHaveBeenCalledWith(
        mediaStore.songFile,
        NO_VOCALS_SEPARATOR_MODEL
      );
    });
  });

  // The tab no longer emits update:modelValue; it used to emit an object of
  // undefined values built from properties the component did not have.
  test('does not emit update:modelValue when metadata changes', async () => {
    const mediaStore = useMediaStore();
    const wrapper = mountTab();

    mediaStore.songArtist = 'Steely Dan';
    mediaStore.songTitle = 'The Last Mall';
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
