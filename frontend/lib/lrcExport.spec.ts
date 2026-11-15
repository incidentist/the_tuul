import yaml from "js-yaml";
import { projectFilesToLrc, UNTIMED_LINES_LEFT_OUT } from "./lrcExport";

const settings = yaml.dump({
  song: { title: "Pale Moon", artist: "The Placeholders", duration: 95.4 },
  videoOptions: {},
});

describe("projectFilesToLrc", () => {
  test("stamps each line with its first word, and clears the screen after a long silence", () => {
    const result = projectFilesToLrc({
      lyrics: "Pale_moon\nri/sing|slow\n\nover",
      timings: {
        "Voice 1": [
          { text: "Pale_", start: 5 },
          { text: "moon\n", start: 5.5, end: 6 },
          { text: "ri/", start: 7 },
          { text: "sing|", start: 7.25 },
          { text: "slow\n\n", start: 8, end: 9.004 },
          { text: "over", start: 61.5, end: 63 },
        ],
      },
      settings,
    });

    expect(result.warnings).toEqual([]);
    expect(result.lrc).toBe(
      [
        "[ti:Pale Moon]",
        "[ar:The Placeholders]",
        "[length:01:35]",
        "[re:Le Toul]",
        "[00:05.00]Pale moon",
        // A one-second release before the next line is no break.
        "[00:07.00]rising slow",
        "[00:09.00]",
        "[01:01.50]over",
        "[01:03.00]",
        "",
      ].join("\n"),
    );
  });

  test("leaves out untimed lines, and keeps untimed words of a timed line", () => {
    const result = projectFilesToLrc({
      lyrics: "Pale_moon\nri/sing",
      timings: {
        "Voice 1": [
          { text: "Pale_" },
          { text: "moon\n", start: 5.5 },
          { text: "ri/" },
          { text: "sing" },
        ],
      },
      settings,
    });

    expect(result.warnings).toEqual([UNTIMED_LINES_LEFT_OUT]);
    expect(result.lrc).toContain("[00:05.50]Pale moon\n");
    expect(result.lrc).not.toContain("rising");
  });

  test("merges the voices in time order, and waits for every voice to finish before clearing", () => {
    const result = projectFilesToLrc({
      lyrics: "[Ann] Pale_moon\n[Bob] Ri/sing\nslow",
      timings: {
        Ann: [
          { text: "Pale_", start: 5 },
          { text: "moon\n", start: 6, end: 20 },
        ],
        Bob: [
          { text: "Ri/", start: 5.5 },
          { text: "sing\n", start: 6, end: 7 },
          { text: "slow", start: 40, end: 41 },
        ],
      },
      settings,
    });

    expect(result.lrc.split("\n").filter((line) => /^\[\d/.test(line))).toEqual([
      "[00:05.00]Pale moon",
      "[00:05.50]Rising",
      "[00:20.00]",
      "[00:40.00]slow",
      "[00:41.00]",
    ]);
  });
});
