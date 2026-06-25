/**
 * Zero Preset Manager - Entry Point
 * Injects camera icon into QR bar and initializes extension.
 */
import { openUI } from './qr-snapshot/ui.js';
import { preloadOpenai } from './qr-snapshot/state.js';
import { init as initPresetManager } from './preset-manager/main.js';
import { initPresetPerformanceOptimizer } from './qr-snapshot/performance.js';

const MODULE_NAME = 'zero';
const BTN_ID = 'zero-preset-btn';

const ctx = SillyTavern.getContext();
const { eventSource, event_types } = ctx;

// Initialize default settings
if (!ctx.extensionSettings[MODULE_NAME]) {
    ctx.extensionSettings[MODULE_NAME] = { groups: {}, snapshots: [], hidden: {} };
}

function createButton() {
    const btn = document.createElement('div');
    btn.id = BTN_ID;
    btn.className = 'qr--button menu_button interactable';
    btn.tabIndex = 0;
    btn.role = 'button';
    btn.title = '预设管理';
    btn.innerHTML = '<i class="fa-solid fa-camera"></i>';
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openUI();
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

eventSource.on(event_types.APP_READY, () => {
    // Pre-warm openai module so it's cached when user opens the panel
    preloadOpenai();
    injectWithRetry();
    initPresetManager();
    initPresetPerformanceOptimizer(eventSource, event_types);
    // Watch body for DOM rebuilds containing QR bar
    observer.observe(document.body, { childList: true, subtree: true });
});
eventSource.on(event_types.CHAT_CHANGED, injectButton);

console.log('[Zero] Preset Manager extension loaded');
