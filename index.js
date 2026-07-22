import { openUI } from './qr-snapshot/ui.js';
import { preloadOpenai, PresetManager, UiStateManager } from './qr-snapshot/state.js';
import { init as initPresetManager } from './preset-manager/main.js';
import { initPresetPerformanceOptimizer } from './qr-snapshot/performance.js';

const MODULE_NAME = 'zero';
const BTN_ID = 'zero-preset-btn';

const ctx = SillyTavern.getContext();
const { eventSource, event_types } = ctx;

// Initialize default settings
if (!ctx.extensionSettings[MODULE_NAME]) {
    ctx.extensionSettings[MODULE_NAME] = { groups: {}, snapshots: [], hidden: {}, linkages: {} };
} else if (!ctx.extensionSettings[MODULE_NAME].linkages) {
    ctx.extensionSettings[MODULE_NAME].linkages = {};
}

// ── Toastr Filter & Suppressor ──────────────────────────────────────────────
function setupToastrFilter() {
    if (typeof window.toastr === 'undefined' || window.toastr._zeroFiltered) return;
    window.toastr._zeroFiltered = true;

    const origInfo = window.toastr.info;
    const origSuccess = window.toastr.success;
    const origWarning = window.toastr.warning;

    window.toastr.info = function(message, title, options) {
        if (typeof message === 'string' && (message.includes('包含被启用的正则') || message.includes('使正则生效'))) {
            return; // 屏蔽酒馆原生“预设包含被启用的正则”弹窗提示
        }
        if (window._muteAllToasts) return;
        return origInfo.apply(this, arguments);
    };

    window.toastr.success = function(message, title, options) {
        if (window._muteAllToasts) return;
        return origSuccess.apply(this, arguments);
    };

    window.toastr.warning = function(message, title, options) {
        if (window._muteAllToasts) return;
        return origWarning.apply(this, arguments);
    };
}
setupToastrFilter();

// ── Linkage Logic (Preset -> API Config) ──────────────────────────────────
let isSwitchingPresetLinkage = false;

async function triggerApiConfigLinkage(presetName) {
    if (!presetName || window._isLinkageTransitioning) return;
    console.log(`[zapi] [Preset ➔ API] 收到预设变更事件: "${presetName}"`);

    if (!window.ApiConfigManager || typeof window.ApiConfigManager.applyConfigByName !== 'function') {
        console.warn('[zapi] [Preset ➔ API] ApiConfigManager 未就绪。');
        return;
    }

    const rawPreset = String(presetName).trim();
    const cleanPreset = rawPreset.replace(/^★\s*/, '').trim();

    const linkages = ctx.extensionSettings[MODULE_NAME]?.linkages || {};

    // 1. Check direct linkages mapping
    let targetApiConfig = linkages[rawPreset] || linkages[cleanPreset];
    if (targetApiConfig) {
        console.log(`[zapi] [Preset ➔ API] 匹配成功 (Zero 显式绑定): "${targetApiConfig}"`);
    }

    // 2. Check if any API config in ApiConfigManager explicitly links to this preset
    if (!targetApiConfig && typeof window.ApiConfigManager.getConfigs === 'function') {
        const apiConfigs = window.ApiConfigManager.getConfigs() || [];
        const match = apiConfigs.find(c => {
            if (!c || !c.linkedPreset) return false;
            const lpRaw = String(c.linkedPreset).trim();
            const lpClean = lpRaw.replace(/^★\s*/, '').trim();
            return lpRaw === rawPreset || lpClean === cleanPreset || lpClean.toLowerCase() === cleanPreset.toLowerCase();
        });
        if (match) {
            targetApiConfig = match.name;
            console.log(`[zapi] [Preset ➔ API] 匹配成功 (APIConfig 显式绑定): "${targetApiConfig}"`);
        }
    }

    // 3. Auto-match by name
    if (!targetApiConfig && typeof window.ApiConfigManager.getConfigs === 'function') {
        const apiConfigs = window.ApiConfigManager.getConfigs() || [];
        const match = apiConfigs.find(c => {
            if (!c || !c.name) return false;
            const cRaw = String(c.name).trim();
            const cClean = cRaw.replace(/^★\s*/, '').trim();
            return (
                cRaw === rawPreset ||
                cClean === cleanPreset ||
                cRaw.toLowerCase() === rawPreset.toLowerCase() ||
                cClean.toLowerCase() === cleanPreset.toLowerCase()
            );
        });
        if (match) {
            targetApiConfig = match.name;
            console.log(`[zapi] [Preset ➔ API] 匹配成功 (同名自动匹配): "${targetApiConfig}"`);
        }
    }

    if (targetApiConfig) {
        const activeApi = window.ApiConfigManager?.getActiveConfigName?.();
        if (activeApi && activeApi === targetApiConfig) {
            console.log(`[zapi] [Preset ➔ API] 目标 API 配置 "${targetApiConfig}" 已激活，跳过。`);
            return;
        }

        console.log(`[zapi] [Preset ➔ API] 匹配成功: "${targetApiConfig}"，等待 250ms 避开酒馆重绘期...`);
        window._isLinkageTransitioning = true;
        window._muteAllToasts = true;

        await new Promise(r => setTimeout(r, 250));

        try {
            console.log(`[zapi] [Preset ➔ API] 应用目标 API 配置: "${targetApiConfig}"...`);
            await window.ApiConfigManager.applyConfigByName(targetApiConfig, { skipLinkage: true, silent: true });
            console.log(`[zapi] [Preset ➔ API] 应用成功: "${targetApiConfig}"`);
        } catch (e) {
            console.error('[zapi] [Preset ➔ API] 应用 API 配置失败:', e);
        } finally {
            setTimeout(() => {
                window._isLinkageTransitioning = false;
                window._muteAllToasts = false;
            }, 800);
        }
    } else {
        console.warn(`[zapi] [Preset ➔ API] 未找到匹配的 API 配置 (预设: "${presetName}")`);
    }
}

