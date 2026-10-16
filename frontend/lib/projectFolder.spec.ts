import { describe, expect, test } from "vitest";
import {
  classifyProjectFolder,
  projectBackgroundEntryName,
  projectSongEntryName,
  trackEntries,
  trackEntryName,
} from "./projectFolder";

function file(relativePath: string): File {
  const name = relativePath.split("/").pop() as string;
  const created = new File(["x"], name);
  Object.defineProperty(created, "webkitRelativePath", { value: relativePath });
  return created;
}

// A folder holding everything the Submit tab writes, for a song that came from YouTube.
const EXPORTED_FOLDER = [
  "Queen - Bohemian Rhapsody [karaoke].mp4",
  "subtitles.ass",
  "title.png",
  "lyrics.txt",
  "timings.txt",
  "settings.yaml",
  "MetalMania.ttf",
  "song.mp4",
  "background.mp4",
  "vocals.wav",
  "backing.wav",
].map((name) => file(`project/${name}`));

function names(files: File[]): string[] {
  return files.map((track) => track.name);
}

describe("classifyProjectFolder", () => {
  test("picks up every file an export writes", () => {
    const project = classifyProjectFolder(EXPORTED_FOLDER);

    expect(project.song?.name).toBe("song.mp4");
    expect(names(project.uploadedTracks.backing)).toEqual(["backing.wav"]);
    expect(names(project.uploadedTracks.vocals)).toEqual(["vocals.wav"]);
    expect(project.lyrics?.name).toBe("lyrics.txt");
    expect(project.timings?.name).toBe("timings.txt");
    expect(project.settings?.name).toBe("settings.yaml");
    expect(project.fonts.map((font) => font.name)).toEqual(["MetalMania.ttf"]);
    expect(project.background?.name).toBe("background.mp4");
  });

  test.each([["background.png"], ["Background.WEBP"], ["background.mkv"]])(
    "recognizes %s as the background",
    (name) => {
      expect(classifyProjectFolder([file(name)]).background?.name).toBe(name);
    },
  );

  test("leaves other videos and images alone", () => {
    const project = classifyProjectFolder([
      file("intro.mp4"),
      file("cover.png"),
      file("background.txt"),
    ]);

    expect(project.background).toBeUndefined();
    expect(project.ignored).toEqual(["background.txt", "cover.png", "intro.mp4"]);
  });

  test("ignores the rendered video, and the subtitles and title frame made from the rest", () => {
    const project = classifyProjectFolder(EXPORTED_FOLDER);

    expect(project.ignored).toEqual(["project/Queen - Bohemian Rhapsody [karaoke].mp4"]);
  });

  test("loads a partial folder, leaving the rest empty", () => {
    const project = classifyProjectFolder([file("lyrics.txt"), file("timings.json")]);

    expect(project.lyrics?.name).toBe("lyrics.txt");
    expect(project.timings?.name).toBe("timings.json");
    expect(project.song).toBeUndefined();
    expect(project.settings).toBeUndefined();
    expect(project.ignored).toEqual([]);
  });

  test("falls back to the extension for names it does not know", () => {
    const project = classifyProjectFolder([
      file("Bohemian Rhapsody.mp3"),
      file("settings.yml"),
      file("Impact.otf"),
    ]);

    expect(project.song?.name).toBe("Bohemian Rhapsody.mp3");
    expect(project.settings?.name).toBe("settings.yml");
    expect(project.fonts.map((font) => font.name)).toEqual(["Impact.otf"]);
  });

  test("keeps every font file", () => {
    const project = classifyProjectFolder([
      file("NotoSans-Regular.ttf"),
      file("NotoSans-Bold.ttf"),
      file("Collection.ttc"),
    ]);

    expect(project.fonts.map((font) => font.name)).toEqual([
      "Collection.ttc",
      "NotoSans-Bold.ttf",
      "NotoSans-Regular.ttf",
    ]);
    expect(project.ignored).toEqual([]);
  });

  test("matches lyrics and timings by name only", () => {
    const project = classifyProjectFolder([
      file("a notes.txt"),
      file("a data.json"),
      file("lyrics.txt"),
      file("timings.txt"),
    ]);

    expect(project.lyrics?.name).toBe("lyrics.txt");
    expect(project.timings?.name).toBe("timings.txt");
    expect(project.ignored).toEqual(["a data.json", "a notes.txt"]);
  });

  test("prefers timings.txt over timings.json, whichever comes first", () => {
    for (const files of [
      [file("timings.json"), file("timings.txt")],
      [file("timings.txt"), file("timings.json")],
    ]) {
      const project = classifyProjectFolder(files);
      expect(project.timings?.name).toBe("timings.txt");
      expect(project.ignored).toEqual(["timings.json"]);
    }
  });

  test("still loads a timings.json on its own", () => {
    expect(classifyProjectFolder([file("timings.json")]).timings?.name).toBe("timings.json");
  });

  test("keeps the first candidate for a slot and reports the rest", () => {
    const project = classifyProjectFolder([file("b.mp3"), file("a.mp3")]);

    expect(project.song?.name).toBe("a.mp3");
    expect(project.ignored).toEqual(["b.mp3"]);
  });

  test("skips the files an extraction leaves behind", () => {
    const project = classifyProjectFolder([file(".DS_Store"), file("__MACOSX/._lyrics.txt")]);

    expect(project.lyrics).toBeUndefined();
    expect(project.ignored).toEqual([]);
  });

  test("places the stems whatever container they were separated into", () => {
    const project = classifyProjectFolder([file("backing.flac"), file("vocals.flac")]);

    expect(names(project.uploadedTracks.backing)).toEqual(["backing.flac"]);
    expect(names(project.uploadedTracks.vocals)).toEqual(["vocals.flac"]);
    expect(project.song).toBeUndefined();
  });

  test("still loads the backing track an older export named accompaniment", () => {
    const project = classifyProjectFolder([file("accompaniment.wav")]);

    expect(names(project.uploadedTracks.backing)).toEqual(["accompaniment.wav"]);
  });

  test("never loads a Karaoke Builder Studio project, whatever it is named", () => {
    const project = classifyProjectFolder([file("song.kbp"), file("Pale Moon.kbp")]);

    expect(project.song).toBeUndefined();
    expect(project.ignored).toEqual(["Pale Moon.kbp", "song.kbp"]);
  });

  test("never loads ASS subtitles other than its own derived ones", () => {
    const project = classifyProjectFolder([file("song.ass"), file("subtitles.ass")]);

    expect(project.song).toBeUndefined();
    expect(project.ignored).toEqual(["song.ass"]);
  });

  test("puts each model's tracks in its own pair, apart from the uploaded ones", () => {
    const project = classifyProjectFolder([
      file("backing.mp3"),
      file("MDX-Kara-backing.wav"),
      file("mdx-kara-vocals.wav"),
      file("BS-Roformer-vocals.flac"),
    ]);

    expect(names(project.uploadedTracks.backing)).toEqual(["backing.mp3"]);
    expect(project.song).toBeUndefined();
    expect(project.modelTracks["UVR_MDXNET_KARA_2.onnx"]?.backing?.name).toBe(
      "MDX-Kara-backing.wav",
    );
    expect(project.modelTracks["UVR_MDXNET_KARA_2.onnx"]?.vocals?.name).toBe("mdx-kara-vocals.wav");
    expect(project.modelTracks["model_bs_roformer_ep_317_sdr_12.9755.ckpt"]).toEqual({
      vocals: expect.objectContaining({ name: "BS-Roformer-vocals.flac" }),
    });
  });

  test("gives a model its first track of each kind, and uploads the next", () => {
    const project = classifyProjectFolder([
      file("MDX-Kara-backing.wav"),
      file("MDX-Kara-backing.mp3"),
    ]);

    expect(project.modelTracks["UVR_MDXNET_KARA_2.onnx"]?.backing?.name).toBe(
      "MDX-Kara-backing.mp3",
    );
    expect(names(project.uploadedTracks.backing)).toEqual(["MDX-Kara-backing.wav"]);
  });

  test("uploads every other backing and vocal track, never taking one as the song", () => {
    const project = classifyProjectFolder([
      file("Demucs-backing.wav"),
      file("demucs-vocals.wav"),
      file("backing.mp3"),
      file("accompaniment.wav"),
      file("song.mp3"),
    ]);

    expect(project.song?.name).toBe("song.mp3");
    expect(names(project.uploadedTracks.backing)).toEqual([
      "accompaniment.wav",
      "backing.mp3",
      "Demucs-backing.wav",
    ]);
    expect(names(project.uploadedTracks.vocals)).toEqual(["demucs-vocals.wav"]);
    expect(project.ignored).toEqual([]);
  });

  test("prefers the exported song over an audio file that took the slot by its extension", () => {
    const project = classifyProjectFolder([file("Instrumental.mp3"), file("song.mp3")]);

    expect(project.song?.name).toBe("song.mp3");
    expect(project.ignored).toEqual(["Instrumental.mp3"]);
  });

  test("reports what it could not place", () => {
    const project = classifyProjectFolder([file("project/notes.docx")]);

    expect(project.ignored).toEqual(["project/notes.docx"]);
  });
});

