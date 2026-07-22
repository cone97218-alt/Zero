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

    async switchPreset(name, options = {}) {
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

        if (!options.skipLinkage && typeof window.triggerZeroApiLinkage === 'function') {
            window.triggerZeroApiLinkage(name);
        }

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

        import('../preset-manager/utils.js').then(m => m.syncBoundRegexOnPromptToggle([{ identifier, enabled }])).catch(e => {
            console.warn('[Zero] Failed to sync bound regex on togglePrompt:', e);
        });
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

        import('../preset-manager/utils.js').then(m => m.syncBoundRegexOnPromptToggle(toggleMap)).catch(e => {
            console.warn('[Zero] Failed to sync bound regex on batchToggleMap:', e);
        });
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
        SnapshotGroupManager.renameSettings(oldName, newName);
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

export async function detectPresetRenames() {
    try {
        const ctx = SillyTavern.getContext();
        const pm = ctx.getPresetManager?.('openai');
        if (!pm) return;

        // 1. Get all available preset names from SillyTavern
        const activePresets = pm.getCompletionPresetNames?.() || [];
        if (activePresets.length === 0) return;

        // 2. Identify preset names currently stored in our settings
        const s = getSettings();
        const storedPresets = new Set();
        if (s.snapshots && Array.isArray(s.snapshots)) {
            s.snapshots.forEach(snap => {
                if (snap.presetName) storedPresets.add(snap.presetName);
            });
        }
        if (s.groups) Object.keys(s.groups).forEach(name => storedPresets.add(name));
        if (s.hidden) Object.keys(s.hidden).forEach(name => storedPresets.add(name));
        if (s.linkages) Object.keys(s.linkages).forEach(name => storedPresets.add(name));

        // 3. Find orphaned presets (in our settings but not active in SillyTavern)
        const orphaned = Array.from(storedPresets).filter(name => !activePresets.includes(name));
        if (orphaned.length === 0) return;

        // 4. Find new presets (active in SillyTavern but not in our settings)
        const brandNew = activePresets.filter(name => !storedPresets.has(name));
        if (brandNew.length === 0) return;

        // 5. For each brand new preset, see if it matches an orphaned preset
        for (const newName of brandNew) {
            const newPrompts = await getPresetPromptsWithEnabled(newName);
            if (newPrompts.length === 0) continue;

            const newIds = new Set(newPrompts.map(p => p.identifier));

            for (const oldName of orphaned) {
                // Get prompt identifiers from old preset snapshots
                const oldSnaps = s.snapshots.filter(snap => snap.presetName === oldName);
                
                // Let's also check if we have groups or other structures for this old preset
                const hasOldData = oldSnaps.length > 0 || (s.groups && s.groups[oldName]);
                if (!hasOldData) continue;

                // Collect all unique prompt IDs from the old snapshots/groups to compare
                const oldIds = new Set();
                oldSnaps.forEach(snap => {
                    if (snap.entries) snap.entries.forEach(e => oldIds.add(e.id));
                });
                
                // Fallback to prompt groups if no snapshots exist yet
                if (oldIds.size === 0 && s.groups && s.groups[oldName]) {
                    s.groups[oldName].forEach(g => {
                        if (g.pids) g.pids.forEach(id => oldIds.add(id));
                    });
                }

                if (oldIds.size === 0) continue;

                // Compare the ID sets: if they are identical or highly similar, it's a rename!
                let matches = 0;
                oldIds.forEach(id => {
                    if (newIds.has(id)) matches++;
                });

                const similarity = matches / Math.max(oldIds.size, newIds.size);
                if (similarity >= 0.95) { // 95% or higher ID match
                    console.log(`[Zero] Detected preset rename from "${oldName}" to "${newName}". Auto-migrating snapshots and settings.`);
                    PresetManager.renameSettings(oldName, newName);
                    // Remove oldName from orphaned list so it doesn't match multiple times
                    const idx = orphaned.indexOf(oldName);
                    if (idx !== -1) orphaned.splice(idx, 1);
                    break;
                }
            }
        }
    } catch (e) {
        console.error('[Zero] Failed to auto-detect preset renames:', e);
    }
}

/** Read prompts and their current toggle (enabled) states from a preset name */
export async function getPresetPromptsWithEnabled(presetName) {
    try {
        const ctx = SillyTavern.getContext();
        const pm = ctx.getPresetManager?.('openai');
        if (!pm) return [];
        const presetData = pm.getCompletionPresetByName(presetName);
        if (!presetData || !presetData.prompts) return [];

        let orderList = [];
        if (Array.isArray(presetData.prompt_order) && presetData.prompt_order.length > 0) {
            const globalOrder = presetData.prompt_order.find(item => item && String(item.character_id) === '100001');
            if (globalOrder && Array.isArray(globalOrder.order)) {
                orderList = globalOrder.order;
            } else {
                const first = presetData.prompt_order[0];
                if (first && Array.isArray(first.order)) {
                    orderList = first.order;
                } else {
                    orderList = presetData.prompt_order.filter(item => item && item.identifier);
                }
            }
        }

        const enabledMap = new Map();
        orderList.forEach(po => {
            if (po && po.identifier) {
                enabledMap.set(po.identifier, po.enabled === true);
            }
        });

        return presetData.prompts
            .filter(p => enabledMap.has(p.identifier))
            .map(p => ({
                identifier: p.identifier,
                name: p.name || p.identifier,
                enabled: enabledMap.get(p.identifier),
                content: p.content || ''
            }));
    } catch (e) {
        console.error('[Zero] Failed to read prompts for preset:', presetName, e);
        return [];
    }
}

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

    async create(name, preset, overrideParams = null) {
        HistoryManager.record();
        const decouple = UiStateManager.get().decoupleJailbreak === true;

        let snapEntries;
        let samplingParams = null;
        let additionalParams = null;

        if (decouple) {
            const jbGroups = GroupManager.getJailbreakGroups(preset.name);
            const jbPromptIds = new Set();
            jbGroups.forEach(g => g.ids.forEach(id => jbPromptIds.add(id)));
            snapEntries = preset.prompts
                .filter(p => !jbPromptIds.has(p.identifier))
                .map(p => ({ id: p.identifier, n: p.name, e: p.enabled }));
        } else {
            snapEntries = preset.prompts.map(p => ({ id: p.identifier, n: p.name, e: p.enabled }));
            if (overrideParams) {
                samplingParams = overrideParams.samplingParams;
                additionalParams = overrideParams.additionalParams;
            } else {
                try {
                    const params = await SamplingParamsHelper.read();
                    if (params) {
                        samplingParams = params.sampling;
                        additionalParams = params.additional;
                    }
                } catch (e) {
                    console.warn('[Zero] Failed to read sampling params for snapshot:', e);
                }
            }
        }

        const snap = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            name,
            presetName: preset.name,
            ts: Date.now(),
            entries: snapEntries,
            samplingParams,
            additionalParams
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

    async overwrite(id, preset) {
        HistoryManager.record();
        const snap = (getSettings().snapshots || []).find(x => x.id === id);
        if (snap) {
            const decouple = UiStateManager.get().decoupleJailbreak === true;
            let snapEntries;
            let samplingParams = null;
            let additionalParams = null;

            if (decouple) {
                const jbGroups = GroupManager.getJailbreakGroups(preset.name);
                const jbPromptIds = new Set();
                jbGroups.forEach(g => g.ids.forEach(id => jbPromptIds.add(id)));
                snapEntries = preset.prompts
                    .filter(p => !jbPromptIds.has(p.identifier))
                    .map(p => ({ id: p.identifier, n: p.name, e: p.enabled }));
            } else {
                snapEntries = preset.prompts.map(p => ({ id: p.identifier, n: p.name, e: p.enabled }));
                try {
                    const params = await SamplingParamsHelper.read();
                    if (params) {
                        samplingParams = params.sampling;
                        additionalParams = params.additional;
                    }
                } catch (e) {
                    console.warn('[Zero] Failed to read sampling params for snapshot:', e);
                }
            }

            snap.presetName = preset.name;
            snap.ts = Date.now();
            snap.entries = snapEntries;
            snap.samplingParams = samplingParams;
            snap.additionalParams = additionalParams;
            saveSettings();
        }
    },

    /** Returns diff array: [{id, name, snapEnabled, curEnabled, type}] */
    diff(snapshot, preset) {
        const decouple = UiStateManager.get().decoupleJailbreak === true;

        let jbPromptIds = new Set();
        if (decouple) {
            const jbGroups = GroupManager.getJailbreakGroups(preset.name);
            jbGroups.forEach(g => g.ids.forEach(id => jbPromptIds.add(id)));
        }

        const curMap = new Map();
        preset.prompts.forEach(p => {
            if (!decouple || !jbPromptIds.has(p.identifier)) {
                curMap.set(p.identifier, p);
            }
        });

        const result = [];
        for (const e of snapshot.entries) {
            const c = curMap.get(e.id);
            if (!c) { result.push({ id: e.id, name: e.n, snapEnabled: e.e, curEnabled: null, type: 'missing' }); }
            else if (c.enabled !== e.e) { result.push({ id: e.id, name: e.n, snapEnabled: e.e, curEnabled: c.enabled, type: 'changed' }); }
            else { result.push({ id: e.id, name: e.n, snapEnabled: e.e, curEnabled: c.enabled, type: 'same' }); }
        }
        preset.prompts.forEach(p => {
            if ((!decouple || !jbPromptIds.has(p.identifier)) && !snapshot.entries.find(e => e.id === p.identifier)) {
                result.push({ id: p.identifier, name: p.name, snapEnabled: null, curEnabled: p.enabled, type: 'new' });
            }
        });
        return result;
    },

    async apply(snapshot, preset) {
        if (preset && snapshot.presetName !== preset.name) {
            console.warn(`[Zero] Applying snapshot from "${snapshot.presetName}" to "${preset.name}"`);
        }
        const map = new Map();
        snapshot.entries.forEach(e => map.set(e.id, e.e));

        const decouple = UiStateManager.get().decoupleJailbreak === true;

        if (preset && Array.isArray(preset.prompts)) {
            let jbPromptIds = new Set();
            if (decouple) {
                const jbGroups = GroupManager.getJailbreakGroups(preset.name);
                jbGroups.forEach(g => g.ids.forEach(id => jbPromptIds.add(id)));
            }

            const snapIds = new Set(snapshot.entries.map(e => e.id));
            preset.prompts.forEach(p => {
                if (!snapIds.has(p.identifier) && (!decouple || !jbPromptIds.has(p.identifier))) {
                    map.set(p.identifier, false);
                }
            });
        }

        await PresetManager.batchToggleMap(map);

        if (!decouple && snapshot.samplingParams) {
            await SamplingParamsHelper.apply(snapshot.samplingParams, snapshot.additionalParams);
        }
    },

    /** Categorizes snapshot entries for mapping to a preset */
    async computeMapping(snapshot, preset, sourcePrompts = [], similarityThreshold = 0.8) {
        const snapEntries = snapshot.entries || [];
        const currentPrompts = preset.prompts || [];

        // Read manual linkages from local storage
        let manualLinks = {};
        try {
            const links = JSON.parse(localStorage.getItem('zero_manual_links') || '{}');
            const keyPair = `${snapshot.presetName}::${preset.name}`;
            manualLinks = links[keyPair] || {};
        } catch (e) {
            console.error('[Zero] Failed to read zero_manual_links:', e);
        }

        const matched = [];
        const missing = [];
        const unmatchedTargetPrompts = new Set(currentPrompts);
        const matchedSourceIds = new Set();

        // Build lookup maps for performance
        const currentPromptsMap = new Map(currentPrompts.map(p => [p.identifier, p]));
        const sourcePromptsMap = new Map(sourcePrompts.map(p => [p.identifier, p]));

        // 1. Match by exact ID
        snapEntries.forEach(se => {
            const tgt = currentPromptsMap.get(se.id);
            if (tgt) {
                matched.push({ snapEntry: se, targetPrompt: tgt, type: 'id' });
                matchedSourceIds.add(se.id);
                unmatchedTargetPrompts.delete(tgt);
            }
        });

        // 2. Match by manual linkages
        snapEntries.forEach(se => {
            if (matchedSourceIds.has(se.id)) return;
            const targetId = manualLinks[se.id];
            if (targetId) {
                const tgt = currentPromptsMap.get(targetId);
                if (tgt && unmatchedTargetPrompts.has(tgt)) {
                    matched.push({ snapEntry: se, targetPrompt: tgt, type: 'manual_link' });
                    matchedSourceIds.add(se.id);
                    unmatchedTargetPrompts.delete(tgt);
                }
            }
        });

        // 3. Match by Name (case-insensitive, trimmed)
        const unmatchedTargetByName = new Map();
        unmatchedTargetPrompts.forEach(p => {
            const cleanName = (p.name || '').trim().toLowerCase();
            if (cleanName && !unmatchedTargetByName.has(cleanName)) {
                unmatchedTargetByName.set(cleanName, p);
            }
        });

        snapEntries.forEach(se => {
            if (matchedSourceIds.has(se.id)) return;
            const cleanName = (se.n || '').trim().toLowerCase();
            if (!cleanName) return;

            const tgt = unmatchedTargetByName.get(cleanName);
            if (tgt && unmatchedTargetPrompts.has(tgt)) {
                matched.push({ snapEntry: se, targetPrompt: tgt, type: 'name' });
                matchedSourceIds.add(se.id);
                unmatchedTargetPrompts.delete(tgt);
                unmatchedTargetByName.delete(cleanName);
            }
        });

        // 4. Match by content similarity (if sourcePrompts are available and threshold > 0, and setting is enabled)
        const compareEnabled = UiStateManager.get().migrateContentCompare !== false;
        if (compareEnabled && Array.isArray(sourcePrompts) && sourcePrompts.length > 0 && similarityThreshold > 0) {
            // Pre-calculate bigrams for unmatched source and target prompts once
            const sourceInfos = new Map();
            for (const se of snapEntries) {
                if (matchedSourceIds.has(se.id)) continue;
                const sourceP = sourcePromptsMap.get(se.id);
                if (sourceP && typeof sourceP.content === 'string' && sourceP.content.trim()) {
                    sourceInfos.set(se.id, getBigrams(sourceP.content));
                }
            }

            const targetInfos = new Map();
            for (const p of unmatchedTargetPrompts) {
                if (typeof p.content === 'string' && p.content.trim()) {
                    targetInfos.set(p.identifier, getBigrams(p.content));
                }
            }

            let comparisonsCount = 0;
            for (const se of snapEntries) {
                if (matchedSourceIds.has(se.id)) continue;
                const info1 = sourceInfos.get(se.id);
                if (!info1) continue;

                let bestMatch = null;
                let highestScore = -1;

                for (const p of unmatchedTargetPrompts) {
                    const info2 = targetInfos.get(p.identifier);
                    if (!info2) continue;

                    const b1 = info1.cleanStr.length - 1;
                    const b2 = info2.cleanStr.length - 1;
                    if (b1 <= 0 || b2 <= 0) continue;

                    // Length-based maximum possible score check
                    const maxPossible = (2.0 * Math.min(b1, b2)) / (b1 + b2);
                    if (maxPossible < similarityThreshold || maxPossible <= highestScore) continue;

                    const score = getStringSimilarityFromInfos(info1, info2);
                    comparisonsCount++;

                    // Yield to the event loop every 300 comparisons to prevent UI thread blocking
                    if (comparisonsCount % 300 === 0) {
                        await new Promise(resolve => setTimeout(resolve, 0));
                    }

                    if (score >= similarityThreshold && score > highestScore) {
                        highestScore = score;
                        bestMatch = p;
                    }
                }

                if (bestMatch) {
                    matched.push({
                        snapEntry: se,
                        targetPrompt: bestMatch,
                        type: 'content',
                        score: highestScore
                    });
                    matchedSourceIds.add(se.id);
                    unmatchedTargetPrompts.delete(bestMatch);
                }
            }
        }

        // 5. Anything left in snapEntries is missing
        snapEntries.forEach(se => {
            if (!matchedSourceIds.has(se.id)) {
                missing.push(se);
            }
        });

        // Anything left in unmatchedTargetPrompts is new
        const newEntries = Array.from(unmatchedTargetPrompts);

        return { matched, missing, newEntries };
    },

    async applySmart(snapshot, preset, resolvedToggles, saveAsCopyName = null, keepHistoricalParams = true) {
        HistoryManager.record();

        // 1. Batch toggle the prompt states
        await PresetManager.batchToggleMap(resolvedToggles);

        // 2. Apply sampling params if available, decoupleJailbreak is false, and keepHistoricalParams is true
        const decouple = UiStateManager.get().decoupleJailbreak === true;
        if (!decouple && keepHistoricalParams && snapshot.samplingParams) {
            await SamplingParamsHelper.apply(snapshot.samplingParams, snapshot.additionalParams);
        }

        // 3. Save as copy in the current preset if requested
        if (saveAsCopyName && preset) {
            const nextPreset = await PresetManager.load();
            return await this.create(saveAsCopyName, nextPreset, keepHistoricalParams ? {
                samplingParams: snapshot.samplingParams,
                additionalParams: snapshot.additionalParams
            } : null);
        }
        return null;
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
    },

    migrate(sourcePresetName, targetPresetName, promptIdMap) {
        HistoryManager.record();
        const sourceGroups = this.get(sourcePresetName);
        const targetGroups = this.get(targetPresetName);
        const groupIdMap = new Map();

        sourceGroups.forEach(srcG => {
            // Find or create group in target
            let tgtG = targetGroups.find(g => g.name === srcG.name);
            if (!tgtG) {
                tgtG = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: srcG.name, ids: [], col: srcG.col || false, type: srcG.type || 'normal', single: srcG.single || false };
                targetGroups.push(tgtG);
            }
            groupIdMap.set(srcG.id, tgtG.id);

            // Map identifiers inside the group
            srcG.ids.forEach(srcId => {
                const tgtId = promptIdMap.get(srcId);
                if (tgtId && !tgtG.ids.includes(tgtId)) {
                    tgtG.ids.push(tgtId);
                }
            });
        });

        this._save(targetPresetName, targetGroups);
        return groupIdMap;
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
    },

    migrate(sourcePresetName, targetPresetName, promptIdMap) {
        HistoryManager.record();
        const s = getSettings();
        if (!s.hidden) s.hidden = {};
        const sourceHidden = s.hidden[sourcePresetName] || [];
        const targetHidden = s.hidden[targetPresetName] || [];

        sourceHidden.forEach(srcId => {
            const tgtId = promptIdMap.get(srcId);
            if (tgtId && !targetHidden.includes(tgtId)) {
                targetHidden.push(tgtId);
            }
        });
        s.hidden[targetPresetName] = targetHidden;
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
    },

    migrate(sourcePresetName, targetPresetName, promptIdMap) {
        HistoryManager.record();
        const sourceLinks = this.get(sourcePresetName);
        const targetLinks = this.get(targetPresetName);

        sourceLinks.forEach(link => {
            const tgtSource = promptIdMap.get(link.source);
            const tgtTarget = promptIdMap.get(link.target);
            if (tgtSource && tgtTarget) {
                if (!targetLinks.some(l => l.source === tgtSource && l.target === tgtTarget)) {
                    targetLinks.push({ source: tgtSource, target: tgtTarget });
                }
            }
        });
        this._save(targetPresetName, targetLinks);
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
    },

    migrate(sourcePresetName, targetPresetName, promptIdMap, groupIdMap) {
        HistoryManager.record();
        const sourceProfiles = this.list(sourcePresetName);
        const targetProfiles = this.list(targetPresetName);

        sourceProfiles.forEach(srcP => {
            const tgtSelectedGroupIds = (srcP.selectedGroupIds || []).map(gid => groupIdMap.get(gid)).filter(Boolean);
            const tgtGroupEntryStates = {};
            if (srcP.groupEntryStates) {
                for (const [gid, states] of Object.entries(srcP.groupEntryStates)) {
                    const tgtGid = groupIdMap.get(gid);
                    if (tgtGid) {
                        tgtGroupEntryStates[tgtGid] = states.map(st => {
                            const tgtId = promptIdMap.get(st.id);
                            return tgtId ? { id: tgtId, e: st.e } : null;
                        }).filter(Boolean);
                    }
                }
            }

            const tgtP = {
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
                name: srcP.name,
                presetName: targetPresetName,
                ts: Date.now(),
                selectedGroupIds: tgtSelectedGroupIds,
                groupEntryStates: tgtGroupEntryStates,
                samplingParams: srcP.samplingParams ? { ...srcP.samplingParams } : null,
                additionalParams: srcP.additionalParams ? { ...srcP.additionalParams } : null
            };
            
            if (!targetProfiles.some(p => p.name === tgtP.name)) {
                targetProfiles.push(tgtP);
            }
        });

        this._save(targetPresetName, targetProfiles);
    }
};

