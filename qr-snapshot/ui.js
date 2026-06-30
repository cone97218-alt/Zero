/**
 * Zero Preset Manager - UI
 * Performance-optimized v2: innerHTML templates, event delegation, lazy rendering.
 */
import { PresetManager, SnapshotManager, GroupManager, HiddenManager, UiStateManager, LinkageManager, zeroTranslate, HistoryManager, ModelProfileManager, SamplingParamsHelper, SnapshotGroupManager, getPresetPromptsWithEnabled, getStringSimilarity, detectPresetRenames } from './state.js';
import { matchPrompt } from './search-util.js';

let overlay = null;
let pendingToggles = new Map();
let toggleTimer = null;
let _scrollSaveTimer = null;
let searchQuery = '';
let searchDebounceTimer = null;
let searchScopeName = true;
let searchScopeContent = true;

// ─── Multi-select state ───
let msActive = false;
let msSelected = new Set();
let msBar = null;

// ─── Current render context (for event delegation) ───
let _promptMap = null;
let _groupMemberMap = null;
let _currentPreset = null;
let _currentModal = null;

// ─── Helpers ───
const h = (tag, attrs = {}, ...ch) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else el.setAttribute(k, v);
    }
    for (const c of ch) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
    return el;
};

const _escMap = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"};
const esc = s => s ? String(s).replace(/[&<>"']/g, c => _escMap[c]) : '';

function formatDate(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function scheduleToggle(identifier, enabled) {
    pendingToggles.set(identifier, enabled);
    clearTimeout(toggleTimer);
    toggleTimer = setTimeout(flushToggles, 300);
}

async function flushToggles() {
    if (pendingToggles.size === 0) return;
    const batch = new Map(pendingToggles);
    pendingToggles.clear();
    try { await PresetManager.batchToggleMap(batch); }
    catch (e) { console.error('[Zero] batch toggle failed:', e); toastr.error('切换失败'); }
}

function showConfirm(modal, msg, onYes, requiresSetting = false) {
    if (requiresSetting && UiStateManager.get().confirmOnSnapshot !== true) {
        onYes();
        return;
    }
    const box = h('div', { class: 'zero-confirm' },
        h('div', { class: 'zero-confirm-box' },
            h('div', { class: 'zero-confirm-msg', html: msg.replace(/\n/g, '<br>') }),
            h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px' },
                h('button', { class: 'zero-btn', text: '取消', onclick: () => box.remove() }),
                h('button', { class: 'zero-btn primary', text: '确认', onclick: () => { box.remove(); onYes(); } })
            )
        )
    );
    modal.appendChild(box);
}

function triggerIconAnimation(iconEl, className) {
    if (!iconEl) return;
    iconEl.classList.remove(className);
    void iconEl.offsetWidth; // trigger reflow to restart animation
    iconEl.classList.add(className);
    iconEl.addEventListener('animationend', function handler() {
        iconEl.classList.remove(className);
        iconEl.removeEventListener('animationend', handler);
    });
}


function showPrompt(modal, msg, defaultVal, onOk) {
    const input = h('input', { class: 'zero-input', type: 'text', value: defaultVal || '' });
    const box = h('div', { class: 'zero-confirm' },
        h('div', { class: 'zero-confirm-box' },
            h('div', { class: 'zero-confirm-msg', text: msg }),
            input,
            h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px' },
                h('button', { class: 'zero-btn', text: '取消', onclick: () => box.remove() }),
                h('button', { class: 'zero-btn primary', text: '确认', onclick: () => { const v = input.value.trim(); if (v) { box.remove(); onOk(v); } } })
            )
        )
    );
    modal.appendChild(box);
    setTimeout(() => input.focus(), 50);
}




// ═══════════════════════════════════════
//  HTML Templates (fast innerHTML)
// ═══════════════════════════════════════
function entryHTML(p) {
    const id = esc(p.identifier);
    const name = esc(p.name || p.identifier);
    return `<div class="zero-entry" data-id="${id}">` +
        `<div class="zero-sel-check"><i class="fa-solid fa-circle"></i></div>` +
        `<span class="zero-entry-name${p.enabled ? '' : ' disabled'}">${name}</span>` +
        `<div class="zero-entry-inline">` +
            `<button class="zero-icon-btn zero-inline-action" data-action="folder" title="分组"><i class="fa-solid fa-folder-open"></i></button>` +
            `<button class="zero-icon-btn zero-inline-action" data-action="preview" title="预览"><i class="fa-solid fa-eye"></i></button>` +
        `</div>` +
        `<label class="zero-switch"><input type="checkbox"${p.enabled ? ' checked' : ''}><span class="zero-slider"></span></label>` +
    `</div>`;
}

function groupSectionHTML(group, members, isUngrouped) {
    const enabledCount = members.filter(p => p.enabled).length;
    const allOn = members.length > 0 && members.every(p => p.enabled);
    const collapsed = group.col;
    const bodyContent = collapsed ? '' : members.map(entryHTML).join('');
    
    const isSingle = group.single || false;
    const switchHTML = isSingle ? '' : `<label class="zero-switch"><input type="checkbox"${allOn ? ' checked' : ''}><span class="zero-slider"></span></label>`;

    return `<div class="zero-group" data-gid="${esc(group.id)}" data-ungrouped="${isUngrouped}">` +
        `<div class="zero-group-header">` +
            `<i class="fa-solid fa-chevron-down chevron${collapsed ? ' collapsed' : ''}"></i>` +
            `<span class="zero-group-title">${esc(group.name)}</span>` +
            `<span class="zero-group-count">${enabledCount}/${members.length}</span>` +
            `<div class="zero-group-actions">` +
                switchHTML +
            `</div>` +
        `</div>` +
        `<div class="zero-group-body${collapsed ? ' collapsed' : ''}"><div class="zero-group-inner">${bodyContent}</div></div>` +
    `</div>`;
}

// ═══════════════════════════════════════
//  Modal
// ═══════════════════════════════════════
export async function openUI() {
    if (overlay && !document.body.contains(overlay)) overlay = null;
    if (overlay) return;

    searchQuery = '';
    searchScopeName = true;
    searchScopeContent = true;
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
    }

    // Background preload ext-ui.js to avoid transition lag when entering Preset Manager
    import('../preset-manager/main.js').catch(() => {});

    overlay = document.createElement('div');
    overlay.id = 'zero-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh',
        zIndex: '10001', background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeUI(); });

    const modal = h('div', { class: 'zero-modal' });
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.innerHTML = '<div class="zero-skeleton"><div class="zero-sk-header"></div><div class="zero-sk-tabs"></div><div class="zero-sk-row"></div><div class="zero-sk-row short"></div><div class="zero-sk-row"></div><div class="zero-sk-row short"></div></div>';

    try {
        PresetManager.invalidate();
        await detectPresetRenames();
        const [preset, listInfo] = await Promise.all([PresetManager.load(), PresetManager.listNames()]);
        if (!preset) { toastr.error('无法加载预设'); closeUI(); return; }
        modal.innerHTML = '';
        buildModal(modal, preset, listInfo);
    } catch (e) {
        console.error('[Zero]', e);
        toastr.error('加载预设失败');
        closeUI();
    }
}

export function closeUI() {
    flushToggles();
    if (msActive) exitMultiSelect();
    if (overlay) {
        // Save scroll position before closing
        const content = overlay.querySelector('.zero-content');
        if (content) {
            const activeTab = UiStateManager.get().activeTab || 'entries';
            UiStateManager.saveScrollPos(activeTab, content.scrollTop);
            SillyTavern.getContext().saveSettingsDebounced();
        }
        overlay.remove();
        overlay = null;
    }
    try {
        HistoryManager.clear();
    } catch (e) {
        console.error('[Zero] Failed to clear history:', e);
    }
}

// ═══════════════════════════════════════
//  Build Modal Structure
// ═══════════════════════════════════════
function buildModal(modal, preset, listInfo) {
    if (msActive) exitMultiSelect();
    searchQuery = '';
    searchScopeName = true;
    searchScopeContent = true;
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
    }

    const select = h('select', { class: 'zero-preset-select' });
    const filteredNames = (listInfo.names || []).filter(n => !n.startsWith('★'));
    filteredNames.forEach(n => {
        const opt = h('option', { value: n, text: n });
        if (n === preset.name) opt.selected = true;
        select.appendChild(opt);
    });
    select.addEventListener('change', () => {
        const name = select.value;
        select.disabled = true;
        const contentEl = modal.querySelector('.zero-content');
        if (contentEl) contentEl.innerHTML = '<div class="zero-loading" style="padding:20px;text-align:center;color:var(--SmartThemeBodyColor)"><i class="fa-solid fa-spinner fa-spin"></i><div>加载中...</div></div>';
        requestAnimationFrame(() => {
            setTimeout(async () => {
                await PresetManager.switchPreset(name);
                await new Promise(r => requestAnimationFrame(r));
                const newPreset = await PresetManager.load();
                if (newPreset) { modal.innerHTML = ''; buildModal(modal, newPreset, listInfo); }
            }, 10);
        });
    });

    // Search wrap setup
    const enableAnim = UiStateManager.get().searchBarAnimation !== false;
    const searchWrap = h('div', { class: 'zero-search-wrap' + (enableAnim ? '' : ' no-animation') });
    const searchRow1 = h('div', { class: 'zero-search-row1' });
    const searchBtn = h('button', {
        class: 'zero-search-btn',
        title: '搜索',
        html: '<i class="fa-solid fa-magnifying-glass"></i>',
        onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isExpanded = searchWrap.classList.contains('expanded');
            if (isExpanded) {
                collapseSearch();
            } else {
                expandSearch();
            }
        }
    });
    const searchInput = h('input', {
        type: 'text',
        class: 'zero-search-input',
        placeholder: '搜索条目/内容/快照...',
        value: searchQuery,
        style: 'font-size: inherit !important;'
    });
    const searchClear = h('button', {
        class: 'zero-search-clear',
        title: '清除',
        html: '<i class="fa-solid fa-xmark"></i>',
        onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            searchInput.value = '';
            searchInput.focus();
            triggerSearch('');
        }
    });

    searchRow1.appendChild(searchBtn);
    searchRow1.appendChild(searchInput);
    searchRow1.appendChild(searchClear);

    const searchRow2 = h('div', { class: 'zero-search-row2' },
        h('span', { class: 'zero-search-opt-label', text: '筛选范围:' }),
        h('button', {
            class: 'zero-chip zero-search-opt-btn name-btn' + (searchScopeName ? ' active' : ''),
            text: '名称',
            onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (searchScopeName && !searchScopeContent) return;
                searchScopeName = !searchScopeName;
                updateOptionButtons();
                triggerSearch(searchInput.value);
            }
        }),
        h('button', {
            class: 'zero-chip zero-search-opt-btn content-btn' + (searchScopeContent ? ' active' : ''),
            text: '内容',
            onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (searchScopeContent && !searchScopeName) return;
                searchScopeContent = !searchScopeContent;
                updateOptionButtons();
                triggerSearch(searchInput.value);
            }
        })
    );

    searchWrap.appendChild(searchRow1);
    searchWrap.appendChild(searchRow2);

    function updateOptionButtons() {
        const nameBtn = searchRow2.querySelector('.name-btn');
        const contentBtn = searchRow2.querySelector('.content-btn');
        if (nameBtn) nameBtn.classList.toggle('active', searchScopeName);
        if (contentBtn) contentBtn.classList.toggle('active', searchScopeContent);
    }

    function expandSearch() {
        searchWrap.classList.add('expanded');
        const header = modal.querySelector('.zero-header');
        if (header) header.classList.add('searching');
        searchBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
        searchBtn.title = '返回';
        setTimeout(() => searchInput.focus(), 50);
    }

    function collapseSearch() {
        searchWrap.classList.remove('expanded');
        const header = modal.querySelector('.zero-header');
        if (header) header.classList.remove('searching');
        searchBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
        searchBtn.title = '搜索';
        searchInput.value = '';
        triggerSearch('');
    }

    function triggerSearch(val) {
        searchQuery = val;
        const activeTabId = UiStateManager.get().activeTab || 'entries';
        const activePanel = panels[activeTabId];
        const freshPreset = PresetManager.cached() || preset;
        renderTab(activeTabId, activePanel, freshPreset, modal);
    }

    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            triggerSearch(searchInput.value);
        }, 1000); // 1s debounce
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            collapseSearch();
        }
    });

    modal.appendChild(h('div', { class: 'zero-header' },
        h('label', { class: 'zero-header-label', text: '当前预设' }),
        select,
        h('button', {
            class: 'zero-manage-btn',
            title: '打开预设管理',
            html: '<i class="fa-solid fa-list-ul"></i>',
            onclick: async () => {
                closeUI();
                const { showPanel } = await import('../preset-manager/main.js');
                await showPanel();
            }
        }),
        h('button', {
            class: 'zero-save-btn',
            title: '保存到酒馆预设',
            html: '<i class="fa-solid fa-floppy-disk"></i>',
            onclick: async (e) => {
                const btn = e.currentTarget;
                const icon = btn.querySelector('i');
                if (btn.classList.contains('processing')) return;
                
                btn.classList.add('processing');
                const ok = await PresetManager.save();
                
                if (ok) {
                    const oldClass = icon.className;
                    icon.className = 'fa-solid fa-check';
                    btn.classList.add('zero-save-success');
                    setTimeout(() => {
                        icon.className = oldClass;
                        btn.classList.remove('zero-save-success', 'processing');
                    }, 1500);
                } else {
                    btn.classList.remove('processing');
                    toastr.info('未找到可保存的预设面板');
                }
            }
        }),
        searchWrap,
        h('button', { class: 'zero-close-btn', html: '<i class="fa-solid fa-xmark"></i>', onclick: closeUI })
    ));

    const tabs = [
        { id: 'entries', icon: 'fa-list', label: '条目' },
        { id: 'snapshots', icon: 'fa-camera-retro', label: '快照' },
        { id: 'editor', icon: 'fa-sliders', label: '编辑' }
    ];
    const tabBar = h('div', { class: 'zero-tabs' });
    const content = h('div', { class: 'zero-content' });
    const panels = {};
    const initialTab = UiStateManager.get().activeTab || 'entries';

    // ─── Scroll position tracking ───
    function setupScrollTracking(contentEl, tabId) {
        contentEl._zeroScrollTab = tabId;
        contentEl.onscroll = () => {
            clearTimeout(_scrollSaveTimer);
            _scrollSaveTimer = setTimeout(() => {
                UiStateManager.saveScrollPos(contentEl._zeroScrollTab, contentEl.scrollTop);
                SillyTavern.getContext().saveSettingsDebounced();
            }, 400);
        };
    }

    function restoreScrollPos(contentEl, tabId) {
        const pos = UiStateManager.getScrollPos(tabId);
        // Important: scroll restoration needs to wait for render
        requestAnimationFrame(() => {
            contentEl.scrollTop = pos;
        });
    }

    tabs.forEach(t => {
        // Pre-create all panels
        const panel = h('div', { class: 'zero-panel' + (t.id === initialTab ? ' active' : '') });
        panels[t.id] = panel;
        content.appendChild(panel);

        const tab = h('div', {
            class: 'zero-tab' + (t.id === initialTab ? ' active' : ''),
            html: `<i class="fa-solid ${t.icon}"></i>${t.label}`,
            'data-tab': t.id,
            onclick: () => {
                if (msActive) exitMultiSelect();
                const currentTabId = UiStateManager.get().activeTab;
                if (currentTabId === t.id) return;

                // Save scroll position of outgoing tab
                UiStateManager.saveScrollPos(currentTabId, content.scrollTop);
                SillyTavern.getContext().saveSettingsDebounced();

                UiStateManager.save({ activeTab: t.id });
                tabBar.querySelectorAll('.zero-tab').forEach(x => x.classList.toggle('active', x.dataset.tab === t.id));

                // Switch panels instantly
                Object.values(panels).forEach(p => p.classList.remove('active'));
                panels[t.id].classList.add('active');

                // Render content (lazy/refresh)
                const freshPreset = PresetManager.cached() || preset;
                renderTab(t.id, panels[t.id], freshPreset, modal);

                // Update scroll tracking and restore position
                setupScrollTracking(content, t.id);
                restoreScrollPos(content, t.id);
            }
        });
        tabBar.appendChild(tab);
    });
    modal.appendChild(tabBar);
    modal.appendChild(content);

    // Initial render
    renderTab(initialTab, panels[initialTab], preset, modal);
    setupScrollTracking(content, initialTab);
    restoreScrollPos(content, initialTab);
}

function renderTab(id, panel, preset, modal) {
    panel.innerHTML = '';
    const searchWrap = modal.querySelector('.zero-search-wrap');
    if (searchWrap) {
        searchWrap.classList.toggle('hide-options', id === 'snapshots');
    }
    if (id === 'entries') renderEntries(panel, preset, modal);
    else if (id === 'snapshots') {
        const viewMode = UiStateManager.get().snapshotViewMode || 'local';
        renderSnapshots(panel, preset, modal, viewMode);
    }
    else if (id === 'editor') renderEditor(panel, preset, modal);
}

