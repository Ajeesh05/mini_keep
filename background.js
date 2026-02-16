/**
 * @fileoverview Backgroud service worker for Mini Keep Chrome Extension
 * 
 * Always run in the background that connects all the tabs and the chrome extensions
 * 
 * @author Ajeesh T
 * @date 2025-10-19
 */

const KEEP_URL = "https://keep.google.com/?mini_keep=1";
const STORAGE_KEY = "keep_window_bounds_v1";

let keepWindowId = null;
let storeTimer = null;
let currentBounds = null; // { left, top, width, height }

const defaultBounds = { width: 575, left: 1325, top: 160, height: 850 };

async function loadSettings() {
    try {
        const data = await chrome.storage.sync.get(STORAGE_KEY);
        if (data && data[STORAGE_KEY]) currentBounds = data[STORAGE_KEY];
    } catch (e) {
        console.warn("loadSettings error:", e);
    }
}

function scheduleStoreBounds(bounds) {
    currentBounds = bounds;
    if (storeTimer) clearTimeout(storeTimer);
    storeTimer = setTimeout(async () => {
        try {
            const payload = {};
            payload[STORAGE_KEY] = currentBounds;
            await chrome.storage.sync.set(payload);
        } catch (e) {
            console.warn("scheduleStoreBounds error:", e);
        } finally {
            storeTimer = null;
        }
    }, 500);
}

/**
 * Find an existing Keep window by scanning all Chrome windows (popups/tabs).
 * Returns the window object if found, otherwise null.
 */
async function findExistingKeepWindow() {
    try {
        // populate:true gives tabs for each window so we can inspect their URLs
        const allWindows = await chrome.windows.getAll({ populate: true });
        for (const w of allWindows) {
            // ignore devtools or other special windows if needed by checking w.type
            // check all tabs in that window for a match
            if (Array.isArray(w.tabs)) {
                for (const t of w.tabs) {
                    if (!t || !t.url) continue;
                    // match the Keep origin (startsWith) to be tolerant of paths/params
                    if (t.url && t.url.includes("mini_keep=1")) {
                        return w;
                    }

                }
            }
        }
    } catch (e) {
        console.warn("findExistingKeepWindow error:", e);
    }
    return null;
}

/**
 * Focus (and if needed restore) a window by id.
 * Attempts to restore if minimized, uses drawAttention to un-minimize on some platforms.
 */
async function focusWindowById(winId) {
    try {
        // Try to get the current state
        const win = await chrome.windows.get(winId);
        if (!win) return false;

        // If minimized, try to restore to normal first
        if (win.state === "minimized") {
            try {
                await chrome.windows.update(winId, { state: "normal" });
            } catch (e) {
                // Some platforms may not support state change; ignore
                console.warn("Could not restore minimized window:", e);
            }
        }

        // Try to focus and draw attention
        try {
            await chrome.windows.update(winId, { focused: true, drawAttention: true });
            return true;
        } catch (e) {
            console.warn("Could not focus window:", e);
            return false;
        }
    } catch (e) {
        // e.g., Invalid window id
        return false;
    }
}

/**
 * Main open/focus routine:
 * - Try keepWindowId
 * - Try scanning existing windows
 * - Otherwise create new popup at remembered bounds
 */
async function openKeep() {
    // 1) Fast path: use stored keepWindowId if valid
    if (keepWindowId !== null) {
        const ok = await focusWindowById(keepWindowId);
        if (ok) return;
        // fall through if invalid or couldn't focus
        keepWindowId = null;
    }

    // 2) Scan all windows for an existing Keep tab
    const existingWin = await findExistingKeepWindow();
    if (existingWin) {
        // store its id for later
        keepWindowId = existingWin.id;
        const ok = await focusWindowById(keepWindowId);
        if (ok) return;
        // if cannot focus (odd edge), fall through to create a new one
        keepWindowId = null;
    }

    // 3) No existing Keep window found -> create a new popup using remembered bounds
    await loadSettings();
    const bounds = currentBounds ?? defaultBounds;

    const createData = {
        url: KEEP_URL,
        type: "popup",
        left: bounds.left ?? defaultBounds.left,
        top: bounds.top ?? defaultBounds.top,
        width: bounds.width ?? defaultBounds.width,
        height: bounds.height ?? defaultBounds.height
    };

    try {
        const win = await chrome.windows.create(createData);
        keepWindowId = win.id;

        // Save initial bounds (some platforms return left/top undefined until after)
        scheduleStoreBounds({
            left: win.left,
            top: win.top,
            width: win.width,
            height: win.height
        });
    } catch (e) {
        console.error("Failed to create Keep popup:", e);
    }
}

async function closeKeep() {
    if (keepWindowId === null) return;
    try {
        await chrome.windows.remove(keepWindowId);
    } catch (e) {
        // ignore
    } finally {
        keepWindowId = null;
    }
}

// If the Keep window is closed manually, clear stored id
chrome.windows.onRemoved.addListener((removedId) => {
    if (removedId === keepWindowId) {
        keepWindowId = null;
    }
});

// Persist bounds when user moves/resizes
chrome.windows.onBoundsChanged.addListener(async (changedWindow) => {
    // changedWindow may be an object with .id in MV3; handle both shapes defensively
    const winId = changedWindow && (changedWindow.id ?? changedWindow);
    if (winId !== keepWindowId) return;

    try {
        const win = await chrome.windows.get(winId);
        if (!win) return;
        scheduleStoreBounds({
            left: win.left ?? 0,
            top: win.top ?? 0,
            width: win.width ?? 400,
            height: win.height ?? 600
        });
    } catch (e) {
        // ignore
    }
});

// Click extension icon -> open or focus Keep
chrome.action.onClicked.addListener(() => openKeep());

// Keyboard shortcuts
chrome.commands.onCommand.addListener(() => openKeep());


// Initialize
loadSettings().catch(console.error);
