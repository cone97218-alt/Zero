/**
 * Zero Preset Manager - UI
 * Performance-optimized v2: innerHTML templates, event delegation, lazy rendering.
 */
import { PresetManager, SnapshotManager, GroupManager, HiddenManager, UiStateManager, LinkageManager, zeroTranslate, HistoryManager } from './state.js';

let overlay = null;
let pendingToggles = new Map();
let toggleTimer = null;
let _scrollSaveTimer = null;

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

function showConfirm(modal, msg, onYes) {
    onYes();
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
    if (id === 'entries') renderEntries(panel, preset, modal);
    else if (id === 'snapshots') renderSnapshots(panel, preset, modal);
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

    // Build all groups as one HTML string
    let html = '';
    groups.forEach(g => {
        const membersInGroup = new Set(g.ids);
        const members = preset.prompts.filter(p => membersInGroup.has(p.identifier) && !hidden.has(p.identifier));
        _groupMemberMap.set(g.id, members);
        html += groupSectionHTML(g, members, false);
    });

    if (ungrouped.length > 0) {
        const ugId = '__ungrouped';
        _groupMemberMap.set(ugId, ungrouped);
        html += groupSectionHTML({ id: ugId, name: '未分组', col: UiStateManager.get().ungroupedCol }, ungrouped, true);
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
        if (e.target.closest('.zero-entry')) e.preventDefault();
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
    panel.innerHTML = '';
    const headerRow = h('div', { class: 'zero-filters', style: 'margin-bottom: 12px; justify-content: space-between;' },
        h('div', { style: 'display: flex; gap: 6px;' },
            h('button', { class: 'zero-chip ' + (viewMode === 'local' ? 'active' : ''), text: '当前预设', onclick: () => renderSnapshots(panel, preset, modal, 'local') }),
            h('button', { class: 'zero-chip ' + (viewMode === 'other' ? 'active' : ''), text: '其他预设', onclick: () => renderSnapshots(panel, preset, modal, 'other') })
        ),
        h('button', { class: 'zero-btn primary', html: '<i class="fa-solid fa-plus"></i> 新建', onclick: () => {
            showPrompt(modal, '快照名称', `快照 ${formatDate(Date.now())}`, (name) => {
                SnapshotManager.create(name, preset);
                renderSnapshots(panel, preset, modal, viewMode);
            });
        }})
    );
    panel.appendChild(headerRow);

    const snaps = viewMode === 'local' ? SnapshotManager.list(preset.name) : SnapshotManager.list().filter(s => s.presetName !== preset.name);
    if (snaps.length === 0) {
        panel.appendChild(h('div', { class: 'zero-empty', text: viewMode === 'local' ? '当前预设暂无快照，点击上方按钮创建' : '没有来自其他预设的快照' }));
        return;
    }
    const frag = document.createDocumentFragment();
    snaps.forEach(snap => frag.appendChild(buildSnapCard(snap, preset, panel, modal, viewMode)));
    panel.appendChild(frag);
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
    const btnRow = h('div', { class: 'zero-snap-actions' },
        h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-check"></i> 应用', onclick: () => {
            if (isOther) {
                showConfirm(modal, `该快照属于预设「${snap.presetName}」。\n是否切换到该预设并应用快照？`, () => {
                    const contentEl = modal.querySelector('.zero-content');
                    if (contentEl) contentEl.innerHTML = '<div class="zero-loading" style="padding:20px;text-align:center;color:var(--SmartThemeBodyColor)"><i class="fa-solid fa-spinner fa-spin"></i><div>切换并应用中...</div></div>';
                    requestAnimationFrame(() => {
                        setTimeout(async () => {
                            try {
                                await PresetManager.switchPreset(snap.presetName);
                                await new Promise(r => requestAnimationFrame(r));
                                const nextPreset = await PresetManager.load();
                                await SnapshotManager.apply(snap, nextPreset);
                                const newList = await PresetManager.listNames();
                                modal.innerHTML = '';
                                buildModal(modal, nextPreset, newList);
                            } catch (e) { toastr.error('切换应用失败'); console.error(e); }
                        }, 10);
                    });
                });
            } else {
                showConfirm(modal, `应用快照「${snap.name}」?\n将切换条目开关状态`, async () => {
                    try {
                        await SnapshotManager.apply(snap, preset);
                        // Refresh cached preset so entries tab shows changes
                        const p = await PresetManager.load();
                        renderSnapshots(panel, p || preset, modal, viewMode);
                    } catch (e) { toastr.error('应用失败'); console.error(e); }
                });
            }
        }}),
        h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-pen"></i> 重命名', onclick: () => {
            showPrompt(modal, '新名称', snap.name, (n) => {
                SnapshotManager.rename(snap.id, n);
                renderSnapshots(panel, preset, modal, viewMode);
            });
        }})
    );
    if (!isOther) {
        btnRow.appendChild(h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-sync"></i> 覆盖', onclick: () => {
            showConfirm(modal, `用当前状态覆盖快照「${snap.name}」?`, () => {
                SnapshotManager.overwrite(snap.id, preset);
                renderSnapshots(panel, preset, modal, viewMode);
            });
        }}));
    }
    btnRow.appendChild(h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-trash"></i> 删除', onclick: () => {
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

        let entries = preset.prompts;
        if (filter === 'enabled') entries = entries.filter(p => p.enabled);
        else if (filter === 'disabled') entries = entries.filter(p => !p.enabled);
        if (groupFilter !== 'all') {
            const g = groups.find(x => x.id === groupFilter);
            if (g) entries = entries.filter(p => g.ids.includes(p.identifier));
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