// ═══════════════════════════════════════
//  TAB 1: Entries (innerHTML + delegation)
// ═══════════════════════════════════════
function renderEntries(panel, preset, modal) {
    panel.innerHTML = '';
    _currentPreset = preset;
    _currentModal = modal;

    const pName = preset.name;
    const groups = GroupManager.get(pName);
    const hidden = HiddenManager.get(pName);
    const assigned = new Set();
    groups.forEach(g => g.ids.forEach(id => assigned.add(id)));

    const visiblePrompts = preset.prompts.filter(p => !hidden.has(p.identifier));
    const ungrouped = visiblePrompts.filter(p => !assigned.has(p.identifier));

    _promptMap = new Map(preset.prompts.map(p => [p.identifier, p]));
    _groupMemberMap = new Map();

    // Toolbar (small, keep createElement)
    panel.appendChild(h('div', { class: 'zero-toolbar' },
        h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-folder"></i> 分组', onclick: () => showGroupManager(panel, preset, modal) }),
        h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-eye-slash"></i> 隐藏', onclick: () => showHiddenManager(panel, preset, modal) }),
        h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-link"></i> 联动', onclick: () => showLinkageManager(panel, preset, modal) })
    ));

    const query = searchQuery ? searchQuery.trim().toLowerCase() : '';

    // Build all groups as one HTML string
    let html = '';
    groups.forEach(g => {
        const membersInGroup = new Set(g.ids);
        let members = preset.prompts.filter(p => membersInGroup.has(p.identifier) && !hidden.has(p.identifier));
        if (query) {
            members = members.filter(p => matchPrompt(p, searchQuery, searchScopeName, searchScopeContent));
        }
        _groupMemberMap.set(g.id, members);
        if (!query || members.length > 0) {
            html += groupSectionHTML(g, members, false);
        }
    });

    let filteredUngrouped = ungrouped;
    if (query) {
        filteredUngrouped = ungrouped.filter(p => matchPrompt(p, searchQuery, searchScopeName, searchScopeContent));
    }

    if (filteredUngrouped.length > 0) {
        const ugId = '__ungrouped';
        _groupMemberMap.set(ugId, filteredUngrouped);
        html += groupSectionHTML({ id: ugId, name: '未分组', col: UiStateManager.get().ungroupedCol }, filteredUngrouped, true);
    }

    if (!html.trim()) {
        html = '<div class="zero-empty" style="text-align:center;padding:20px;color:var(--SmartThemeEmColor)">没有匹配的条目</div>';
    }

    const listEl = document.createElement('div');
    listEl.innerHTML = html;
    panel.appendChild(listEl);

    // Setup event delegation (once per panel)
    if (!panel._zeroDelegated) {
        setupEntriesDelegation(panel);
        panel._zeroDelegated = true;
    }
}

function handleSingleSelectConstraint(preset, gid, id) {
    const groups = GroupManager.get(preset.name);
    const group = groups.find(g => g.id === gid);
    if (!group || !group.single) return;

    const toggleMap = new Map();
    group.ids.forEach(x => {
        if (x !== id) {
            const p = _promptMap.get(x);
            if (p && p.enabled) {
                p.enabled = false;
                toggleMap.set(x, false);
                pendingToggles.set(x, false);

                // Update DOM directly
                const entryEl = _currentModal?.querySelector(`.zero-entry[data-id="${esc(x)}"]`);
                if (entryEl) {
                    const otherCb = entryEl.querySelector('.zero-switch input');
                    if (otherCb) otherCb.checked = false;
                    entryEl.querySelector('.zero-entry-name')?.classList.add('disabled');
                }
            }
        }
    });

    if (toggleMap.size > 0) {
        PresetManager.batchToggleMap(toggleMap).catch(e => console.error('[Zero] single-select constraint sync failed:', e));
    }
}

function propagateLinkages(identifier, enabled, visited = new Set()) {
    if (visited.has(identifier)) return;
    visited.add(identifier);

    const presetName = _currentPreset.name;
    const linkages = LinkageManager.get(presetName);
    const targets = linkages.filter(l => l.source === identifier).map(l => l.target);

    for (const tgt of targets) {
        const p = _promptMap.get(tgt);
        if (p && p.enabled !== enabled) {
            p.enabled = enabled;
            pendingToggles.set(tgt, enabled);

            // Update DOM element
            const entryEl = _currentModal?.querySelector(`.zero-entry[data-id="${esc(tgt)}"]`);
            if (entryEl) {
                const cb = entryEl.querySelector('.zero-switch input');
                if (cb) cb.checked = enabled;
                entryEl.querySelector('.zero-entry-name')?.classList.toggle('disabled', !enabled);
                updateGroupCount(entryEl.closest('.zero-group'));
            }

            // Single select constraint logic if enabled
            if (enabled) {
                const tgtGroupEl = entryEl?.closest('.zero-group');
                if (tgtGroupEl) {
                    const tgtGid = tgtGroupEl.dataset.gid;
                    handleSingleSelectConstraint(_currentPreset, tgtGid, tgt);
                }
            }

            // Recursively propagate
            propagateLinkages(tgt, enabled, visited);
        }
    }
}

// ─── Event Delegation for entries tab ───
function setupEntriesDelegation(panel) {
    // Toggle switches (entry + group header)
    panel.addEventListener('change', (e) => {
        const cb = e.target;
        if (cb.type !== 'checkbox') return;

        const header = cb.closest('.zero-group-header');
        if (header) {
            e.stopPropagation();
            localBatchToggle(header.closest('.zero-group'), cb.checked);
            return;
        }

        const entry = cb.closest('.zero-entry');
        if (entry) {
            if (msActive) { cb.checked = !cb.checked; return; }
            const id = entry.dataset.id;
            const p = _promptMap.get(id);
            if (p) {
                p.enabled = cb.checked;
                scheduleToggle(id, cb.checked);
                entry.querySelector('.zero-entry-name').classList.toggle('disabled', !cb.checked);

                // Enforce single select constraint if enabled
                if (cb.checked) {
                    const groupEl = entry.closest('.zero-group');
                    if (groupEl) {
                        handleSingleSelectConstraint(_currentPreset, groupEl.dataset.gid, id);
                    }
                }

                // Enforce linkage propagation
                propagateLinkages(id, cb.checked);

                updateGroupCount(entry.closest('.zero-group'));
            }
        }
    });

    // Click delegation
    panel.addEventListener('click', (e) => {
        // Group header collapse/expand
        const header = e.target.closest('.zero-group-header');
        if (header && !e.target.closest('.zero-group-actions')) {
            handleGroupCollapse(header);
            return;
        }

        // Inline action buttons
        const action = e.target.closest('.zero-inline-action');
        if (action && !msActive) {
            e.stopPropagation();
            const entry = action.closest('.zero-entry');
            const id = entry.dataset.id;
            const prompt = _promptMap.get(id);
            if (!prompt) return;
            if (action.dataset.action === 'folder') {
                const groups = GroupManager.get(_currentPreset.name);
                if (groups.length === 0) { toastr.info('请先在「分组管理」中创建分组'); return; }
                const groupEl = entry.closest('.zero-group');
                const gid = groupEl?.dataset.gid;
                const isUngrouped = groupEl?.dataset.ungrouped === 'true';
                const currentGroup = isUngrouped ? { id: gid } : (groups.find(g => g.id === gid) || { id: gid });
                showGroupAssignMenu(_currentModal, panel, _currentPreset, prompt, currentGroup, isUngrouped);
            } else if (action.dataset.action === 'preview') {
                showContentPreview(_currentModal, prompt);
            }
            return;
        }

        // Multi-select click
        if (msActive) {
            const entry = e.target.closest('.zero-entry');
            if (entry && !e.target.closest('.zero-switch')) {
                e.preventDefault();
                e.stopPropagation();
                toggleEntrySelection(entry.dataset.id, entry, entry.querySelector('.zero-sel-check'));
            }
        }
    });

    // Context menu
    panel.addEventListener('contextmenu', (e) => {
        const entry = e.target.closest('.zero-entry');
        if (entry) {
            if (e.target.closest('.zero-switch') || e.target.closest('.zero-inline-action')) return;
            e.preventDefault();
            const id = entry.dataset.id;
            if (!msActive) {
                enterMultiSelect(panel, _currentPreset, _currentModal, id);
                entry.classList.add('selected');
                const ic = entry.querySelector('.zero-sel-check');
                if (ic) ic.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
            } else {
                toggleEntrySelection(id, entry, entry.querySelector('.zero-sel-check'));
            }
        }
    });

    // Long-press for multi-select
    let lpTimer = null, lpCancelled = false;
    panel.addEventListener('touchstart', (e) => {
        const entry = e.target.closest('.zero-entry');
        if (!entry || msActive) return;
        if (e.target.closest('.zero-switch') || e.target.closest('.zero-inline-action')) return;
        lpCancelled = false;
        lpTimer = setTimeout(() => {
            if (!lpCancelled) {
                const id = entry.dataset.id;
                enterMultiSelect(panel, _currentPreset, _currentModal, id);
                entry.classList.add('selected');
                const ic = entry.querySelector('.zero-sel-check');
                if (ic) ic.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
                if (navigator.vibrate) navigator.vibrate(15);
            }
        }, 500);
    }, { passive: true });
    panel.addEventListener('touchmove', () => { lpCancelled = true; clearTimeout(lpTimer); }, { passive: true });
    panel.addEventListener('touchend', () => clearTimeout(lpTimer));
}

function handleGroupCollapse(header) {
    const groupEl = header.closest('.zero-group');
    const body = groupEl.querySelector('.zero-group-body');
    const isExpanding = body.classList.contains('collapsed');

    if (isExpanding) {
        // Lazy render contents on first expand
        const inner = body.querySelector('.zero-group-inner');
        if (inner && !inner.hasChildNodes()) {
            const gid = groupEl.dataset.gid;
            const members = _groupMemberMap.get(gid) || [];
            inner.innerHTML = members.map(entryHTML).join('');
        }

        // Accordion logic: only collapse already expanded ones
        const expandedGroups = groupEl.parentElement.querySelectorAll('.zero-group-body:not(.collapsed)');
        let saveUngrouped = false;
        
        expandedGroups.forEach(otherBody => {
            const other = otherBody.closest('.zero-group');
            if (other === groupEl) return;
            
            const otherChevron = other.querySelector('.chevron');
            otherBody.classList.add('collapsed');
            otherChevron?.classList.add('collapsed');
            
            const otherGid = other.dataset.gid;
            const otherIsUngrouped = other.dataset.ungrouped === 'true';
            if (!otherIsUngrouped) {
                GroupManager.setCollapse(_currentPreset.name, otherGid, true);
            } else {
                saveUngrouped = true;
            }
        });
        if (saveUngrouped) UiStateManager.save({ ungroupedCol: true });
    }

    const gid = groupEl.dataset.gid;
    const isUngrouped = groupEl.dataset.ungrouped === 'true';
    const chevron = header.querySelector('.chevron');
    const willCollapse = !isExpanding;

    body.classList.toggle('collapsed', willCollapse);
    chevron?.classList.toggle('collapsed', willCollapse);

    if (!isUngrouped) GroupManager.setCollapse(_currentPreset.name, gid, willCollapse);
    else UiStateManager.save({ ungroupedCol: willCollapse });
}

function localBatchToggle(groupEl, enabled) {
    const gid = groupEl.dataset.gid;
    const body = groupEl.querySelector('.zero-group-body');
    const map = new Map();
    const members = _groupMemberMap.get(gid) || [];

    // Ensure lazily rendered content is generated before toggling checks
    const inner = body.querySelector('.zero-group-inner');
    if (inner && !inner.hasChildNodes() && members.length > 0) {
        inner.innerHTML = members.map(entryHTML).join('');
    }

    body.querySelectorAll('.zero-entry').forEach(entry => {
        const id = entry.dataset.id;
        const p = _promptMap.get(id);
        if (p) {
            p.enabled = enabled;
            map.set(id, enabled);
            const cb = entry.querySelector('.zero-switch input');
            if (cb) cb.checked = enabled;
            entry.querySelector('.zero-entry-name')?.classList.toggle('disabled', !enabled);
        }
    });

    const countEl = groupEl.querySelector('.zero-group-count');
    if (countEl) countEl.textContent = `${enabled ? members.length : 0}/${members.length}`;

    if (map.size > 0) {
        PresetManager.batchToggleMap(map).catch(e => { console.error('[Zero] batch toggle failed:', e); toastr.error('操作失败'); });
    }
}

function updateGroupCount(groupEl) {
    if (!groupEl) return;
    const body = groupEl.querySelector('.zero-group-body');
    if (!body) return;
    
    const gid = groupEl.dataset.gid;
    const members = _groupMemberMap.get(gid) || [];
    
    // Use DOM state if rendered, otherwise compute from memory
    const inner = body.querySelector('.zero-group-inner');
    let total = members.length;
    let enabled = 0;
    
    if (inner && !inner.hasChildNodes()) {
        enabled = members.filter(p => p.enabled).length;
    } else {
        const switches = body.querySelectorAll('.zero-switch input[type="checkbox"]');
        enabled = Array.from(switches).filter(cb => cb.checked).length;
    }
    
    const countEl = groupEl.querySelector('.zero-group-count');
    if (countEl) countEl.textContent = `${enabled}/${total}`;
    const groupCb = groupEl.querySelector('.zero-group-header .zero-switch input[type="checkbox"]');
    if (groupCb) groupCb.checked = (total > 0 && enabled === total);
}

// ─── Content Preview ───
function showContentPreview(modal, prompt) {
    const content = prompt.content || prompt.prompt || '';
    const role = prompt.role || '';
    const titleText = prompt.name || prompt.identifier;
    const previewBox = h('div', { class: 'zero-confirm' });
    const previewContent = h('div', { class: 'zero-confirm-box zero-preview-box' });
    
    const titleEl = h('div', { class: 'zero-preview-title' },
        h('span', { text: titleText, style: 'flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px;' }),
        role ? h('span', { class: 'zero-preview-role', text: role, style: 'margin-right: 8px;' }) : null
    );

    const bodyEl = h('div', { class: 'zero-preview-content' });
    let originalText = content;
    let translatedText = null;
    let isShowingTranslated = false;

    const editBtn = h('button', {
        class: 'zero-icon-btn zero-preview-edit',
        style: 'opacity: 0.6; color: var(--SmartThemeQuoteColor, #7b8cde);',
        title: '编辑条目',
        html: '<i class="fa-solid fa-pencil"></i>',
        onclick: () => {
            previewBox.remove();
            openNativeEditor(prompt.identifier);
        }
    });
    titleEl.appendChild(editBtn);

    if (typeof window.translate === 'function' && content.trim()) {
        const transBtn = h('button', {
            class: 'zero-icon-btn zero-preview-trans',
            style: 'opacity: 0.6;',
            title: '翻译内容',
            html: '<i class="fa-solid fa-language"></i>',
            onclick: async () => {
                if (transBtn.classList.contains('processing')) return;
                
                // Toggle back to original if already showing translation
                if (isShowingTranslated) {
                    bodyEl.textContent = originalText;
                    isShowingTranslated = false;
                    transBtn.title = '翻译内容';
                    transBtn.style.opacity = '0.6';
                    return;
                }

                // If we have a cached translation, use it
                if (translatedText) {
                    bodyEl.textContent = translatedText;
                    isShowingTranslated = true;
                    transBtn.title = '显示原文';
                    transBtn.style.opacity = '1';
                    return;
                }

                // Otherwise, perform translation
                transBtn.classList.add('processing');
                const icon = transBtn.querySelector('i');
                const oldClass = icon.className;
                icon.className = 'fa-solid fa-spinner fa-spin';
                
                try {
                    const result = await zeroTranslate(originalText);
                    if (result) {
                        translatedText = result;
                        bodyEl.textContent = translatedText;
                        isShowingTranslated = true;
                        transBtn.title = '显示原文';
                        transBtn.style.opacity = '1';
                    }
                } catch (e) {
                     console.error('[Zero] Translation failed:', e);
                } finally {
                    icon.className = oldClass;
                    transBtn.classList.remove('processing');
                }
            }
        });
        titleEl.appendChild(transBtn);
    }

    const copyBtn = h('button', {
        class: 'zero-icon-btn zero-preview-copy',
        style: 'opacity: 0.6;',
        title: '复制内容',
        html: '<i class="fa-regular fa-copy"></i>',
        onclick: async () => {
            const text = bodyEl.textContent;
            if (!text) return;
            try {
                await navigator.clipboard.writeText(text);
                const icon = copyBtn.querySelector('i');
                const oldClass = icon.className;
                icon.className = 'fa-solid fa-check';
                copyBtn.style.color = 'var(--SmartThemeQuoteColor, #7b8cde)';
                setTimeout(() => {
                    icon.className = oldClass;
                    copyBtn.style.color = '';
                }, 1500);
            } catch (err) {
                console.error('[Zero] Copy failed:', err);
            }
        }
    });
    titleEl.appendChild(copyBtn);

    previewContent.appendChild(titleEl);
    if (content.trim()) bodyEl.textContent = content;
    else bodyEl.appendChild(h('div', { class: 'zero-empty', style: 'padding:16px 0', text: '（无内容）' }));
    previewContent.appendChild(bodyEl);
    previewContent.appendChild(h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px' },
        h('button', { class: 'zero-btn primary', text: '关闭', onclick: () => previewBox.remove() })
    ));
    previewBox.appendChild(previewContent);
    modal.appendChild(previewBox);
}

// ═══════════════════════════════════════
//  Multi-Select Mode
// ═══════════════════════════════════════
let _msPanel = null;

function enterMultiSelect(panel, preset, modal, firstId) {
    msActive = true;
    msSelected.clear();
    msSelected.add(firstId);
    _msPanel = panel;
    _currentPreset = preset;
    _currentModal = modal;
    panel.classList.add('zero-multiselect');
    showMultiSelectBar(modal, panel, preset);
}

function exitMultiSelect() {
    msActive = false;
    msSelected.clear();
    if (_msPanel) {
        _msPanel.classList.remove('zero-multiselect');
        _msPanel.querySelectorAll('.zero-entry.selected').forEach(el => {
            el.classList.remove('selected');
            const ic = el.querySelector('.zero-sel-check');
            if (ic) ic.innerHTML = '<i class="fa-solid fa-circle"></i>';
        });
    }
    if (msBar) { msBar.remove(); msBar = null; }
    _msPanel = null;
}

function toggleEntrySelection(id, entryEl, selCheck) {
    if (msSelected.has(id)) {
        msSelected.delete(id);
        entryEl.classList.remove('selected');
        if (selCheck) selCheck.innerHTML = '<i class="fa-solid fa-circle"></i>';
    } else {
        msSelected.add(id);
        entryEl.classList.add('selected');
        if (selCheck) selCheck.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
    }
    updateMultiSelectBar();
    if (msSelected.size === 0) exitMultiSelect();
}

