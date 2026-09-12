import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';

import VideoCreationProgressIndicator from './VideoCreationProgressIndicator.vue';
import { CreationPhase, SeparationPhase, SeparationProgress } from '@/types';

function mountIndicator(props: Record<string, unknown>) {
  return mount(VideoCreationProgressIndicator, {
    props,
    global: {
      stubs: {
        'b-message': { template: '<div><slot /></div>' },
        'b-progress': { props: ['value'], template: '<div class="progress"><slot /></div>' },
      },
    },
  });
}

const separatingProps = {
  phase: CreationPhase.SeparatingVocals,
  songDuration: 100,
  elapsedTime: 25_000,
  progress: 0,
};

describe('VideoCreationProgressIndicator', () => {
  describe('while separating vocals', () => {
    test('estimates progress from elapsed time when the backend reports nothing', () => {
      const wrapper = mountIndicator(separatingProps);

      expect(wrapper.vm.progressValue).toBe(25);
      expect(wrapper.vm.progressMessage).toBe('Creating instrumental track: 25%');
    });

    test('caps the elapsed-time estimate at 100%', () => {
      const wrapper = mountIndicator({ ...separatingProps, elapsedTime: 500_000 });

      expect(wrapper.vm.progressValue).toBe(100);
    });

    test('uses the reported fraction when the backend provides one', () => {
      const separationProgress: SeparationProgress = { phase: SeparationPhase.Separating, fraction: 0.6 };
      const wrapper = mountIndicator({ ...separatingProps, separationProgress });

      expect(wrapper.vm.progressValue).toBe(60);
      expect(wrapper.vm.progressMessage).toBe('Creating instrumental track: 60%');
    });

    test('shows an indeterminate bar with a phase message when the fraction is unknown', () => {
      const separationProgress: SeparationProgress = { phase: SeparationPhase.DownloadingModel, fraction: null };
      const wrapper = mountIndicator({ ...separatingProps, separationProgress });

      expect(wrapper.vm.progressValue).toBeUndefined();
      expect(wrapper.vm.progressMessage).toBe('Downloading separation model...');
    });

    test('labels the model download and load phases', () => {
      const downloading = mountIndicator({
        ...separatingProps,
        separationProgress: { phase: SeparationPhase.DownloadingModel, fraction: 0.5 },
      });
      const loading = mountIndicator({
        ...separatingProps,
        separationProgress: { phase: SeparationPhase.LoadingModel, fraction: null },
      });

      expect(downloading.vm.progressMessage).toBe('Downloading separation model: 50%');
      expect(loading.vm.progressMessage).toBe('Loading separation model...');
    });
  });

  describe('while creating the video', () => {
    test('shows ffmpeg progress and ignores separation progress', () => {
      const wrapper = mountIndicator({
        phase: CreationPhase.CreatingVideo,
        songDuration: 100,
        elapsedTime: 0,
        progress: 0.42,
        separationProgress: { phase: SeparationPhase.Separating, fraction: 0.9 },
      });

      expect(wrapper.vm.progressValue).toBe(42);
      expect(wrapper.vm.progressMessage).toBe('Creating video: 42%');
    });
  });
});
