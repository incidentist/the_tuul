import { describe, it, expect, beforeEach } from "vitest";
import { mount, shallowMount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import VideoPreview from "@/components/VideoPreview.vue";

describe("VideoPreview", () => {
  interface Props {
    songFile: Blob;
    subtitles: string;
    fonts: Record<string, any>;
    backgroundColor: string;
    audioDelay: number;
    background?: Blob;
    previewTrack?: string;
  }

  let props: Props;

  beforeEach(() => {
    setActivePinia(createPinia());
    props = {
      songFile: new Blob(["dummy audio data"], { type: "audio/mp3" }),
      subtitles:
        "[Script Info]\nScriptType: v4.00+\nPlayResX: 384\nPlayResY: 288\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Hello World",
      fonts: {},
      backgroundColor: "#000000",
      audioDelay: 0,
    };
  });

  it("mounts successfully", async () => {
    const wrapper = shallowMount(VideoPreview, {
      props,
      stubs: {
        "b-message": true,
      },
    });

    expect(wrapper.exists()).toBe(true);
  });

  it("renders the correct elements", async () => {
    const wrapper = mount(VideoPreview, {
      props,
      stubs: {
        "b-message": true,
      },
    });

    expect(wrapper.find(".preview-container").exists()).toBe(true);
    expect(wrapper.find(".subtitle-canvas").exists()).toBe(true);
    expect(wrapper.find("audio").exists()).toBe(true);
  });
});