function showMultiSelectBar(modal, panel, preset) {
    if (msBar) msBar.remove();
    const countEl = h('span', { class: 'zero-ms-count', text: `已选 ${msSelected.size}` });
    msBar = h('div', { class: 'zero-multiselect-bar' },
        countEl,
        h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-check-double"></i> 全选', onclick: () => {
            panel.querySelectorAll('.zero-group-inner').forEach(inner => {
                if (!inner.hasChildNodes()) {
                    const groupEl = inner.closest('.zero-group');
                    const gid = groupEl.dataset.gid;
                    const members = _groupMemberMap.get(gid) || [];
                    inner.innerHTML = members.map(entryHTML).join('');
                }
            });
            panel.querySelectorAll('.zero-entry[data-id]').forEach(el => {
                const id = el.dataset.id;
                if (!msSelected.has(id)) {
                    msSelected.add(id);
                    el.classList.add('selected');
                    const ic = el.querySelector('.zero-sel-check');
                    if (ic) ic.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
                }
            });
            updateMultiSelectBar();
        }}),
        h('button', { class: 'zero-btn primary', html: '<i class="fa-solid fa-folder"></i> 分到组', onclick: () => showBatchGroupAssign(modal, panel, preset) }),
        h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-xmark"></i> 退出', onclick: exitMultiSelect })
    );
    modal.appendChild(msBar);
}

function updateMultiSelectBar() {
    if (!msBar) return;
    const countEl = msBar.querySelector('.zero-ms-count');
    if (countEl) countEl.textContent = `已选 ${msSelected.size}`;
}

function showBatchGroupAssign(modal, panel, preset) {
    const pName = preset.name;
    const groups = GroupManager.get(pName);
    if (groups.length === 0) { toastr.info('请先创建分组'); return; }
    if (msSelected.size === 0) { toastr.info('未选择任何条目'); return; }

    const menuBox = h('div', { class: 'zero-confirm' });
    const menuContent = h('div', { class: 'zero-confirm-box zero-menu-box' },
        h('div', { class: 'zero-confirm-msg', text: `将 ${msSelected.size} 个条目分到…` })
    );
    groups.forEach(g => {
        menuContent.appendChild(h('button', {
            class: 'zero-menu-item',
            html: `<i class="fa-solid fa-folder"></i> ${g.name}`,
            onclick: () => {
                const count = msSelected.size;
                GroupManager.assign(pName, g.id, Array.from(msSelected));
                menuBox.remove();
                exitMultiSelect();
                renderEntries(panel, preset, modal);
            }
        }));
    });
    menuContent.appendChild(h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px' },
        h('button', { class: 'zero-btn', text: '取消', onclick: () => menuBox.remove() })
    ));
    menuBox.appendChild(menuContent);
    modal.appendChild(menuBox);
}

function showGroupAssignMenu(modal, panel, preset, prompt, currentGroup, isUngrouped) {
    const pName = preset.name;
    const groups = GroupManager.get(pName);
    const menuItems = [];

    if (!isUngrouped) {
        menuItems.push({ label: '从当前分组移出', icon: 'fa-right-from-bracket', action: () => {
            GroupManager.unassign(pName, prompt.identifier);
            renderEntries(panel, preset, modal);
        }});
    }
    groups.forEach(g => {
        if (!isUngrouped && g.id === currentGroup.id) return;
        if (!g.ids.includes(prompt.identifier)) {
            menuItems.push({ label: `移到「${g.name}」`, icon: 'fa-folder', action: () => {
                GroupManager.assign(pName, g.id, [prompt.identifier]);
                renderEntries(panel, preset, modal);
            }});
        }
    });
    if (menuItems.length === 0) { toastr.info('没有可用的分组操作'); return; }

    const menuBox = h('div', { class: 'zero-confirm' });
    const menuContent = h('div', { class: 'zero-confirm-box zero-menu-box' },
        h('div', { class: 'zero-confirm-msg', text: `移动「${prompt.name || prompt.identifier}」` })
    );
    menuItems.forEach(item => {
        menuContent.appendChild(h('button', {
            class: 'zero-menu-item',
            html: `<i class="fa-solid ${item.icon}"></i> ${item.label}`,
            onclick: () => { menuBox.remove(); item.action(); }
        }));
    });
    menuContent.appendChild(h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px' },
        h('button', { class: 'zero-btn', text: '取消', onclick: () => menuBox.remove() })
    ));
    menuBox.appendChild(menuContent);
    modal.appendChild(menuBox);
}

function showLinkageManager(panel, preset, modal) {
    const pName = preset.name;
    const menuBox = h('div', { class: 'zero-confirm' });
    const contentBox = h('div', { class: 'zero-confirm-box zero-group-mgr-box', style: 'max-width: 420px; max-height: 75vh; display: flex; flex-direction: column;' });
    contentBox.appendChild(h('div', { class: 'zero-confirm-msg', text: '条目联动管理' }));

    const listContainer = h('div', { class: 'zero-group-mgr-list', style: 'overflow-y: auto; max-height: 35vh; margin: 8px 0; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; background: rgba(0,0,0,0.1);' });

    function renderList() {
        listContainer.innerHTML = '';
        const linkages = LinkageManager.get(pName);
        if (linkages.length === 0) {
            listContainer.appendChild(h('div', { class: 'zero-empty', style: 'padding:20px 0', text: '暂无联动规则' }));
            return;
        }
        linkages.forEach(l => {
            const sourcePrompt = preset.prompts.find(p => p.identifier === l.source);
            const targetPrompt = preset.prompts.find(p => p.identifier === l.target);
            const sName = sourcePrompt ? (sourcePrompt.name || sourcePrompt.identifier) : l.source;
            const tName = targetPrompt ? (targetPrompt.name || targetPrompt.identifier) : l.target;

            const row = h('div', { class: 'zero-group-mgr-row', style: 'display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 13px;' },
                h('div', { style: 'display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; padding-right: 8px;' },
                    h('span', { text: sName, style: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--SmartThemeBodyColor); flex: 1;' }),
                    h('span', { html: '<i class="fa-solid fa-arrow-right" style="opacity: 0.5; font-size: 11px;"></i>', style: 'flex-shrink: 0;' }),
                    h('span', { text: tName, style: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--SmartThemeQuoteColor); flex: 1;' })
                ),
                h('button', {
                    class: 'zero-icon-btn',
                    title: '删除联动',
                    html: '<i class="fa-solid fa-trash"></i>',
                    onclick: () => {
                        LinkageManager.remove(pName, l.source, l.target);
                        renderList();
                    }
                })
            );
            listContainer.appendChild(row);
        });
    }

    renderList();
    contentBox.appendChild(listContainer);

    const sourceSelect = h('select', { class: 'zero-preset-select', style: 'width: 100%; margin-bottom: 8px;' });
    const targetSelect = h('select', { class: 'zero-preset-select', style: 'width: 100%; margin-bottom: 12px;' });

    preset.prompts.forEach(p => {
        const name = p.name || p.identifier;
        sourceSelect.appendChild(h('option', { value: p.identifier, text: name }));
        targetSelect.appendChild(h('option', { value: p.identifier, text: name }));
    });

    const createForm = h('div', { style: 'margin-top: 8px; display: flex; flex-direction: column; gap: 4px;' },
        h('label', { text: '源条目（当此条目开关变化时）', style: 'font-size: 11px; color: var(--SmartThemeEmColor); text-align: left;' }),
        sourceSelect,
        h('label', { text: '联动目标（跟着变为相同状态）', style: 'font-size: 11px; color: var(--SmartThemeEmColor); text-align: left;' }),
        targetSelect,
        h('button', {
            class: 'zero-btn primary',
            style: 'width: 100%; justify-content: center; margin-top: 6px;',
            html: '<i class="fa-solid fa-plus"></i> 添加联动规则',
            onclick: () => {
                const src = sourceSelect.value;
                const tgt = targetSelect.value;
                if (src === tgt) {
                    toastr.error('源条目和目标条目不能相同');
                    return;
                }
                LinkageManager.add(pName, src, tgt);
                renderList();
            }
        })
    );
    contentBox.appendChild(createForm);

    contentBox.appendChild(h('div', { class: 'zero-confirm-btns', style: 'margin-top:16px;' },
        h('button', {
            class: 'zero-btn',
            text: '关闭',
            onclick: () => {
                menuBox.remove();
                renderEntries(panel, preset, modal);
            }
        })
    ));

    menuBox.appendChild(contentBox);
    modal.appendChild(menuBox);
}

function showHiddenManager(panel, preset, modal) {
    const pName = preset.name;
    const hidden = HiddenManager.get(pName);
    const hiddenPrompts = preset.prompts.filter(p => hidden.has(p.identifier));
    const visiblePrompts = preset.prompts.filter(p => !hidden.has(p.identifier));

    const menuBox = h('div', { class: 'zero-confirm' });
    const menuContent = h('div', { class: 'zero-confirm-box zero-hidden-box' });
    let activeView = 'hidden';
    let selectedIds = new Set();

    function renderHiddenList() {
        menuContent.innerHTML = '';
        const tabBar = h('div', { class: 'zero-hidden-tabs' });
        tabBar.appendChild(h('button', { class: 'zero-chip' + (activeView === 'hidden' ? ' active' : ''), text: `已隐藏 (${hiddenPrompts.length})`, onclick: () => { activeView = 'hidden'; selectedIds.clear(); renderHiddenList(); } }));
        tabBar.appendChild(h('button', { class: 'zero-chip' + (activeView === 'visible' ? ' active' : ''), text: `可见条目 (${visiblePrompts.length})`, onclick: () => { activeView = 'visible'; selectedIds.clear(); renderHiddenList(); } }));
        menuContent.appendChild(tabBar);

        const listDiv = h('div', { class: 'zero-hidden-list' });
        const items = activeView === 'hidden' ? hiddenPrompts : visiblePrompts;
        
        let batchBtn = null;
        let selAllBtn = null;

        function updateBatchBtn() {
            if (batchBtn) {
                batchBtn.disabled = selectedIds.size === 0;
                const batchAction = activeView === 'hidden' ? '恢复' : '隐藏';
                batchBtn.textContent = selectedIds.size > 0 ? `批量${batchAction} (${selectedIds.size})` : `批量${batchAction}`;
            }
            if (selAllBtn) {
                const allChecked = selectedIds.size > 0 && selectedIds.size === items.length;
                selAllBtn.innerHTML = allChecked ? '<i class="fa-regular fa-square-check"></i>' : '<i class="fa-solid fa-check-double"></i>';
            }
        }

        if (items.length === 0) {
            listDiv.appendChild(h('div', { class: 'zero-empty', style: 'padding:16px 0', text: activeView === 'hidden' ? '没有被隐藏的条目' : '所有条目已隐藏' }));
        } else {
            items.forEach(p => {
                const isHidden = activeView === 'hidden';
                const row = h('div', { class: 'zero-hidden-row', style: 'cursor:pointer' });
                
                const checkbox = h('input', { type: 'checkbox', style: 'margin-right:8px; pointer-events:none;' });
                checkbox.checked = selectedIds.has(p.identifier);
                row.appendChild(checkbox);
                
                row.appendChild(h('span', { class: 'zero-hidden-name', style: 'flex:1', text: p.name || p.identifier }));
                
                const singleBtn = h('button', {
                    class: 'zero-btn',
                    html: isHidden ? '<i class="fa-solid fa-eye"></i> 恢复' : '<i class="fa-solid fa-eye-slash"></i> 隐藏',
                    onclick: (e) => {
                        e.stopPropagation();
                        if (isHidden) {
                            HiddenManager.show(pName, p.identifier);
                            const idx = hiddenPrompts.indexOf(p);
                            if (idx > -1) hiddenPrompts.splice(idx, 1);
                            if (!visiblePrompts.includes(p)) visiblePrompts.push(p);
                        } else {
                            HiddenManager.hide(pName, p.identifier);
                            const idx = visiblePrompts.indexOf(p);
                            if (idx > -1) visiblePrompts.splice(idx, 1);
                            if (!hiddenPrompts.includes(p)) hiddenPrompts.push(p);
                        }
                        selectedIds.delete(p.identifier);
                        renderHiddenList();
                    }
                });
                row.appendChild(singleBtn);

                row.onclick = () => {
                    if (selectedIds.has(p.identifier)) {
                        selectedIds.delete(p.identifier);
                        checkbox.checked = false;
                    } else {
                        selectedIds.add(p.identifier);
                        checkbox.checked = true;
                    }
                    updateBatchBtn();
                };

                listDiv.appendChild(row);
            });
        }
        menuContent.appendChild(listDiv);

        const btns = h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px; align-items:center;' });
        
        if (items.length > 0) {
            selAllBtn = h('button', { class: 'zero-btn', title: '全选/取消', onclick: () => {
                if (selectedIds.size === items.length) selectedIds.clear();
                else items.forEach(p => selectedIds.add(p.identifier));
                listDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                     cb.checked = selectedIds.size > 0;
                });
                updateBatchBtn();
            }});
            btns.appendChild(selAllBtn);
        }

        btns.appendChild(h('div', { style: 'flex:1' }));
        btns.appendChild(h('button', { class: 'zero-btn', text: '关闭', onclick: () => { menuBox.remove(); renderEntries(panel, preset, modal); } }));
        
        if (items.length > 0) {
            batchBtn = h('button', { class: 'zero-btn primary', onclick: () => {
                if (selectedIds.size === 0) return;
                selectedIds.forEach(id => {
                    if (activeView === 'hidden') {
                        HiddenManager.show(pName, id);
                        const p = hiddenPrompts.find(x => x.identifier === id);
                        if (p) {
                            hiddenPrompts.splice(hiddenPrompts.indexOf(p), 1);
                            visiblePrompts.push(p);
                        }
                    } else {
                        HiddenManager.hide(pName, id);
                        const p = visiblePrompts.find(x => x.identifier === id);
                        if (p) {
                            visiblePrompts.splice(visiblePrompts.indexOf(p), 1);
                            hiddenPrompts.push(p);
                        }
                    }
                });
                selectedIds.clear();
                renderHiddenList();
            }});
            btns.appendChild(batchBtn);
        }
        
        updateBatchBtn();
        menuContent.appendChild(btns);
    }

    renderHiddenList();
    menuBox.appendChild(menuContent);
    modal.appendChild(menuBox);
}

function showGroupManager(panel, preset, modal) {
    const pName = preset.name;
    const menuBox = h('div', { class: 'zero-confirm' });
    const contentBox = h('div', { class: 'zero-confirm-box zero-group-mgr-box' });
    contentBox.appendChild(h('div', { class: 'zero-confirm-msg', text: '分组管理' }));

    const listContainer = h('div', { class: 'zero-group-mgr-list' });
    let dragSrcId = null;

    function renderList() {
        listContainer.innerHTML = '';
        const currentGroups = GroupManager.get(pName);
        if (currentGroups.length === 0) {
            listContainer.appendChild(h('div', { class: 'zero-empty', style: 'padding:20px 0', text: '暂无分组' }));
            return;
        }
        currentGroups.forEach(g => {
            const row = h('div', { class: 'zero-group-mgr-row', draggable: 'true', 'data-id': g.id });
            const dragHandle = h('div', { class: 'zero-drag-handle', html: '<i class="fa-solid fa-grip-vertical"></i>' });
            row.appendChild(dragHandle);
            row.appendChild(h('div', { class: 'zero-group-mgr-name', text: g.name }));
            const actions = h('div', { class: 'zero-group-mgr-actions' });
            const isSingle = g.single || false;
            const isJailbreak = g.type === 'jailbreak';
            // Jailbreak type toggle
            actions.appendChild(h('button', {
                class: 'zero-icon-btn' + (isJailbreak ? ' zero-group-jailbreak-active' : ''),
                title: isJailbreak ? '破限分组 (点击切换为普通)' : '普通分组 (点击切换为破限)',
                style: isJailbreak ? 'color: #e88c6e; opacity: 1;' : 'opacity: 0.4;',
                html: '<i class="fa-solid fa-shield-halved"></i>',
                onclick: (e) => {
                    e.stopPropagation();
                    GroupManager.setType(pName, g.id, isJailbreak ? 'normal' : 'jailbreak');
                    renderList();
                }
            }));
            actions.appendChild(h('button', {
                class: 'zero-icon-btn' + (isSingle ? ' zero-group-single-active' : ''),
                title: isSingle ? '单选分组 (点击切换为普通)' : '普通分组 (点击切换为单选)',
                style: isSingle ? 'color: var(--SmartThemeQuoteColor, #7b8cde); opacity: 1;' : 'opacity: 0.55;',
                html: isSingle ? '<i class="fa-solid fa-circle-dot"></i>' : '<i class="fa-regular fa-circle-dot"></i>',
                onclick: (e) => {
                    e.stopPropagation();
                    GroupManager.setSingle(pName, g.id, !isSingle);
                    renderList();
                }
            }));
            actions.appendChild(h('button', { class: 'zero-icon-btn', title: '重命名', html: '<i class="fa-solid fa-pen"></i>', onclick: (e) => { e.stopPropagation(); showPrompt(menuBox, '重命名分组', g.name, n => { GroupManager.rename(pName, g.id, n); renderList(); }); } }));
            actions.appendChild(h('button', { class: 'zero-icon-btn', title: '删除分组', html: '<i class="fa-solid fa-trash"></i>', onclick: (e) => { e.stopPropagation(); showConfirm(menuBox, `删除分组「${g.name}」？\n（条目不会被删除）`, () => { GroupManager.remove(pName, g.id); renderList(); }); } }));
            row.appendChild(actions);

            // Desktop Drag & Drop
            row.addEventListener('dragstart', (e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.id); dragSrcId = g.id; row.classList.add('dragging'); });
            row.addEventListener('dragend', () => { row.classList.remove('dragging'); dragSrcId = null; listContainer.querySelectorAll('.zero-group-mgr-row').forEach(r => { r.classList.remove('drag-over-top', 'drag-over-bottom'); }); });
            row.addEventListener('dragover', (e) => {
                e.preventDefault(); e.dataTransfer.dropEffect = 'move';
                if (!dragSrcId || dragSrcId === g.id) return;
                const rect = row.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                row.classList.toggle('drag-over-top', e.clientY < midY);
                row.classList.toggle('drag-over-bottom', e.clientY >= midY);
            });
            row.addEventListener('dragleave', () => { row.classList.remove('drag-over-top', 'drag-over-bottom'); });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('drag-over-top', 'drag-over-bottom');
                const draggedId = e.dataTransfer.getData('text/plain');
                if (draggedId && draggedId !== g.id) {
                    const currentIds = GroupManager.get(pName).map(x => x.id);
                    const oldIndex = currentIds.indexOf(draggedId);
                    const newIndex = currentIds.indexOf(g.id);
                    if (oldIndex > -1 && newIndex > -1) {
                        currentIds.splice(oldIndex, 1);
                        const rect2 = row.getBoundingClientRect();
                        const midY2 = rect2.top + rect2.height / 2;
                        let insertIndex = newIndex;
                        if (oldIndex < newIndex && e.clientY < midY2) insertIndex -= 1;
                        else if (oldIndex > newIndex && e.clientY >= midY2) insertIndex += 1;
                        currentIds.splice(insertIndex, 0, draggedId);
                        GroupManager.reorder(pName, currentIds);
                        renderList();
                    }
                }
            });

            // Mobile Touch Drag Implementation
            let initialY = 0;
            dragHandle.addEventListener('touchstart', (e) => {
                e.preventDefault();
                initialY = e.touches[0].clientY;
                dragSrcId = g.id;
                row.classList.add('dragging');
            }, { passive: false });

            dragHandle.addEventListener('touchmove', (e) => {
                if (!dragSrcId) return;
                e.preventDefault();
                const touchY = e.touches[0].clientY;
                
                row.style.transform = `translateY(${touchY - initialY}px)`;
                row.style.zIndex = '100';

                listContainer.querySelectorAll('.zero-group-mgr-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
                const siblings = Array.from(listContainer.querySelectorAll('.zero-group-mgr-row')).filter(r => r !== row);
                for (let r of siblings) {
                    const rect = r.getBoundingClientRect();
                    if (touchY >= rect.top && touchY <= rect.bottom) {
                        const midY = rect.top + rect.height / 2;
                        r.classList.toggle('drag-over-top', touchY < midY);
                        r.classList.toggle('drag-over-bottom', touchY >= midY);
                        break;
                    }
                }
            }, { passive: false });

            dragHandle.addEventListener('touchend', (e) => {
                if (!dragSrcId) return;
                row.classList.remove('dragging');
                row.style.transform = '';
                row.style.zIndex = '';
                dragSrcId = null;

                const target = listContainer.querySelector('.drag-over-top, .drag-over-bottom');
                listContainer.querySelectorAll('.zero-group-mgr-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
                
                if (target) {
                    const targetId = target.dataset.id;
                    if (targetId && targetId !== g.id) {
                        const currentIds = GroupManager.get(pName).map(x => x.id);
                        const oldIndex = currentIds.indexOf(g.id);
                        if (oldIndex > -1) {
                            currentIds.splice(oldIndex, 1);
                            const adjustedNewIndex = currentIds.indexOf(targetId);
                            let insertIndex = adjustedNewIndex;
                            if (target.classList.contains('drag-over-bottom')) {
                                insertIndex += 1;
                            }
                            currentIds.splice(insertIndex, 0, g.id);
                            GroupManager.reorder(pName, currentIds);
                            renderList();
                        }
                    }
                }
            });

            listContainer.appendChild(row);
        });
    }

    renderList();
    contentBox.appendChild(listContainer);
    contentBox.appendChild(h('button', { class: 'zero-btn', style: 'width:100%; justify-content:center; margin: 12px 0;', html: '<i class="fa-solid fa-plus"></i> 新建分组', onclick: () => showPrompt(menuBox, '分组名称', '', name => { GroupManager.create(pName, name); renderList(); }) }));
    contentBox.appendChild(h('div', { class: 'zero-confirm-btns' }, h('button', { class: 'zero-btn primary', style: 'width:100%;', text: '完成', onclick: () => { menuBox.remove(); renderEntries(panel, preset, modal); } })));
    menuBox.appendChild(contentBox);
    modal.appendChild(menuBox);
}