window.triggerZeroApiLinkage = triggerApiConfigLinkage;

// ── Public Global API ──────────────────────────────────────────────────────
window.Zero = {
    switchPreset: async (presetName, options = {}) => {
        if (!options.skipLinkage) {
            isSwitchingPresetLinkage = true;
        }
        try {
            return await PresetManager.switchPreset(presetName, options);
        } finally {
            if (!options.skipLinkage) {
                setTimeout(() => { isSwitchingPresetLinkage = false; }, 400);
            }
        }
    },
    getPresets: () => {
        const selectEl = document.getElementById('settings_preset_openai');
        if (selectEl) {
            const names = Array.from(selectEl.options).map(opt => opt.textContent.trim());
            const active = selectEl.selectedIndex >= 0 ? selectEl.options[selectEl.selectedIndex].textContent.trim() : '';
            return { names, active };
        }
        return { names: [], active: '' };
    },
    getLinkages: () => ctx.extensionSettings[MODULE_NAME]?.linkages || {},
    setLinkage: (presetName, apiConfigName) => {
        if (!ctx.extensionSettings[MODULE_NAME].linkages) {
            ctx.extensionSettings[MODULE_NAME].linkages = {};
        }
        if (apiConfigName) {
            ctx.extensionSettings[MODULE_NAME].linkages[presetName] = apiConfigName;
        } else {
            delete ctx.extensionSettings[MODULE_NAME].linkages[presetName];
        }
        ctx.saveSettingsDebounced();
    }
};

// ── Event Listeners ────────────────────────────────────────────────────────
if (typeof $ !== 'undefined') {
    $(document).on('change', '#settings_preset_openai', function() {
        if (isSwitchingPresetLinkage) return;
        const selectEl = this;
        const selectedName = selectEl.options[selectEl.selectedIndex]?.textContent?.trim();
        if (selectedName) {
            isSwitchingPresetLinkage = true;
            try {
                triggerApiConfigLinkage(selectedName);
            } finally {
                setTimeout(() => { isSwitchingPresetLinkage = false; }, 400);
            }
        }
    });
}

