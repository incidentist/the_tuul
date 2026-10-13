import { describe, it, expect, vi } from "vitest";
import { shallowMount } from "@vue/test-utils";
import TimingAdjuster from "@/components/TimingAdjuster.vue";
import { TimedSegment } from "@/lib/timedSegments";
import { Region, RegionParams } from "@/lib/wavesurferPlugins/OpenEndedRegionPlugin";

/**
 * The regions the adjuster draws for `segments`, by segment index.
 */
function regionsFor(segments: TimedSegment[]) {
  const wrapper = shallowMount(TimingAdjuster, { props: { segments } });
  return Object.fromEntries(
    (wrapper.vm.regions as RegionParams[]).map(({ id, start, review }) => [
      Number(id?.split("_")[1]),
      { start, review },
    ]),
  );
}

describe("TimingAdjuster regions", () => {
  it("passes each segment's review flag to its region", () => {
    expect(
      regionsFor([
        { text: "one_", start: 1 },
        { text: "two_", review: "lost" },
        { text: "three", start: 3, review: "moved" },
      ]),
    ).toEqual({
      0: { start: 1, review: undefined },
      1: { start: 2, review: "lost" },
      2: { start: 3, review: "moved" },
    });
  });

  it("stacks lost segments before the first timed one just before its start", () => {
    const regions = regionsFor([
      { text: "one_", review: "lost" },
      { text: "two_", review: "lost" },
      { text: "three", start: 3 },
    ]);

    expect(regions[0].start).toBeCloseTo(3);
    expect(regions[0].start).toBeLessThan(3);
    expect(regions[1].start).toBe(regions[0].start);
  });

  it("stacks lost segments after the last timed one at its end", () => {
    const regions = regionsFor([
      { text: "one_", start: 1, end: 1.5 },
      { text: "two_", review: "lost" },
      { text: "three", review: "lost" },
    ]);

    expect(regions[1]).toEqual({ start: 1.5, review: "lost" });
    expect(regions[2]).toEqual({ start: 1.5, review: "lost" });
  });

  it("stacks them a second after an open-ended last segment", () => {
    const regions = regionsFor([
      { text: "one_", start: 1 },
      { text: "two", review: "lost" },
    ]);

    expect(regions[1]).toEqual({ start: 2, review: "lost" });
  });

  it("draws nothing for unflagged segments with no position, or a voice with no timing", () => {
    expect(Object.keys(regionsFor([{ text: "one_", start: 1, end: 2 }, { text: "two" }]))).toEqual([
      "0",
    ]);
    expect(regionsFor([{ text: "one", review: "lost" }])).toEqual({});
  });
});

describe("TimingAdjuster region playback", () => {
  const region = { id: "segment_0", start: 10, end: 11, isOpenEnded: false } as Region;

  /**
   * An adjuster in Adjust mode whose player reports `paused`, with its range playback and seeks
   * recorded.
   */
  function adjusterWhile(paused: boolean) {
    const wrapper = shallowMount(TimingAdjuster, {
      props: { segments: [{ text: "one", start: 9, end: 10 }], prerollSeconds: 2 },
    });
    const player = wrapper.vm.player;
    vi.spyOn(player, "paused", "get").mockReturnValue(paused);
    const playRange = vi.spyOn(player, "playRange").mockImplementation(() => {});
    const seeks: number[] = [];
    vi.spyOn(player, "currentTime", "set").mockImplementation((time) => seeks.push(time));
    return { wrapper, playRange, seeks };
  }

  it("plays a released region through while paused", async () => {
    const { wrapper, playRange, seeks } = adjusterWhile(true);

    wrapper.vm.onRegionsUpdated([region]);
    await wrapper.vm.$nextTick();

    expect(playRange).toHaveBeenCalledWith(10, 11);
    expect(seeks).toEqual([]);
  });

  it("moves the playhead to the preroll before a released region while playing", async () => {
    const { wrapper, playRange, seeks } = adjusterWhile(false);

    wrapper.vm.onRegionsUpdated([region]);
    await wrapper.vm.$nextTick();

    expect(playRange).not.toHaveBeenCalled();
    expect(seeks).toEqual([8]);
  });

  it("plays a clicked region only while paused", () => {
    const click = () => new MouseEvent("click");
    const paused = adjusterWhile(true);
    paused.wrapper.vm.onRegionClicked(region, click());
    expect(paused.playRange).toHaveBeenCalledWith(10, 11);

    const playing = adjusterWhile(false);
    playing.wrapper.vm.onRegionClicked(region, click());
    expect(playing.playRange).not.toHaveBeenCalled();
    expect(playing.seeks).toEqual([]);
  });
});

describe("TimingAdjuster floating overview", () => {
  function immersiveAdjuster() {
    vi.useFakeTimers();
    const wrapper = shallowMount(TimingAdjuster, {
      props: { segments: [], immersive: true },
      global: {
        stubs: { Wavesurfer: { template: "<div />", methods: { endSwipeMomentum() {} } } },
      },
    });
    return wrapper.vm as unknown as {
      floatingOverview: { expanded: boolean };
      expandFloatingOverview(): void;
      holdFloatingOverview(): void;
      collapseFloatingOverview(afterUse?: boolean): void;
    };
  }

  it("expands while the view moves by hand, and collapses two seconds after it stops", () => {
    const adjuster = immersiveAdjuster();

    adjuster.expandFloatingOverview();
    vi.advanceTimersByTime(1500);
    adjuster.expandFloatingOverview();
    vi.advanceTimersByTime(1500);
    expect(adjuster.floatingOverview.expanded).toBe(true);

    vi.advanceTimersByTime(500);
    expect(adjuster.floatingOverview.expanded).toBe(false);
    vi.useRealTimers();
  });

  it("stays expanded while held, and collapses half a second after release", () => {
    const adjuster = immersiveAdjuster();

    adjuster.expandFloatingOverview();
    adjuster.holdFloatingOverview();
    vi.advanceTimersByTime(5000);
    expect(adjuster.floatingOverview.expanded).toBe(true);

    adjuster.collapseFloatingOverview(true);
    vi.advanceTimersByTime(500);
    expect(adjuster.floatingOverview.expanded).toBe(false);
    vi.useRealTimers();
  });

  it("never expands outside immersive mode", () => {
    const wrapper = shallowMount(TimingAdjuster, { props: { segments: [] } });
    const adjuster = wrapper.vm as unknown as {
      floatingOverview: { expanded: boolean };
      expandFloatingOverview(): void;
    };

    adjuster.expandFloatingOverview();

    expect(adjuster.floatingOverview.expanded).toBe(false);
  });
});