// ═══════════════════════════════════════
//  TAB 2: Snapshots
// ═══════════════════════════════════════
function renderSnapshots(panel, preset, modal, viewMode = 'local') {
    _currentPreset = preset;
    _currentModal = modal;
    panel.innerHTML = '';
    // Sub-tab bar: 快照 | 方案
    const subTabBar = h('div', { class: 'zero-sub-tabs', style: 'display:flex; gap:6px; margin-bottom:12px; align-items: center;' },
        h('button', { class: 'zero-chip' + (viewMode !== 'profiles' ? ' active' : ''), text: '快照', onclick: () => {
            const nextMode = viewMode !== 'profiles' ? viewMode : 'local';
            UiStateManager.save({ snapshotViewMode: nextMode });
            renderSnapshots(panel, preset, modal, nextMode);
        } }),
        h('button', { class: 'zero-chip' + (viewMode === 'profiles' ? ' active' : ''), text: '模型方案', onclick: () => {
            UiStateManager.save({ snapshotViewMode: 'profiles' });
            renderSnapshots(panel, preset, modal, 'profiles');
        } })
    );
    panel.appendChild(subTabBar);

    if (viewMode === 'profiles') {
        renderModelProfiles(panel, preset, modal);
        return;
    }

    const headerRow = h('div', { class: 'zero-filters', style: 'margin-bottom: 12px; justify-content: space-between;' },
        h('div', { style: 'display: flex; gap: 6px;' },
            h('button', { class: 'zero-chip ' + (viewMode === 'local' ? 'active' : ''), text: '当前预设', onclick: () => {
                UiStateManager.save({ snapshotViewMode: 'local' });
                renderSnapshots(panel, preset, modal, 'local');
            } }),
            h('button', { class: 'zero-chip ' + (viewMode === 'other' ? 'active' : ''), text: '其他预设', onclick: () => {
                UiStateManager.save({ snapshotViewMode: 'other' });
                renderSnapshots(panel, preset, modal, 'other');
            } })
        ),
        h('div', { style: 'display: flex; gap: 6px; align-items: center;' },
            viewMode === 'local' ? h('button', { class: 'zero-btn', title: '快照分组', html: '<i class="fa-solid fa-folder"></i>', onclick: () => showSnapshotGroupManager(panel, preset, modal) }) : null,
            h('button', { class: 'zero-btn', title: '迁移导入', html: '<i class="fa-solid fa-file-import"></i>', onclick: () => showSnapshotMigrationModal(preset, null, modal) }),
            h('button', { class: 'zero-btn primary', title: '新建快照', html: '<i class="fa-solid fa-plus"></i>', onclick: () => {
                showPrompt(modal, '快照名称', `快照 ${formatDate(Date.now())}`, async (name) => {
                    await SnapshotManager.create(name, preset);
                    renderSnapshots(panel, preset, modal, viewMode);
                });
            } })
        )
    );
    panel.appendChild(headerRow);

    const query = searchQuery ? searchQuery.trim().toLowerCase() : '';
    let snaps = viewMode === 'local' ? SnapshotManager.list(preset.name) : SnapshotManager.list().filter(s => s.presetName !== preset.name);
    if (query) {
        snaps = snaps.filter(s => (s.name || '').toLowerCase().includes(query));
    }
    if (snaps.length === 0) {
        if (viewMode === 'local' && !query) {
            const emptyEl = h('div', { class: 'zero-empty', text: '当前预设暂无快照，点击右上方按钮创建。' });
            panel.appendChild(emptyEl);
            
            // Add recommendation banner
            const similarPresetName = findMostSimilarPresetWithSnapshots(preset.name);
            if (similarPresetName) {
                const banner = h('div', { class: 'zero-migration-banner' },
                    h('div', { class: 'zero-migration-banner-text' },
                        h('i', { class: 'fa-solid fa-lightbulb', style: 'color: var(--SmartThemeEmColor); margin-right: 6px;' }),
                        `当前预设暂无快照。建议从相似预设「${similarPresetName}」导入/迁移快照配置。`
                    ),
                    h('button', {
                        class: 'zero-btn primary sm',
                        text: '立即迁移导入',
                        onclick: () => {
                            showSnapshotMigrationModal(preset, similarPresetName, modal);
                        }
                    })
                );
                panel.appendChild(banner);
            }
        } else {
            panel.appendChild(h('div', { class: 'zero-empty', text: query ? '没有匹配的快照' : '没有来自其他预设的快照' }));
        }
        return;
    }

    if (viewMode === 'local') {
        const sGroups = SnapshotGroupManager.get(preset.name);
        const assignedSids = new Set();
        sGroups.forEach(g => g.sids.forEach(id => assignedSids.add(id)));

        const ungroupedSnaps = snaps.filter(s => !assignedSids.has(s.id));

        sGroups.forEach(g => {
            const groupSnaps = snaps.filter(s => g.sids.includes(s.id));
            if (query && groupSnaps.length === 0) return;
            const collapsed = g.col;

            const groupEl = h('div', { class: 'zero-group zero-snapshot-group', 'data-sgid': g.id },
                h('div', { class: 'zero-group-header zero-snap-group-header', onclick: () => toggleSnapshotGroup(groupEl, preset.name, g.id) },
                    h('i', { class: 'fa-solid fa-chevron-down chevron' + (collapsed ? ' collapsed' : '') }),
                    h('span', { class: 'zero-group-title', text: g.name }),
                    h('span', { class: 'zero-group-count', text: `${groupSnaps.length} 个快照` })
                ),
                h('div', { class: 'zero-group-body' + (collapsed ? ' collapsed' : '') },
                    h('div', { class: 'zero-group-inner zero-snap-group-inner', style: 'padding: 8px 10px 4px;' })
                )
            );

            panel.appendChild(groupEl);

            if (!collapsed) {
                const inner = groupEl.querySelector('.zero-snap-group-inner');
                groupSnaps.forEach(snap => {
                    inner.appendChild(buildSnapCard(snap, preset, panel, modal, viewMode));
                });
            }
        });

        if (ungroupedSnaps.length > 0) {
            const hasGroups = sGroups.length > 0;
            if (hasGroups) {
                const collapsed = UiStateManager.get().ungroupedCol || false;
                const groupEl = h('div', { class: 'zero-group zero-snapshot-group', 'data-sgid': '__ungrouped' },
                    h('div', { class: 'zero-group-header zero-snap-group-header', onclick: () => toggleSnapshotGroup(groupEl, preset.name, '__ungrouped') },
                        h('i', { class: 'fa-solid fa-chevron-down chevron' + (collapsed ? ' collapsed' : '') }),
                        h('span', { class: 'zero-group-title', text: '未分组' }),
                        h('span', { class: 'zero-group-count', text: `${ungroupedSnaps.length} 个快照` })
                    ),
                    h('div', { class: 'zero-group-body' + (collapsed ? ' collapsed' : '') },
                        h('div', { class: 'zero-group-inner zero-snap-group-inner', style: 'padding: 8px 10px 4px;' })
                    )
                );
                panel.appendChild(groupEl);

                if (!collapsed) {
                    const inner = groupEl.querySelector('.zero-snap-group-inner');
                    ungroupedSnaps.forEach(snap => {
                        inner.appendChild(buildSnapCard(snap, preset, panel, modal, viewMode));
                    });
                }
            } else {
                const container = h('div', { style: 'padding: 4px 2px 0;' });
                ungroupedSnaps.forEach(snap => {
                    container.appendChild(buildSnapCard(snap, preset, panel, modal, viewMode));
                });
                panel.appendChild(container);
            }
        }
    } else {
        const container = h('div', { style: 'padding: 4px 2px 0;' });
        snaps.forEach(snap => {
            container.appendChild(buildSnapCard(snap, preset, panel, modal, viewMode));
        });
        panel.appendChild(container);
    }
}

function buildSnapCard(snap, preset, panel, modal, viewMode) {
    const card = h('div', { class: 'zero-snap' });
    const snapHeader = h('div', { class: 'zero-snap-header' },
        h('span', { class: 'zero-snap-name', text: snap.name }),
        h('span', { class: 'zero-snap-meta', text: `${snap.presetName} · ${formatDate(snap.ts)}` })
    );
    const body = h('div', { class: 'zero-snap-body' });
    let expanded = false;
    snapHeader.addEventListener('click', () => {
        expanded = !expanded;
        body.classList.toggle('expanded', expanded);
        if (expanded) { body.innerHTML = ''; renderSnapshotDiff(body, snap, preset); }
    });

    const isOther = snap.presetName !== preset.name;
    const applyIcon = h('i', { class: 'fa-solid fa-check' });
    const overwriteIcon = h('i', { class: 'fa-solid fa-sync' });

    const btnRow = h('div', { class: 'zero-snap-actions' },
        h('button', { class: 'zero-btn', title: '应用', onclick: () => {
            if (isOther) {
                showConfirm(modal, `该快照属于预设「${snap.presetName}」。\n是否切换到该预设并应用快照？`, () => {
                    triggerIconAnimation(applyIcon, 'zero-anim-apply');
                    setTimeout(() => {
                        const contentEl = modal.querySelector('.zero-content');
                        if (contentEl) contentEl.innerHTML = '<div class="zero-loading" style="padding:20px;text-align:center;color:var(--SmartThemeBodyColor)"><i class="fa-solid fa-spinner fa-spin"></i><div>切换并应用中...</div></div>';
                        requestAnimationFrame(() => {
                            setTimeout(async () => {
                                try {
                                    await PresetManager.switchPreset(snap.presetName);
                                    await new Promise(r => requestAnimationFrame(r));
                                    const nextPreset = await PresetManager.load();
                                    await SnapshotManager.apply(snap, nextPreset);
                                    if (UiStateManager.get().toastOnSnapshotSwitch === true) {
                                        toastr.success(`已应用快照「${snap.name}」`);
                                    }
                                    const newList = await PresetManager.listNames();
                                    modal.innerHTML = '';
                                    buildModal(modal, nextPreset, newList);
                                } catch (e) { toastr.error('切换应用失败'); console.error(e); }
                            }, 10);
                        });
                    }, 400);
                }, true);
            } else {
                showConfirm(modal, `应用快照「${snap.name}」?\n将切换条目开关状态`, async () => {
                    try {
                        triggerIconAnimation(applyIcon, 'zero-anim-apply');
                        const startTime = Date.now();
                        await SnapshotManager.apply(snap, preset);
                        if (UiStateManager.get().toastOnSnapshotSwitch === true) {
                            toastr.success(`已应用快照「${snap.name}」`);
                        }
                        const p = await PresetManager.load();
                        const elapsed = Date.now() - startTime;
                        const delay = Math.max(0, 600 - elapsed);
                        if (delay > 0) await new Promise(r => setTimeout(r, delay));
                        renderSnapshots(panel, p || preset, modal, viewMode);
                    } catch (e) { toastr.error('应用失败'); console.error(e); }
                }, true);
            }
        } }, applyIcon),
        !isOther ? h('button', { class: 'zero-btn', title: '分组', html: '<i class="fa-solid fa-folder-open"></i>', onclick: () => showSnapshotGroupAssignMenu(modal, panel, preset, snap) }) : null,
        isOther ? h('button', { class: 'zero-btn', title: '导入与迁移到当前预设', html: '<i class="fa-solid fa-file-import"></i>', onclick: () => showSnapshotMigrationModal(preset, snap, modal) }) : null,
        h('button', { class: 'zero-btn', title: '重命名', html: '<i class="fa-solid fa-pen"></i>', onclick: () => {
            showPrompt(modal, '新名称', snap.name, (n) => {
                SnapshotManager.rename(snap.id, n);
                renderSnapshots(panel, preset, modal, viewMode);
            });
        }})
    );
    if (!isOther) {
        btnRow.appendChild(h('button', { class: 'zero-btn', title: '覆盖', onclick: () => {
            showConfirm(modal, `用当前状态覆盖快照「${snap.name}」?`, async () => {
                try {
                    triggerIconAnimation(overwriteIcon, 'zero-anim-overwrite');
                    const startTime = Date.now();
                    await SnapshotManager.overwrite(snap.id, preset);
                    if (UiStateManager.get().toastOnSnapshotOverwrite === true) {
                        toastr.success(`快照「${snap.name}」已覆盖`);
                    }
                    const elapsed = Date.now() - startTime;
                    const delay = Math.max(0, 600 - elapsed);
                    if (delay > 0) await new Promise(r => setTimeout(r, delay));
                    renderSnapshots(panel, preset, modal, viewMode);
                } catch (e) { toastr.error('覆盖失败'); console.error(e); }
            }, true);
        } }, overwriteIcon));
    }
    btnRow.appendChild(h('button', { class: 'zero-btn', title: '删除', html: '<i class="fa-solid fa-trash"></i>', onclick: () => {
        showConfirm(modal, `删除快照「${snap.name}」?`, () => {
            SnapshotManager.delete(snap.id);
            renderSnapshots(panel, preset, modal, viewMode);
        });
    }}));

    card.appendChild(snapHeader);
    card.appendChild(btnRow);
    card.appendChild(body);
    return card;
}

function toggleSnapshotGroup(groupEl, presetName, sgid) {
    const header = groupEl.querySelector('.zero-group-header');
    const body = groupEl.querySelector('.zero-group-body');
    const chevron = header.querySelector('.chevron');
    const isExpanding = body.classList.contains('collapsed');

    const willCollapse = !isExpanding;
    body.classList.toggle('collapsed', willCollapse);
    chevron?.classList.toggle('collapsed', willCollapse);

    if (sgid !== '__ungrouped') {
        SnapshotGroupManager.setCollapse(presetName, sgid, willCollapse);
    } else {
        UiStateManager.save({ ungroupedCol: willCollapse });
    }

    if (isExpanding) {
        // 折叠其他所有处于展开状态的快照分组 (实现手风琴效果)
        const panel = groupEl.closest('.zero-panel');
        if (panel) {
            const allGroups = panel.querySelectorAll('.zero-snapshot-group');
            allGroups.forEach(otherGroup => {
                if (otherGroup !== groupEl) {
                    const otherBody = otherGroup.querySelector('.zero-group-body');
                    const otherChevron = otherGroup.querySelector('.zero-group-header .chevron');
                    const otherSgid = otherGroup.dataset.sgid;

                    if (otherBody && !otherBody.classList.contains('collapsed')) {
                        otherBody.classList.add('collapsed');
                        if (otherChevron) otherChevron.classList.add('collapsed');

                        // 同时更新数据层状态
                        if (otherSgid === '__ungrouped') {
                            UiStateManager.save({ ungroupedCol: true });
                        } else if (otherSgid) {
                            SnapshotGroupManager.setCollapse(presetName, otherSgid, true);
                        }
                    }
                }
            });
        }

        const inner = body.querySelector('.zero-group-inner');
        if (inner && !inner.hasChildNodes()) {
            const panel = groupEl.closest('.zero-panel');
            const modal = groupEl.closest('.zero-modal');
            const preset = _currentPreset;

            const snaps = SnapshotManager.list(presetName);
            let groupSnaps = [];
            if (sgid === '__ungrouped') {
                const sGroups = SnapshotGroupManager.get(presetName);
                const assignedSids = new Set();
                sGroups.forEach(g => g.sids.forEach(id => assignedSids.add(id)));
                groupSnaps = snaps.filter(s => !assignedSids.has(s.id));
            } else {
                const g = SnapshotGroupManager.get(presetName).find(x => x.id === sgid);
                if (g) {
                    groupSnaps = snaps.filter(s => g.sids.includes(s.id));
                }
            }

            groupSnaps.forEach(snap => {
                inner.appendChild(buildSnapCard(snap, preset, panel, modal, 'local'));
            });
        }
    }
}

