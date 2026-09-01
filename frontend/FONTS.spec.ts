import { readFileSync } from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import { FONTS } from "@/constants";

// Every FONTS key is written into the .ass file as the style's Fontname.
// ffmpeg.wasm's core is built without fontconfig, so libass has no font
// provider and can only match a face by its exact internal family name. When
// the name doesn't match, libass logs "can't find selected font provider",
// renders zero glyphs, and ffmpeg still exits 0 -- producing a video that is
// entirely blank with no error shown to the user.
//
// This shipped once: the key "Trebuchet" didn't match the file's real family
// name, "Trebuchet MS". These tests keep that from happening again.

const FONT_DIR = path.resolve(import.meta.dirname, "../api/assets/fonts");

const NAME_ID_FAMILY = 1;
const PLATFORM_WINDOWS = 3;

function readFamilyNames(ttfPath: string): string[] {
  const data = readFileSync(ttfPath);
  const tableCount = data.readUInt16BE(4);

  let nameTableOffset: number | null = null;
  for (let i = 0; i < tableCount; i++) {
    const record = 12 + 16 * i;
    if (data.toString("latin1", record, record + 4) === "name") {
      nameTableOffset = data.readUInt32BE(record + 8);
      break;
    }
  }
  if (nameTableOffset === null) {
    throw new Error(`No name table in ${ttfPath}`);
  }

  const recordCount = data.readUInt16BE(nameTableOffset + 2);
  const stringsOffset = nameTableOffset + data.readUInt16BE(nameTableOffset + 4);

  const names: string[] = [];
  for (let i = 0; i < recordCount; i++) {
    const record = nameTableOffset + 6 + 12 * i;
    const platformId = data.readUInt16BE(record);
    const nameId = data.readUInt16BE(record + 6);
    if (nameId !== NAME_ID_FAMILY) {
      continue;
    }
    const length = data.readUInt16BE(record + 8);
    const offset = stringsOffset + data.readUInt16BE(record + 10);
    const raw = data.subarray(offset, offset + length);
    // Windows-platform names are UTF-16BE; Mac-platform names are single-byte.
    // Buffer has no utf16be encoding, so swap to little-endian before decoding.
    names.push(
      platformId === PLATFORM_WINDOWS
        ? Buffer.from(raw).swap16().toString("utf16le")
        : raw.toString("latin1")
    );
  }

  return names;
}

describe("FONTS", () => {
  const entries = Object.entries(FONTS);

  test("is not empty", () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  test.each(entries)(
    'key "%s" matches the internal family name of %s',
    (dropdownName, fontPath) => {
      const ttfPath = path.join(FONT_DIR, path.basename(fontPath));
      expect(readFamilyNames(ttfPath)).toContain(dropdownName);
    }
  );
});
