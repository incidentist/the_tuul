import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupErrorHandling } from "./util";

describe("setupErrorHandling", () => {
    const realConsoleError = console.error;
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn().mockResolvedValue({ ok: true });
        vi.stubGlobal("fetch", fetchMock);
        console.error = vi.fn();
    });

    afterEach(() => {
        console.error = realConsoleError;
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

    it("reports console.error calls to /log with error severity", () => {
        setupErrorHandling();

        console.error("Failed to add region", new Error("bad region"));

        const { url, body } = lastLoggedBody();
        expect(url).toBe("/log");
        expect(body.severity).toBe("error");
        expect(body.message).toBe("bad region");
    });
});
