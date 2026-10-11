import { test, expect, Locator, Page } from "@playwright/test";
import {
  defaultTestConfig,
  setupTestEnvironment,
  enableAdvancedMode,
  navigateToTab,
  TabId,
  uploadAudioFile,
  loadAndEnterLyrics,
  uploadTimingsFile,
  scrollWaveformIntoView,
  waveformPixelsPerSecond,
  adjustTiming,
  playbackPosition,
} from "./utils";
import { DEFAULT_VOICE_ID } from "../../frontend/lib/voices";

// One screen of four lines: One 1-2 s, Two 3-5 s, Three 5-6 s and Four 7-8 s.
const FIXTURE_TIMINGS = "timings-adjust-group.json";
const LYRICS = "One\nTwo\nThree\nFour";

function modeButton(page: Page, mode: "Adjust" | "Lines") {
  return page.getByRole("button", { name: mode, exact: true });
}

async function setupDisplayMode(page: Page, lyrics = LYRICS, timings = FIXTURE_TIMINGS) {
  await navigateToTab(page, TabId.SongInfo);
  await uploadAudioFile(
    page,
    defaultTestConfig.audioFile,
    defaultTestConfig.artist,
    defaultTestConfig.title,
  );
  await navigateToTab(page, TabId.LyricInput);
  await loadAndEnterLyrics(page, lyrics);
  await navigateToTab(page, TabId.SongInfo);
  await uploadTimingsFile(page, timings);
  await navigateToTab(page, TabId.TimingAdjustment);
  await modeButton(page, "Lines").click();
  await scrollWaveformIntoView(page);
  // The scroll can bring a frame under the pointer, which tints it.
  await page.mouse.move(0, 0);
  await expect(page.locator('[part="display-band"]')).toHaveCount(lyrics.split(/\n+/).length);
}

/**
 * The handle on one side of a line's frame. The handles are drawn apart from the frames.
 */
function handle(page: Page, side: "start" | "end", line = 0) {
  return page.locator(`[part~="display-band-${side}"]`).nth(line);
}

function firstSegment(page: Page) {
  return page.evaluate(
    (voice) => JSON.parse(localStorage.getItem("timings._segments")!)[voice][0],
    DEFAULT_VOICE_ID,
  );
}

/**
 * Drag the first line's end edge ten seconds back.
 */
async function dragFirstEndEdgeBack(page: Page) {
  // The first line shows until its screen ends at 8 s. Far more than the six seconds back to its
  // own end at 2 s.
  const endEdge = handle(page, "end");
  const pixelsPerSecond = await waveformPixelsPerSecond(page);
  const box = (await endEdge.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 10 * pixelsPerSecond, y, { steps: 10 });
  await page.mouse.up();
}

function segments(page: Page) {
  return page.evaluate(
    (voice) => JSON.parse(localStorage.getItem("timings._segments")!)[voice],
    DEFAULT_VOICE_ID,
  );
}

/**
 * A point on the waveform, at a time in seconds and in the middle of one of the five rows.
 */
