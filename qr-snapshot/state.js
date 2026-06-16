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
        HistoryManager.record();
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
        HistoryManager.record();
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
        // Rename model profiles as well
        ModelProfileManager.renameSettings(oldName, newName);
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
        HistoryManager.record();
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
        HistoryManager.record();
        const s = getSettings();
        s.snapshots = (s.snapshots || []).filter(x => x.id !== id);
        saveSettings();
    },

    rename(id, newName) {
        HistoryManager.record();
        const snap = (getSettings().snapshots || []).find(x => x.id === id);
        if (snap) { snap.name = newName; saveSettings(); }
    },

    overwrite(id, preset) {
        HistoryManager.record();
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

        // Disable new entries that are not present in the snapshot
        if (preset && Array.isArray(preset.prompts)) {
            const snapIds = new Set(snapshot.entries.map(e => e.id));
            preset.prompts.forEach(p => {
                if (!snapIds.has(p.identifier)) {
                    map.set(p.identifier, false);
                }
            });
        }

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
        HistoryManager.record();
        const groups = this.get(presetName);
        const g = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, ids: [], col: false };
        groups.push(g);
        this._save(presetName, groups);
        return g;
    },

    remove(presetName, gid) {
        HistoryManager.record();
        this._save(presetName, this.get(presetName).filter(g => g.id !== gid));
    },

    rename(presetName, gid, n) {
        HistoryManager.record();
        const groups = this.get(presetName);
        const g = groups.find(x => x.id === gid);
        if (g) { g.name = n; this._save(presetName, groups); }
    },

    assign(presetName, gid, identifiers) {
        HistoryManager.record();
        const groups = this.get(presetName);
        for (const g of groups) g.ids = g.ids.filter(id => !identifiers.includes(id));
        const tgt = groups.find(x => x.id === gid);
        if (tgt) tgt.ids.push(...identifiers);
        this._save(presetName, groups);
    },

    unassign(presetName, identifier) {
        HistoryManager.record();
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

    /** Set group type: 'normal' | 'jailbreak' */
    setType(presetName, gid, type) {
        const groups = this.get(presetName);
        const g = groups.find(x => x.id === gid);
        if (g) { g.type = type; this._save(presetName, groups); }
    },

    /** Returns all jailbreak-type groups for a preset */
    getJailbreakGroups(presetName) {
        return this.get(presetName).filter(g => g.type === 'jailbreak');
    },

    /** Reorder groups by array of group ids */
    reorder(presetName, orderedIds) {
        HistoryManager.record();
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
        HistoryManager.record();
        const s = getSettings();
        if (!s.hidden[presetName]) s.hidden[presetName] = [];
        if (!s.hidden[presetName].includes(identifier)) {
            s.hidden[presetName].push(identifier);
            saveSettings();
        }
    },

    show(presetName, identifier) {
        HistoryManager.record();
        const s = getSettings();
        if (s.hidden[presetName]) {
            s.hidden[presetName] = s.hidden[presetName].filter(id => id !== identifier);
            saveSettings();
        }
    },

    showAll(presetName) {
        HistoryManager.record();
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
        HistoryManager.record();
        const list = this.get(presetName);
        if (!list.some(l => l.source === source && l.target === target)) {
            list.push({ source, target });
            this._save(presetName, list);
        }
    },
    remove(presetName, source, target) {
        HistoryManager.record();
        const list = this.get(presetName).filter(l => !(l.source === source && l.target === target));
        this._save(presetName, list);
    }
};

// ═══════════════════════════════════════
//  Sampling Params Helper
// ═══════════════════════════════════════
const SAMPLING_KEYS = [
    'temp_openai', 'top_p_openai', 'top_k_openai', 'min_p_openai', 'top_a_openai',
    'repetition_penalty_openai', 'freq_pen_openai', 'pres_pen_openai'
];
const ADDITIONAL_KEYS = ['custom_include_body', 'custom_exclude_body', 'custom_include_headers'];

