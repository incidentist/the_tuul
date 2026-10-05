import { describe, expect, it, vi } from "vitest";
import { createSeparationTimer } from "./separationTelemetry";
import { SeparationPhase } from "@/types";

describe("createSeparationTimer", () => {
    function fakeClock(...times: number[]) {
        return () => times.shift()!;
    }

    it("times the whole separation and each reported phase", () => {
        const timer = createSeparationTimer(undefined, fakeClock(0, 0, 1500, 61_500, 64_000));

        timer.onProgress({ phase: SeparationPhase.LoadingModel, fraction: null });
        timer.onProgress({ phase: SeparationPhase.Separating, fraction: 0 });
        timer.onProgress({ phase: SeparationPhase.Separating, fraction: 0.5 });
        timer.onProgress({ phase: SeparationPhase.WritingOutput, fraction: null });
        const timing = timer.finish();

        expect(timing.durationSeconds).toBe(64);
        expect(timing.phaseSeconds).toEqual({
            [SeparationPhase.LoadingModel]: 1.5,
            [SeparationPhase.Separating]: 60,
            [SeparationPhase.WritingOutput]: 2.5,
        });
    });

    it("forwards every progress event to the caller's callback", () => {
        const onProgress = vi.fn();
        const timer = createSeparationTimer(onProgress);
        const progress = { phase: SeparationPhase.Separating, fraction: 0.5 };

        timer.onProgress(progress);

        expect(onProgress).toHaveBeenCalledWith(progress);
    });

    it("notes when the tab was hidden during separation", () => {
        const timer = createSeparationTimer();
        vi.spyOn(document, "hidden", "get").mockReturnValue(true);
        document.dispatchEvent(new Event("visibilitychange"));
        vi.restoreAllMocks();

        expect(timer.finish().wasHidden).toBe(true);
    });

    it("reports a visible tab as never hidden", () => {
        expect(createSeparationTimer().finish().wasHidden).toBe(false);
    });
});
