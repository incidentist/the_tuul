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

    it("reports console.error calls to /log with error severity", () => {
        setupErrorHandling();

        console.error("Failed to add region", new Error("bad region"));

        const { url, body } = lastLoggedBody();
        expect(url).toBe("/log");
        expect(body.severity).toBe("error");
        expect(body.message).toBe("bad region");
    });
});