// ═══════════════════════════════════════
//  Snapshot Group Manager
// ═══════════════════════════════════════
export const SnapshotGroupManager = {
    get(presetName) {
        const s = getSettings();
        if (!s.snapshotGroups) s.snapshotGroups = {};
        return s.snapshotGroups[presetName] || [];
    },

    _save(presetName, groups) {
        const s = getSettings();
        if (!s.snapshotGroups) s.snapshotGroups = {};
        s.snapshotGroups[presetName] = groups;
        saveSettings();
    },

    create(presetName, name) {
        HistoryManager.record();
        const groups = this.get(presetName);
        const g = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, sids: [], col: false };
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

    assign(presetName, gid, snapshotIds) {
        HistoryManager.record();
        const groups = this.get(presetName);
        // Remove from all other groups first
        for (const g of groups) {
            g.sids = g.sids.filter(id => !snapshotIds.includes(id));
        }
        const tgt = groups.find(x => x.id === gid);
        if (tgt) {
            tgt.sids.push(...snapshotIds);
        }
        this._save(presetName, groups);
    },

    unassign(presetName, snapshotId) {
        HistoryManager.record();
        const groups = this.get(presetName);
        for (const g of groups) {
            g.sids = g.sids.filter(id => id !== snapshotId);
        }
        this._save(presetName, groups);
    },

    setCollapse(presetName, gid, collapsed) {
        const groups = this.get(presetName);
        const g = groups.find(x => x.id === gid);
        if (g && g.col !== collapsed) { g.col = collapsed; this._save(presetName, groups); }
    },

    reorder(presetName, orderedIds) {
        HistoryManager.record();
        const groups = this.get(presetName);
        const map = new Map(groups.map(g => [g.id, g]));
        const reordered = orderedIds.map(id => map.get(id)).filter(Boolean);
        groups.forEach(g => { if (!orderedIds.includes(g.id)) reordered.push(g); });
        this._save(presetName, reordered);
    },

    renameSettings(oldName, newName) {
        const s = getSettings();
        if (!s.snapshotGroups) return;
        if (s.snapshotGroups[oldName]) {
            s.snapshotGroups[newName] = s.snapshotGroups[oldName];
            delete s.snapshotGroups[oldName];
        }
        saveSettings();
    },

    migrate(sourcePresetName, targetPresetName, snapshotIdMap) {
        HistoryManager.record();
        const sourceGroups = this.get(sourcePresetName);
        const targetGroups = this.get(targetPresetName);

        const finalMap = new Map(snapshotIdMap || []);
        if (finalMap.size === 0) {
            const sourceSnaps = SnapshotManager.list(sourcePresetName) || [];
            const targetSnaps = SnapshotManager.list(targetPresetName) || [];
            sourceSnaps.forEach(srcS => {
                const matchedTgt = targetSnaps.find(tgtS => tgtS.name === srcS.name);
                if (matchedTgt) {
                    finalMap.set(srcS.id, matchedTgt.id);
                }
            });
        }

        sourceGroups.forEach(srcG => {
            // Find or create group in target
            let tgtG = targetGroups.find(g => g.name === srcG.name);
            if (!tgtG) {
                tgtG = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: srcG.name, sids: [], col: srcG.col || false };
                targetGroups.push(tgtG);
            }

            // Map snapshot IDs inside the group
            srcG.sids.forEach(srcSid => {
                const tgtSid = finalMap.get(srcSid);
                if (tgtSid && !tgtG.sids.includes(tgtSid)) {
                    tgtG.sids.push(tgtSid);
                }
            });
        });

        this._save(targetPresetName, targetGroups);
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

const bigramCache = new Map();
export function getBigrams(str) {
    let cached = bigramCache.get(str);
    if (cached) return cached;
    
    const cleanStr = str.replace(/\s+/g, '');
    const bigrams = new Map();
    for (let i = 0; i < cleanStr.length - 1; i++) {
        const bigram = cleanStr.substr(i, 2);
        bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    const result = { cleanStr, bigrams };
    bigramCache.set(str, result);
    if (bigramCache.size > 2000) {
        const firstKey = bigramCache.keys().next().value;
        bigramCache.delete(firstKey);
    }
    return result;
}

export function getStringSimilarityFromInfos(info1, info2) {
    if (info1.cleanStr === info2.cleanStr) return 1.0;
    if (info1.cleanStr.length < 2 || info2.cleanStr.length < 2) return 0;

    let intersection = 0;
    const map1 = info1.bigrams;
    const map2 = info2.bigrams;

    if (map1.size < map2.size) {
        for (const [bigram, count1] of map1.entries()) {
            const count2 = map2.get(bigram);
            if (count2 > 0) {
                intersection += count1 < count2 ? count1 : count2;
            }
        }
    } else {
        for (const [bigram, count2] of map2.entries()) {
            const count1 = map1.get(bigram);
            if (count1 > 0) {
                intersection += count1 < count2 ? count1 : count2;
            }
        }
    }

    return (2.0 * intersection) / (info1.cleanStr.length + info2.cleanStr.length - 2);
}

export function getStringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1.0;

    const info1 = getBigrams(str1);
    const info2 = getBigrams(str2);

    return getStringSimilarityFromInfos(info1, info2);
}


