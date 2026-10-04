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

// Props may be circular or huge, and the error path must never throw.
function loggableProps(props: unknown): Record<string, unknown> | undefined {
    if (!props) {
        return undefined;
    }
    try {
        const json = JSON.stringify(props);
        if (json.length > MAX_LOGGED_PROPS_CHARS) {
            return { truncated: true, sizeInChars: json.length };
        }
        return JSON.parse(json);
    } catch {
        return { unserializable: true };
    }
}

export function setupErrorHandling() {
    const LOG_ERRORS_TO_SERVER = true;
    const originalConsoleError = console.error;

    if (!LOG_ERRORS_TO_SERVER) {
        return originalConsoleError;
    }

    function logError(error: Error | string, vm: any, info: string) {
        // Convert string errors to Error objects to get stack traces
        const err = error instanceof Error ? error : new Error(error);

        // Extract file and line information from stack trace
        const stackLines = err.stack?.split('\n') || [];
        const errorLocation = stackLines[1]?.match(/\((.*):(\d+):(\d+)\)/) || [];
        const [, filePath, lineNumber, columnNumber] = errorLocation;
        originalConsoleError(err);

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
                    props: loggableProps(vm.$props),
                } : undefined
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

