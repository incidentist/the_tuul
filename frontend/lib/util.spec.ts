import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupErrorHandling } from "./util";

describe("setupErrorHandling", () => {
    const realConsoleError = console.error;
    const realConsoleWarn = console.warn;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal("fetch", fetchMock);
        console.error = vi.fn();
        console.warn = vi.fn();
    });

    afterEach(() => {
        console.error = realConsoleError;
        console.warn = realConsoleWarn;
        vi.unstubAllGlobals();
    });

    function lastLoggedBody() {
        const [url, init] = fetchMock.mock.calls.at(-1)!;
        return { url, body: JSON.parse(init.body) };
    }

    it("reports Vue errors to /log with error severity", () => {
        const logError = setupErrorHandling();

        logError(new Error("boom"), null, "setup function");

        const { url, body } = lastLoggedBody();
        expect(url).toBe("/log");
        expect(body.severity).toBe("error");
        expect(body.message).toBe("boom");
        expect(body.info).toBe("setup function");
    });

    it("sends line and column as numbers when the stack frame parses", () => {
        const logError = setupErrorHandling();
        const error = new Error("boom");
        error.stack = "Error: boom\n    at doThing (http://localhost/src/app.ts:42:7)";

        logError(error, null, "");

        const { body } = lastLoggedBody();
        expect(body.line).toBe(42);
        expect(body.column).toBe(7);
    });

    it("omits line and column when the stack frame can't be parsed", () => {
        const logError = setupErrorHandling();
        const error = new Error("boom");
        error.stack = "Error: boom";

        logError(error, null, "");

        const { body } = lastLoggedBody();
        expect(body).not.toHaveProperty("line");
        expect(body).not.toHaveProperty("column");
    });

    it("sends the error type, browser and a timestamp", () => {
        const logError = setupErrorHandling();

        logError(new TypeError("bad"), null, "render function");

        const { body } = lastLoggedBody();
        expect(body.type).toBe("TypeError");
        expect(body.userAgent).toBe(navigator.userAgent);
        expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });

    describe("Vue component context", () => {
        function logWithProps(props: unknown, $options: object = { name: "TimingAdjuster" }) {
            const logError = setupErrorHandling();
            logError(new Error("boom"), { $options, $props: props }, "setup function");
            return lastLoggedBody().body.vue;
        }

        it("sends the component name and its props", () => {
            expect(logWithProps({ lyrics: ["la la"] })).toEqual({
                component: "TimingAdjuster",
                props: { lyrics: ["la la"] },
            });
        });

        it("falls back to 'unknown' for components without a name", () => {
            expect(logWithProps({}, {}).component).toBe("unknown");
        });

        it("still logs the error when props are circular", () => {
            const circular: Record<string, unknown> = {};
            circular.self = circular;

            expect(logWithProps(circular).props).toEqual({ unserializable: true });
        });

        it("replaces oversized props with their size", () => {
            const huge = { lyrics: "la ".repeat(20_000) };

            const { props } = logWithProps(huge);

            expect(props.truncated).toBe(true);
            expect(props.sizeInChars).toBeGreaterThan(10_000);
        });

        it("sends no vue context when the error has no component", () => {
            const logError = setupErrorHandling();
            logError(new Error("boom"), null, "");
            expect(lastLoggedBody().body).not.toHaveProperty("vue");
        });
    });

    describe("log context", () => {
        function logWithContext(getContext?: () => Record<string, unknown>) {
            const logError = setupErrorHandling(getContext);
            logError(new Error("boom"), null, "");
            return lastLoggedBody().body;
        }

        it("sends the context gathered when the error fires", () => {
            const body = logWithContext(() => ({ lyrics: "la la", timings: [[1.5, 1]] }));

            expect(body.context).toEqual({ lyrics: "la la", timings: [[1.5, 1]] });
        });

        it("reads the context at error time, not at setup time", () => {
            let lyrics = "before";
            const logError = setupErrorHandling(() => ({ lyrics }));
            lyrics = "after";

            logError(new Error("boom"), null, "");

            expect(lastLoggedBody().body.context).toEqual({ lyrics: "after" });
        });

        it("sends context for console.error calls too", () => {
            setupErrorHandling(() => ({ lyrics: "la la" }));

            console.error(new Error("boom"));

            expect(lastLoggedBody().body.context).toEqual({ lyrics: "la la" });
        });

        it("omits context when there is none", () => {
            expect(logWithContext()).not.toHaveProperty("context");
            expect(logWithContext(() => ({}))).not.toHaveProperty("context");
        });

        it("still logs the error when gathering context throws", () => {
            const body = logWithContext(() => {
                throw new Error("no active pinia");
            });

            expect(body.message).toBe("boom");
            expect(body).not.toHaveProperty("context");
        });

        it("caps an oversized value without dropping the others", () => {
            const body = logWithContext(() => ({
                lyrics: "la la",
                timings: Array.from({ length: 20_000 }, (_, i) => [i + 0.123456, 1]),
            }));

            expect(body.context.lyrics).toBe("la la");
            expect(body.context.timings.truncated).toBe(true);
            expect(body.context.timings.sizeInChars).toBeGreaterThan(50_000);
        });
    });

    describe("throttling repeated errors", () => {
        let logError: ReturnType<typeof setupErrorHandling>;
        let localConsoleError: typeof console.error;

        beforeEach(() => {
            vi.useFakeTimers();
            localConsoleError = console.error;
            logError = setupErrorHandling();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        function report(message: string) {
            logError(new Error(message), null, "");
        }

        it("reports the first occurrence immediately, without a repeat count", () => {
            report("boom");

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(lastLoggedBody().body).not.toHaveProperty("repeatCount");
        });

        it("suppresses identical errors within the window", () => {
            for (let i = 0; i < 1000; i++) {
                report("boom");
            }

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("treats errors that differ only in numbers as identical", () => {
            report("Invalid linked list: segment_98 should be segment_100");
            report("Invalid linked list: segment_3 should be segment_5");

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("reports different errors independently", () => {
            report("first problem");
            report("second problem");

            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("tells apart the same message thrown from different places", () => {
            for (const frame of ["at one (app.js:1:1)", "at two (app.js:2:2)"]) {
                const error = new Error("Cannot read properties of undefined");
                error.stack = `Error: Cannot read properties of undefined\n    ${frame}`;
                logError(error, null, "");
            }

            expect(fetchMock).toHaveBeenCalledTimes(2);
        });

        it("reports again after the window with the number suppressed", () => {
            report("boom");
            for (let i = 0; i < 5; i++) {
                report("boom");
            }

            vi.advanceTimersByTime(60_000);
            report("boom");

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(lastLoggedBody().body.repeatCount).toBe(5);
        });

        it("keeps suppressing until a full window has passed since the last report", () => {
            report("boom");
            vi.advanceTimersByTime(59_999);
            report("boom");

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("starts a fresh count after each report", () => {
            report("boom");
            report("boom");
            vi.advanceTimersByTime(60_000);
            report("boom");
            vi.advanceTimersByTime(60_000);
            report("boom");

            expect(fetchMock).toHaveBeenCalledTimes(3);
            expect(lastLoggedBody().body).not.toHaveProperty("repeatCount");
        });

        it("stops reporting after 100 reports in a page load", () => {
            for (let i = 0; i < 150; i++) {
                report(`distinct problem ${"x".repeat(i)}`);
            }

            expect(fetchMock).toHaveBeenCalledTimes(100);
        });

        it("still shows every occurrence in the local console", () => {
            for (let i = 0; i < 10; i++) {
                report("boom");
            }

            expect(localConsoleError).toHaveBeenCalledTimes(10);
        });

        it("throttles console.error calls too", () => {
            for (let i = 0; i < 10; i++) {
                console.error("Invalid linked list");
            }

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    describe("warnings", () => {
        let localConsoleWarn: typeof console.warn;

        beforeEach(() => {
            localConsoleWarn = console.warn;
        });

        it("reports console.warn calls to /log with warning severity", () => {
            setupErrorHandling();

            console.warn("Invalid value for currentTime:", NaN);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const { url, body } = lastLoggedBody();
            expect(url).toBe("/log");
            expect(body.severity).toBe("warning");
            expect(body.message).toBe("Invalid value for currentTime: NaN");
            expect(body.userAgent).toBe(navigator.userAgent);
        });

        it("reports a warning given as an Error with that error's own stack", () => {
            setupErrorHandling();
            const warning = new Error("Couldn't read song metadata");
            warning.stack = "Error: Couldn't read song metadata\n    at readTags (http://localhost/media.ts:111:5)";

            console.warn("Couldn't read song metadata:", warning);

            const { body } = lastLoggedBody();
            expect(body.severity).toBe("warning");
            expect(body.message).toBe("Couldn't read song metadata");
            expect(body.line).toBe(111);
        });

        it("still prints the warning to the local console, once, with its original arguments", () => {
            setupErrorHandling();

            console.warn("Invalid value for currentTime:", NaN);

            expect(localConsoleWarn).toHaveBeenCalledTimes(1);
            expect(localConsoleWarn).toHaveBeenCalledWith("Invalid value for currentTime:", NaN);
        });

        it("includes the log context", () => {
            setupErrorHandling(() => ({ lyrics: "la la" }));

            console.warn("Can't create subtitles");

            expect(lastLoggedBody().body.context).toEqual({ lyrics: "la la" });
        });

        it("throttles repeated warnings", () => {
            setupErrorHandling();

            for (let i = 0; i < 100; i++) {
                console.warn("Invalid value for currentTime:", i);
            }

            expect(fetchMock).toHaveBeenCalledTimes(1);
        });

        it("doesn't let a flood of errors suppress the same text as a warning", () => {
            const logError = setupErrorHandling();

            logError(new Error("Invalid value"), null, "");
            console.warn("Invalid value");

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(lastLoggedBody().body.severity).toBe("warning");
        });

        it("keeps reporting warnings after the error cap is reached", () => {
            const logError = setupErrorHandling();
            for (let i = 0; i < 150; i++) {
                logError(new Error(`distinct problem ${"x".repeat(i)}`), null, "");
            }
            expect(fetchMock).toHaveBeenCalledTimes(100);

            console.warn("A warning after the error flood");

            expect(fetchMock).toHaveBeenCalledTimes(101);
        });
    });

    it("points file and line at the caller of console.error, not at our override", () => {
        const logError = setupErrorHandling();
        const error = new Error("Invalid linked list");
        error.stack = [
            "Error: Invalid linked list",
            "    at console.error (http://localhost/bundle.js:28:569)",
            "    at checkRegions (http://localhost/bundle.js:34:2303)",
        ].join("\n");

        logError(error, null, "");

        const { body } = lastLoggedBody();
        expect(body.line).toBe(34);
        expect(body.column).toBe(2303);
    });

    it("reports console.error calls to /log with error severity", () => {
        setupErrorHandling();

        console.error("Failed to add region", new Error("bad region"));

        const { url, body } = lastLoggedBody();
        expect(url).toBe("/log");
        expect(body.severity).toBe("error");
        expect(body.message).toBe("bad region");
    });
});
