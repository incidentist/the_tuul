import { isEmpty, mapValues, pickBy } from "lodash-es";

export function readFileAsync(file: File): Promise<string | ArrayBuffer> {
    return new Promise((resolve, reject) => {
        let reader = new FileReader();

        reader.onload = () => {
            resolve(reader.result);
        };

        reader.onerror = reject;

        reader.readAsArrayBuffer(file);
    })
}



const MAX_LOGGED_PROPS_CHARS = 10_000;
const MAX_LOGGED_CONTEXT_VALUE_CHARS = 50_000;

// Logged values may be circular or huge, and the error path must never throw.
function loggable(value: unknown, maxChars: number): unknown {
    if (!value) {
        return undefined;
    }
    try {
        const json = JSON.stringify(value);
        if (json.length > maxChars) {
            return { truncated: true, sizeInChars: json.length };
        }
        return JSON.parse(json);
    } catch {
        return { unserializable: true };
    }
}

// Each value is capped separately so one oversized entry doesn't drop the rest.
function loggableContext(getContext?: () => Record<string, unknown>) {
    try {
        const values = pickBy(
            mapValues(getContext?.(), value => loggable(value, MAX_LOGGED_CONTEXT_VALUE_CHARS)),
            value => value !== undefined,
        );
        return isEmpty(values) ? undefined : values;
    } catch {
        return undefined;
    }
}

const REPEAT_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_PAGE_LOAD = 100;
const MAX_TRACKED_ERRORS = 200;

// Digits are collapsed so errors that differ only in ids or indexes count as the same one.
function errorFingerprint(err: Error): string {
    const callerFrame = err.stack?.split('\n').slice(1).find(line => !line.includes('console.error'));
    return [err.name, err.message.replace(/\d+/g, '#'), callerFrame?.trim()].join('|');
}

// Returns a function that answers, for each error, how many identical errors were suppressed
// since the last report of it, or null if this one should not be reported at all.
function createErrorThrottle() {
    const seen = new Map<string, { lastReportedAt: number; suppressed: number }>();
    let reportsSent = 0;

    return function suppressedCountIfReportable(err: Error): number | null {
        if (reportsSent >= MAX_REPORTS_PER_PAGE_LOAD) {
            return null;
        }

        const fingerprint = errorFingerprint(err);
        const now = Date.now();
        const previous = seen.get(fingerprint);
        if (previous && now - previous.lastReportedAt < REPEAT_WINDOW_MS) {
            previous.suppressed++;
            return null;
        }

        if (!previous && seen.size >= MAX_TRACKED_ERRORS) {
            seen.delete(seen.keys().next().value!);
        }
        seen.set(fingerprint, { lastReportedAt: now, suppressed: 0 });
        reportsSent++;
        return previous?.suppressed ?? 0;
    };
}

/**
 * @param getContext Called when an error fires; its result is sent along as `context`.
 */
export function setupErrorHandling(getContext?: () => Record<string, unknown>) {
    const LOG_ERRORS_TO_SERVER = true;
    const originalConsoleError = console.error;

    if (!LOG_ERRORS_TO_SERVER) {
        return originalConsoleError;
    }

    const suppressedCountIfReportable = createErrorThrottle();

    function logError(error: Error | string, vm: any, info: string) {
        // Convert string errors to Error objects to get stack traces
        const err = error instanceof Error ? error : new Error(error);

        // Extract file and line information from stack trace
        const stackLines = err.stack?.split('\n') || [];
        const errorLocation = stackLines[1]?.match(/\((.*):(\d+):(\d+)\)/) || [];
        const [, filePath, lineNumber, columnNumber] = errorLocation;
        originalConsoleError(err);

        const repeatCount = suppressedCountIfReportable(err);
        if (repeatCount === null) {
            return;
        }

        // Send the error to the server
        fetch("/log", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                severity: "error",
                message: err.message,
                stack: err.stack,
                file: filePath?.split('/').slice(-2).join('/') || 'unknown', // Last two parts of path
                line: lineNumber ? Number(lineNumber) : undefined,
                column: columnNumber ? Number(columnNumber) : undefined,
                type: err.name,
                info,
                userAgent: navigator.userAgent,
                timestamp: new Date().toISOString(),
                vue: vm ? {
                    component: vm.$options?.name || 'unknown',
                    props: loggable(vm.$props, MAX_LOGGED_PROPS_CHARS),
                } : undefined,
                context: loggableContext(getContext),
                repeatCount: repeatCount || undefined,
            }),
        }).catch(e => {
            // Fallback to original console if server logging fails
            originalConsoleError('Failed to log error to server:', e);
        });
    }

    console.error = function (...args: any[]) {
        try {
            originalConsoleError.apply(console, args);

            // Handle different types of error arguments
            const error = args.find(arg => arg instanceof Error) || new Error(args.join(" "));
            logError(error, null, args.join(" "));
        } catch (error) {
            originalConsoleError.apply(console, [error]);
        }
    };
    return logError;
}