if (event_types.PRESET_CHANGED) {
    eventSource.on(event_types.PRESET_CHANGED, (presetName) => {
        if (isSwitchingPresetLinkage) return;
        const name = typeof presetName === 'string' ? presetName : presetName?.name;
        if (name) {
            triggerApiConfigLinkage(name);
        }
    });
}

// ── Slash Commands Registration ─────────────────────────────────────────────
export async function registerZeroSlashCommands() {
    try {
        const ctx = SillyTavern.getContext();
        let SlashCommand = null;
        let SlashCommandParser = null;

        if (ctx.SlashCommand && ctx.SlashCommandParser) {
            SlashCommand = ctx.SlashCommand;
            SlashCommandParser = ctx.SlashCommandParser;
        } else {
            const scModule = await import('/scripts/slash-commands/SlashCommand.js');
            const scpModule = await import('/scripts/slash-commands/SlashCommandParser.js');
            SlashCommand = scModule.SlashCommand;
            SlashCommandParser = scpModule.SlashCommandParser;
        }

        if (!SlashCommand || !SlashCommandParser) return;

        // 1. Snapshot Modal command
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'zero-snapshot',
            aliases: ['zero-qr', 'zerosnapshot', 'zero-snapshots'],
            helpString: '打开 Zero 快照管理弹窗',
            callback: () => {
                openUI();
                return '';
            },
        }));

        // 2. Preset Manager Panel command
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'zero-preset',
            aliases: ['zero-presets', 'zeropreset', 'zero-preset-manager'],
            helpString: '打开 Zero 预设管理面板',
            callback: async () => {
                const { showPanel } = await import('./preset-manager/main.js');
                showPanel();
                return '';
            },
        }));

        console.log('[Zero] Slash commands /zero-snapshot and /zero-preset registered successfully');
    } catch (e) {
        console.warn('[Zero] Failed to register slash commands:', e);
    }
}

// ── UI Buttons Injection ────────────────────────────────────────────────────
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
    const enabled = UiStateManager.get().injectQrBarButton !== false;
    if (!enabled) {
        const existing = document.getElementById(BTN_ID);
        if (existing) existing.remove();
        return;
    }
    if (document.getElementById(BTN_ID)) return;
    const btnContainer = document.querySelector('#qr--bar .qr--buttons');
    if (btnContainer) {
        btnContainer.prepend(createButton());
        return;
    }
    const qrBar = document.getElementById('qr--bar');
    if (qrBar) {
        qrBar.prepend(createButton());
    }
}

function injectWithRetry(attempts = 0) {
    const enabled = UiStateManager.get().injectQrBarButton !== false;
    if (!enabled) {
        const existing = document.getElementById(BTN_ID);
        if (existing) existing.remove();
        return;
    }
    if (document.getElementById(BTN_ID)) return;
    if (attempts > 15) return;
    injectButton();
    if (!document.getElementById(BTN_ID)) {
        setTimeout(() => injectWithRetry(attempts + 1), 500);
    }
}

window.updateZeroQrBarButtonInjection = () => {
    const enabled = UiStateManager.get().injectQrBarButton !== false;
    if (enabled) {
        injectWithRetry();
    } else {
        const existing = document.getElementById(BTN_ID);
        if (existing) existing.remove();
    }
};

const observer = new MutationObserver(() => {
    const enabled = UiStateManager.get().injectQrBarButton !== false;
    if (!enabled) {
        const existing = document.getElementById(BTN_ID);
        if (existing) existing.remove();
        return;
    }
    if (!document.getElementById(BTN_ID) && document.querySelector('#qr--bar .qr--buttons')) {
        injectButton();
    }
});

eventSource.on(event_types.APP_READY, () => {
    preloadOpenai();
    injectWithRetry();
    initPresetManager();
    initPresetPerformanceOptimizer(eventSource, event_types);
    registerZeroSlashCommands();
    observer.observe(document.body, { childList: true, subtree: true });
});
eventSource.on(event_types.CHAT_CHANGED, injectButton);

console.log('[Zero] Preset Manager extension loaded with API Config Manager linkage & Slash Commands support');