async function waveformPoint(page: Page, time: number, row: number) {
  const wrapper = (await page
    .locator('.timing-adjustment-tab .wavesurfer-container [part~="wrapper"]')
    .boundingBox())!;
  return {
    x: wrapper.x + time * (await waveformPixelsPerSecond(page)),
    y: wrapper.y + ((row + 0.5) * wrapper.height) / 5,
  };
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

function playhead(page: Page) {
  return playbackPosition(page);
}

test.describe("Timing tab Lines mode", () => {
  test.describe.configure({ timeout: 60000 });

  test.beforeEach(async ({ page }) => {
    await setupTestEnvironment(page);
    await enableAdvancedMode(page);
  });

  test("stores a dragged edge, stopped at the line's syllables, and resets it on a double-click", async ({
    page,
  }) => {
    await setupDisplayMode(page);
    await expect(page.locator('[part~="region"]')).toHaveCount(0);

    const frame = page.locator('[part="display-band"]').first();
    const endEdge = handle(page, "end");
    const borderRight = () => frame.evaluate((el) => getComputedStyle(el).borderRightStyle);
    await expect.poll(borderRight).toBe("dashed");

    await dragFirstEndEdgeBack(page);

    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 2 });
    await expect.poll(borderRight).toBe("solid");

    const before = await playhead(page);
    await endEdge.dblclick();

    await expect
      .poll(() => firstSegment(page).then((segment) => segment.displayEnd))
      .toBe(undefined);
    await expect.poll(borderRight).toBe("dashed");
    expect(await playhead(page)).toBe(before);
  });

  test("puts every line back on the automatic times with the eraser", async ({ page }) => {
    await setupDisplayMode(page);
    const reset = page.getByRole("button", { name: "Reset line display times" });
    await expect(reset).toBeDisabled();

    await dragFirstEndEdgeBack(page);
    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 2 });

    await reset.click();

    await expect
      .poll(() => firstSegment(page).then((segment) => segment.displayEnd))
      .toBe(undefined);
    const frame = page.locator('[part="display-band"]').first();
    await expect
      .poll(() => frame.evaluate((el) => getComputedStyle(el).borderRightStyle))
      .toBe("dashed");
    await expect(reset).toBeDisabled();
  });

  test("pushes a stored end along when a syllable is dragged past it", async ({ page }) => {
    await setupDisplayMode(page);
    await dragFirstEndEdgeBack(page);
    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 2 });

    await modeButton(page, "Adjust").click();
    // The next line starts at 3 s, which leaves room to end the first one half a second later.
    await adjustTiming(page, 0, 0, 0.5 * (await waveformPixelsPerSecond(page)));

    await expect
      .poll(() => firstSegment(page).then((segment) => segment.displayEnd))
      .toBeGreaterThan(2.4);
    const { end, displayEnd } = await firstSegment(page);
    expect(displayEnd).toBeCloseTo(end, 5);

    await modeButton(page, "Lines").click();
    await scrollWaveformIntoView(page);
    const frame = page.locator('[part="display-band"]').first();
    const wrapper = page.locator('.timing-adjustment-tab .wavesurfer-container [part~="wrapper"]');
    const pixelsPerSecond = await waveformPixelsPerSecond(page);
    const frameBox = (await frame.boundingBox())!;
    const wrapperBox = (await wrapper.boundingBox())!;
    const frameEnd = (frameBox.x + frameBox.width - wrapperBox.x) / pixelsPerSecond;
    expect(frameEnd).toBeCloseTo(displayEnd, 1);
    expect(await frame.evaluate((el) => getComputedStyle(el).borderRightStyle)).toBe("solid");
  });

  test("tints the hovered or dragged frame, and the frames of lines at its height", async ({
    page,
  }) => {
    // Two screens of two lines, so One and Three share a height, and so do Two and Four.
    await setupDisplayMode(page, "One\nTwo\n\nThree\nFour");
    const frames = page.locator('[part="display-band"]');
    const fills = () =>
      frames.evaluateAll((all) => all.map((frame) => getComputedStyle(frame).backgroundColor));
    // Every frame has the same faint fill at rest.
    await expect.poll(async () => new Set(await fills()).size).toBe(1);
    const [none] = await fills();
    expect(none).not.toBe("rgba(0, 0, 0, 0)");

    await frames.nth(1).hover();
    const [, active, , sameHeight] = await fills();
    expect(active).not.toBe(none);
    expect(sameHeight).not.toBe(none);
    expect(sameHeight).not.toBe(active);
    await expect.poll(fills).toEqual([none, active, none, sameHeight]);

    // The tint follows a drag after the pointer has left the frame.
    const box = (await handle(page, "end").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 200, { steps: 10 });
    await expect.poll(fills).toEqual([active, none, sameHeight, none]);

    await page.mouse.up();
    await page.mouse.move(0, 0);
    await expect.poll(fills).toEqual([none, none, none, none]);
  });

  test("stops a dragged end at the line at its height, which then appears as it ends", async ({
    page,
  }) => {
    // Two screens of two lines, so One and Three share a height. Three is sung from 5 s.
    await setupDisplayMode(page, "One\nTwo\n\nThree\nFour");
    const frames = page.locator('[part="display-band"]');
    const pixelsPerSecond = await waveformPixelsPerSecond(page);
    const wrapper = page.locator('.timing-adjustment-tab .wavesurfer-container [part~="wrapper"]');
    const secondsAt = async (element: Locator) => {
      const [box, waveform] = [await element.boundingBox(), await wrapper.boundingBox()];
      return (box!.x - waveform!.x) / pixelsPerSecond;
    };
    const box = (await handle(page, "end").boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);

    // Hovering One marks where its end would reach Three. Nothing limits its start.
    const endLimit = page.locator('[part~="display-band-limit-end"]');
    await expect(endLimit).toBeVisible();
    expect(await secondsAt(endLimit)).toBeCloseTo(5, 1);
    await expect(page.locator('[part~="display-band-limit-start"]')).toBeHidden();

    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 6 * pixelsPerSecond, y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 5 });
    await expect.poll(() => secondsAt(frames.nth(2))).toBeCloseTo(5, 1);
    await expect(page.locator("[data-overlaps]")).toHaveCount(0);
  });

  test("keeps a handle within reach under the frame of another line in its row", async ({
    page,
  }) => {
    // One and Six share the first row. Six's screen shows from when One's ends until 12 s,
    // and Four, at One's height, counts in from 6 s.
    await setupDisplayMode(
      page,
      "One\nTwo\n\nThree\nFour\nFive\nSix",
      "timings-adjust-six-lines.json",
    );
    const pixelsPerSecond = await waveformPixelsPerSecond(page);
    const endEdge = handle(page, "end");
    // One's end meets Six's start, so this grabs the half of the edge inside One's frame.
    let box = (await endEdge.boundingBox())!;
    let x = box.x + box.width / 4;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 4 * pixelsPerSecond, y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 6 });

    box = (await endEdge.boundingBox())!;
    x = box.x + box.width / 2;
    const topmost = await endEdge.evaluate(
      (edge, [x, y]) => edge.contains((edge.getRootNode() as ShadowRoot).elementFromPoint(x, y)),
      [x, y],
    );
    expect(topmost).toBe(true);

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 10 * pixelsPerSecond, y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => firstSegment(page)).toMatchObject({ displayEnd: 2 });
  });

  test("moves every frame of a box selection together", async ({ page }) => {
    await setupDisplayMode(page);
    const frames = page.locator('[part="display-band"]');
    const pixelsPerSecond = await waveformPixelsPerSecond(page);
    const wrapperX = (await page
      .locator('.timing-adjustment-tab .wavesurfer-container [part~="wrapper"]')
      .boundingBox())!.x;
    const spans = () =>
      frames.evaluateAll((all) =>
        all.map((frame) => {
          const { left, right } = frame.getBoundingClientRect();
          return [left, right];
        }),
      );
    const before = await spans();

    // The four lines take the first four rows, which leaves the last one bare.
    await drag(page, await waveformPoint(page, 4, 4), await waveformPoint(page, 3, 2));
    const from = await waveformPoint(page, 4, 2);
    await drag(page, from, { x: from.x + 0.5 * pixelsPerSecond, y: from.y });

    const seconds = (x: number) => (x - wrapperX) / pixelsPerSecond;
    const moved = ([left, right]: number[]) => ({
      displayStart: expect.closeTo(seconds(left) + 0.5, 1),
      displayEnd: expect.closeTo(seconds(right) + 0.5, 1),
    });
    await expect
      .poll(() => segments(page))
      .toMatchObject([{}, {}, moved(before[2]), moved(before[3])]);
    const [one, two] = await segments(page);
    expect(one.displayStart).toBeUndefined();
    expect(two.displayStart).toBeUndefined();
    expect(await spans()).toEqual([before[0], before[1], expect.anything(), expect.anything()]);
  });

  test("moves the same edge of every selected frame, as far as the first can go", async ({
    page,
  }) => {
    await setupDisplayMode(page);
    const frames = page.locator('[part="display-band"]');
    const borderColor = (line: number) =>
      frames.nth(line).evaluate((frame) => getComputedStyle(frame).borderTopColor);
    const unselected = await borderColor(0);
    for (const line of [0, 1]) {
      const { x, y } = await waveformPoint(page, 4, line);
      await page.mouse.click(x, y);
    }
    expect(await borderColor(1)).not.toBe(unselected);

    // Two is sung until 5 s, which stops both ends there, three seconds after One's own end.
    await dragFirstEndEdgeBack(page);

    await expect
      .poll(() => segments(page).then((all) => all.slice(0, 2)))
      .toMatchObject([{ displayEnd: expect.closeTo(5, 5) }, { displayEnd: expect.closeTo(5, 5) }]);
    const [one, two, three] = await segments(page);
    expect(one.displayStart).toBeUndefined();
    expect(two.displayStart).toBeUndefined();
    expect(three.displayEnd).toBeUndefined();

    // A click on the bare last row clears the selection.
    const bare = await waveformPoint(page, 4, 4);
    await page.mouse.click(bare.x, bare.y);
    await expect.poll(() => borderColor(0)).toBe(unselected);
    await expect.poll(() => borderColor(1)).toBe(unselected);
  });
});
