import { shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import SubtitleDisplay from "./SubtitleDisplay.vue";

describe("SubtitleDisplay", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("renders", () => {
    const wrapper = shallowMount(SubtitleDisplay, {
      props: {
        subtitles: "",
        fonts: {},
      },
    });
    expect(wrapper.find("canvas.subtitle-canvas").exists()).toBe(true);
  });
});
