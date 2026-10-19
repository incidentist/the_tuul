import { mount, shallowMount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

import SongTimingTab from './SongTimingTab.vue';
import { useLyricsStore } from '@/stores/lyrics';
import { useTimingsStore } from '@/stores/timings';
import { KEY_CODES, LYRIC_MARKERS } from '@/constants';

// The settings store reads localStorage at construction, which this Node
// build does not provide without --localstorage-file.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
});

// Only the timing logic is under test, so skip rendering the Buefy template
// and render just the <audio> element the component reads playback state from.
function mountTab() {
  return shallowMount({ ...SongTimingTab, render: () => h('audio', { ref: 'audio' }) });
}

// Buefy isn't installed in unit tests, so stand in for the components the
// template uses. b-checkbox gets a real checkbox to exercise v-model.
const Passthrough = defineComponent({
  render() {
    return h('div', this.$slots.default?.());
  },
});
const BCheckbox = defineComponent({
  props: { modelValue: Boolean, disabled: Boolean },
  emits: ['update:modelValue'],
  render() {
    return h('label', [
      h('input', {
        type: 'checkbox',
        checked: this.modelValue,
        disabled: this.disabled,
        onChange: (e: Event) => this.$emit('update:modelValue', (e.target as HTMLInputElement).checked),
      }),
      this.$slots.default?.(),
    ]);
  },
});

function mountTabWithTemplate() {
  const buefy = ['b-tab-item', 'b-collapse', 'b-message', 'b-button', 'b-field', 'b-radio-button', 'b-tooltip'];
  return mount(SongTimingTab, {
    global: {
      components: { ...Object.fromEntries(buefy.map(name => [name, Passthrough])), 'b-checkbox': BCheckbox },
      stubs: { LyricDisplay: true, TimingButtons: true },
    },
  });
}

// Simulate the audio element reaching the end of the song at `time`.
function endSong(vm: any, time: number) {
  const audio = vm.$refs.audio as HTMLAudioElement;
  Object.defineProperty(audio, 'currentTime', { value: time, writable: true, configurable: true });
  Object.defineProperty(audio, 'paused', { value: true, configurable: true });
  Object.defineProperty(audio, 'ended', { value: true, configurable: true });
  vm.onAudioEvent(new Event('ended'));
}

const { SPACEBAR, ENTER } = KEY_CODES;
const { SEGMENT_START: START, SEGMENT_END: END } = LYRIC_MARKERS;

