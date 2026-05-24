/**
 * Zero Preset Manager - Data Layer
 * Handles preset loading, toggling, switching, snapshots, and groups.
 * Performance: openai module is cached after first import.
 */

const MODULE_NAME = 'zero';

// ─── Settings helpers ───
function getSettings() {
    const ctx = SillyTavern.getContext();
    if (!ctx.extensionSettings[MODULE_NAME]) {
        ctx.extensionSettings[MODULE_NAME] = { groups: {}, snapshots: [], hidden: {}, linkages: {}, uiState: { activeTab: 'entries', ungroupedCol: false, editorFilter: 'all', editorGroupFilter: 'all', scrollPositions: {} } };
    }
    const s = ctx.extensionSettings[MODULE_NAME];
    if (!s.hidden) s.hidden = {};
    if (!s.linkages) s.linkages = {};
    if (!s.uiState) s.uiState = { activeTab: 'entries', ungroupedCol: false, editorFilter: 'all', editorGroupFilter: 'all', scrollPositions: {} };
    if (!s.uiState.scrollPositions) s.uiState.scrollPositions = {};
    return s;
}
function saveSettings() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// ─── Cached openai module ───
let _openaiModule = null;
async function getOpenai() {
    if (!_openaiModule) _openaiModule = await import('/scripts/openai.js');
    return _openaiModule;
}
/** Pre-warm openai import (fire-and-forget from index.js) */
export function preloadOpenai() {
    getOpenai().catch(() => {});
}

// ─── UI State Manager ───
export const UiStateManager = {
    get() {
        return getSettings().uiState;
    },
    save(changes) {
        const s = getSettings();
        if (!s.uiState) s.uiState = { activeTab: 'entries', ungroupedCol: false, editorFilter: 'all', editorGroupFilter: 'all', scrollPositions: {} };
        Object.assign(s.uiState, changes);
        saveSettings();
    },
    /** Save scroll position for a tab (debounced externally) */
    saveScrollPos(tabId, scrollTop) {
        const state = this.get();
        if (!state.scrollPositions) state.scrollPositions = {};
        state.scrollPositions[tabId] = scrollTop;
        // Don't call saveSettings() here — caller uses debounce
    },
    /** Get saved scroll position for a tab */
    getScrollPos(tabId) {
        const state = this.get();
        return (state.scrollPositions && state.scrollPositions[tabId]) || 0;
    }
};

// ─── Preset Cache ───
let _preset = null;
let _presetNames = null;

