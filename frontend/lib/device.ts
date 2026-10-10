export function isMobile() {
    // True if we're on a phone or tablet
    return window.screen.width <= 820;
}

/**
 * True if this machine has enough memory to separate a song in the browser.
 * navigator.deviceMemory is rounded down to a power of two and capped at 8,
 * so this means "8 GB or more". Only Chromium reports it; elsewhere we can't
 * tell, so assume the machine can cope.
 */
export function supportsInBrowserSeparation() {
    const deviceMemoryGB: number | undefined = (navigator as any).deviceMemory;
    return deviceMemoryGB === undefined || deviceMemoryGB > 4;
}