function showSnapshotGroupManager(panel, preset, modal) {
    const pName = preset.name;
    const menuBox = h('div', { class: 'zero-confirm' });
    const contentBox = h('div', { class: 'zero-confirm-box zero-group-mgr-box' },
        h('div', { class: 'zero-confirm-msg', text: '管理快照分组' })
    );

    const listContainer = h('div', { class: 'zero-group-mgr-list' });

    function renderList() {
        listContainer.innerHTML = '';
        const groups = SnapshotGroupManager.get(pName);
        if (groups.length === 0) {
            listContainer.appendChild(h('div', { class: 'zero-empty', text: '暂无分组' }));
            return;
        }

        groups.forEach((g, idx) => {
            const row = h('div', {
                class: 'zero-group-mgr-row',
                draggable: true,
                'data-gid': g.id
            });

            row.addEventListener('dragstart', (e) => {
                row.classList.add('dragging');
                e.dataTransfer.setData('text/plain', g.id);
            });
            row.addEventListener('dragend', () => row.classList.remove('dragging'));
            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                const draggingEl = listContainer.querySelector('.dragging');
                if (draggingEl && draggingEl !== row) {
                    const rect = row.getBoundingClientRect();
                    const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
                    row.classList.toggle('drag-over-top', !next);
                    row.classList.toggle('drag-over-bottom', next);
                }
            });
            row.addEventListener('dragleave', () => {
                row.classList.remove('drag-over-top', 'drag-over-bottom');
            });
            row.addEventListener('drop', (e) => {
                e.preventDefault();
                row.classList.remove('drag-over-top', 'drag-over-bottom');
                const dragId = e.dataTransfer.getData('text/plain');
                if (dragId && dragId !== g.id) {
                    const currentIds = SnapshotGroupManager.get(pName).map(x => x.id);
                    const oldIndex = currentIds.indexOf(dragId);
                    if (oldIndex > -1) {
                        currentIds.splice(oldIndex, 1);
                        const adjustedNewIndex = currentIds.indexOf(g.id);
                        let insertIndex = adjustedNewIndex;
                        if (row.classList.contains('drag-over-bottom')) {
                            insertIndex += 1;
                        }
                        currentIds.splice(insertIndex, 0, dragId);
                        SnapshotGroupManager.reorder(pName, currentIds);
                        renderList();
                    }
                }
            });

            const dragHandle = h('span', { class: 'zero-group-mgr-drag', html: '<i class="fa-solid fa-bars"></i>' });
            row.appendChild(dragHandle);
            row.appendChild(h('div', { class: 'zero-group-mgr-name', text: g.name }));

            const actions = h('div', { class: 'zero-group-mgr-actions' });
            actions.appendChild(h('button', {
                class: 'zero-icon-btn',
                title: '重命名',
                html: '<i class="fa-solid fa-pen"></i>',
                onclick: (e) => {
                    e.stopPropagation();
                    showPrompt(menuBox, '新组名', g.name, name => {
                        SnapshotGroupManager.rename(pName, g.id, name);
                        renderList();
                    });
                }
            }));
            actions.appendChild(h('button', {
                class: 'zero-icon-btn zero-group-mgr-del',
                title: '删除分组',
                html: '<i class="fa-solid fa-trash"></i>',
                onclick: (e) => {
                    e.stopPropagation();
                    showConfirm(menuBox, `确认删除分组「${g.name}」？\n（组内快照不会被删除）`, () => {
                        SnapshotGroupManager.remove(pName, g.id);
                        renderList();
                    });
                }
            }));

            row.appendChild(actions);
            listContainer.appendChild(row);
        });
    }

    renderList();
    contentBox.appendChild(listContainer);
    contentBox.appendChild(h('button', { class: 'zero-btn', style: 'width:100%; justify-content:center; margin: 12px 0;', html: '<i class="fa-solid fa-plus"></i> 新建分组', onclick: () => showPrompt(menuBox, '分组名称', '', name => { SnapshotGroupManager.create(pName, name); renderList(); }) }));
    contentBox.appendChild(h('div', { class: 'zero-confirm-btns' }, h('button', { class: 'zero-btn primary', style: 'width:100%;', text: '完成', onclick: () => { menuBox.remove(); renderSnapshots(panel, preset, modal, 'local'); } })));
    menuBox.appendChild(contentBox);
    modal.appendChild(menuBox);
}

function showSnapshotGroupAssignMenu(modal, panel, preset, snap) {
    const pName = preset.name;
    const groups = SnapshotGroupManager.get(pName);
    const menuItems = [];

    const currentGroup = groups.find(g => g.sids.includes(snap.id));

    if (currentGroup) {
        menuItems.push({ label: '从当前分组移出', icon: 'fa-right-from-bracket', action: () => {
            SnapshotGroupManager.unassign(pName, snap.id);
            renderSnapshots(panel, preset, modal, 'local');
        }});
    }
    groups.forEach(g => {
        if (currentGroup && g.id === currentGroup.id) return;
        menuItems.push({ label: `移到「${g.name}」`, icon: 'fa-folder', action: () => {
            SnapshotGroupManager.assign(pName, g.id, [snap.id]);
            renderSnapshots(panel, preset, modal, 'local');
        }});
    });

    if (menuItems.length === 0) { toastr.info('请先创建分组'); return; }

    const menuBox = h('div', { class: 'zero-confirm' });
    const menuContent = h('div', { class: 'zero-confirm-box zero-menu-box' },
        h('div', { class: 'zero-confirm-msg', text: `移动快照「${snap.name}」` })
    );
    menuItems.forEach(item => {
        menuContent.appendChild(h('button', {
            class: 'zero-menu-item',
            html: `<i class="fa-solid ${item.icon}"></i> ${item.label}`,
            onclick: () => { menuBox.remove(); item.action(); }
        }));
    });
    menuContent.appendChild(h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px' },
        h('button', { class: 'zero-btn', text: '取消', onclick: () => menuBox.remove() })
    ));
    menuBox.appendChild(menuContent);
    modal.appendChild(menuBox);
}

function renderSnapshotDiff(container, snap, preset) {
    const diffs = SnapshotManager.diff(snap, preset);
    const html = diffs.map(d => {
        let cls = 'zero-diff-item';
        let statusHTML = '';
        if (d.type === 'changed') {
            cls += ' changed';
            statusHTML = `<span class="zero-diff-status off">${d.curEnabled ? 'ON' : 'OFF'}</span><span class="zero-diff-status arrow">→</span><span class="zero-diff-status on">${d.snapEnabled ? 'ON' : 'OFF'}</span>`;
        } else if (d.type === 'missing') {
            cls += ' missing';
            statusHTML = '<span class="zero-diff-status off">已移除</span>';
        } else if (d.type === 'new') {
            cls += ' new-entry';
            if (d.curEnabled) {
                statusHTML = '<span class="zero-diff-status on">新条目</span><span class="zero-diff-status arrow">→</span><span class="zero-diff-status off">OFF</span>';
            } else {
                statusHTML = '<span class="zero-diff-status on">新条目</span>';
            }
        } else {
            statusHTML = `<span class="zero-diff-status">${d.snapEnabled ? 'ON' : 'OFF'}</span>`;
        }
        return `<div class="${cls}"><span class="zero-diff-name">${esc(d.name)}</span><div>${statusHTML}</div></div>`;
    }).join('');
    container.innerHTML = html;

    if (snap.samplingParams) {
        const paramsDivider = h('div', { style: 'margin: 12px 10px 6px; border-top: 1px dashed rgba(255,255,255,0.06);' });
        container.appendChild(paramsDivider);
        
        const mockProfile = {
            samplingParams: snap.samplingParams,
            additionalParams: snap.additionalParams,
            selectedGroupIds: []
        };
        renderProfileDetail(container, mockProfile, preset);
    }
}

// ═══════════════════════════════════════
//  Model Profiles UI
// ═══════════════════════════════════════
function renderModelProfiles(panel, preset, modal) {
    const pName = preset.name;
    const jbGroups = GroupManager.getJailbreakGroups(pName);

    const headerRow = h('div', { class: 'zero-filters', style: 'margin-bottom: 12px; justify-content: space-between;' },
        jbGroups.length === 0
            ? h('span', { style: 'font-size:12px; color:var(--SmartThemeEmColor)', text: '请先在「分组管理」中将分组标记为破限类型' })
            : h('span', { style: 'font-size:12px; color:var(--SmartThemeEmColor)', text: `${jbGroups.length} 个破限分组` }),
        h('button', { class: 'zero-btn primary', html: '<i class="fa-solid fa-plus"></i> 新建方案', onclick: () => {
            showCreateProfileDialog(panel, preset, modal, null);
        }})
    );
    panel.appendChild(headerRow);

    const query = searchQuery ? searchQuery.trim().toLowerCase() : '';
    let profiles = ModelProfileManager.list(pName);
    if (query) {
        profiles = profiles.filter(profile => (profile.name || '').toLowerCase().includes(query));
    }
    if (profiles.length === 0) {
        panel.appendChild(h('div', { class: 'zero-empty', text: query ? '没有匹配的方案' : '暂无模型方案，点击右上方按钮创建' }));
        return;
    }
    const frag = document.createDocumentFragment();
    profiles.forEach(profile => frag.appendChild(buildProfileCard(profile, preset, panel, modal)));
    panel.appendChild(frag);
}

function buildProfileCard(profile, preset, panel, modal) {
    const pName = preset.name;
    const card = h('div', { class: 'zero-snap' });

    // Header matches snapshot style
    const cardHeader = h('div', { class: 'zero-snap-header' },
        h('span', { class: 'zero-snap-name', text: profile.name }),
        h('span', { class: 'zero-snap-meta', text: `${profile.presetName} · ${formatDate(profile.ts)}` })
    );
    const body = h('div', { class: 'zero-snap-body' });
    let expanded = false;
    cardHeader.addEventListener('click', () => {
        expanded = !expanded;
        body.classList.toggle('expanded', expanded);
        if (expanded) {
            body.innerHTML = '';
            renderProfileDetail(body, profile, preset);
        }
    });

    // Action buttons
    const btnRow = h('div', { class: 'zero-snap-actions' },
        h('button', { class: 'zero-btn', title: '应用', html: '<i class="fa-solid fa-check"></i>', onclick: async () => {
            try {
                await ModelProfileManager.apply(profile, preset);
                const p = await PresetManager.load();
                renderSnapshots(panel, p || preset, modal, 'profiles');
                toastr.success(`已应用方案「${profile.name}」`);
            } catch (e) { toastr.error('应用失败'); console.error(e); }
        }}),
        h('button', { class: 'zero-btn', title: '重命名', html: '<i class="fa-solid fa-pen"></i>', onclick: () => {
            showPrompt(modal, '新名称', profile.name, n => {
                ModelProfileManager.rename(pName, profile.id, n);
                renderSnapshots(panel, preset, modal, 'profiles');
            });
        }}),
        h('button', { class: 'zero-btn', title: '覆盖', html: '<i class="fa-solid fa-sync"></i>', onclick: () => {
            showCreateProfileDialog(panel, preset, modal, profile);
        }}),
        h('button', { class: 'zero-btn', title: '删除', html: '<i class="fa-solid fa-trash"></i>', onclick: () => {
            showConfirm(modal, `删除方案「${profile.name}」?`, () => {
                ModelProfileManager.delete(pName, profile.id);
                renderSnapshots(panel, preset, modal, 'profiles');
            });
        }})
    );

    card.appendChild(cardHeader);
    card.appendChild(btnRow);
    card.appendChild(body);
    return card;
}

function renderProfileDetail(container, profile, preset) {
    const pName = preset.name;
    // Render active group tags inside expanded body
    const activeGids = profile.selectedGroupIds || [];
    if (activeGids.length > 0) {
        const tagsContainer = h('div', { style: 'margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 4px; align-items: center;' });
        tagsContainer.appendChild(h('span', { style: 'font-size: 11px; color: var(--SmartThemeEmColor, #999); font-weight: bold; margin-right: 4px;', text: '激活分组:' }));
        activeGids.forEach(gid => {
            const g = GroupManager.get(pName).find(x => x.id === gid);
            if (g) {
                tagsContainer.appendChild(h('span', { class: 'zero-profile-tag', text: g.name }));
            }
        });
        container.appendChild(tagsContainer);
    }

    // Two-column layout for parameters
    const columns = h('div', { class: 'zero-profile-detail-columns', style: 'display: flex; gap: 16px;' });
    const leftCol = h('div', { class: 'zero-profile-detail-col', style: 'flex: 1; min-width: 0;' });
    const rightCol = h('div', { class: 'zero-profile-detail-col', style: 'flex: 1; min-width: 0;' });
    columns.appendChild(leftCol);
    columns.appendChild(rightCol);
    container.appendChild(columns);

    // Sampling params (Left column)
    const sp = profile.samplingParams || {};
    const labels = {
        temp_openai: '温度', top_p_openai: 'Top P', top_k_openai: 'Top K',
        min_p_openai: 'Min P', top_a_openai: 'Top A',
        repetition_penalty_openai: '重复惩罚', freq_pen_openai: '频率惩罚', pres_pen_openai: '存在惩罚'
    };
    const rows = Object.entries(sp).filter(([, v]) => v !== undefined && v !== null);
    if (rows.length > 0) {
        const table = h('div', { class: 'zero-profile-detail-section' });
        table.appendChild(h('div', { class: 'zero-profile-detail-title', text: '采样参数' }));
        rows.forEach(([k, v]) => {
            table.appendChild(h('div', { class: 'zero-profile-detail-row' },
                h('span', { class: 'zero-profile-detail-key', text: labels[k] || k }),
                h('span', { class: 'zero-profile-detail-val', text: String(v) })
            ));
        });
        leftCol.appendChild(table);
    }

    // Additional params (Right column)
    const ap = profile.additionalParams || {};
    const apEntries = Object.entries(ap).filter(([, v]) => v && String(v).trim());
    if (apEntries.length > 0) {
        const apLabels = { custom_include_body: '包括主体', custom_exclude_body: '排除主体', custom_include_headers: '请求标头' };
        const sec = h('div', { class: 'zero-profile-detail-section' });
        sec.appendChild(h('div', { class: 'zero-profile-detail-title', text: '附加参数' }));
        apEntries.forEach(([k, v]) => {
            sec.appendChild(h('div', { class: 'zero-profile-detail-row', style: 'align-items:flex-start' },
                h('span', { class: 'zero-profile-detail-key', text: apLabels[k] || k }),
                h('span', { class: 'zero-profile-detail-val', style: 'white-space:pre-wrap; word-break:break-all', text: v })
            ));
        });
        rightCol.appendChild(sec);
    }
}

/**
 * Create/overwrite profile dialog.
 * If existingProfile is provided, we are overwriting it.
 */
async function showCreateProfileDialog(panel, preset, modal, existingProfile) {
    const pName = preset.name;
    const jbGroups = GroupManager.getJailbreakGroups(pName);

    if (jbGroups.length === 0) {
        toastr.info('请先在「分组管理」中将至少一个分组标记为破限类型');
        return;
    }

    // Read current sampling params
    const currentParams = await SamplingParamsHelper.read();
    const sp = currentParams?.sampling || {};
    const ap = currentParams?.additional || {};

    const isOverwrite = !!existingProfile;
    const dialogTitle = isOverwrite ? `覆盖方案「${existingProfile.name}」` : '新建模型方案';

    const box = h('div', { class: 'zero-confirm' });
    const content = h('div', { class: 'zero-confirm-box zero-profile-dialog' });
    content.appendChild(h('div', { class: 'zero-confirm-msg', text: dialogTitle }));

    // Name input (only for new)
    let nameInput = null;
    if (!isOverwrite) {
        nameInput = h('input', { class: 'zero-input', type: 'text', value: `方案 ${formatDate(Date.now())}`, style: 'width:100%; margin-bottom:12px;' });
        content.appendChild(nameInput);
    }

    // Group selection
    content.appendChild(h('div', { class: 'zero-profile-section-title', text: '激活的破限分组（未选中的分组将全部关闭）' }));
    const groupChecks = new Map(); // gid -> checkbox el
    const groupList = h('div', { class: 'zero-profile-group-list' });
    const preSelected = new Set(existingProfile?.selectedGroupIds || jbGroups.map(g => g.id));
    jbGroups.forEach(g => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = preSelected.has(g.id);
        groupChecks.set(g.id, cb);
        const row = h('label', { class: 'zero-profile-group-row' }, cb, h('span', { text: ` ${g.name}` }));
        groupList.appendChild(row);
    });
    content.appendChild(groupList);

    // Sampling params display (read-only from current ST values)
    content.appendChild(h('div', { class: 'zero-profile-section-title', style: 'margin-top:12px', text: '采样参数（读取当前值）' }));
    const spLabels = {
        temp_openai: '温度', top_p_openai: 'Top P', top_k_openai: 'Top K',
        min_p_openai: 'Min P', top_a_openai: 'Top A',
        repetition_penalty_openai: '重复惩罚', freq_pen_openai: '频率惩罚', pres_pen_openai: '存在惩罚'
    };
    const spGrid = h('div', { class: 'zero-profile-sp-grid' });
    Object.entries(spLabels).forEach(([k, label]) => {
        spGrid.appendChild(h('div', { class: 'zero-profile-sp-item' },
            h('span', { class: 'zero-profile-sp-label', text: label }),
            h('span', { class: 'zero-profile-sp-val', text: String(sp[k] ?? '—') })
        ));
    });
    content.appendChild(spGrid);

    // Additional params display
    const hasAdditional = Object.values(ap).some(v => v && String(v).trim());
    if (hasAdditional) {
        content.appendChild(h('div', { class: 'zero-profile-section-title', style: 'margin-top:8px', text: '附加参数（读取当前值）' }));
        const apLabels = { custom_include_body: '包括主体', custom_exclude_body: '排除主体', custom_include_headers: '请求标头' };
        Object.entries(ap).filter(([, v]) => v && String(v).trim()).forEach(([k, v]) => {
            content.appendChild(h('div', { class: 'zero-profile-detail-row', style: 'font-size:11px; padding: 2px 0;' },
                h('span', { class: 'zero-profile-detail-key', text: apLabels[k] || k }),
                h('span', { class: 'zero-profile-detail-val', style: 'max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap', text: v })
            ));
        });
    }

    // Confirm buttons
    content.appendChild(h('div', { class: 'zero-confirm-btns', style: 'margin-top:16px' },
        h('button', { class: 'zero-btn', text: '取消', onclick: () => box.remove() }),
        h('button', { class: 'zero-btn primary', text: isOverwrite ? '覆盖保存' : '创建', onclick: async () => {
            const selectedGroupIds = jbGroups.filter(g => groupChecks.get(g.id)?.checked).map(g => g.id);

            // Capture per-group entry states for selected groups
            const groupEntryStates = {};
            selectedGroupIds.forEach(gid => {
                const g = jbGroups.find(x => x.id === gid);
                if (g) {
                    groupEntryStates[gid] = g.ids.map(id => {
                        const p = preset.prompts.find(x => x.identifier === id);
                        return { id, e: p ? p.enabled : false };
                    });
                }
            });

            const freshParams = await SamplingParamsHelper.read();
            const finalSp = freshParams?.sampling || {};
            const finalAp = freshParams?.additional || {};

            if (isOverwrite) {
                ModelProfileManager.overwrite(pName, existingProfile.id, selectedGroupIds, groupEntryStates, finalSp, finalAp);
                toastr.success(`方案「${existingProfile.name}」已覆盖`);
            } else {
                const name = nameInput?.value?.trim();
                if (!name) { toastr.error('请输入方案名称'); return; }
                ModelProfileManager.create(pName, name, selectedGroupIds, groupEntryStates, finalSp, finalAp);
                toastr.success(`方案「${name}」已创建`);
            }
            box.remove();
            renderSnapshots(panel, preset, modal, 'profiles');
        }})
    ));

    box.appendChild(content);
    modal.appendChild(box);
    if (nameInput) setTimeout(() => nameInput.focus(), 50);
}