describe("trackEntryName", () => {
  test("prefixes a model's tracks with the model", () => {
    expect(trackEntryName("UVR_MDXNET_KARA_2.onnx", "vocals", "wav")).toBe("MDX-Kara-vocals.wav");
    expect(trackEntryName("model_bs_roformer_ep_317_sdr_12.9755.ckpt", "backing", "mp3")).toBe(
      "BS-Roformer-backing.mp3",
    );
  });

  test("keeps an uploaded file's name, adding the kind when the name lacks it", () => {
    expect(trackEntryName("file:backing/backing.mp3", "backing", "wav")).toBe("backing.mp3");
    expect(trackEntryName("file:vocals/Demucs-vocals.flac", "vocals", "wav")).toBe(
      "Demucs-vocals.flac",
    );
    expect(trackEntryName("file:backing/Instrumental.mp3", "backing", "wav")).toBe(
      "Instrumental-backing.mp3",
    );
  });

  test("names an uploaded file so that the classifier uploads it again", () => {
    const name = trackEntryName("file:backing/Instrumental.mp3", "backing", "mp3");

    expect(names(classifyProjectFolder([file(name)]).uploadedTracks.backing)).toEqual([name]);
  });

  test("names a track the classifier puts back in its model's pair", () => {
    const name = trackEntryName("mel_band_roformer_karaoke_becruily.ckpt", "backing", "wav");

    const project = classifyProjectFolder([file(name)]);

    expect(project.modelTracks["mel_band_roformer_karaoke_becruily.ckpt"]?.backing?.name).toBe(
      name,
    );
  });
});