// ═══════════════════════════════════════
//  Preset Manager
// ═══════════════════════════════════════
export const PresetManager = {
    /** Returns cached preset (sync), or null if not yet loaded */
    cached() { return _preset; },

    async load() {
        const openai = await getOpenai();
        const promptManager = openai.promptManager;
        const pm = window.SillyTavern?.getContext?.()?.getPresetManager?.('openai');
        
        const presetName = pm?.getSelectedPresetName() || 'Default';
        const promptOrder = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter) || [];
        
        const prompts = promptOrder.map(orderItem => {
            const p = promptManager.getPromptById(orderItem.identifier);
            if (!p) return null;
            return {
                ...p,
                identifier: orderItem.identifier,
                name: p.name,
                enabled: orderItem.enabled
            };
        }).filter(Boolean);

        _preset = {
            name: presetName,
            prompts: prompts
        };
        
        // Clean up garbage quietly in the background
        setTimeout(() => this.cleanupGarbage(), 2000);
        
        return _preset;
    },

    cached() { return _preset; },

    async listNames() {
        // Try to get names from SillyTavern context first (more reliable)
        try {
            const ctx = SillyTavern.getContext();
            const pm = ctx.getPresetManager?.('openai');
            if (pm) {
                const list = pm.getPresetList();
                const names = pm.isKeyedApi() ? (list.preset_names || []) : Object.keys(list.preset_names || {});
                const active = pm.getSelectedPresetName();
                if (names.length > 0) {
                    return { names, active };
                }
            }
        } catch (e) {
            console.warn('[Zero] Failed to get preset list from context:', e);
        }

        // Fallback to DOM if context is unavailable or returns empty
        let names = [];
        let active = '';
        const selectEl = document.getElementById('settings_preset_openai');
        if (selectEl) {
            names = Array.from(selectEl.options).map(opt => opt.textContent.trim());
            if (selectEl.selectedIndex >= 0) {
                active = selectEl.options[selectEl.selectedIndex].textContent.trim();
            }
        }
        return { names, active };
    },

    async switchPreset(name) {
        const selectEl = document.getElementById('settings_preset_openai');
        if (!selectEl) return false;
        const opt = Array.from(selectEl.options).find(o => o.textContent.trim() === name);
        if (!opt) return false;
        
        selectEl.value = opt.value;
        selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof $ !== 'undefined') {
            $(selectEl).trigger('change');
        }
        
        _preset = null;
        _presetNames = null;
        return true;
    },

    async togglePrompt(identifier, enabled) {
        const openai = await getOpenai();
        const promptManager = openai.promptManager;
        if (promptManager) {
            const promptOrder = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
            const orderItem = promptOrder.find(o => o.identifier === identifier);
            if (orderItem) {
                orderItem.enabled = enabled;
                if (promptManager.tokenHandler && typeof promptManager.tokenHandler.getCounts === 'function') {
                    const counts = promptManager.tokenHandler.getCounts();
                    counts[identifier] = null;
                }
                promptManager.saveServiceSettings();
                if (typeof promptManager.renderDebounced === 'function') {
                    promptManager.renderDebounced();
                } else if (typeof promptManager.render === 'function') {
                    promptManager.render();
                }
            }
        }
        if (_preset) {
            const p = _preset.prompts.find(x => x.identifier === identifier);
            if (p) p.enabled = enabled;
        }
    },

    /** Batch update from a Map<identifier, enabled> */
    async batchToggleMap(toggleMap) {
        if (!_preset) await this.load();
        
        // Mutate existing cache instances
        _preset.prompts.forEach(p => {
            if (toggleMap.has(p.identifier)) {
                p.enabled = toggleMap.get(p.identifier);
            }
        });

        const openai = await getOpenai();
        const promptManager = openai.promptManager;
        if (promptManager) {
            const promptOrder = promptManager.getPromptOrderForCharacter(promptManager.activeCharacter);
            let changed = false;
            const tokenCounts = (promptManager.tokenHandler && typeof promptManager.tokenHandler.getCounts === 'function')
                ? promptManager.tokenHandler.getCounts() : null;
            promptOrder.forEach(o => {
                if (toggleMap.has(o.identifier)) {
                    o.enabled = toggleMap.get(o.identifier);
                    changed = true;
                    if (tokenCounts) tokenCounts[o.identifier] = null;
                }
            });
            if (changed) {
                promptManager.saveServiceSettings();
                if (typeof promptManager.renderDebounced === 'function') {
                    promptManager.renderDebounced();
                } else if (typeof promptManager.render === 'function') {
                    promptManager.render();
                }
            }
        }
    },

    invalidate() { _preset = null; _presetNames = null; },

    renameSettings(oldName, newName) {
        const s = getSettings();
        if (s.groups && s.groups[oldName]) {
            s.groups[newName] = s.groups[oldName];
            delete s.groups[oldName];
        }
        if (s.hidden && s.hidden[oldName]) {
            s.hidden[newName] = s.hidden[oldName];
            delete s.hidden[oldName];
        }
        if (s.linkages && s.linkages[oldName]) {
            s.linkages[newName] = s.linkages[oldName];
            delete s.linkages[oldName];
        }
        if (s.snapshots && Array.isArray(s.snapshots)) {
            s.snapshots.forEach(snap => {
                if (snap.presetName === oldName) {
                    snap.presetName = newName;
                }
            });
        }
        saveSettings();
    },

    async save() {
        // Find SillyTavern's native "Update Preset" button
        // Chat Completion (OpenAI/Claude/etc) is usually #update_oai_preset
        let btn = document.getElementById('update_oai_preset');
        
        // Fallback: look for other active preset manager buttons
        if (!btn || btn.offsetParent === null) {
            const btns = Array.from(document.querySelectorAll('[data-preset-manager-update]'))
                .filter(b => b.offsetParent !== null);
            if (btns.length > 0) btn = btns[0];
        }
        
        if (btn) {
            btn.click();
            return true;
        }
        return false;
    },

    async cleanupGarbage() {
        // Disabled to prevent race conditions that wipe valid prompt/group mappings on page reload/lag.
    }
};

// ═══════════════════════════════════════
//  Snapshot Manager
// ═══════════════════════════════════════
export const SnapshotManager = {
    /** Return snapshots for a specific preset (or all if no name given) */
    list(presetName) {
        const all = getSettings().snapshots || [];
        if (!presetName) return all;
        return all.filter(s => s.presetName === presetName);
    },

    create(name, preset) {
        const snap = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            name,
            presetName: preset.name,
            ts: Date.now(),
            entries: preset.prompts.map(p => ({ id: p.identifier, n: p.name, e: p.enabled }))
        };
        const s = getSettings();
        if (!s.snapshots) s.snapshots = [];
        s.snapshots.unshift(snap);
        saveSettings();
        return snap;
    },

    delete(id) {
        const s = getSettings();
        s.snapshots = (s.snapshots || []).filter(x => x.id !== id);
        saveSettings();
    },

    rename(id, newName) {
        const snap = (getSettings().snapshots || []).find(x => x.id === id);
        if (snap) { snap.name = newName; saveSettings(); }
    },

    overwrite(id, preset) {
        const snap = (getSettings().snapshots || []).find(x => x.id === id);
        if (snap) {
            snap.presetName = preset.name;
            snap.ts = Date.now();
            snap.entries = preset.prompts.map(p => ({ id: p.identifier, n: p.name, e: p.enabled }));
            saveSettings();
        }
    },

    /** Returns diff array: [{id, name, snapEnabled, curEnabled, type}] */
    diff(snapshot, preset) {
        const curMap = new Map();
        preset.prompts.forEach(p => curMap.set(p.identifier, p));
        const result = [];
        for (const e of snapshot.entries) {
            const c = curMap.get(e.id);
            if (!c) { result.push({ id: e.id, name: e.n, snapEnabled: e.e, curEnabled: null, type: 'missing' }); }
            else if (c.enabled !== e.e) { result.push({ id: e.id, name: e.n, snapEnabled: e.e, curEnabled: c.enabled, type: 'changed' }); }
            else { result.push({ id: e.id, name: e.n, snapEnabled: e.e, curEnabled: c.enabled, type: 'same' }); }
        }
        preset.prompts.forEach(p => {
            if (!snapshot.entries.find(e => e.id === p.identifier)) {
                result.push({ id: p.identifier, name: p.name, snapEnabled: null, curEnabled: p.enabled, type: 'new' });
            }
        });
        return result;
    },

    async apply(snapshot, preset) {
        // Safety check: warn if applying to a different preset
        if (preset && snapshot.presetName !== preset.name) {
            console.warn(`[Zero] Applying snapshot from "${snapshot.presetName}" to "${preset.name}"`);
        }
        const map = new Map();
        snapshot.entries.forEach(e => map.set(e.id, e.e));
        await PresetManager.batchToggleMap(map);
    }
};