// ═══════════════════════════════════════
//  TAB 3: Editor
// ═══════════════════════════════════════
function renderEditor(panel, preset, modal) {
    const uiState = UiStateManager.get();
    let filter = uiState.editorFilter || 'all';
    let groupFilter = uiState.editorGroupFilter || 'all';
    const pName = preset.name;
    const groups = GroupManager.get(pName);

    // Validate groupFilter still exists
    if (groupFilter !== 'all' && !groups.find(g => g.id === groupFilter)) {
        groupFilter = 'all';
    }

    function render() {
        panel.innerHTML = '';
        const filters = h('div', { class: 'zero-filters' });
        ['all', 'enabled', 'disabled'].forEach(f => {
            const labels = { all: '全部', enabled: '已启用', disabled: '未启用' };
            filters.appendChild(h('button', {
                class: 'zero-chip' + (filter === f ? ' active' : ''),
                text: labels[f],
                onclick: () => { filter = f; if (f === 'all') groupFilter = 'all'; UiStateManager.save({ editorFilter: filter, editorGroupFilter: groupFilter }); render(); }
            }));
        });
        if (groups.length > 0) {
            filters.appendChild(h('span', { text: '|', style: 'color:var(--SmartThemeEmColor);margin:0 2px' }));
            groups.forEach(g => {
                filters.appendChild(h('button', {
                    class: 'zero-chip' + (groupFilter === g.id ? ' active' : ''),
                    text: g.name,
                    onclick: () => { groupFilter = groupFilter === g.id ? 'all' : g.id; UiStateManager.save({ editorFilter: filter, editorGroupFilter: groupFilter }); render(); }
                }));
            });
        }
        panel.appendChild(filters);

        const query = searchQuery ? searchQuery.trim().toLowerCase() : '';
        let entries = preset.prompts;
        if (filter === 'enabled') entries = entries.filter(p => p.enabled);
        else if (filter === 'disabled') entries = entries.filter(p => !p.enabled);
        if (groupFilter !== 'all') {
            const g = groups.find(x => x.id === groupFilter);
            if (g) entries = entries.filter(p => g.ids.includes(p.identifier));
        }
        if (query) {
            entries = entries.filter(p => matchPrompt(p, searchQuery, searchScopeName, searchScopeContent));
        }

        if (entries.length === 0) {
            panel.appendChild(h('div', { class: 'zero-empty', text: '没有匹配的条目' }));
            return;
        }

        const listEl = document.createElement('div');
        listEl.className = 'zero-editor-list';
        listEl.innerHTML = entries.map(p => {
            const sc = p.enabled ? 'on' : 'off';
            const st = p.enabled ? 'ON' : 'OFF';
            const nc = p.enabled ? '' : ' disabled';
            return `<div class="zero-edit-row" data-id="${esc(p.identifier)}"><span class="zero-diff-status ${sc}">${st}</span><span class="zero-editor-name${nc}">${esc(p.name || p.identifier)}</span><button class="zero-icon-btn zero-edit-pencil" title="编辑此条目"><i class="fa-solid fa-pencil"></i></button></div>`;
        }).join('');
        panel.appendChild(listEl);

        // Delegation for pencil clicks
        listEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.zero-edit-pencil');
            if (btn) {
                const row = btn.closest('.zero-edit-row');
                if (row) openNativeEditor(row.dataset.id);
            }
        });
    }
    render();
}

async function openNativeEditor(identifier) {
    try {
        const openai = await import('/scripts/openai.js');
        const promptManager = openai.promptManager;
        if (!promptManager) { toastr.error('找不到预设编辑器'); return; }
        const ctx = SillyTavern.getContext();
        const prompts = ctx.chatCompletionSettings?.prompts;
        const prompt = prompts?.find(p => p.identifier === identifier);
        if (!prompt) { toastr.error('找不到该条目'); return; }

        promptManager.clearEditForm();
        promptManager.clearInspectForm();
        promptManager.loadPromptIntoEditForm(prompt);
        
        if (overlay) overlay.style.display = 'none';
        promptManager.showPopup();

        const popupId = promptManager.configuration.prefix + 'prompt_manager_popup';
        const popup = document.getElementById(popupId);
        if (popup) {
            const observer = new MutationObserver(async () => {
                // React instantly when the closing animation starts (openDrawer class removed)
                if (!popup.classList.contains('openDrawer')) {
                    observer.disconnect();
                    if (overlay) {
                        overlay.style.display = 'flex';
                        try {
                            const p = await PresetManager.load();
                            if (p) {
                                const panel = overlay.querySelector('.zero-panel.active');
                                if (panel) {
                                    const activeTab = UiStateManager.get().activeTab || 'entries';
                                    if (activeTab === 'editor') {
                                        renderEditor(panel, p, overlay.querySelector('.zero-modal'));
                                    } else if (activeTab === 'entries') {
                                        renderEntries(panel, p, overlay.querySelector('.zero-modal'));
                                    }
                                }
                            }
                        } catch (err) { console.error('[Zero] reload after native edit:', err); }
                    }
                }
            });
            observer.observe(popup, { attributes: true, attributeFilter: ['class'] });
        } else {
            console.warn('[Zero] Could not find native popup:', popupId);
            if (overlay) overlay.style.display = 'flex';
        }
    } catch (e) {
        console.error('[Zero] openNativeEditor failed:', e);
        toastr.error('无法打开编辑器');
        if (overlay) overlay.style.display = 'flex';
    }
}

function findMostSimilarPresetWithSnapshots(currentPresetName) {
    const allSnaps = SnapshotManager.list();
    const otherPresetNames = Array.from(new Set(allSnaps.map(s => s.presetName)))
        .filter(name => name !== currentPresetName);
    if (otherPresetNames.length === 0) return null;

    let bestName = null;
    let maxScore = -1;

    otherPresetNames.forEach(name => {
        let score = 0;
        const w1 = currentPresetName.split(/[\s-_vV\d.]+/)[0];
        const w2 = name.split(/[\s-_vV\d.]+/)[0];
        if (w1 && w2 && w1.toLowerCase() === w2.toLowerCase()) {
            score += 15;
        }
        let commonPrefixLen = 0;
        const minLen = Math.min(currentPresetName.length, name.length);
        for (let i = 0; i < minLen; i++) {
            if (currentPresetName[i].toLowerCase() === name[i].toLowerCase()) {
                commonPrefixLen++;
            } else {
                break;
            }
        }
        score += commonPrefixLen;

        if (score > maxScore) {
            maxScore = score;
            bestName = name;
        }
    });

    return maxScore > 2 ? bestName : otherPresetNames[0];
}

