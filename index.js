/**
 * Zero Preset Manager - Entry Point
 * Injects camera icon into QR bar and initializes extension.
 */

// Register global error tracking immediately to catch any issues (including syntax/loading errors in imports)
window.addEventListener('error', function(e) {
    alert('[Zero Global Error]\nMsg: ' + e.message + '\nFile: ' + e.filename + '\nLine: ' + e.lineno + '\nCol: ' + e.colno + '\nStack: ' + (e.error ? e.error.stack : ''));
});
window.addEventListener('unhandledrejection', function(e) {
    alert('[Zero Unhandled Rejection]\nReason: ' + e.reason + '\nStack: ' + (e.reason && e.reason.stack ? e.reason.stack : ''));
});

let openUI;
let preloadOpenai;
let initPresetManager;

const MODULE_NAME = 'zero';
const BTN_ID = 'zero-preset-btn';

const ctx = SillyTavern.getContext();
const { eventSource, event_types } = ctx;

// Initialize default settings
if (!ctx.extensionSettings[MODULE_NAME]) {
    ctx.extensionSettings[MODULE_NAME] = { groups: {}, snapshots: [], hidden: {} };
}

// Start loading dependencies dynamically
const modulesPromise = (async () => {
    try {
        const [uiMod, stateMod, mainMod] = await Promise.all([
            import('./qr-snapshot/ui.js'),
            import('./qr-snapshot/state.js'),
            import('./preset-manager/main.js')
        ]);
        openUI = uiMod.openUI;
        preloadOpenai = stateMod.preloadOpenai;
        initPresetManager = mainMod.init;
    } catch (err) {
        alert('[Zero Import Error] Failed to load modules: ' + err + '\nStack: ' + (err ? err.stack : ''));
        throw err;
    }
})();

function createButton() {
    const btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.className = 'qr--button menu_button interactable';
    btn.tabIndex = 0;
    btn.role = 'button';
    btn.title = '预设管理';
    btn.innerHTML = '<i class="fa-solid fa-camera"></i>';
    btn.addEventListener('click', async (e) => {
        try {
            e.preventDefault();
            e.stopPropagation();
            await modulesPromise;
            if (typeof openUI !== 'function') {
                alert('[Zero Error] openUI is not a function!');
                return;
            }
            await openUI();
        } catch (clickErr) {
            alert('[Zero Click Error] Preset Button click failed: ' + clickErr + '\nStack: ' + (clickErr ? clickErr.stack : ''));
        }
    });
    return btn;
}

function injectButton() {
    if (document.getElementById(BTN_ID)) return;

    // Try injecting into the .qr--buttons container first
    const btnContainer = document.querySelector('#qr--bar .qr--buttons');
    if (btnContainer) {
        btnContainer.prepend(createButton());
        console.log('[Zero] Button injected into .qr--buttons');
        return;
    }

    // Fallback: inject directly into #qr--bar
    const qrBar = document.getElementById('qr--bar');
    if (qrBar) {
        qrBar.prepend(createButton());
        console.log('[Zero] Button injected into #qr--bar');
        return;
    }
}

// Retry injection: QR bar may load after APP_READY
function injectWithRetry(attempts = 0) {
    if (document.getElementById(BTN_ID)) return;
    if (attempts > 15) return; // Give up after ~7.5s

    injectButton();

    if (!document.getElementById(BTN_ID)) {
        setTimeout(() => injectWithRetry(attempts + 1), 500);
    }
}

// Also watch for QR bar appearing dynamically
const observer = new MutationObserver(() => {
    if (!document.getElementById(BTN_ID) && document.querySelector('#qr--bar .qr--buttons')) {
        injectButton();
    }
});

eventSource.on(event_types.APP_READY, async () => {
    try {
        await modulesPromise;
        // Pre-warm openai module so it's cached when user opens the panel
        preloadOpenai();
        injectWithRetry();
        initPresetManager();
        // Watch body for DOM rebuilds containing QR bar
        observer.observe(document.body, { childList: true, subtree: true });
    } catch (err) {
        alert('[Zero Init Error] APP_READY handler failed: ' + err + '\nStack: ' + (err ? err.stack : ''));
    }
});
eventSource.on(event_types.CHAT_CHANGED, injectButton);

console.log('[Zero] Preset Manager extension loaded');
