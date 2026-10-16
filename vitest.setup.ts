import { vi } from "vitest";

// Global mocks for web APIs can go here
vi.mock("jassub", () => {
  return {
    __esModule: true,
    default: vi.fn(function () {
      return {
        ready: Promise.resolve(),
        manualRender: vi.fn(() => Promise.resolve()),
        destroy: vi.fn(() => Promise.resolve()),
        renderer: {
          setTrack: vi.fn(() => Promise.resolve()),
          addFonts: vi.fn(() => Promise.resolve(true)),
        },
      };
    }),
  };
});