describe("projectSongEntryName", () => {
  test("keeps the extension, so the reader can tell audio from video", () => {
    expect(projectSongEntryName("Bohemian Rhapsody.mp3")).toBe("song.mp3");
    expect(projectSongEntryName("audio.mp4")).toBe("song.mp4");
    expect(projectSongEntryName("audio")).toBe("song");
  });
});

describe("trackEntries", () => {
  test("numbers a name another track already took, so neither overwrites the other", () => {
    const audio = new Blob(["x"], { type: "audio/wav" });
    const entries = trackEntries([
      { source: "UVR_MDXNET_KARA_2.onnx", backing: audio, vocals: new Blob() },
      { source: "file:backing/MDX-Kara-backing.wav", backing: audio, vocals: new Blob() },
    ]);

    expect(entries.map((entry) => entry.name)).toEqual([
      "MDX-Kara-backing.wav",
      "2-MDX-Kara-backing.wav",
    ]);
  });
});

describe("projectBackgroundEntryName", () => {
  test.each([
    [new File(["x"], "My Clip.MOV", { type: "video/quicktime" }), "background.mov"],
    [new File(["x"], "sunset.jpeg"), "background.jpeg"],
    [new Blob(["x"], { type: "image/webp" }), "background.webp"],
    [new Blob(["x"]), "background.mp4"],
  ])("names %o after its role, keeping its extension", (background, expected) => {
    expect(projectBackgroundEntryName(background)).toBe(expected);
  });
});
