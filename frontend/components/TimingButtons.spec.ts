import { mount } from '@vue/test-utils';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';

import TimingButtons from './TimingButtons.vue';
import { KEY_CODES } from '@/constants';

// Buefy isn't installed in unit tests; a plain button lets listeners fall through.
const BButton = defineComponent({
  render() {
    return h('button', this.$slots.default?.());
  },
});

function mountButtons(props = {}) {
  return mount(TimingButtons, { props, global: { components: { 'b-button': BButton } } });
}

function emittedKeyCodes(wrapper: ReturnType<typeof mountButtons>) {
  return (wrapper.emitted('keydown') ?? []).map(([e]) => (e as KeyboardEvent).keyCode);
}

describe('TimingButtons', () => {
  test('shows Spacebar and Enter buttons by default', async () => {
    const wrapper = mountButtons();
    const buttons = wrapper.findAll('button');

    expect(buttons.map(b => b.text())).toEqual(['Spacebar', 'Enter']);

    await buttons[0].trigger('mousedown');
    await buttons[1].trigger('mousedown');
    expect(emittedKeyCodes(wrapper)).toEqual([KEY_CODES.SPACEBAR, KEY_CODES.ENTER]);
  });

  test('hides the Enter button when showEnter is false', async () => {
    const wrapper = mountButtons({ showEnter: false });
    const buttons = wrapper.findAll('button');

    expect(buttons.map(b => b.text())).toEqual(['Spacebar']);

    await buttons[0].trigger('mousedown');
    expect(emittedKeyCodes(wrapper)).toEqual([KEY_CODES.SPACEBAR]);
  });
});