// ═══════════════════════════════════════
//  Group Manager
// ═══════════════════════════════════════
export const GroupManager = {
    get(presetName) {
        const s = getSettings();
        if (!s.groups) s.groups = {};
        return s.groups[presetName] || [];
    },

    _save(presetName, groups) {
        const s = getSettings();
        if (!s.groups) s.groups = {};
        s.groups[presetName] = groups;
        saveSettings();
    },

    create(presetName, name) {
        const groups = this.get(presetName);
        const g = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, ids: [], col: false };
        groups.push(g);
        this._save(presetName, groups);
        return g;
    },

    remove(presetName, gid) {
        this._save(presetName, this.get(presetName).filter(g => g.id !== gid));
    },

    rename(presetName, gid, n) {
        const groups = this.get(presetName);
        const g = groups.find(x => x.id === gid);
        if (g) { g.name = n; this._save(presetName, groups); }
    },

    assign(presetName, gid, identifiers) {
        const groups = this.get(presetName);
        for (const g of groups) g.ids = g.ids.filter(id => !identifiers.includes(id));
        const tgt = groups.find(x => x.id === gid);
        if (tgt) tgt.ids.push(...identifiers);
        this._save(presetName, groups);
    },

    unassign(presetName, identifier) {
        const groups = this.get(presetName);
        for (const g of groups) g.ids = g.ids.filter(id => id !== identifier);
        this._save(presetName, groups);
    },

    setCollapse(presetName, gid, collapsed) {
        const groups = this.get(presetName);
        const g = groups.find(x => x.id === gid);
        if (g && g.col !== collapsed) { g.col = collapsed; this._save(presetName, groups); }
    },

    setSingle(presetName, gid, isSingle) {
        const groups = this.get(presetName);
        const g = groups.find(x => x.id === gid);
        if (g) { g.single = isSingle; this._save(presetName, groups); }
    },

    /** Reorder groups by array of group ids */
    reorder(presetName, orderedIds) {
        const groups = this.get(presetName);
        const map = new Map(groups.map(g => [g.id, g]));
        const reordered = orderedIds.map(id => map.get(id)).filter(Boolean);
        groups.forEach(g => { if (!orderedIds.includes(g.id)) reordered.push(g); });
        this._save(presetName, reordered);
    }
};

// ═══════════════════════════════════════
//  Hidden Manager
// ═══════════════════════════════════════
export const HiddenManager = {
    /** Returns a Set of hidden identifiers for a preset */
    get(presetName) {
        const s = getSettings();
        return new Set(s.hidden[presetName] || []);
    },

    hide(presetName, identifier) {
        const s = getSettings();
        if (!s.hidden[presetName]) s.hidden[presetName] = [];
        if (!s.hidden[presetName].includes(identifier)) {
            s.hidden[presetName].push(identifier);
            saveSettings();
        }
    },

    show(presetName, identifier) {
        const s = getSettings();
        if (s.hidden[presetName]) {
            s.hidden[presetName] = s.hidden[presetName].filter(id => id !== identifier);
            saveSettings();
        }
    },

    showAll(presetName) {
        const s = getSettings();
        s.hidden[presetName] = [];
        saveSettings();
    }
};

// ═══════════════════════════════════════
//  Linkage Manager
// ═══════════════════════════════════════
export const LinkageManager = {
    get(presetName) {
        const s = getSettings();
        if (!s.linkages) s.linkages = {};
        return s.linkages[presetName] || [];
    },
    _save(presetName, list) {
        const s = getSettings();
        if (!s.linkages) s.linkages = {};
        s.linkages[presetName] = list;
        saveSettings();
    },
    add(presetName, source, target) {
        const list = this.get(presetName);
        if (!list.some(l => l.source === source && l.target === target)) {
            list.push({ source, target });
            this._save(presetName, list);
        }
    },
    remove(presetName, source, target) {
        const list = this.get(presetName).filter(l => !(l.source === source && l.target === target));
        this._save(presetName, list);
    }
};
