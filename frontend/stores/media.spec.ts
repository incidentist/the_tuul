import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// separateTrack posts to the separation API, so stub the network call.
vi.mock('@/lib/audio', () => ({
  separateTrack: vi.fn(),
}));

import { separateTrack } from '@/lib/audio';
import {
  useMediaStore,
  BACKING_VOCALS_SEPARATOR_MODEL,
  NO_VOCALS_SEPARATOR_MODEL,
} from './media';

describe('Media Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(separateTrack).mockReset();
  });

  test('defaults to the backing-vocals separation model', () => {
    const mediaStore = useMediaStore();
    expect(mediaStore.separationModel).toBe(BACKING_VOCALS_SEPARATOR_MODEL);
  });

  describe('setBackingTrack', () => {
    test('stores an uploaded file and flags it as user-supplied', async () => {
      const mediaStore = useMediaStore();
      const file = new File(['backing'], 'backing.mp3', { type: 'audio/mpeg' });

      await mediaStore.setBackingTrack(file);

      // Pinia wraps stored values in a reactive proxy, so compare identity
      // through an own property rather than with toBe.
      expect(mediaStore.separatedTrack?.backing.name).toBe('backing.mp3');
      expect(mediaStore.isBackingTrackUserUploaded).toBe(true);
    });

    test('replaces the backing track of an existing separation result', async () => {
      const mediaStore = useMediaStore();
      const vocals = new Blob(['vocals-payload']);
      mediaStore.separatedTrack = { backing: new Blob(['old']), vocals };

      const file = new File(['new'], 'new.mp3', { type: 'audio/mpeg' });
      await mediaStore.setBackingTrack(file);

      expect(mediaStore.separatedTrack?.backing.name).toBe('new.mp3');
      // The separated vocals are still needed by the timing adjuster
      expect(await mediaStore.separatedTrack?.vocals.text()).toBe('vocals-payload');
      expect(mediaStore.isBackingTrackUserUploaded).toBe(true);
    });

    test('clearing the upload discards the track rather than leaving a null backing', async () => {
      const mediaStore = useMediaStore();
      await mediaStore.setBackingTrack(
        new File(['backing'], 'backing.mp3', { type: 'audio/mpeg' })
      );

      await mediaStore.setBackingTrack(null);

      expect(mediaStore.separatedTrack).toBeNull();
      expect(mediaStore.isBackingTrackUserUploaded).toBe(false);
    });
  });

  describe('startSeparation', () => {
    test('stores the separation result without flagging it as user-supplied', async () => {
      const mediaStore = useMediaStore();
      const result = {
        backing: new Blob(['backing-payload']),
        vocals: new Blob(['vocals-payload']),
      };
      vi.mocked(separateTrack).mockResolvedValue(result);

      const songFile = new File(['song'], 'song.mp3', { type: 'audio/mpeg' });
      await mediaStore.startSeparation(songFile, NO_VOCALS_SEPARATOR_MODEL);

      expect(separateTrack).toHaveBeenCalledWith(
        songFile,
        NO_VOCALS_SEPARATOR_MODEL
      );
      expect(await mediaStore.separatedTrack?.backing.text()).toBe(
        'backing-payload'
      );
      expect(mediaStore.isBackingTrackUserUploaded).toBe(false);
      expect(mediaStore.isProcessing).toBe(false);
    });

    test('clears the user-uploaded flag when separation replaces an uploaded track', async () => {
      const mediaStore = useMediaStore();
      await mediaStore.setBackingTrack(
        new File(['backing'], 'backing.mp3', { type: 'audio/mpeg' })
      );
      expect(mediaStore.isBackingTrackUserUploaded).toBe(true);

      vi.mocked(separateTrack).mockResolvedValue({
        backing: new Blob(['b']),
        vocals: new Blob(['v']),
      });
      await mediaStore.startSeparation(
        new File(['song'], 'song.mp3', { type: 'audio/mpeg' }),
        BACKING_VOCALS_SEPARATOR_MODEL
      );

      expect(mediaStore.isBackingTrackUserUploaded).toBe(false);
    });

    test('records the error and stops processing when separation fails', async () => {
      const mediaStore = useMediaStore();
      vi.mocked(separateTrack).mockRejectedValue(new Error('separation blew up'));

      await mediaStore.startSeparation(
        new File(['song'], 'song.mp3', { type: 'audio/mpeg' }),
        BACKING_VOCALS_SEPARATOR_MODEL
      );

      expect(mediaStore.error).toBe('separation blew up');
      expect(mediaStore.separatedTrack).toBeNull();
      expect(mediaStore.isProcessing).toBe(false);
    });
  });
});