async function showSnapshotMigrationModal(preset, preselectedSourceOrSnap = null, modal = null) {
    const targetModal = overlay || document.getElementById('zero-overlay') || document.body;
    
    function buildCollapsibleSection(sectionId, titleText, defaultOpen = false, onExpand = null) {
        const storageKey = `zero_migration_section_${sectionId}`;
        const savedOpen = localStorage.getItem(storageKey);
        // Default to false (collapsed)
        const isOpen = savedOpen === null ? defaultOpen : savedOpen === 'true';

        const chevron = h('i', { class: 'fa-solid fa-chevron-down chevron' + (isOpen ? '' : ' collapsed') });
        const header = h('div', { class: 'zero-group-header', style: 'padding: 8px 10px; background: rgba(255,255,255,0.03); cursor: pointer;' },
            chevron,
            h('span', { class: 'zero-group-title', text: titleText })
        );
        const body = h('div', { class: 'zero-group-body' + (isOpen ? '' : ' collapsed') });
        const container = h('div', { class: 'zero-group', style: 'margin-bottom: 8px;' },
            header,
            body
        );
        container.setAttribute('data-section-id', sectionId);

        let hasRendered = false;
        const triggerExpand = () => {
            if (!hasRendered && typeof onExpand === 'function') {
                hasRendered = true;
                onExpand(body);
            }
        };

        container.renderLazy = triggerExpand;

        header.addEventListener('click', () => {
            const isCollapsed = body.classList.toggle('collapsed');
            chevron.classList.toggle('collapsed', isCollapsed);
            localStorage.setItem(storageKey, (!isCollapsed).toString());
            if (!isCollapsed) {
                triggerExpand();
            }
        });

        // Trigger rendering immediately if section is open initially
        if (isOpen) {
            triggerExpand();
        }

        return { container, body, header, chevron };
    }

    function showContentCompareModal(sourceP, targetP) {
        const compareBox = h('div', { class: 'zero-confirm', style: 'z-index: 20500;' });
        const content = h('div', { class: 'zero-confirm-box', style: 'max-width: 680px; width: 90%; height: 80vh; max-height: 80vh; display: flex; flex-direction: column;' },
            h('div', { class: 'zero-confirm-msg', text: '对比条目内容' }),
            h('div', { style: 'display: flex; flex-direction: column; gap: 12px; flex: 1; overflow: hidden; margin-bottom: 12px;' },
                h('div', { style: 'flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden;' },
                    h('div', { style: 'font-weight: bold; margin-bottom: 4px; font-size:12px; color: var(--SmartThemeEmColor);', text: `来源 (原预设): ${sourceP.name || sourceP.identifier}` }),
                    h('textarea', { readonly: true, class: 'zero-input', style: 'flex: 1; resize: none; font-family: monospace; font-size: 10px; padding: 8px; background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;', text: sourceP.content || '' })
                ),
                h('div', { style: 'flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden;' },
                    h('div', { style: 'font-weight: bold; margin-bottom: 4px; font-size:12px; color: var(--SmartThemeEmColor);', text: `目标 (当前预设): ${targetP.name || targetP.identifier}` }),
                    h('textarea', { readonly: true, class: 'zero-input', style: 'flex: 1; resize: none; font-family: monospace; font-size: 10px; padding: 8px; background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.06); border-radius: 4px;', text: targetP.content || '' })
                )
            ),
            h('div', { class: 'zero-confirm-btns', style: 'display:flex; justify-content:flex-end;' },
                h('button', { class: 'zero-btn primary', text: '关闭', onclick: () => compareBox.remove() })
            )
        );
        compareBox.appendChild(content);
        targetModal.appendChild(compareBox);
    }

    const listInfo = await PresetManager.listNames();
    const allPresets = listInfo.names || [];
    const filteredSourcePresets = allPresets.filter(n => !n.startsWith('★') && n !== preset.name);

    const menuBox = h('div', { class: 'zero-confirm' });
    const contentBox = h('div', { class: 'zero-confirm-box zero-migration-box' },
        h('div', { class: 'zero-confirm-msg', text: '快照导入与迁移' }),
        h('div', { class: 'zero-migration-header-desc', text: '将其他预设的快照（或当前开关配置）智能转换并导入到当前预设' })
    );

    const scrollContainer = h('div', { class: 'zero-migration-scroll' });
    contentBox.appendChild(scrollContainer);

    // Section 1: Basic Settings (Static, collapsed by default unless saved otherwise)
    const settingsSection = buildCollapsibleSection('settings', '基础设置', false);
    scrollContainer.appendChild(settingsSection.container);

    // Collapsible Search Box
    const searchInput = h('input', {
        class: 'zero-input',
        type: 'text',
        placeholder: '搜索条目名称...',
        style: 'display: none; height: 22px; padding: 2px 8px; font-size: 11px; border-radius: 4px; box-sizing: border-box; width: 150px; border: 1px solid rgba(255,255,255,0.08); background: rgba(0,0,0,0.2);'
    });

    const closeSearchBtn = h('button', {
        class: 'zero-btn sm',
        style: 'display: none; padding: 2px 6px; height: 22px; margin-left: 4px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); align-items: center; justify-content: center;',
        onclick: (e) => {
            e.stopPropagation();
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input'));
            searchInput.style.display = 'none';
            closeSearchBtn.style.display = 'none';
            searchBtn.style.display = 'inline-flex';
        }
    }, h('i', { class: 'fa-solid fa-xmark', style: 'font-size: 10px;' }));

    const searchBtn = h('button', {
        class: 'zero-btn sm',
        style: 'padding: 2px 8px; height: 22px; display: inline-flex; align-items: center; justify-content: center; gap: 4px; font-size: 11px; border-radius: 4px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);',
        onclick: (e) => {
            e.stopPropagation();
            searchBtn.style.display = 'none';
            searchInput.style.display = 'inline-block';
            closeSearchBtn.style.display = 'inline-flex';
            searchInput.focus();
        }
    }, h('i', { class: 'fa-solid fa-magnifying-glass', style: 'font-size: 10px;' }), h('span', { text: '搜索条目' }));

    const searchContainer = h('div', {
        style: 'display: flex; justify-content: flex-end; align-items: center; margin: 4px 10px 8px; height: 24px;'
    }, searchBtn, searchInput, closeSearchBtn);
    scrollContainer.appendChild(searchContainer);

    let searchTimeout = null;
    searchInput.addEventListener('input', () => {
        if (searchTimeout) clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const q = searchInput.value.toLowerCase().trim();
            const sections = ['matched', 'new', 'missing'];

            if (q) {
                sections.forEach(secId => {
                    const secEl = menuBox.querySelector(`.zero-group[data-section-id="${secId}"]`);
                    if (secEl && typeof secEl.renderLazy === 'function') {
                        secEl.renderLazy();
                    }
                });
            }

            sections.forEach(secId => {
                const secEl = menuBox.querySelector(`.zero-group[data-section-id="${secId}"]`);
                if (!secEl) return;

                const cards = secEl.querySelectorAll('.zero-migration-item');
                let visibleCount = 0;

                cards.forEach(card => {
                    const nameEl = card.querySelector('.zero-migration-item-name');
                    const nameText = nameEl ? nameEl.textContent.toLowerCase() : '';
                    if (nameText.includes(q)) {
                        card.style.display = '';
                        visibleCount++;
                    } else {
                        card.style.display = 'none';
                    }
                });

                const headerTextEl = secEl.querySelector('.zero-group-title');
                if (headerTextEl) {
                    const totalCount = cards.length;
                    let baseTitle = '';
                    if (secId === 'matched') baseTitle = '正常匹配的条目';
                    else if (secId === 'new') baseTitle = '当前预设新增的条目';
                    else if (secId === 'missing') baseTitle = '缺失与改名条目';

                    if (q) {
                        headerTextEl.textContent = `${baseTitle} (显示 ${visibleCount}/${totalCount})`;
                    } else {
                        headerTextEl.textContent = `${baseTitle} (${totalCount})`;
                    }
                }

                if (q && visibleCount > 0) {
                    const body = secEl.querySelector('.zero-group-body');
                    const chevron = secEl.querySelector('.zero-group-header i');
                    if (body && body.classList.contains('collapsed')) {
                        body.classList.remove('collapsed');
                        if (chevron) chevron.classList.remove('collapsed');
                    }
                }
            });
        }, 1000);
    });

    const formContainer = h('div', { style: 'padding: 8px 10px;' });
    settingsSection.body.appendChild(formContainer);

    const sourceSelect = h('select', { class: 'zero-preset-select', style: 'width:100%;' });
    filteredSourcePresets.forEach(name => {
        sourceSelect.appendChild(h('option', { value: name, text: name }));
    });

    const sourceRow = h('div', { class: 'zero-migration-form-row' },
        h('label', { text: '来源预设' }),
        sourceSelect
    );
    formContainer.appendChild(sourceRow);

    const snapSelect = h('select', { class: 'zero-preset-select', style: 'width:100%;' });
    const snapRow = h('div', { class: 'zero-migration-form-row' },
        h('label', { text: '选择快照' }),
        snapSelect
    );
    formContainer.appendChild(snapRow);

    const nameInput = h('input', { class: 'zero-input', type: 'text', placeholder: '新快照名称', style: 'font-size:inherit !important;' });
    const nameRow = h('div', { class: 'zero-migration-form-row' },
        h('label', { text: '保存名称' }),
        nameInput
    );
    formContainer.appendChild(nameRow);

    // Similarity Threshold Row
    const thresholdSelect = h('select', { class: 'zero-preset-select', style: 'width:100%;' });
    const thresholdOptions = [
        { value: '1.0', text: '100% 完全一致' },
        { value: '0.9', text: '90% 高度相似' },
        { value: '0.8', text: '80% 相似' },
        { value: '0.7', text: '70% 相似' },
        { value: '0.0', text: '关闭内容匹配' }
    ];
    let selectedThreshold = parseFloat(localStorage.getItem('zero_migration_similarity_threshold') || '0.8');
    thresholdOptions.forEach(opt => {
        const optionEl = h('option', { value: opt.value, text: opt.text });
        optionEl.selected = (parseFloat(opt.value) === selectedThreshold);
        thresholdSelect.appendChild(optionEl);
    });

    thresholdSelect.addEventListener('change', () => {
        selectedThreshold = parseFloat(thresholdSelect.value);
        localStorage.setItem('zero_migration_similarity_threshold', thresholdSelect.value);
        renderMappingUI();
    });

    const thresholdRow = h('div', { class: 'zero-migration-form-row' },
        h('label', { text: '内容匹配阈值' }),
        thresholdSelect
    );
    formContainer.appendChild(thresholdRow);

    // Read saved copy preference
    const savedCopyPref = localStorage.getItem('zero_migration_save_copy');
    const isCopyChecked = savedCopyPref === null ? true : savedCopyPref === 'true';

    const copyCheckbox = h('input', { type: 'checkbox' });
    copyCheckbox.checked = isCopyChecked;
    const copySwitch = h('label', { class: 'zero-switch' },
        copyCheckbox,
        h('span', { class: 'zero-slider' })
    );
    const copyRow = h('div', { class: 'zero-migration-form-row', style: 'margin-bottom: 8px;' },
        h('label', { text: '保存快照副本', style: 'width: 110px;' }),
        h('div', { style: 'display:flex; align-items:center; gap:6px; flex:1;' },
            copySwitch,
            h('span', { text: '在当前预设下保存一份转换后的快照', style: 'font-size: 11px; color: var(--SmartThemeEmColor);' })
        )
    );
    formContainer.appendChild(copyRow);

    // Read saved keep historical params preference
    const savedKeepParamsPref = localStorage.getItem('zero_migration_keep_historical_params');
    const isKeepParamsChecked = savedKeepParamsPref === null ? true : savedKeepParamsPref === 'true';

    const keepParamsCheckbox = h('input', { type: 'checkbox' });
    keepParamsCheckbox.checked = isKeepParamsChecked;
    const keepParamsSwitch = h('label', { class: 'zero-switch' },
        keepParamsCheckbox,
        h('span', { class: 'zero-slider' })
    );
    keepParamsCheckbox.addEventListener('change', () => {
        localStorage.setItem('zero_migration_keep_historical_params', keepParamsCheckbox.checked.toString());
    });

    const decouple = UiStateManager.get().decoupleJailbreak === true;
    const paramsRow = h('div', { class: 'zero-migration-form-row', style: `margin-bottom: 8px; display: ${decouple ? 'none' : 'flex'};` },
        h('label', { text: '保留历史模型参数', style: 'width: 110px;' }),
        h('div', { style: 'display:flex; align-items:center; gap:6px; flex:1;' },
            keepParamsSwitch,
            h('span', { text: '导入时保留快照当时记录的模型参数', style: 'font-size: 11px; color: var(--SmartThemeEmColor);' })
        )
    );
    formContainer.appendChild(paramsRow);



    // Dynamic Container for sections 2, 3, and 4
    const dynamicContainer = h('div');
    scrollContainer.appendChild(dynamicContainer);

    const applyBtn = h('button', { class: 'zero-btn primary', text: '导入并应用', style: 'flex:1; justify-content:center;' });
    const importOnlyBtn = h('button', { class: 'zero-btn', text: '仅导入', style: 'flex:1; justify-content:center;' });
    const cancelBtn = h('button', { class: 'zero-btn', text: '取消', style: 'flex:1; justify-content:center;', onclick: () => menuBox.remove() });

    // Set initial disabled state based on checkbox
    importOnlyBtn.disabled = !isCopyChecked;

    copyCheckbox.addEventListener('change', () => {
        importOnlyBtn.disabled = !copyCheckbox.checked;
        localStorage.setItem('zero_migration_save_copy', copyCheckbox.checked.toString());
    });

    const btnRow = h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px; display:flex; gap:8px;' },
        cancelBtn,
        importOnlyBtn,
        applyBtn
    );
    contentBox.appendChild(btnRow);

    let currentSourcePreset = '';
    let selectedSnapshotObj = null;
    let mappingResult = null;
    let manualMappings = new Map();
    let saveLinkages = new Map();
    let newEntriesState = localStorage.getItem('zero_migration_new_entries_state') || 'default';
    let newEntriesCustomStates = new Map();
    let sourcePrompts = [];

    let currentRenderTicket = 0;
    async function renderMappingUI() {
        const ticket = ++currentRenderTicket;

        dynamicContainer.innerHTML = '<div class="zero-loading" style="padding:20px;text-align:center;color:var(--SmartThemeBodyColor);"><i class="fa-solid fa-spinner fa-spin"></i><div>正在计算映射中...</div></div>';
        applyBtn.disabled = true;
        importOnlyBtn.disabled = true;

        if (!selectedSnapshotObj) {
            dynamicContainer.innerHTML = '';
            dynamicContainer.appendChild(h('div', { class: 'zero-empty', text: '请先选择快照' }));
            applyBtn.disabled = true;
            importOnlyBtn.disabled = true;
            return;
        }

        const threshold = selectedThreshold;
        const snapObj = selectedSnapshotObj;
        const srcPrompts = sourcePrompts;

        const result = await SnapshotManager.computeMapping(snapObj, preset, srcPrompts, threshold);
        if (ticket !== currentRenderTicket) return;

        mappingResult = result;
        dynamicContainer.innerHTML = '';
        applyBtn.disabled = false;
        importOnlyBtn.disabled = !copyCheckbox.checked;

        const { matched, missing, newEntries } = mappingResult;

        // Section 2: Matched Entries (Collapsed by default)
        if (matched.length > 0) {
            const section = buildCollapsibleSection('matched', `正常匹配的条目 (${matched.length})`, false, (body) => {
                const inner = h('div', { style: 'padding: 8px 10px 4px;' });
                matched.forEach(m => {
                    const stateText = m.snapEntry.e ? 'ON' : 'OFF';
                    let matchTypeLabel = '';
                    let nameText = '';
                    if (m.type === 'content') {
                        const pct = Math.round((m.score || 1.0) * 100);
                        matchTypeLabel = pct === 100 ? '内容匹配' : `相似度 ${pct}%`;
                        nameText = `${m.snapEntry.n || m.snapEntry.id} ➔ ${m.targetPrompt.name || m.targetPrompt.identifier}`;
                    } else if (m.type === 'name' || m.type === 'manual_link') {
                        matchTypeLabel = m.type === 'name' ? '名称匹配' : '联动映射';
                        nameText = `${m.snapEntry.n || m.snapEntry.id} ➔ ${m.targetPrompt.name || m.targetPrompt.identifier}`;
                    } else {
                        matchTypeLabel = 'ID 匹配';
                        nameText = m.targetPrompt.name || m.targetPrompt.identifier;
                    }

                    const row = h('div', { class: 'zero-migration-item' },
                        h('div', { style: 'display:flex; flex-direction:column; overflow:hidden; flex:1;' },
                            h('span', { class: 'zero-migration-item-name', text: nameText }),
                            h('span', { class: 'zero-migration-item-meta', text: `快照原状态: ${stateText}` })
                        ),
                        h('span', { class: 'zero-migration-badge matched', text: matchTypeLabel, style: 'flex-shrink:0;' })
                    );
                    inner.appendChild(row);
                });
                body.appendChild(inner);
            });
            dynamicContainer.appendChild(section.container);
        }

        // Section 3: New Entries (Collapsed by default)
        if (newEntries.length > 0) {
            const section = buildCollapsibleSection('new', `当前预设新增的条目 (${newEntries.length})`, false, (body) => {
                const inner = h('div', { style: 'padding: 8px 10px 4px;' });

                const optDefault = h('option', { value: 'default', text: '保持预设默认' });
                optDefault.selected = (newEntriesState === 'default');
                const optOn = h('option', { value: 'on', text: '全部开启' });
                optOn.selected = (newEntriesState === 'on');
                const optOff = h('option', { value: 'off', text: '全部关闭' });
                optOff.selected = (newEntriesState === 'off');

                const globalSelect = h('select', { class: 'zero-preset-select', style: 'font-size: 11px; padding: 2px 6px; height: 24px;' },
                    optDefault, optOn, optOff
                );
                globalSelect.addEventListener('change', () => {
                    newEntriesState = globalSelect.value;
                    localStorage.setItem('zero_migration_new_entries_state', newEntriesState);
                    newEntries.forEach(ne => {
                        if (newEntriesState === 'on') newEntriesCustomStates.set(ne.identifier, true);
                        else if (newEntriesState === 'off') newEntriesCustomStates.set(ne.identifier, false);
                        else newEntriesCustomStates.delete(ne.identifier);
                    });
                    renderMappingUI();
                });

                const globalControlRow = h('div', { style: 'display:flex; justify-content:space-between; align-items:center; padding: 4px 8px 8px; border-bottom: 1px dashed rgba(255,255,255,0.06); margin-bottom: 8px;' },
                    h('span', { text: '新条目全局初始状态:', style: 'font-size:11px; color:var(--SmartThemeEmColor);' }),
                    globalSelect
                );
                inner.appendChild(globalControlRow);
                inner.appendChild(h('div', { class: 'zero-migration-section-desc', text: '快照中无此条目，请选择这些新增条目的导入状态。' }));

                newEntries.forEach(ne => {
                    let isChecked = ne.enabled;
                    if (newEntriesCustomStates.has(ne.identifier)) {
                        isChecked = newEntriesCustomStates.get(ne.identifier);
                    } else if (newEntriesState === 'on') {
                        isChecked = true;
                    } else if (newEntriesState === 'off') {
                        isChecked = false;
                    }

                    const chk = h('input', { type: 'checkbox' });
                    chk.checked = isChecked;
                    chk.addEventListener('change', () => {
                        newEntriesCustomStates.set(ne.identifier, chk.checked);
                    });
                    const sw = h('label', { class: 'zero-switch' },
                        chk,
                        h('span', { class: 'zero-slider' })
                    );

                    const row = h('div', { class: 'zero-migration-item' },
                        h('span', { class: 'zero-migration-item-name', text: ne.name || ne.identifier }),
                        h('div', { class: 'zero-migration-item-actions' },
                            h('span', { class: 'zero-migration-badge new', text: '新增' }),
                            sw
                        )
                    );
                    inner.appendChild(row);
                });

                body.appendChild(inner);
            });
            dynamicContainer.appendChild(section.container);
        }

        // Section 4: Missing/Renamed Entries (Collapsed by default)
        if (missing.length > 0) {
            const section = buildCollapsibleSection('missing', `缺失与改名条目 (${missing.length})`, false, (body) => {
                const inner = h('div', { style: 'padding: 8px 10px 4px;' });
                inner.appendChild(h('div', { class: 'zero-migration-section-desc', text: '可能已改名或被删除。如果已改名，请选择对应的新条目进行关联映射。' }));

                // Helper to build a searchable select element (No autofocus on input by default)
                function createSearchableSelect(options, currentValue, onChange) {
                    const container = h('div', { style: 'position: relative; flex: 1; min-width: 0;' });
                    
                    const selectedOpt = options.find(o => o.value === currentValue);
                    const buttonText = selectedOpt ? selectedOpt.text : '-- 请选择 --';
                    
                    const btn = h('button', {
                        class: 'zero-preset-select zero-btn sm',
                        style: 'width: 100%; text-align: left; justify-content: space-between; display: flex; align-items: center; padding: 2px 6px; height: 24px; font-size: 11px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.08); border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
                        onclick: (e) => {
                            e.stopPropagation();
                            // Close other searchable select dropdowns
                            menuBox.querySelectorAll('.zero-search-select-dropdown').forEach(d => {
                                if (d !== dropdown) {
                                    d.style.display = 'none';
                                    const lc = d.querySelector('.zero-list-container');
                                    if (lc) lc.innerHTML = '';
                                }
                            });
                            const isShown = dropdown.style.display === 'block';
                            dropdown.style.display = isShown ? 'none' : 'block';
                            if (!isShown) {
                                searchInput.value = '';
                                filterOptions('');
                            } else {
                                listContainer.innerHTML = '';
                            }
                        }
                    },
                        h('span', { text: buttonText, style: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' }),
                        h('i', { class: 'fa-solid fa-chevron-down', style: 'font-size: 9px; margin-left: 4px; opacity: 0.7;' })
                    );
                    
                    const searchInput = h('input', {
                        class: 'zero-input',
                        type: 'text',
                        placeholder: '输入过滤条目...',
                        style: 'width: 100%; height: 20px; font-size: 10px; padding: 2px 6px; margin-bottom: 4px; box-sizing: border-box; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: #fff !important;'
                    });
                    
                    const listContainer = h('div', {
                        class: 'zero-list-container',
                        style: 'max-height: 160px; overflow-y: auto; display: block;'
                    });
                    
                    const dropdown = h('div', {
                        class: 'zero-search-select-dropdown',
                        style: 'display: none; position: absolute; left: 0; right: 0; top: 100%; z-index: 100; margin-top: 2px; padding: 4px; background: rgb(from var(--SmartThemeChatTintColor, rgba(40,40,55,1)) r g b / 1) !important; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);'
                    },
                        searchInput,
                        listContainer
                    );
                    
                    function filterOptions(q) {
                        listContainer.innerHTML = '';
                        const query = q.toLowerCase().trim();
                        
                        options.forEach(opt => {
                            if (query && !opt.text.toLowerCase().includes(query)) return;
                            
                            const isSelected = opt.value === currentValue;
                            const optEl = h('div', {
                                style: `display: block; padding: 6px 10px; font-size: 11px; cursor: pointer; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 2px; ${isSelected ? 'background: var(--SmartThemeQuoteColor, #7b8cde) !important; color: #fff !important;' : 'color: var(--SmartThemeBodyColor, inherit) !important;'}`
                            }, opt.text);
                            
                            optEl.addEventListener('mouseenter', () => {
                                if (!isSelected) optEl.style.background = 'rgba(255,255,255,0.06)';
                            });
                            optEl.addEventListener('mouseleave', () => {
                                if (!isSelected) optEl.style.background = '';
                            });
                            
                            optEl.addEventListener('click', (e) => {
                                e.stopPropagation();
                                dropdown.style.display = 'none';
                                listContainer.innerHTML = '';
                                onChange(opt.value);
                            });
                            
                            listContainer.appendChild(optEl);
                        });
                        
                        if (listContainer.children.length === 0) {
                            listContainer.appendChild(h('div', {
                                style: 'padding: 6px; text-align: center; color: var(--SmartThemeEmColor); font-size: 10px; font-style: italic;',
                                text: '无匹配项'
                            }));
                        }
                    }
                    
                    let selectSearchTimeout = null;
                    searchInput.addEventListener('input', () => {
                        if (selectSearchTimeout) clearTimeout(selectSearchTimeout);
                        selectSearchTimeout = setTimeout(() => {
                            filterOptions(searchInput.value);
                        }, 1000);
                    });
                    
                    document.addEventListener('click', () => {
                        dropdown.style.display = 'none';
                        listContainer.innerHTML = '';
                    });
                    
                    container.appendChild(btn);
                    container.appendChild(dropdown);
                    return container;
                }

                missing.forEach(se => {
                    const selectOptions = [
                        { value: '', text: '-- 不导入 (已删除) --' }
                    ];
                    newEntries.forEach(ne => {
                        selectOptions.push({ value: ne.identifier, text: ne.name || ne.identifier });
                    });

                    let selectVal = manualMappings.get(se.id) || '';

                    const linkChk = h('input', { type: 'checkbox' });
                    linkChk.checked = saveLinkages.get(se.id) !== false;
                    linkChk.addEventListener('change', () => {
                        saveLinkages.set(se.id, linkChk.checked);
                    });
                    const linkSw = h('label', { class: 'zero-switch' },
                        linkChk,
                        h('span', { class: 'zero-slider' })
                    );

                    const compareBtn = h('button', { class: 'zero-btn sm', style: 'display:none; padding:2px 8px; font-size:11px;', text: '对比内容' });
                    const identicalBadge = h('span', { class: 'zero-migration-badge matched', style: 'display:none; font-size:10px; margin-left:4px;', text: '内容一致' });

                    compareBtn.addEventListener('click', () => {
                        if (!selectVal) return;
                        const targetP = newEntries.find(ne => ne.identifier === selectVal);
                        const sourceP = sourcePrompts.find(p => p.identifier === se.id);
                        if (targetP && sourceP) {
                            showContentCompareModal(sourceP, targetP);
                        }
                    });

                    const updateLinkVisibility = (val) => {
                        const hasVal = !!val;
                        linkRow.style.display = hasVal ? 'flex' : 'none';
                        compareBtn.style.display = hasVal ? 'inline-flex' : 'none';
                        
                        if (hasVal) {
                            const targetP = newEntries.find(ne => ne.identifier === val);
                            const sourceP = sourcePrompts.find(p => p.identifier === se.id);
                            if (targetP && sourceP) {
                                const score = getStringSimilarity(sourceP.content, targetP.content);
                                const pct = Math.round(score * 100);
                                identicalBadge.style.display = 'inline-block';
                                if (pct === 100) {
                                    identicalBadge.textContent = '内容一致';
                                    identicalBadge.className = 'zero-migration-badge matched';
                                } else {
                                    identicalBadge.textContent = `相似度 ${pct}%`;
                                    identicalBadge.className = 'zero-migration-badge new';
                                }
                            } else {
                                identicalBadge.style.display = 'none';
                            }
                        } else {
                            identicalBadge.style.display = 'none';
                        }
                    };

                    const select = createSearchableSelect(selectOptions, selectVal, (newVal) => {
                        selectVal = newVal;
                        if (newVal) {
                            manualMappings.set(se.id, newVal);
                        } else {
                            manualMappings.delete(se.id);
                        }
                        updateLinkVisibility(newVal);
                    });

                    const linkRow = h('div', { style: 'display:none; align-items:center; gap:6px; font-size:10px; color:var(--SmartThemeEmColor); margin-top:4px;' },
                        linkSw,
                        h('span', { text: '保存为此两预设的永久条目关联' })
                    );

                    updateLinkVisibility(selectVal);

                    const row = h('div', { class: 'zero-migration-item', style: 'flex-direction:column; align-items:stretch; gap:4px; padding:8px 10px;' },
                        h('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:8px;' },
                            h('div', { style: 'display:flex; align-items:center; gap:4px; overflow:hidden; flex:1;' },
                                h('span', { class: 'zero-migration-item-name', text: se.n || se.id, style: 'font-weight:bold; max-width:100%;' }),
                                identicalBadge
                            ),
                            h('span', { class: 'zero-migration-badge missing', text: '缺失/改名', style: 'flex-shrink:0;' })
                        ),
                        h('div', { style: 'display:flex; justify-content:space-between; align-items:center; font-size:10px; color:var(--SmartThemeEmColor);' },
                            h('span', { text: `原状态: ${se.e ? 'ON' : 'OFF'}` })
                        ),
                        h('div', { style: 'display:flex; align-items:center; gap:8px; margin-top:4px;' },
                            h('span', { text: '关联至:', style: 'font-size:11px; color:var(--SmartThemeEmColor); flex-shrink:0;' }),
                            select,
                            compareBtn
                        ),
                        linkRow
                    );
                    inner.appendChild(row);
                });

                body.appendChild(inner);
            });
            dynamicContainer.appendChild(section.container);
        }

        // Re-apply search filter if there is active search query
        if (searchInput.value) {
            searchInput.dispatchEvent(new Event('input'));
        }
    }

    async function updateSnapshotsDropdown() {
        snapSelect.innerHTML = '';
        currentSourcePreset = sourceSelect.value;
        if (!currentSourcePreset) return;

        const savedSnaps = SnapshotManager.list(currentSourcePreset);
        
        // Add batch options in the dropdown
        snapSelect.appendChild(h('option', { value: '__all_snaps_and_groups', text: '[完整迁移]' }));
        snapSelect.appendChild(h('option', { value: '__prompt_groups_only', text: '[迁移条目分组]' }));
        snapSelect.appendChild(h('option', { value: '__snapshot_groups_only', text: '[迁移快照分组]' }));
        snapSelect.appendChild(h('option', { value: '__model_profiles_only', text: '[迁移模型方案]' }));
        snapSelect.appendChild(h('option', { value: '__active_layout', text: '[当前活跃开关]' }));

        savedSnaps.forEach(snap => {
            snapSelect.appendChild(h('option', { value: snap.id, text: snap.name }));
        });

        loadSelectedSnapshot();
    }

    async function loadSelectedSnapshot() {
        const snapId = snapSelect.value;
        selectedSnapshotObj = null;
        sourcePrompts = [];

        if (snapId === '__all_snaps_and_groups') {
            const prompts = await getPresetPromptsWithEnabled(currentSourcePreset);
            selectedSnapshotObj = {
                id: '__all_snaps_and_groups',
                name: '完整迁移',
                presetName: currentSourcePreset,
                ts: Date.now(),
                entries: prompts.map(p => ({ id: p.identifier, n: p.name || p.identifier, e: p.enabled === true }))
            };
            sourcePrompts = prompts;
            
            // Hide nameRow & copyRow since it applies to all snaps
            nameRow.style.display = 'none';
            copyRow.style.display = 'none';
            
            applyBtn.textContent = '导入并应用整套';
            importOnlyBtn.textContent = '仅导入整套';
            importOnlyBtn.style.display = 'inline-flex';
            importOnlyBtn.disabled = false;
        } else if (snapId === '__prompt_groups_only') {
            const prompts = await getPresetPromptsWithEnabled(currentSourcePreset);
            selectedSnapshotObj = {
                id: '__prompt_groups_only',
                name: '迁移条目分组',
                presetName: currentSourcePreset,
                ts: Date.now(),
                entries: prompts.map(p => ({ id: p.identifier, n: p.name || p.identifier, e: p.enabled === true }))
            };
            sourcePrompts = prompts;
            
            // Hide configuration rows and show only import groups button
            nameRow.style.display = 'none';
            copyRow.style.display = 'none';
            
            applyBtn.textContent = '导入条目分组';
            importOnlyBtn.style.display = 'none';
        } else if (snapId === '__snapshot_groups_only') {
            const prompts = await getPresetPromptsWithEnabled(currentSourcePreset);
            selectedSnapshotObj = {
                id: '__snapshot_groups_only',
                name: '迁移快照分组',
                presetName: currentSourcePreset,
                ts: Date.now(),
                entries: prompts.map(p => ({ id: p.identifier, n: p.name || p.identifier, e: p.enabled === true }))
            };
            sourcePrompts = prompts;
            
            // Hide configuration rows and show only import groups button
            nameRow.style.display = 'none';
            copyRow.style.display = 'none';
            
            applyBtn.textContent = '导入快照分组';
            importOnlyBtn.style.display = 'none';
        } else if (snapId === '__model_profiles_only') {
            const prompts = await getPresetPromptsWithEnabled(currentSourcePreset);
            selectedSnapshotObj = {
                id: '__model_profiles_only',
                name: '迁移模型方案',
                presetName: currentSourcePreset,
                ts: Date.now(),
                entries: prompts.map(p => ({ id: p.identifier, n: p.name || p.identifier, e: p.enabled === true }))
            };
            sourcePrompts = prompts;

            // Hide configuration rows
            nameRow.style.display = 'none';
            copyRow.style.display = 'none';

            applyBtn.textContent = '导入模型方案';
            importOnlyBtn.style.display = 'none';
        } else if (snapId === '__active_layout') {
            const prompts = await getPresetPromptsWithEnabled(currentSourcePreset);
            selectedSnapshotObj = {
                id: '__active_layout',
                name: '当前活跃开关',
                presetName: currentSourcePreset,
                ts: Date.now(),
                entries: prompts.map(p => ({ id: p.identifier, n: p.name || p.identifier, e: p.enabled === true }))
            };
            sourcePrompts = prompts;
            nameInput.value = `${currentSourcePreset} 默认配置`;
            
            nameRow.style.display = 'flex';
            copyRow.style.display = 'flex';
            copyCheckbox.disabled = false;
            const savedCopyPref = localStorage.getItem('zero_migration_save_copy');
            copyCheckbox.checked = savedCopyPref === null ? true : savedCopyPref === 'true';
            
            applyBtn.textContent = '导入并应用';
            importOnlyBtn.textContent = '仅导入';
            importOnlyBtn.style.display = 'inline-flex';
            importOnlyBtn.disabled = !copyCheckbox.checked;
        } else {
            selectedSnapshotObj = (SnapshotManager.list(currentSourcePreset) || []).find(s => s.id === snapId);
            if (selectedSnapshotObj) {
                nameInput.value = selectedSnapshotObj.name;
                sourcePrompts = await getPresetPromptsWithEnabled(currentSourcePreset);
            }
            
            nameRow.style.display = 'flex';
            copyRow.style.display = 'flex';
            copyCheckbox.disabled = false;
            const savedCopyPref = localStorage.getItem('zero_migration_save_copy');
            copyCheckbox.checked = savedCopyPref === null ? true : savedCopyPref === 'true';
            
            applyBtn.textContent = '导入并应用';
            importOnlyBtn.textContent = '仅导入';
            importOnlyBtn.style.display = 'inline-flex';
            importOnlyBtn.disabled = !copyCheckbox.checked;
        }
        const decouple = UiStateManager.get().decoupleJailbreak === true;
        const showParams = !decouple && (snapId === '__all_snaps_and_groups' || (!snapId.startsWith('__')));
        paramsRow.style.display = showParams ? 'flex' : 'none';

        manualMappings.clear();
        saveLinkages.clear();
        newEntriesCustomStates.clear();

        renderMappingUI();
    }

    sourceSelect.addEventListener('change', updateSnapshotsDropdown);
    snapSelect.addEventListener('change', loadSelectedSnapshot);

    if (filteredSourcePresets.length === 0) {
        scrollContainer.appendChild(h('div', { class: 'zero-empty', text: '没有找到其他预设可供导入。' }));
        applyBtn.disabled = true;
        importOnlyBtn.disabled = true;
    } else {
        let defaultSource = filteredSourcePresets[0];
        let preselectedSnapId = null;

        if (preselectedSourceOrSnap) {
            if (typeof preselectedSourceOrSnap === 'string') {
                if (filteredSourcePresets.includes(preselectedSourceOrSnap)) {
                    defaultSource = preselectedSourceOrSnap;
                }
            } else if (typeof preselectedSourceOrSnap === 'object' && preselectedSourceOrSnap.presetName) {
                if (filteredSourcePresets.includes(preselectedSourceOrSnap.presetName)) {
                    defaultSource = preselectedSourceOrSnap.presetName;
                    preselectedSnapId = preselectedSourceOrSnap.id;
                }
            }
        }

        sourceSelect.value = defaultSource;
        await updateSnapshotsDropdown();

        if (preselectedSnapId) {
            snapSelect.value = preselectedSnapId;
            await loadSelectedSnapshot();
        }
    }

    async function executeImport(applyToggles) {
        if (!selectedSnapshotObj || !mappingResult) return;

        const { matched, missing, newEntries } = mappingResult;
        const promptIdMap = new Map();

        matched.forEach(m => {
            promptIdMap.set(m.snapEntry.id, m.targetPrompt.identifier);
        });

        for (const [snapEntryId, targetId] of manualMappings.entries()) {
            if (targetId) {
                promptIdMap.set(snapEntryId, targetId);
            }
        }

        // Save manual links if any
        const newManualLinks = {};
        for (const [snapEntryId, targetId] of manualMappings.entries()) {
            if (targetId && saveLinkages.get(snapEntryId) !== false) {
                newManualLinks[snapEntryId] = targetId;
            }
        }
        if (Object.keys(newManualLinks).length > 0) {
            try {
                const links = JSON.parse(localStorage.getItem('zero_manual_links') || '{}');
                const keyPair = `${selectedSnapshotObj.presetName}::${preset.name}`;
                if (!links[keyPair]) links[keyPair] = {};
                Object.assign(links[keyPair], newManualLinks);
                localStorage.setItem('zero_manual_links', JSON.stringify(links));
            } catch (e) {
                console.error('[Zero] Failed to save zero_manual_links:', e);
            }
        }

        menuBox.innerHTML = '<div class="zero-loading" style="padding:40px;text-align:center;color:var(--SmartThemeBodyColor)"><i class="fa-solid fa-spinner fa-spin"></i><div>导入并迁移中...</div></div>';

        requestAnimationFrame(() => {
            setTimeout(async () => {
                try {
                    if (selectedSnapshotObj.id === '__prompt_groups_only') {
                        // Only migrate prompt groups (One-off structural action)
                        GroupManager.migrate(currentSourcePreset, preset.name, promptIdMap);
                        toastr.success(`已成功同步迁移所有条目分组！`);
                    } else if (selectedSnapshotObj.id === '__snapshot_groups_only') {
                        // Only migrate snapshot groups (One-off structural action)
                        SnapshotGroupManager.migrate(currentSourcePreset, preset.name, new Map());
                        toastr.success(`已成功同步迁移所有快照分组！`);
                    } else if (selectedSnapshotObj.id === '__model_profiles_only') {
                        // Only migrate model profiles
                        const groupIdMap = GroupManager.migrate(currentSourcePreset, preset.name, promptIdMap);
                        ModelProfileManager.migrate(currentSourcePreset, preset.name, promptIdMap, groupIdMap);
                        toastr.success(`已成功同步迁移所有模型方案！`);
                    } else if (selectedSnapshotObj.id === '__all_snaps_and_groups') {
                        // Batch migration of all snapshots + snapshot groups
                        const allSourceSnaps = SnapshotManager.list(currentSourcePreset) || [];
                        const snapshotIdMap = new Map();

                        for (const srcSnap of allSourceSnaps) {
                            const tempPreset = {
                                name: preset.name,
                                prompts: preset.prompts.map(p => {
                                    let isEnabled = p.enabled;
                                    const srcId = Array.from(promptIdMap.entries()).find(([s, t]) => t === p.identifier)?.[0];
                                    const srcEntry = srcId ? srcSnap.entries.find(e => e.id === srcId) : null;
                                    if (srcEntry) {
                                        isEnabled = srcEntry.e;
                                    } else {
                                        if (newEntriesCustomStates.has(p.identifier)) {
                                            isEnabled = newEntriesCustomStates.get(p.identifier);
                                        } else if (newEntriesState === 'on') {
                                            isEnabled = true;
                                        } else if (newEntriesState === 'off') {
                                            isEnabled = false;
                                        }
                                    }
                                    return { ...p, enabled: isEnabled };
                                })
                            };
                            const keepParams = keepParamsCheckbox.checked;
                            const newSnap = await SnapshotManager.create(srcSnap.name, tempPreset, keepParams ? {
                                samplingParams: srcSnap.samplingParams,
                                additionalParams: srcSnap.additionalParams
                            } : null);
                            if (newSnap && newSnap.id) {
                                snapshotIdMap.set(srcSnap.id, newSnap.id);
                            }
                        }

                        // Migrate Snapshot Groups
                        SnapshotGroupManager.migrate(currentSourcePreset, preset.name, snapshotIdMap);

                        // Migrate Prompt Groups, Hidden states, Linkages, and Model Profiles
                        const groupIdMap = GroupManager.migrate(currentSourcePreset, preset.name, promptIdMap);
                        HiddenManager.migrate(currentSourcePreset, preset.name, promptIdMap);
                        LinkageManager.migrate(currentSourcePreset, preset.name, promptIdMap);
                        ModelProfileManager.migrate(currentSourcePreset, preset.name, promptIdMap, groupIdMap);

                        // Apply toggles of active source preset if applyToggles is true
                        if (applyToggles) {
                            const resolvedToggles = new Map();
                            preset.prompts.forEach(p => {
                                let isEnabled = p.enabled;
                                const srcId = Array.from(promptIdMap.entries()).find(([s, t]) => t === p.identifier)?.[0];
                                const srcP = srcId ? sourcePrompts.find(x => x.identifier === srcId) : null;
                                if (srcP) {
                                    isEnabled = srcP.enabled;
                                } else {
                                    if (newEntriesCustomStates.has(p.identifier)) {
                                        isEnabled = newEntriesCustomStates.get(p.identifier);
                                    } else if (newEntriesState === 'on') {
                                        isEnabled = true;
                                    } else if (newEntriesState === 'off') {
                                        isEnabled = false;
                                    }
                                }
                                resolvedToggles.set(p.identifier, isEnabled);
                            });
                            await PresetManager.batchToggleMap(resolvedToggles);
                        }

                        toastr.success(`已成功一键迁移所有快照与快照分组！`);
                    } else {
                        // Single snapshot migration
                        const resolvedToggles = new Map();

                        matched.forEach(m => {
                            resolvedToggles.set(m.targetPrompt.identifier, m.snapEntry.e);
                        });

                        newEntries.forEach(ne => {
                            let isEnabled = ne.enabled;
                            if (newEntriesCustomStates.has(ne.identifier)) {
                                isEnabled = newEntriesCustomStates.get(ne.identifier);
                            } else if (newEntriesState === 'on') {
                                isEnabled = true;
                            } else if (newEntriesState === 'off') {
                                isEnabled = false;
                            }
                            resolvedToggles.set(ne.identifier, isEnabled);
                        });

                        for (const [snapEntryId, targetId] of manualMappings.entries()) {
                            const se = missing.find(x => x.id === snapEntryId);
                            if (se && targetId) {
                                resolvedToggles.set(targetId, se.e);
                            }
                        }

                        const newSnapName = nameInput.value.trim() || selectedSnapshotObj.name;
                        const copyName = copyCheckbox.checked ? newSnapName : null;

                        let newSnap = null;
                        const keepParams = keepParamsCheckbox.checked;
                        if (applyToggles) {
                            newSnap = await SnapshotManager.applySmart(selectedSnapshotObj, preset, resolvedToggles, copyName, keepParams);
                            toastr.success(`快照已智能导入并应用！`);
                        } else if (copyName) {
                            const tempPreset = {
                                name: preset.name,
                                prompts: preset.prompts.map(p => ({
                                    ...p,
                                    enabled: resolvedToggles.has(p.identifier) ? resolvedToggles.get(p.identifier) : p.enabled
                                }))
                            };
                            newSnap = await SnapshotManager.create(copyName, tempPreset, keepParams ? {
                                samplingParams: selectedSnapshotObj.samplingParams,
                                additionalParams: selectedSnapshotObj.additionalParams
                            } : null);
                            toastr.success(`快照副本「${copyName}」已成功导入`);
                        }

                        // If single snapshot copy created, migrate its group placement
                        if (newSnap && newSnap.id && syncSnap) {
                            // Find which group in source preset the source snapshot belongs to
                            const srcGroups = SnapshotGroupManager.get(currentSourcePreset);
                            const srcG = srcGroups.find(g => g.sids.includes(selectedSnapshotObj.id));
                            if (srcG) {
                                const snapshotIdMap = new Map([[selectedSnapshotObj.id, newSnap.id]]);
                                SnapshotGroupManager.migrate(currentSourcePreset, preset.name, snapshotIdMap);
                            }
                        }

                        // Migrate Prompt Groups
                        if (syncPrompt) {
                            GroupManager.migrate(currentSourcePreset, preset.name, promptIdMap);
                        }
                    }

                    menuBox.remove();
                    
                    const p = await PresetManager.load();
                    const panel = overlay.querySelector('.zero-panel.active');
                    if (panel) {
                        renderSnapshots(panel, p || preset, modal, 'local');
                    }
                } catch (e) {
                    console.error('[Zero] Import failed:', e);
                    toastr.error('导入失败，请检查控制台。');
                    menuBox.remove();
                }
            }, 50);
        });
    }

    applyBtn.addEventListener('click', () => executeImport(true));
    importOnlyBtn.addEventListener('click', () => executeImport(false));

    menuBox.appendChild(contentBox);
    targetModal.appendChild(menuBox);
}