describe('SongTimingTab', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  test('in word mode, spacebar alternates between word start and word end', () => {
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();
    lyricsStore.setLyrics('Hello world');
    lyricsStore.setSyncByWord(true);
    const vm = mountTab().vm as any;

    vm.addTimingEvent(SPACEBAR, 1.0);
    expect(vm.awaitingWordEnd).toBe(true);
    expect(vm.displayedSegment).toBe(0);

    vm.addTimingEvent(SPACEBAR, 1.5);
    expect(vm.awaitingWordEnd).toBe(false);
    expect(vm.displayedSegment).toBe(1);

    vm.addTimingEvent(SPACEBAR, 2.0);
    expect(timingsStore.areTimingsFinished).toBe(false);
    vm.addTimingEvent(SPACEBAR, 2.5);
    // Extra presses after the last word has ended are ignored
    vm.addTimingEvent(SPACEBAR, 3.0);

    expect(timingsStore.rawTimings).toEqual([
      [1.0, START], [1.5, END], [2.0, START], [2.5, END],
    ]);
    expect(timingsStore.areTimingsFinished).toBe(true);
  });

  test('in word mode, Enter is ignored', () => {
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();
    lyricsStore.setLyrics('Hello world');
    lyricsStore.setSyncByWord(true);
    const vm = mountTab().vm as any;

    vm.addTimingEvent(SPACEBAR, 1.0);
    vm.addTimingEvent(ENTER, 1.2);
    vm.addTimingEvent(SPACEBAR, 1.5);

    expect(timingsStore.rawTimings).toEqual([[1.0, START], [1.5, END]]);
  });

  test('in line mode, spacebar starts segments and Enter ends them', () => {
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();
    lyricsStore.setLyrics('Hello world\nSecond line');
    const vm = mountTab().vm as any;

    vm.addTimingEvent(SPACEBAR, 1.0);
    vm.addTimingEvent(SPACEBAR, 2.0);
    vm.addTimingEvent(ENTER, 3.0);

    expect(vm.awaitingWordEnd).toBe(false);
    expect(timingsStore.rawTimings).toEqual([[1.0, START], [2.0, START], [3.0, END]]);
    expect(timingsStore.areTimingsFinished).toBe(true);
  });

  test('in word mode, the song ending closes the word still being sung', () => {
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();
    lyricsStore.setLyrics('Hello');
    lyricsStore.setSyncByWord(true);
    const vm = mountTab().vm as any;

    vm.addTimingEvent(SPACEBAR, 1.0);
    endSong(vm, 4.0);

    expect(vm.awaitingWordEnd).toBe(false);
    expect(timingsStore.rawTimings).toEqual([[1.0, START], [4.0, END]]);
  });

  test('in word mode, the song ending adds nothing when no word is in progress', () => {
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();
    lyricsStore.setLyrics('Hello world');
    lyricsStore.setSyncByWord(true);
    const vm = mountTab().vm as any;

    vm.addTimingEvent(SPACEBAR, 1.0);
    vm.addTimingEvent(SPACEBAR, 1.5);
    endSong(vm, 4.0);

    expect(vm.awaitingWordEnd).toBe(false);
    expect(timingsStore.rawTimings).toEqual([[1.0, START], [1.5, END]]);
  });

  test('in line mode, the song ending marks the end of the last segment', () => {
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();
    lyricsStore.setLyrics('Hello world');
    const vm = mountTab().vm as any;

    vm.addTimingEvent(SPACEBAR, 1.0);
    endSong(vm, 4.0);

    expect(timingsStore.rawTimings).toEqual([[1.0, START], [4.0, END]]);
  });

  test('redoing a screen in word mode clears a pending word end', () => {
    const lyricsStore = useLyricsStore();
    const timingsStore = useTimingsStore();
    lyricsStore.setLyrics('Hello world');
    lyricsStore.setSyncByWord(true);
    const vm = mountTab().vm as any;

    vm.addTimingEvent(SPACEBAR, 6.0);
    expect(vm.awaitingWordEnd).toBe(true);

    vm.redoScreen();

    expect(vm.awaitingWordEnd).toBe(false);
    expect(vm.currentSegment).toBe(0);
    expect(vm.displayedSegment).toBe(0);
    expect(vm.$refs.audio.currentTime).toBe(1.0);
    expect(timingsStore.rawTimings).toEqual([]);

    // The next spacebar starts the first word again rather than ending it
    vm.addTimingEvent(SPACEBAR, 6.5);
    expect(vm.awaitingWordEnd).toBe(true);
    expect(timingsStore.rawTimings).toEqual([[6.5, START]]);
  });

  test('switching sync mode clears a pending word end', async () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hello world');
    lyricsStore.setSyncByWord(true);
    const vm = mountTab().vm as any;

    vm.addTimingEvent(SPACEBAR, 1.0);
    expect(vm.awaitingWordEnd).toBe(true);
    expect(vm.isWordToggleMode).toBe(true);

    lyricsStore.setSyncByWord(false);
    await nextTick();

    expect(vm.isWordToggleMode).toBe(false);
    expect(vm.awaitingWordEnd).toBe(false);
    expect(vm.displayedSegment).toBe(vm.currentSegment);
  });

  test('the Sync Each Word checkbox toggles word mode', async () => {
    const lyricsStore = useLyricsStore();
    lyricsStore.setLyrics('Hello world');
    const wrapper = mountTabWithTemplate();
    const checkbox = wrapper.find('input[type="checkbox"]');

    expect(wrapper.text()).toContain('Sync Each Word');
    expect((checkbox.element as HTMLInputElement).checked).toBe(false);

    await checkbox.setValue(true);
    expect(lyricsStore.syncByWord).toBe(true);
    expect((wrapper.vm as any).isWordToggleMode).toBe(true);

    await checkbox.setValue(false);
    expect(lyricsStore.syncByWord).toBe(false);
  });

  test('the Sync Each Word checkbox is disabled while the song is playing', async () => {
    useLyricsStore().setLyrics('Hello world');
    const wrapper = mountTabWithTemplate();
    const vm = wrapper.vm as any;
    const audio = vm.$refs.audio as HTMLAudioElement;
    vi.spyOn(audio, 'play').mockResolvedValue(undefined);
    vi.spyOn(audio, 'pause').mockReturnValue(undefined);
    const checkbox = () => wrapper.find('input[type="checkbox"]').element as HTMLInputElement;

    expect(checkbox().disabled).toBe(false);

    vm.playPause();
    await nextTick();
    expect(checkbox().disabled).toBe(true);

    vm.playPause();
    await nextTick();
    expect(checkbox().disabled).toBe(false);
  });
});
