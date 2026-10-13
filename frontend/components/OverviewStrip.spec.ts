import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import OverviewStrip from "@/components/OverviewStrip.vue";
import type { RegionReview } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";
import { WebAudioPlayer } from "@/lib/webAudioPlayer";

const STRIP_WIDTH = 200;

// Plain tsc can't see the type the component exports.
interface OverviewRegion {
  start: number;
  end?: number;
  review?: RegionReview;
  selected: boolean;
  hole: boolean;
}

/**
 * A player holding a 100-second song, which records where it was sent.
 */
function fakePlayer() {
  const player = new EventTarget() as EventTarget & {
    currentTime: number;
    duration: number;
    loading: boolean;
  };
  player.currentTime = 0;
  player.duration = 100;
  player.loading = false;
  return player;
}

async function mountStrip(
  props: {
    regions?: OverviewRegion[];
    view?: { start: number; end: number };
    collapsed?: boolean;
  } = {},
) {
  const player = fakePlayer();
  const buffer = { duration: 100, length: 1600, numberOfChannels: 1 } as AudioBuffer;
  const wrapper = mount(OverviewStrip, {
    props: { player: player as unknown as WebAudioPlayer, buffer, ...props },
  });
  const strip = wrapper.element as HTMLElement;
  strip.getBoundingClientRect = () => ({ left: 0, width: STRIP_WIDTH }) as DOMRect;
  strip.setPointerCapture = vi.fn();
  // The duration is read from the player once mounted.
  await wrapper.vm.$nextTick();
  return { wrapper, player };
}

function region(start: number, end?: number, extra: Partial<OverviewRegion> = {}) {
  return { start, end, selected: false, hole: false, ...extra };
}

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 0;
  });
});

describe("OverviewStrip", () => {
  it("places regions as fractions of the song, and runs an open end to the next start", async () => {
    const { wrapper } = await mountStrip({ regions: [region(10, 20), region(30), region(50, 55)] });

    const styles = wrapper.findAll(".overview-region").map((span) => span.attributes("style"));

    expect(styles[0]).toContain("left: 10%");
    expect(styles[0]).toContain("width: 10%");
    expect(styles[1]).toContain("left: 30%");
    expect(styles[1]).toContain("width: 20%");
  });

  it("draws flagged regions last, in their flag color even when selected", async () => {
    const { wrapper } = await mountStrip({
      regions: [
        region(10, 20, { review: "lost", selected: true }),
        region(30, 40, { selected: true }),
      ],
    });

    const classes = wrapper.findAll(".overview-region").map((span) => span.classes());

    expect(classes[0]).toContain("is-selected");
    expect(classes[1]).toEqual(expect.arrayContaining(["is-flagged", "is-lost"]));
    expect(classes[1]).not.toContain("is-selected");
  });

  it("hides the view box while the whole song is in view", async () => {
    const whole = await mountStrip({ view: { start: 0, end: 100 } });
    const part = await mountStrip({ view: { start: 20, end: 30 } });

    expect(whole.wrapper.find(".overview-view").exists()).toBe(false);
    expect(part.wrapper.find(".overview-view").exists()).toBe(true);
  });

  it("seeks to where it is pressed and dragged", async () => {
    const { wrapper, player } = await mountStrip();

    await wrapper.trigger("pointerdown", { pointerId: 1, clientX: 50, pointerType: "touch" });
    expect(player.currentTime).toBe(25);

    await wrapper.trigger("pointermove", { pointerId: 1, clientX: 100, pointerType: "touch" });
    expect(player.currentTime).toBe(50);
    expect(wrapper.emitted("grab")).toHaveLength(1);
  });

  it("asks to expand when touched collapsed, without seeking", async () => {
    const { wrapper, player } = await mountStrip({ collapsed: true });

    await wrapper.trigger("pointerdown", { pointerId: 1, clientX: 50, pointerType: "touch" });

    expect(wrapper.emitted("expand")).toHaveLength(1);
    expect(wrapper.emitted("grab")).toBeUndefined();
    expect(player.currentTime).toBe(0);
  });

  it("scrolls the view when its box is dragged, without seeking", async () => {
    const { wrapper, player } = await mountStrip({ view: { start: 20, end: 30 } });
    const box = wrapper.find(".overview-view");

    await box.trigger("pointerdown", { pointerId: 1, clientX: 50, pointerType: "touch" });
    await wrapper.trigger("pointermove", { pointerId: 1, clientX: 70, pointerType: "touch" });
    await wrapper.trigger("pointerup", { pointerId: 1, pointerType: "touch" });

    expect(player.currentTime).toBe(0);
    expect(wrapper.emitted("scroll-to")).toEqual([[30]]);
    expect(wrapper.emitted("release")).toHaveLength(1);
  });

  it("hands a wheel turn on with the time under the pointer", async () => {
    const { wrapper } = await mountStrip();

    await wrapper.trigger("wheel", { deltaY: -100, clientX: 50 });

    const [[event, time]] = wrapper.emitted("scroll-wheel")!;
    expect((event as WheelEvent).deltaY).toBe(-100);
    expect(time).toBe(25);
  });

  it("follows the player with a slider that seeks it", async () => {
    const { wrapper, player } = await mountStrip();
    const slider = wrapper.get<HTMLInputElement>('input[aria-label="Playback position"]');

    player.currentTime = 75;
    player.dispatchEvent(new Event("timeupdate"));
    expect(slider.element.value).toBe("75");
    expect(slider.attributes("max")).toBe("100");
    expect(slider.attributes("disabled")).toBeUndefined();

    await slider.setValue("30");
    expect(player.currentTime).toBe(30);
  });
});
