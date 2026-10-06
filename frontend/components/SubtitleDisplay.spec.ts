import { shallowMount } from '@vue/test-utils';
import { beforeEach, vi } from 'vitest';
import SubtitlesOctopus from 'libass-wasm';
import SubtitleDisplay from './SubtitleDisplay.vue';

describe('SubtitleDisplay', () => {
    beforeEach(() => {
        vi.mocked(SubtitlesOctopus).mockClear();
    });

    it('renders', () => {
        const wrapper = shallowMount(SubtitleDisplay, {
            propsData: {
                subtitles: '',
                fonts: {}
            }
        });
        expect(wrapper.find('canvas.subtitle-canvas').exists()).toBe(true);
    });

    it('creates the subtitle renderer with the given subtitles', () => {
        shallowMount(SubtitleDisplay, {
            propsData: { subtitles: '[Script Info]', fonts: {} }
        });
        expect(SubtitlesOctopus).toHaveBeenCalledTimes(1);
        expect(vi.mocked(SubtitlesOctopus).mock.calls[0][0].subContent).toBe('[Script Info]');
    });

    it('waits for non-empty subtitles before creating the renderer', async () => {
        // An empty subContent makes the worker crash on an unset subUrl
        const wrapper = shallowMount(SubtitleDisplay, {
            propsData: { subtitles: '', fonts: {} }
        });
        expect(SubtitlesOctopus).not.toHaveBeenCalled();

        // Playback controls are safe to use before the renderer exists
        wrapper.vm.setPlayhead(1.5);
        wrapper.vm.play();
        wrapper.vm.pause();

        await wrapper.setProps({ subtitles: '[Script Info]' });
        expect(SubtitlesOctopus).toHaveBeenCalledTimes(1);
        expect(vi.mocked(SubtitlesOctopus).mock.calls[0][0].subContent).toBe('[Script Info]');
    });

    it('updates the track of an existing renderer instead of creating another', async () => {
        const wrapper = shallowMount(SubtitleDisplay, {
            propsData: { subtitles: '[Script Info]', fonts: {} }
        });
        const manager = vi.mocked(SubtitlesOctopus).mock.results[0].value;

        await wrapper.setProps({ subtitles: '[Script Info] v2' });
        expect(SubtitlesOctopus).toHaveBeenCalledTimes(1);
        expect(manager.setTrack).toHaveBeenCalledWith('[Script Info] v2');
    });
});
