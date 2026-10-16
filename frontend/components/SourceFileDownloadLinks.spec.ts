import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import SourceFileDownloadLinks from "./SourceFileDownloadLinks.vue";
import type { TrackPair } from "@/stores/media";

const stubIcons = { stubs: { "b-icon": true } };

describe("SourceFileDownloadLinks", () => {
  it("lists an uploaded font under its own file name", () => {
    const font = new File(["font bytes"], "MyFont.ttf");
    const wrapper = mount(SourceFileDownloadLinks, { props: { fonts: [font] }, global: stubIcons });

    expect(wrapper.text()).toContain("MyFont.ttf");
  });

  it("lists the song under its own file name", () => {
    const song = new File(["audio bytes"], "My Song.flac");
    const wrapper = mount(SourceFileDownloadLinks, { props: { song }, global: stubIcons });

    expect(wrapper.text()).toContain("My Song.flac");
  });

  it("lists every track of every pair, prefixed with the model that made it", () => {
    const audio = (bytes: string) => new Blob([bytes], { type: "audio/mpeg" });
    const tracks: TrackPair[] = [
      { source: "UVR_MDXNET_KARA_2.onnx", backing: audio("b1"), vocals: audio("v1") },
      { source: "file:backing/Instrumental.mp3", backing: audio("b2"), vocals: new Blob() },
    ];
    const wrapper = mount(SourceFileDownloadLinks, { props: { tracks }, global: stubIcons });

    expect(wrapper.findAll(".file-item").map((item) => item.text())).toEqual([
      "MDX-Kara-vocals.mp3",
      "MDX-Kara-backing.mp3",
      "Instrumental-backing.mp3",
    ]);
  });

  it("shows nothing when there is no font and no other file", () => {
    const wrapper = mount(SourceFileDownloadLinks, { global: stubIcons });

    expect(wrapper.find(".source-file-links").exists()).toBe(false);
  });

  it("downloads the font when its file name is clicked", async () => {
    const font = new File(["font bytes"], "MyFont.ttf");
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:font");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe("MyFont.ttf");
    });
    const wrapper = mount(SourceFileDownloadLinks, { props: { fonts: [font] }, global: stubIcons });

    await wrapper.find(".file-item button").trigger("click");

    expect(createObjectURL).toHaveBeenCalledWith(font);
    expect(click).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });
});
