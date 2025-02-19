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



export function setupErrorHandling() {
    const originalConsoleError = console.error;

    function logError(err: Error, vm: any, info: string) {
        // Send the error to the server
        fetch("/log_error", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                error: err.toString(),
                info,
            }),
        })
    }

    console.error = function (...args: any[]) {
        try {
            originalConsoleError.apply(console, args);
            logError(new Error(args.join(" ")), null, "");
        } catch (error) {
            originalConsoleError.apply(console, error);
        }
    };
    return logError;
}

