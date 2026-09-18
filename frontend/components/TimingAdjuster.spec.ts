import { shallowMount } from '@vue/test-utils';
import TimingAdjuster from './TimingAdjuster.vue';
import { LYRIC_MARKERS } from '@/constants';
import { LyricEvent } from '@/lib/timing';

const lyrics = "Hello world\nSecond line";

function mountAdjuster(timings: LyricEvent[]) {
    return shallowMount(TimingAdjuster, {
        propsData: { lyrics, timings },
        global: { stubs: { 'b-message': true } }
    });
}

describe('TimingAdjuster', () => {
    it('shows the waveform for usable timings', () => {
        const wrapper = mountAdjuster([
            [1.0, LYRIC_MARKERS.SEGMENT_START],
            [2.0, LYRIC_MARKERS.SEGMENT_END],
            [3.0, LYRIC_MARKERS.SEGMENT_START],
            [4.0, LYRIC_MARKERS.SEGMENT_END],
        ]);

        expect(wrapper.vm.error).toBe(null);
        expect(wrapper.vm.regions.length).toBe(2);
        expect(wrapper.find('wavesurfer-stub').exists()).toBe(true);
        expect(wrapper.find('b-message-stub').exists()).toBe(false);
    });

    it('displays an error instead of an empty adjuster when the regions cannot be built', async () => {
        // Timings that begin with a segment end can't be turned into regions.
        // An uploaded timings file is the way to get them.
        const wrapper = mountAdjuster([
            [2.0, LYRIC_MARKERS.SEGMENT_END],
            [3.0, LYRIC_MARKERS.SEGMENT_START],
            [4.0, LYRIC_MARKERS.SEGMENT_END],
        ]);

        await wrapper.vm.$nextTick();
        expect(wrapper.vm.error).toBeTruthy();
        expect(wrapper.find('b-message-stub').exists()).toBe(true);
        expect(wrapper.find('wavesurfer-stub').exists()).toBe(false);
    });

    it('clears the error when the timings become usable again', async () => {
        const wrapper = mountAdjuster([[2.0, LYRIC_MARKERS.SEGMENT_END]]);
        expect(wrapper.vm.error).toBeTruthy();

        await wrapper.setProps({
            timings: [
                [1.0, LYRIC_MARKERS.SEGMENT_START],
                [2.0, LYRIC_MARKERS.SEGMENT_END],
            ]
        });

        expect(wrapper.vm.error).toBe(null);
        expect(wrapper.find('wavesurfer-stub').exists()).toBe(true);
    });
});