export const SamplingParamsHelper = {
    /** Read current values from oai_settings via the openai module */
    async read() {
        const openai = await getOpenai();
        const s = openai.oai_settings;
        if (!s) return null;
        const sampling = {};
        SAMPLING_KEYS.forEach(k => { sampling[k] = s[k]; });
        const additional = {};
        ADDITIONAL_KEYS.forEach(k => { additional[k] = s[k] ?? ''; });
        return { sampling, additional };
    },

    /** Write values back: update DOM inputs and dispatch change events */
    async apply(sampling, additional) {
        const openai = await getOpenai();
        const s = openai.oai_settings;
        if (!s) return;

        // Mapping from oai_settings key to DOM element id
        const domMap = {
            temp_openai: 'temp_openai',
            top_p_openai: 'top_p_openai',
            top_k_openai: 'top_k_openai',
            min_p_openai: 'min_p_openai',
            top_a_openai: 'top_a_openai',
            repetition_penalty_openai: 'repetition_penalty_openai',
            freq_pen_openai: 'freq_pen_openai',
            pres_pen_openai: 'pres_pen_openai',
            custom_include_body: 'custom_include_body',
            custom_exclude_body: 'custom_exclude_body',
            custom_include_headers: 'custom_include_headers',
        };

        const allParams = Object.assign({}, sampling || {}, additional || {});
        for (const [key, val] of Object.entries(allParams)) {
            if (val === undefined || val === null) continue;
            s[key] = val;
            // Try to update DOM element
            const elId = domMap[key];
            if (elId) {
                const el = document.getElementById(elId);
                if (el) {
                    el.value = val;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        }
        SillyTavern.getContext().saveSettingsDebounced();
    }
};

// ═══════════════════════════════════════
//  Model Profile Manager
// ═══════════════════════════════════════
export const ModelProfileManager = {
    _key(presetName) { return presetName; },

    list(presetName) {
        const s = getSettings();
        if (!s.modelProfiles) s.modelProfiles = {};
        return s.modelProfiles[this._key(presetName)] || [];
    },

    _save(presetName, profiles) {
        const s = getSettings();
        if (!s.modelProfiles) s.modelProfiles = {};
        s.modelProfiles[this._key(presetName)] = profiles;
        saveSettings();
    },

    /**
     * Create a new model profile.
     * @param {string} presetName
     * @param {string} name - Profile display name
     * @param {string[]} selectedGroupIds - Jailbreak group IDs to be activated by this profile
     * @param {object} groupEntryStates - Map of { groupId: [{id, e}] } — current entry states per group
     * @param {object} samplingParams - { temp_openai, top_p_openai, ... }
     * @param {object} additionalParams - { custom_include_body, custom_exclude_body, custom_include_headers }
     */
    create(presetName, name, selectedGroupIds, groupEntryStates, samplingParams, additionalParams) {
        const profiles = this.list(presetName);
        const profile = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            name,
            presetName,
            ts: Date.now(),
            selectedGroupIds,       // string[] — which jailbreak groups are ON
            groupEntryStates,       // { [gid]: [{id, e}] } — per-group entry states
            samplingParams,
            additionalParams
        };
        profiles.unshift(profile);
        this._save(presetName, profiles);
        return profile;
    },

    delete(presetName, id) {
        this._save(presetName, this.list(presetName).filter(p => p.id !== id));
    },

    rename(presetName, id, newName) {
        const profiles = this.list(presetName);
        const p = profiles.find(x => x.id === id);
        if (p) { p.name = newName; this._save(presetName, profiles); }
    },

    overwrite(presetName, id, selectedGroupIds, groupEntryStates, samplingParams, additionalParams) {
        const profiles = this.list(presetName);
        const p = profiles.find(x => x.id === id);
        if (p) {
            p.ts = Date.now();
            p.selectedGroupIds = selectedGroupIds;
            p.groupEntryStates = groupEntryStates;
            p.samplingParams = samplingParams;
            p.additionalParams = additionalParams;
            this._save(presetName, profiles);
        }
    },

    /**
     * Apply a profile:
     * 1. Force-OFF all entries in unselected jailbreak groups
     * 2. Restore entry states for selected jailbreak groups (selected group wins on conflict)
     * 3. Apply sampling + additional params
     */
    async apply(profile, preset) {
        const allJbGroups = GroupManager.getJailbreakGroups(profile.presetName);
        const selectedSet = new Set(profile.selectedGroupIds || []);
        const toggleMap = new Map();

        // Step 1: turn OFF all entries in unselected jailbreak groups
        allJbGroups.forEach(g => {
            if (!selectedSet.has(g.id)) {
                g.ids.forEach(id => toggleMap.set(id, false));
            }
        });

        // Step 2: apply selected group entry states (overrides any conflicts)
        const states = profile.groupEntryStates || {};
        selectedSet.forEach(gid => {
            const entries = states[gid] || [];
            entries.forEach(e => toggleMap.set(e.id, e.e));
        });

        if (toggleMap.size > 0) {
            await PresetManager.batchToggleMap(toggleMap);
        }

        // Step 3: apply sampling & additional params
        await SamplingParamsHelper.apply(profile.samplingParams, profile.additionalParams);
    },

    /** Rename profile references if preset is renamed */
    renameSettings(oldName, newName) {
        const s = getSettings();
        if (!s.modelProfiles) return;
        if (s.modelProfiles[oldName]) {
            s.modelProfiles[newName] = s.modelProfiles[oldName];
            delete s.modelProfiles[oldName];
            s.modelProfiles[newName].forEach(p => { p.presetName = newName; });
        }
        saveSettings();
    }
};

// ═══════════════════════════════════════
//  Mixed Language Translation Helper
// ═══════════════════════════════════════
export async function zeroTranslate(text) {
    if (typeof window.translate !== 'function') return text;
    if (!text || text.trim() === '') return '';

    const targetLang = (window.SillyTavern?.getContext?.()?.extensionSettings?.translate?.target_language || 'zh-cn').toLowerCase();

    const parts = text.split(/(\n\n+)/);
    const translateIndices = [];
    const translateTexts = [];

    for (let i = 0; i < parts.length; i += 2) {
        const part = parts[i];
        if (part.trim() === '') continue;

        let needTranslate = true;
        if (targetLang.startsWith('zh')) {
            // Target is Chinese: translate if it contains any Latin letters, Japanese Kana, or Korean Hangul
            if (!/[a-zA-Z\u3040-\u30ff\uac00-\ud7af]/.test(part)) {
                needTranslate = false;
            }
        } else if (targetLang.startsWith('en')) {
            // Target is English: translate if it contains any CJK characters (Chinese, Japanese, Korean)
            if (!/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(part)) {
                needTranslate = false;
            }
        }

        if (needTranslate) {
            translateIndices.push(i);
            translateTexts.push(part);
        }
    }

    if (translateTexts.length === 0) {
        return text;
    }

    // Try batch translation to prevent rate limiting
    try {
        const combinedText = translateTexts.join('\n\n=====\n\n');
        const translatedCombined = await window.translate(combinedText);
        if (translatedCombined) {
            const translatedParts = translatedCombined.split(/\n+={3,}\s*\n+/);
            if (translatedParts.length === translateTexts.length) {
                for (let k = 0; k < translateIndices.length; k++) {
                    parts[translateIndices[k]] = translatedParts[k].trim();
                }
                return parts.join('');
            } else {
                console.warn('[Zero] Batch translation parts length mismatch. Expected:', translateTexts.length, 'Got:', translatedParts.length, 'Falling back to individual translation.');
            }
        }
    } catch (e) {
        console.error('[Zero] Batch translation failed, falling back to individual translation:', e);
    }

    // Fallback: translate paragraph-by-paragraph
    for (let k = 0; k < translateIndices.length; k++) {
        const idx = translateIndices[k];
        try {
            const singleTranslated = await window.translate(parts[idx]);
            if (singleTranslated) {
                parts[idx] = singleTranslated;
            }
        } catch (err) {
            console.error('[Zero] Paragraph translation fallback failed for index:', idx, err);
        }
    }

    return parts.join('');
}

// ─── Undo / Redo History Manager ───
let undoStack = [];
let redoStack = [];
let alreadyRecorded = false;
let isRestoring = false;

export const HistoryManager = {
    clear() {
        undoStack = [];
        redoStack = [];
        alreadyRecorded = false;
        isRestoring = false;
        this.updateButtonsState();
    },

    captureState() {
        try {
            const pm = SillyTavern.getContext().getPresetManager('openai');
            if (!pm) return null;
            const { presets, preset_names } = pm.getPresetList();
            const activePresetName = pm.getSelectedPresetName();
            
            // Deep clone presets & names
            const clonedPresets = JSON.parse(JSON.stringify(presets));
            const clonedNames = JSON.parse(JSON.stringify(preset_names));
            
            // Deep clone Zero extension settings
            const zeroSettings = JSON.parse(JSON.stringify(getSettings()));

            // Deep clone manual links from localStorage
            const manualLinks = JSON.parse(localStorage.getItem('zero_manual_links') || '{}');

            return {
                presets: clonedPresets,
                preset_names: clonedNames,
                activePresetName: activePresetName,
                zeroSettings: zeroSettings,
                manualLinks: manualLinks
            };
        } catch (e) {
            console.error('[Zero] Failed to capture state for undo:', e);
            return null;
        }
    },

    record() {
        if (isRestoring || alreadyRecorded) return;
        
        const state = this.captureState();
        if (!state) return;

        alreadyRecorded = true;
        Promise.resolve().then(() => {
            alreadyRecorded = false;
        });
        
        // Push to undo stack
        undoStack.push(state);
        // Limit to 5 steps
        if (undoStack.length > 5) {
            undoStack.shift();
        }
        // Clear redo stack on new action
        redoStack = [];
        
        this.updateButtonsState();
    },

    async undo() {
        if (undoStack.length === 0) return;
        
        // Capture current state to push to redo stack
        const currentState = this.captureState();
        if (currentState) {
            redoStack.push(currentState);
            if (redoStack.length > 5) {
                redoStack.shift();
            }
        }
        
        const prevState = undoStack.pop();
        await this.restoreState(prevState);
        
        this.updateButtonsState();
        window.dispatchEvent(new Event('zero-history-changed'));
    },

    async redo() {
        if (redoStack.length === 0) return;
        
        // Capture current state to push to undo stack
        const currentState = this.captureState();
        if (currentState) {
            undoStack.push(currentState);
            if (undoStack.length > 5) {
                undoStack.shift();
            }
        }
        
        const nextState = redoStack.pop();
        await this.restoreState(nextState);
        
        this.updateButtonsState();
        window.dispatchEvent(new Event('zero-history-changed'));
    },

    async restoreState(snapshot) {
        try {
            isRestoring = true;
            const pm = SillyTavern.getContext().getPresetManager('openai');
            if (!pm) return;
            const list = pm.getPresetList();
            const isKeyed = pm.isKeyedApi();
            
            // Build current presets map (name -> presetData)
            const currentPresetsMap = new Map();
            if (isKeyed) {
                if (Array.isArray(list.preset_names)) {
                    list.preset_names.forEach((name, idx) => {
                        const presetData = list.presets[idx];
                        if (presetData) {
                            currentPresetsMap.set(name, presetData);
                        }
                    });
                }
            } else {
                if (list.preset_names && typeof list.preset_names === 'object') {
                    for (const name in list.preset_names) {
                        const idx = list.preset_names[name];
                        const presetData = list.presets[idx];
                        if (presetData) {
                            currentPresetsMap.set(name, presetData);
                        }
                    }
                }
            }

            // Build snapshot presets map (name -> presetData)
            const snapshotPresetsMap = new Map();
            if (isKeyed) {
                if (Array.isArray(snapshot.preset_names)) {
                    snapshot.preset_names.forEach((name, idx) => {
                        const presetData = snapshot.presets[idx];
                        if (presetData) {
                            snapshotPresetsMap.set(name, presetData);
                        }
                    });
                }
            } else {
                if (snapshot.preset_names && typeof snapshot.preset_names === 'object') {
                    for (const name in snapshot.preset_names) {
                        const idx = snapshot.preset_names[name];
                        const presetData = snapshot.presets[idx];
                        if (presetData) {
                            snapshotPresetsMap.set(name, presetData);
                        }
                    }
                }
            }

            // Parallel sync backend
            const syncTasks = [];

            // 1. Delete presets from backend that are in current but not in snapshot
            for (const name of currentPresetsMap.keys()) {
                if (!snapshotPresetsMap.has(name)) {
                    syncTasks.push((async () => {
                        try {
                            await pm.deletePreset(name);
                        } catch (e) {
                            console.error('[Zero] Failed to delete preset on undo/redo:', name, e);
                        }
                    })());
                }
            }

            // 2. Save/Restore presets to backend that are in snapshot and changed
            for (const [name, presetData] of snapshotPresetsMap.entries()) {
                const currentData = currentPresetsMap.get(name);
                if (!currentData || JSON.stringify(currentData) !== JSON.stringify(presetData)) {
                    syncTasks.push((async () => {
                        try {
                            await pm.savePreset(name, presetData, { skipUpdate: true });
                        } catch (e) {
                            console.error('[Zero] Failed to save preset on undo/redo:', name, e);
                        }
                    })());
                }
            }

            if (syncTasks.length > 0) {
                await Promise.all(syncTasks);
            }
            
            // Restore presets in SillyTavern in-memory lists
            list.presets.length = 0;
            snapshot.presets.forEach(p => list.presets.push(p));
            
            // Restore preset names
            if (Array.isArray(list.preset_names)) {
                list.preset_names.length = 0;
                snapshot.preset_names.forEach(n => list.preset_names.push(n));
            } else if (list.preset_names && typeof list.preset_names === 'object') {
                for (const key in list.preset_names) {
                    delete list.preset_names[key];
                }
                Object.assign(list.preset_names, snapshot.preset_names);
            }
            
            // Restore active preset selection
            const currentActiveName = pm.getSelectedPresetName();
            if (currentActiveName !== snapshot.activePresetName) {
                const activeVal = pm.findPreset(snapshot.activePresetName);
                if (activeVal !== undefined && activeVal !== null) {
                    await pm.selectPreset(activeVal);
                }
            } else {
                // If active preset didn't change, trigger light-weight refresh of prompt order
                const openai = await getOpenai();
                const promptManager = openai?.promptManager;
                if (promptManager && typeof promptManager.render === 'function') {
                    if (typeof promptManager.renderDebounced === 'function') {
                        promptManager.renderDebounced();
                    } else {
                        promptManager.render();
                    }
                }
            }
            
            // Restore Zero extension settings
            const s = getSettings();
            for (const key in s) {
                delete s[key];
            }
            Object.assign(s, JSON.parse(JSON.stringify(snapshot.zeroSettings)));
            saveSettings();

            // Restore manual links in localStorage
            if (snapshot.manualLinks) {
                localStorage.setItem('zero_manual_links', JSON.stringify(snapshot.manualLinks));
            } else {
                localStorage.removeItem('zero_manual_links');
            }
            
            // Invalidate Zero caches
            PresetManager.invalidate();
            
            // Force refresh native preset manager
            if (typeof pm.render === 'function') pm.render();
            else if (typeof pm.populate === 'function') pm.populate();
        } catch (e) {
            console.error('[Zero] Failed to restore state:', e);
        } finally {
            isRestoring = false;
        }
    },

    updateButtonsState() {
        const hasUndo = undoStack.length > 0;
        const hasRedo = redoStack.length > 0;
        
        const $undoBtn = $('#zero-history-undo');
        const $redoBtn = $('#zero-history-redo');
        
        if ($undoBtn.length) {
            $undoBtn.prop('disabled', !hasUndo).css('opacity', hasUndo ? '1' : '0.4').css('cursor', hasUndo ? 'pointer' : 'default');
        }
        if ($redoBtn.length) {
            $redoBtn.prop('disabled', !hasRedo).css('opacity', hasRedo ? '1' : '0.4').css('cursor', hasRedo ? 'pointer' : 'default');
        }
    }
};

