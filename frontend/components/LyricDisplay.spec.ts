import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';

import LyricDisplay from './LyricDisplay.vue';

const lyricSegments = [{ text: 'Hello_' }, { text: 'big_' }, { text: 'world' }];

describe('LyricDisplay', () => {
  test('splits lyrics into completed, current and upcoming segments', () => {
    const wrapper = mount(LyricDisplay, { props: { lyricSegments, currentSegment: 1 } });

    expect(wrapper.find('.completed-lyrics').text()).toBe('Hello_');
    expect(wrapper.find('.current-lyrics').text()).toBe('big_');
    expect(wrapper.find('.upcoming-lyrics').text()).toBe('world');
  });

  test('does not mark the current segment as in progress by default', () => {
    const wrapper = mount(LyricDisplay, { props: { lyricSegments, currentSegment: 1 } });

    expect(wrapper.find('.current-lyrics').classes()).not.toContain('is-in-progress');
  });

  test('marks the current segment while it is in progress', async () => {
    const wrapper = mount(LyricDisplay, {
      props: { lyricSegments, currentSegment: 1, segmentInProgress: true },
    });

    expect(wrapper.find('.current-lyrics').classes()).toContain('is-in-progress');

    await wrapper.setProps({ segmentInProgress: false });
    expect(wrapper.find('.current-lyrics').classes()).not.toContain('is-in-progress');
  });
});
