/**
 * Zero Preset Manager - UI
 * Performance-optimized v2: innerHTML templates, event delegation, lazy rendering.
 */
import { PresetManager, SnapshotManager, GroupManager, PinnedManager, HiddenManager, UiStateManager, LinkageManager, resolvePromptConstraints, zeroTranslate, HistoryManager, ModelProfileManager, SamplingParamsHelper, SnapshotGroupManager, getPresetPromptsWithEnabled, getStringSimilarity, detectPresetRenames, getOpenai, OpLogManager, StreamManager } from './state.js';
import { matchPrompt } from './search-util.js';
import { ThemeManager } from '../preset-manager/theme.js';

let overlay = null;
let pendingToggles = new Map();
let toggleTimer = null;
let _scrollSaveTimer = null;
let searchQuery = '';
let searchDebounceTimer = null;
let searchScopeName = true;
let searchScopeContent = true;
let presetManagerModule = null;
let editorModule = null;

// ─── Multi-select state ───
let msActive = false;
let msSelected = new Set();
let msBar = null;

let _promptMap = null;
let _groupMemberMap = null;
let _currentPreset = null;
let _currentModal = null;
let _currentPanels = null;

function markPanelsDirty(panels, exceptId = null) {
    const targetPanels = panels || _currentPanels;
    if (!targetPanels) return;
    Object.keys(targetPanels).forEach(id => {
        if (id !== exceptId && targetPanels[id]) {
            targetPanels[id]._dirty = true;
        }
    });
}

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
    // Instant local memory mutation on _currentPreset so UI state is immediately consistent
    if (_currentPreset && Array.isArray(_currentPreset.prompts)) {
        const p = _currentPreset.prompts.find(x => x.identifier === identifier || x.name === identifier);
        if (p) p.enabled = enabled;
    }
    clearTimeout(toggleTimer);
    toggleTimer = setTimeout(flushToggles, 120);
}

async function flushToggles() {
    if (pendingToggles.size === 0) return;
    const batch = new Map(pendingToggles);
    pendingToggles.clear();
    clearTimeout(toggleTimer);
    try {
        await PresetManager.batchToggleMap(batch, false, _currentPreset?.name);
    } catch (e) {
        console.error('[Zero] batch toggle failed:', e);
        toastr.error('切换失败');
    }
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
                h('button', { class: 'zero-btn', text: '取消', onclick: (e) => { e.stopPropagation(); box.remove(); } }),
                h('button', { class: 'zero-btn primary', text: '确认', onclick: (e) => { e.stopPropagation(); box.remove(); onYes(); } })
            )
        )
    );
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => {
        if (e.target === box) {
            e.stopPropagation();
            box.remove();
        }
    });
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
                h('button', { class: 'zero-btn', text: '取消', onclick: (e) => { e.stopPropagation(); box.remove(); } }),
                h('button', { class: 'zero-btn primary', text: '确认', onclick: (e) => { e.stopPropagation(); const v = input.value.trim(); if (v) { box.remove(); onOk(v); } } })
            )
        )
    );
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => {
        if (e.target === box) {
            e.stopPropagation();
            box.remove();
        }
    });
    modal.appendChild(box);
    setTimeout(() => input.focus(), 50);
}




// ═══════════════════════════════════════
//  HTML Templates (fast innerHTML)
// ═══════════════════════════════════════
function entryHTML(p, cachedActions = null, isPinned = false) {
    const id = esc(p.identifier);
    const name = esc(p.name || p.identifier);
    const actions = (Array.isArray(cachedActions) ? cachedActions : null) || UiStateManager.get().entryActions || ['pin', 'inject-var', 'folder', 'preview'];

    let actionBtnsHtml = '';
    if (actions.includes('pin')) {
        actionBtnsHtml += `<button class="zero-icon-btn zero-inline-action${isPinned ? ' pinned' : ''}" data-action="pin" title="${isPinned ? '取消组内置顶' : '组内置顶'}" style="${isPinned ? 'color: var(--SmartThemeQuoteColor);' : ''}"><i class="fa-solid fa-thumbtack"></i></button>`;
    }
    if (actions.includes('inject-var')) {
        actionBtnsHtml += `<button class="zero-icon-btn zero-inline-action" data-action="inject-var" title="注入变量包裹"><i class="fa-solid fa-code"></i></button>`;
    }
    if (actions.includes('folder')) {
        actionBtnsHtml += `<button class="zero-icon-btn zero-inline-action" data-action="folder" title="分组管理"><i class="fa-solid fa-folder-open"></i></button>`;
    }
    if (actions.includes('multi-select')) {
        actionBtnsHtml += `<button class="zero-icon-btn zero-inline-action" data-action="multi-select" title="多选模式"><i class="fa-solid fa-square-check"></i></button>`;
    }
    if (actions.includes('preview')) {
        actionBtnsHtml += `<button class="zero-icon-btn zero-inline-action" data-action="preview" title="预览"><i class="fa-solid fa-eye"></i></button>`;
    }
    if (actions.includes('edit')) {
        actionBtnsHtml += `<button class="zero-icon-btn zero-inline-action" data-action="edit" title="在编辑器中打开"><i class="fa-solid fa-pencil"></i></button>`;
    }

    return `<div class="zero-entry" data-id="${id}">` +
        `<div class="zero-sel-check"><i class="fa-solid fa-circle"></i></div>` +
        `<span class="zero-entry-name${p.enabled ? '' : ' disabled'}">${name}</span>` +
        `<div class="zero-entry-inline">` +
            actionBtnsHtml +
        `</div>` +
        `<label class="zero-switch"><input type="checkbox"${p.enabled ? ' checked' : ''}><span class="zero-slider"></span></label>` +
    `</div>`;
}

// pinnedSet: pre-computed Set<string> for the current preset — avoids one getSettings()
// call per member. Pass null to fall back to the legacy per-call path.
function renderGroupMembersHTML(members, cachedActions = null, presetName = null, pinnedSet = null) {
    const pName = presetName || _currentPreset?.name || '';
    const actions = (Array.isArray(cachedActions) ? cachedActions : null) || UiStateManager.get().entryActions || ['pin', 'inject-var', 'folder', 'preview'];
    
    const pinnedMembers = [];
    const normalMembers = [];
    if (pinnedSet) {
        // Fast path: use pre-computed set — O(1) per member, no settings read
        members.forEach(m => {
            if (PinnedManager.isPinnedInSet(pinnedSet, m)) pinnedMembers.push(m);
            else normalMembers.push(m);
        });
    } else {
        // Fallback: read pinned set fresh (only used when called from lazy-expand)
        const freshSet = PinnedManager.getSet(pName);
        members.forEach(m => {
            if (PinnedManager.isPinnedInSet(freshSet, m)) pinnedMembers.push(m);
            else normalMembers.push(m);
        });
    }
    const sortedMembers = [...pinnedMembers, ...normalMembers];

    return sortedMembers.map(m => entryHTML(m, actions, pinnedMembers.includes(m))).join('');
}

function groupSectionHTML(group, members, isUngrouped, cachedActions = null, presetName = null, pinnedSet = null) {
    const enabledCount = members.filter(p => p.enabled).length;
    const allOn = members.length > 0 && members.every(p => p.enabled);
    const collapsed = group.col;
    // Collapsed groups: always skip member render — lazy expand handles it in handleGroupCollapse.
    // This avoids building potentially hundreds of entry HTML strings that the user never sees.
    const bodyContent = collapsed ? '' : renderGroupMembersHTML(members, cachedActions, presetName, pinnedSet);
    
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
//  Modal Minimize & Restore & GPU Singleton Architecture
// ═══════════════════════════════════════
let modal = null;
let _isOpen = false;
let _isSnapshotDirty = true;
let _lastRenderedPresetName = null;
let _modalBuilt = false;
let _lastToggleTime = 0;
let lastSnapshotRestoreTime = 0;

export function markSnapshotDirty() {
    _isSnapshotDirty = true;
    _modalBuilt = false;
    if (_currentPanels) markPanelsDirty(_currentPanels);

    if (_isOpen && modal) {
        requestAnimationFrame(() => {
            if (_isOpen && modal) {
                syncModalDynamicState(modal);
            }
        });
    }
}

function getOffscreenTransform(state) {
    const isDesktop = window.innerWidth >= 800;
    const winMode = state?.snapshotWindowMode || 'fixed';
    const isDesktopWindow = isDesktop && winMode !== 'fixed';
    const modalStyle = state?.snapshotModalStyle || 'center';
    const animStyle = state?.snapshotModalAnimation || 'slide';

    if (animStyle === 'none') return 'none';
    if (animStyle === 'scale' || animStyle === 'fade') return 'scale(0.94)';

    if (isDesktopWindow) {
        if (winMode === 'docked_right') return 'translate3d(105%, 0, 0)';
        if (winMode === 'docked_left') return 'translate3d(-105%, 0, 0)';
        return 'translate3d(0, 20px, 0) scale(0.96)';
    } else {
        if (modalStyle === 'right') return 'translate3d(105%, 0, 0)';
        if (modalStyle === 'left') return 'translate3d(-105%, 0, 0)';
        if (modalStyle === 'top') return 'translate3d(0, -105%, 0)';
        if (modalStyle === 'bottom') return 'translate3d(0, 105%, 0)';
        return 'translate3d(0, 25px, 0) scale(0.94)';
    }
}

let _globalOutsideClickListener = null;

function enableClickOutside() {
    disableClickOutside();
    _globalOutsideClickListener = (e) => {
        if (!_isOpen || !modal) return;

        // Prevent immediate close on the same gesture that opened the modal (200ms grace window)
        if (Date.now() - _lastToggleTime < 200) return;

        // Floating window mode on desktop never closes on outside click
        const state = UiStateManager.get();
        const winMode = state?.snapshotWindowMode || 'fixed';
        const isDesktop = window.innerWidth >= 800;
        if (isDesktop && winMode === 'floating') {
            return;
        }

        const target = e.target;
        if (!target) return;

        // Check composedPath first (resilient against DOM removal in button click handlers)
        const path = e.composedPath ? e.composedPath() : [];
        if (path.includes(modal) || path.some(el => 
            el === modal ||
            el?.id === 'zero-modal' ||
            el?.id === 'zero-overlay' ||
            el?.id === 'zero-entry-context-menu-modal' ||
            el?.id === 'zero-quick-editor' ||
            el?.id === 'zero-op-log-modal' ||
            el?.id === 'zero-inject-var-modal' ||
            el?.id === 'zero-collect-modal' ||
            el?.classList?.contains?.('zero-modal') ||
            el?.classList?.contains?.('zero-modal-card') ||
            el?.classList?.contains?.('zero-confirm') ||
            el?.classList?.contains?.('zero-confirm-box') ||
            el?.classList?.contains?.('zero-preview-box') ||
            el?.classList?.contains?.('zero-menu-box') ||
            el?.classList?.contains?.('zero-group-mgr-box') ||
            el?.classList?.contains?.('zero-migration-box') ||
            el?.classList?.contains?.('zero-multiselect-bar')
        )) {
            return;
        }

        // Guard 1: If target is detached from document (e.g. removed by a close/delete handler), ignore
        if (!document.body.contains(target)) return;

        // Guard 2: If clicking inside the modal or header/content/buttons, ignore
        if (modal.contains(target) || modal === target) return;

        // Guard 3: If clicking on toastr or alert or menu button or minimized badge or confirm/preview box, ignore
        if (target.closest && (
            target.closest('#zero-modal') ||
            target.closest('.zero-modal') ||
            target.closest('.zero-modal-card') ||
            target.closest('#zero-preset-btn') ||
            target.closest('#zero-floating-ball') ||
            target.closest('#zero-snapshot-minimized-badge') ||
            target.closest('.zero-confirm') ||
            target.closest('.zero-confirm-box') ||
            target.closest('.zero-preview-box') ||
            target.closest('.zero-menu-box') ||
            target.closest('.zero-group-mgr-box') ||
            target.closest('.zero-migration-box') ||
            target.closest('.zero-multiselect-bar') ||
            target.closest('#zero-quick-editor') ||
            target.closest('#zero-op-log-modal') ||
            target.closest('#zero-inject-var-modal') ||
            target.closest('#zero-entry-context-menu-modal') ||
            target.closest('#toast-container')
        )) {
            return;
        }

        // Click is outside -> Close UI immediately
        closeUI();
    };

    document.addEventListener('pointerdown', _globalOutsideClickListener, true);
}

function disableClickOutside() {
    if (_globalOutsideClickListener) {
        document.removeEventListener('pointerdown', _globalOutsideClickListener, true);
        _globalOutsideClickListener = null;
    }
}

function applySnapshotModalGeometry(modalEl, overlayEl, state) {
    const modalStyle = state?.snapshotModalStyle || 'center';
    const scale = state?.snapshotModalScale || 80;
    const winMode = state?.snapshotWindowMode || 'fixed';
    const isDesktop = window.innerWidth >= 800;
    const isDesktopFloating = isDesktop && winMode === 'floating';

    const floatingPos = (() => {
        try {
            return JSON.parse(localStorage.getItem('zero_snapshot_floating_pos') || localStorage.getItem('zero_snapshot_modal_pos') || 'null');
        } catch {
            return null;
        }
    })();
    const dockRightWidth = state?.snapshotDockRightWidth || localStorage.getItem('zero_snapshot_dock_right_width') || '450px';
    const dockLeftWidth = state?.snapshotDockLeftWidth || localStorage.getItem('zero_snapshot_dock_left_width') || '450px';

    Object.assign(overlayEl.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100vw',
        height: '100vh',
        zIndex: '20000',
        background: 'transparent',
        backgroundColor: 'transparent',
        pointerEvents: 'none',
        display: 'flex',
        overflow: 'hidden'
    });
    modalEl.style.pointerEvents = 'auto';

    if (modalStyle === 'center') {
        overlayEl.style.alignItems = 'center';
        overlayEl.style.justifyContent = 'center';
    } else if (modalStyle === 'top') {
        overlayEl.style.alignItems = 'flex-start';
        overlayEl.style.justifyContent = 'center';
    } else if (modalStyle === 'bottom') {
        overlayEl.style.alignItems = 'flex-end';
        overlayEl.style.justifyContent = 'center';
    } else if (modalStyle === 'left') {
        overlayEl.style.alignItems = 'stretch';
        overlayEl.style.justifyContent = 'flex-start';
    } else if (modalStyle === 'right') {
        overlayEl.style.alignItems = 'stretch';
        overlayEl.style.justifyContent = 'flex-end';
    }

    if (isDesktop && winMode !== 'fixed') {
        if (winMode === 'floating') {
            const vw = window.innerWidth, vh = window.innerHeight;
            const w = Math.max(260, floatingPos?.w ?? Math.min(Math.round(vw * 0.9), 560));
            const hVal = Math.max(260, floatingPos?.h ?? Math.min(Math.round(vh * 0.85), 780));
            const l = Math.max(0, Math.min(floatingPos?.l ?? Math.round((vw - w) / 2), vw - 80));
            const t = Math.max(0, Math.min(floatingPos?.t ?? Math.round((vh - hVal) / 2), vh - 50));

            modalEl.style.position = 'fixed';
            modalEl.style.left = `${l}px`;
            modalEl.style.top = `${t}px`;
            modalEl.style.right = 'auto';
            modalEl.style.bottom = 'auto';
            modalEl.style.width = `${w}px`;
            modalEl.style.height = `${hVal}px`;
            modalEl.style.maxHeight = '98vh';
            modalEl.style.borderRadius = '14px';
            modalEl.style.margin = '0';
        } else if (winMode === 'docked_right') {
            modalEl.style.position = 'fixed';
            modalEl.style.top = '0';
            modalEl.style.left = 'auto';
            modalEl.style.right = '0';
            modalEl.style.bottom = 'auto';
            modalEl.style.width = dockRightWidth;
            modalEl.style.height = '100vh';
            modalEl.style.maxHeight = '100vh';
            modalEl.style.borderRadius = '0';
            modalEl.style.margin = '0';
        } else if (winMode === 'docked_left') {
            modalEl.style.position = 'fixed';
            modalEl.style.top = '0';
            modalEl.style.left = '0';
            modalEl.style.right = 'auto';
            modalEl.style.bottom = 'auto';
            modalEl.style.width = dockLeftWidth;
            modalEl.style.height = '100vh';
            modalEl.style.maxHeight = '100vh';
            modalEl.style.borderRadius = '0';
            modalEl.style.margin = '0';
        }
    } else {
        modalEl.style.position = 'relative';
        modalEl.style.left = 'auto';
        modalEl.style.top = 'auto';
        modalEl.style.right = 'auto';
        modalEl.style.bottom = 'auto';
        modalEl.style.margin = '0';

        if (modalStyle === 'center') {
            modalEl.style.width = '92%';
            modalEl.style.maxWidth = '520px';
            modalEl.style.height = `${scale}vh`;
            modalEl.style.maxHeight = '90vh';
            modalEl.style.borderRadius = '14px';
        } else if (modalStyle === 'top') {
            modalEl.style.width = '100%';
            modalEl.style.maxWidth = '600px';
            modalEl.style.height = `${scale}vh`;
            modalEl.style.maxHeight = '100vh';
            modalEl.style.borderRadius = '0 0 14px 14px';
        } else if (modalStyle === 'bottom') {
            modalEl.style.width = '100%';
            modalEl.style.maxWidth = '600px';
            modalEl.style.height = `${scale}vh`;
            modalEl.style.maxHeight = '100vh';
            modalEl.style.borderRadius = '14px 14px 0 0';
        } else if (modalStyle === 'left') {
            modalEl.style.width = `${scale}vw`;
            modalEl.style.maxWidth = '100vw';
            modalEl.style.height = '100vh';
            modalEl.style.maxHeight = '100vh';
            modalEl.style.borderRadius = '0 14px 14px 0';
        } else if (modalStyle === 'right') {
            modalEl.style.width = `${scale}vw`;
            modalEl.style.maxWidth = '100vw';
            modalEl.style.height = '100vh';
            modalEl.style.maxHeight = '100vh';
            modalEl.style.borderRadius = '14px 0 0 14px';
        }
    }
}

export function initSnapshotUI() {
    if (!overlay || !document.body.contains(overlay)) {
        let existingOverlay = document.getElementById('zero-overlay');
        if (existingOverlay) existingOverlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'zero-overlay';
        overlay.className = 'zero-overlay';

        overlay.addEventListener('click', (e) => {
            if (Date.now() - lastSnapshotRestoreTime < 350) return;
            if (e.target === overlay) {
                closeUI();
            }
        });

        modal = document.createElement('div');
        modal.id = 'zero-modal';
        modal.className = 'zero-modal zero-modal-card';
        overlay.appendChild(modal);

        const state = UiStateManager.get();
        applySnapshotModalGeometry(modal, overlay, state);
        modal.style.transform = getOffscreenTransform(state);
        overlay.style.display = 'none';
        overlay.style.visibility = 'hidden';
        modal.style.visibility = 'hidden';

        document.body.appendChild(overlay);
    }
    return { overlay, modal };
}

export function minimizeSnapshotUI() {
    UiStateManager.save({ snapshotIsMinimized: true });
    closeUI();

    import('../preset-manager/floating-ball.js').then(({ FloatingBall }) => {
        FloatingBall.show('snapshot', () => restoreSnapshotUI());
    }).catch(() => {});
}

export function restoreSnapshotUI() {
    lastSnapshotRestoreTime = Date.now();
    UiStateManager.save({ snapshotIsMinimized: false });
    import('../preset-manager/floating-ball.js').then(({ FloatingBall }) => {
        FloatingBall.hide('snapshot');
    }).catch(() => {});
    openUI();
}

export async function openUI() {
    const now = Date.now();
    if (now - _lastToggleTime < 150) return;
    _lastToggleTime = now;

    lastSnapshotRestoreTime = now;
    ThemeManager.applyTheme();

    searchQuery = '';
    searchScopeName = true;
    searchScopeContent = true;
    if (searchDebounceTimer) {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = null;
    }

    // Background preload modules
    import('../preset-manager/main.js').then(m => { presetManagerModule = m; }).catch(() => {});
    import('../preset-manager/editor.js').then(m => { editorModule = m; }).catch(() => {});
    import('../preset-manager/utils.js').catch(() => {});

    UiStateManager.save({ snapshotIsMinimized: false });
    import('../preset-manager/floating-ball.js').then(({ FloatingBall }) => {
        FloatingBall.hide('snapshot');
    }).catch(() => {});

    const { overlay: ov, modal: mo } = initSnapshotUI();
    const state = UiStateManager.get();
    applySnapshotModalGeometry(mo, ov, state);

    const isDesktop = window.innerWidth >= 800;
    const isDesktopFloating = isDesktop && state.snapshotWindowMode === 'floating';

    // ── STEP 1: 0ms Instant GPU Entrance (Compositor Thread, Zero JANK) ──
    _isOpen = true;
    ov.style.display = 'flex';
    ov.classList.add('open');
    mo.classList.add('open');
    ov.style.visibility = 'visible';
    mo.style.visibility = 'visible';
    mo.style.transform = 'translate3d(0, 0, 0) scale(1)';
    mo.style.opacity = '1';
    ov.style.opacity = '1';
    ov.style.background = 'transparent';
    ov.style.backgroundColor = 'transparent';
    ov.style.pointerEvents = 'none';
    mo.style.pointerEvents = 'auto';
    enableClickOutside();

    // ── STEP 2: Async Data Populating & Dirty Checking in requestAnimationFrame ──
    requestAnimationFrame(async () => {
        try {
            PresetManager.invalidate();
            let preset = PresetManager.loadSync();
            let listInfo = PresetManager.listNamesSync();
            if (!preset) {
                const res = await Promise.all([PresetManager.load(), PresetManager.listNames()]);
                preset = res[0];
                listInfo = res[1];
            }
            if (!preset) {
                toastr.error('无法加载预设');
                closeUI();
                return;
            }

            const activePresetName = preset.name;
            const needsFullRebuild = !_modalBuilt || _isSnapshotDirty || (_lastRenderedPresetName && activePresetName && _lastRenderedPresetName !== activePresetName);

            if (needsFullRebuild) {
                mo.innerHTML = '';
                buildModal(mo, preset, listInfo);
                _modalBuilt = true;
                _isSnapshotDirty = false;
                _lastRenderedPresetName = preset.name;
            } else {
                syncModalDynamicState(mo, listInfo);
            }

            detectPresetRenames().catch(e => console.warn('[Zero] detectPresetRenames background check:', e));
        } catch (e) {
            console.error('[Zero] openUI RAF error:', e);
            toastr.error('加载预设失败');
            closeUI();
        }
    });
}

function syncModalDynamicState(modalEl, listInfo) {
    if (!modalEl) return;
    const freshList = listInfo || PresetManager.listNamesSync();
    const filteredNames = (freshList.names || []).filter(n => !n.startsWith('★'));
    const select = modalEl.querySelector('.zero-preset-select');
    const activeNativeName = freshList.active || (() => {
        const nativeSelect = document.getElementById('settings_preset_openai');
        return (nativeSelect && nativeSelect.selectedIndex >= 0) ? nativeSelect.options[nativeSelect.selectedIndex].textContent.trim() : null;
    })();

    if (select) {
        const currentOpts = Array.from(select.options).map(o => o.value);
        const isListChanged = currentOpts.length !== filteredNames.length || currentOpts.some((val, idx) => val !== filteredNames[idx]);

        if (isListChanged) {
            select.innerHTML = '';
            filteredNames.forEach(n => {
                const opt = document.createElement('option');
                opt.value = n;
                opt.textContent = n;
                if (n === activeNativeName) opt.selected = true;
                select.appendChild(opt);
            });
        } else if (activeNativeName && select.value !== activeNativeName) {
            select.value = activeNativeName;
        }
    }
    const streamBtn = modalEl.querySelector('.zero-stream-btn');
    if (streamBtn) {
        const isStreamOn = StreamManager.isStreamEnabled();
        streamBtn.classList.toggle('active', isStreamOn);
        streamBtn.title = isStreamOn ? '流式输出: 已开启 (点击切换为非流式)' : '流式输出: 已关闭 (点击开启流式)';
    }
}

export function toggleUI(forceState) {
    const isCurrentlyOpen = _isOpen && overlay && overlay.classList.contains('open');
    const targetState = typeof forceState === 'boolean' ? forceState : !isCurrentlyOpen;
    if (targetState) {
        openUI();
    } else {
        closeUI();
    }
}

export function closeUI() {
    disableClickOutside();
    const now = Date.now();
    if (now - _lastToggleTime < 150 && !_isOpen) return;
    _lastToggleTime = now;

    if (pendingToggles.size > 0) {
        const batch = new Map(pendingToggles);
        pendingToggles.clear();
        clearTimeout(toggleTimer);
        PresetManager.batchToggleMap(batch, false, _currentPreset?.name).catch(e => console.error('[Zero] closeUI batchToggleMap error:', e));
    }
    PresetManager.flushNativeRender();
    if (msActive) exitMultiSelect();

    if (overlay && modal) {
        // Save scroll position before closing
        const content = modal.querySelector('.zero-content');
        if (content) {
            const activeTab = UiStateManager.get().activeTab || 'entries';
            UiStateManager.saveScrollPos(activeTab, content.scrollTop);
            SillyTavern.getContext().saveSettingsDebounced();
        }

        const state = UiStateManager.get();
        const winMode = state.snapshotWindowMode || 'fixed';
        if (modal && window.innerWidth >= 800 && winMode === 'floating') {
            const r = modal.getBoundingClientRect();
            try {
                localStorage.setItem('zero_snapshot_floating_pos', JSON.stringify({
                    l: Math.round(r.left),
                    t: Math.round(r.top),
                    w: Math.round(r.width),
                    h: Math.round(r.height)
                }));
            } catch (e) {}
        }

        // ── GPU exit transition (Instant and persistent, never destroys DOM) ──
        _isOpen = false;
        overlay.classList.remove('open');
        modal.classList.remove('open');
        overlay.style.pointerEvents = 'none';
        modal.style.pointerEvents = 'none';

        const offscreenTransform = getOffscreenTransform(state);
        modal.style.transform = offscreenTransform;
        modal.style.opacity = '0';
        overlay.style.opacity = '0';

        setTimeout(() => {
            if (!_isOpen && overlay && modal) {
                overlay.style.visibility = 'hidden';
                modal.style.visibility = 'hidden';
                overlay.style.display = 'none';
            }
        }, 240);
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
    select.addEventListener('change', async () => {
        const name = select.value;
        select.disabled = true;
        const contentEl = modal.querySelector('.zero-content');
        if (contentEl) {
            contentEl.style.opacity = '0.5';
            contentEl.style.pointerEvents = 'none';
        }
        try {
            await PresetManager.switchPreset(name);
            PresetManager.invalidate();
            const newPreset = await PresetManager.load();
            const freshList = PresetManager.listNamesSync();
            if (newPreset) {
                modal.innerHTML = '';
                buildModal(modal, newPreset, freshList);
                _modalBuilt = true;
                _isSnapshotDirty = false;
                _lastRenderedPresetName = newPreset.name;
            }
        } catch (err) {
            console.error('[Zero] preset switch failed:', err);
            if (contentEl) {
                contentEl.style.opacity = '1';
                contentEl.style.pointerEvents = '';
            }
            select.disabled = false;
        }
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
        markPanelsDirty(panels, activeTabId);
        renderTab(activeTabId, activePanel, freshPreset, modal, true);
    }

    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            triggerSearch(searchInput.value);
        }, 300);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            collapseSearch();
        }
    });

    const header = h('div', { class: 'zero-header' });
    import('../preset-manager/window.js').then(({ WindowManager }) => {
        const winMode = UiStateManager.get().snapshotWindowMode || 'fixed';
        if (window.innerWidth >= 800 && winMode === 'floating') {
            WindowManager.makeOverlayDraggable(modal, header, () => {
                if (modal) {
                    const r = modal.getBoundingClientRect();
                    try {
                        localStorage.setItem('zero_snapshot_floating_pos', JSON.stringify({
                            l: Math.round(r.left),
                            t: Math.round(r.top),
                            w: Math.round(r.width),
                            h: Math.round(r.height)
                        }));
                    } catch (e) {}
                }
            });
        } else if (window.innerWidth >= 800 && winMode === 'docked_right') {
            WindowManager.initDockResizer(modal, 'docked_right', (widthStr) => {
                UiStateManager.save({ snapshotDockRightWidth: widthStr });
                try { localStorage.setItem('zero_snapshot_dock_right_width', widthStr); } catch (e) {}
            });
        } else if (window.innerWidth >= 800 && winMode === 'docked_left') {
            WindowManager.initDockResizer(modal, 'docked_left', (widthStr) => {
                UiStateManager.save({ snapshotDockLeftWidth: widthStr });
                try { localStorage.setItem('zero_snapshot_dock_left_width', widthStr); } catch (e) {}
            });
        }
    }).catch(() => {});
    const isOpLogEnabled = UiStateManager.get().enablePresetOpLog !== false;
    const windowState = UiStateManager.get().windowState || {};
    const showWinModeBtn = windowState.showWinModeBtn !== false && UiStateManager.get().showWinModeBtn !== false;
    const showWinMinimizeBtn = windowState.showWinMinimizeBtn !== false && UiStateManager.get().showWinMinimizeBtn !== false;

    const headerChildren = [
        select
    ];

    if (window.innerWidth >= 800 && showWinModeBtn) {
        const curWinMode = UiStateManager.get().snapshotWindowMode || 'fixed';
        const winModeIcons = {
            fixed: '<i class="fa-solid fa-expand"></i>',
            floating: '<i class="fa-solid fa-window-restore"></i>',
            docked_right: '<i class="fa-solid fa-table-columns"></i>',
            docked_left: '<i class="fa-solid fa-table-columns fa-flip-horizontal"></i>'
        };
        const winModeTitles = {
            fixed: '当前: 固定配置模式 (点击切换为桌面悬浮窗)',
            floating: '当前: 桌面悬浮窗 (点击切换为右侧停靠)',
            docked_right: '当前: 右侧停靠 (点击切换为左侧停靠)',
            docked_left: '当前: 左侧停靠 (点击切换为固定配置模式)'
        };
        headerChildren.push(h('button', {
            class: 'zero-snapshot-win-mode-btn interactable',
            title: winModeTitles[curWinMode] || winModeTitles.fixed,
            html: winModeIcons[curWinMode] || winModeIcons.fixed,
            onclick: () => {
                const modeOrder = ['fixed', 'floating', 'docked_right', 'docked_left'];
                const curIdx = modeOrder.indexOf(curWinMode);
                const nextMode = modeOrder[(curIdx + 1) % modeOrder.length];
                UiStateManager.save({ snapshotWindowMode: nextMode });
                const modeNames = {
                    fixed: '固定原生模式',
                    floating: '桌面悬浮窗模式',
                    docked_right: '右侧停靠模式',
                    docked_left: '左侧停靠模式'
                };
                _lastToggleTime = 0;
                closeUI();
                setTimeout(() => {
                    _lastToggleTime = 0;
                    openUI();
                }, 40);
            }
        }));
    }

    if (showWinMinimizeBtn) {
        headerChildren.push(h('button', {
            class: 'zero-snapshot-min-btn interactable',
            title: '最小化为快照胶囊浮窗',
            html: '<i class="fa-solid fa-minus"></i>',
            onclick: () => {
                minimizeSnapshotUI();
            }
        }));
    }
    if (isOpLogEnabled) {
        headerChildren.push(h('button', {
            class: 'zero-op-log-btn',
            title: '查看预设操作日志 (最新20条)',
            html: '<i class="fa-solid fa-clock-rotate-left"></i>',
            onclick: () => openOpLogModal((select && select.value) ? select.value : preset.name)
        }));
    }

    // ─── Stream Toggle Button ───
    const showStreamBtn = UiStateManager.get().showStreamBtn !== false;
    if (showStreamBtn) {
        const isStreamOn = StreamManager.isStreamEnabled();
        const streamBtn = h('button', {
            class: `zero-stream-btn interactable ${isStreamOn ? 'active' : ''}`,
            title: isStreamOn ? '流式输出: 已开启 (点击切换为非流式)' : '流式输出: 已关闭 (点击开启流式)',
            html: '<i class="fa-solid fa-bars-staggered"></i>',
            onclick: async (e) => {
                const btn = e.currentTarget;
                const newState = await StreamManager.setStreamEnabled();
                updateStreamBtnState(btn, newState);
            }
        });

        function updateStreamBtnState(btn, active) {
            if (!btn) return;
            if (active) {
                btn.classList.add('active');
                btn.title = '流式输出: 已开启 (点击切换为非流式)';
            } else {
                btn.classList.remove('active');
                btn.title = '流式输出: 已关闭 (点击开启流式)';
            }
        }

        const streamSyncListener = (e) => {
            if (e.target && (e.target.id === 'stream_toggle' || e.target.id === 'streaming_textgenerationwebui' || e.target.id === 'streaming_kobold' || e.target.id === 'streaming_novel')) {
                updateStreamBtnState(streamBtn, StreamManager.isStreamEnabled());
            }
        };
        document.addEventListener('change', streamSyncListener);

        headerChildren.push(streamBtn);
    }

    headerChildren.push(
        h('button', {
            class: 'zero-manage-btn',
            title: '打开预设管理',
            html: '<i class="fa-solid fa-list-ul"></i>',
            onclick: () => {
                if (overlay) overlay.style.display = 'none';
                const openPanel = () => {
                    if (presetManagerModule) {
                        presetManagerModule.showPanel();
                    } else {
                        import('../preset-manager/main.js').then(m => {
                            presetManagerModule = m;
                            m.showPanel();
                        });
                    }
                    setTimeout(() => {
                        closeUI();
                    }, 500);
                };
                openPanel();
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
    );
    headerChildren.forEach(c => header.appendChild(c));
    modal.appendChild(header);

    const tabs = [
        { id: 'entries', icon: 'fa-list', label: '条目' },
        { id: 'snapshots', icon: 'fa-camera-retro', label: '快照' },
        { id: 'editor', icon: 'fa-sliders', label: '编辑' }
    ];
    const tabBar = h('div', { class: 'zero-tabs' });
    const content = h('div', { class: 'zero-content' });
    const panels = {};
    _currentPanels = panels;
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

                // Switch panels instantly via CSS class
                Object.values(panels).forEach(p => p.classList.remove('active'));
                const targetPanel = panels[t.id];
                targetPanel.classList.add('active');

                // Instant switch: only render if target tab is not yet rendered or marked dirty
                const freshPreset = PresetManager.cached() || preset;
                renderTab(t.id, targetPanel, freshPreset, modal);

                // Update scroll tracking and restore position
                setupScrollTracking(content, t.id);
                restoreScrollPos(content, t.id);
            }
        });
        tabBar.appendChild(tab);
    });
    modal.appendChild(tabBar);
    modal.appendChild(content);
    // Initial render: only render the active tab immediately to maximize opening speed; defer other tabs until clicked
    renderTab(initialTab, panels[initialTab], preset, modal);
    tabs.forEach(t => {
        if (t.id !== initialTab) {
            panels[t.id]._rendered = false;
            panels[t.id]._dirty = true;
        }
    });
    setupScrollTracking(content, initialTab);
    restoreScrollPos(content, initialTab);
    setupSwipeGestures(modal, overlay, tabBar, content, panels, preset);
}

function setupSwipeGestures(modalEl, overlayEl, tabBarEl, contentEl, panels, preset) {
    if (!modalEl) return;
    modalEl.querySelector('.zero-swipe-handle')?.remove();
    const state = UiStateManager.get();
    if (state.enableSwipeGestures === false) {
        return;
    }

    // Touch support check
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 800;
    if (!hasTouch) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let isTracking = false;
    let isDraggingDismiss = false;
    let isSwipingTabs = false;
    let gestureDirection = null;
    let canPullDown = false;
    let initialScrollTop = 0;

    const modalStyle = state?.snapshotModalStyle || 'center';

    const getDismissDirection = () => {
        if (modalStyle === 'left') return 'left';
        if (modalStyle === 'right') return 'right';
        if (modalStyle === 'top') return 'top';
        return 'bottom'; // center and bottom dismiss downwards
    };

    const dismissDir = getDismissDirection();

    // Helper: find closest scrollable container
    const findScrollParent = (startNode, boundary) => {
        let node = startNode;
        while (node && node !== boundary && node !== document.body) {
            if (node.scrollHeight > node.clientHeight + 2) {
                const style = window.getComputedStyle(node);
                const overflowY = style.overflowY;
                if (overflowY === 'auto' || overflowY === 'scroll') {
                    return node;
                }
            }
            node = node.parentElement;
        }
        return null;
    };

    // Helper: switch to tab dynamically by relative offset (-1 or +1)
    const switchTabRelative = (offset) => {
        const tabs = Array.from(tabBarEl?.querySelectorAll('.zero-tab') || []).filter(el => el.offsetParent !== null);
        const activeTab = tabBarEl?.querySelector('.zero-tab.active');
        const curIdx = tabs.indexOf(activeTab);
        if (curIdx === -1) return;
        const nextIdx = curIdx + offset;
        if (nextIdx >= 0 && nextIdx < tabs.length) {
            tabs[nextIdx].click();
            if (navigator.vibrate) {
                try { navigator.vibrate(12); } catch (e) {}
            }
        } else {
            if (navigator.vibrate) {
                try { navigator.vibrate(5); } catch (e) {}
            }
        }
    };

    let activeScrollParent = null;

    const onTouchStart = (e) => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        const target = e.target;

        // Skip gesture if user is touching interactive inputs, sliders, or popups
        if (target.closest && target.closest('input, textarea, select, .zero-switch, .zero-slider, .zero-input, .zero-icon-btn, .zero-btn, .zero-range, .zero-group-mgr-drag, .dragging, .zero-confirm, .zero-preview-box')) {
            return;
        }

        // On desktop floating window mode, header drag is reserved for repositioning
        if (window.innerWidth >= 800 && state.snapshotWindowMode === 'floating') {
            return;
        }

        startX = t.clientX;
        startY = t.clientY;
        startTime = Date.now();
        isTracking = true;
        isDraggingDismiss = false;
        isSwipingTabs = false;
        gestureDirection = null;

        activeScrollParent = findScrollParent(target, contentEl || modalEl);
        initialScrollTop = activeScrollParent ? activeScrollParent.scrollTop : (contentEl ? contentEl.scrollTop : 0);
        const isOnHandleOrHeader = !!(target.closest && target.closest('.zero-header, .zero-tabs'));
        canPullDown = isOnHandleOrHeader || (initialScrollTop <= 2);
    };

    const onTouchMove = (e) => {
        if (!isTracking || e.touches.length !== 1) return;
        const t = e.touches[0];
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;

        if (!gestureDirection) {
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);
            if (absX < 8 && absY < 8) return;

            if (dismissDir === 'bottom' || dismissDir === 'top') {
                if (absY > absX) {
                    if (activeScrollParent && activeScrollParent.scrollTop > 2) {
                        canPullDown = false;
                    }
                    // Vertical movement
                    if ((dismissDir === 'bottom' && dy > 0 && canPullDown) || (dismissDir === 'top' && dy < 0 && canPullDown)) {
                        gestureDirection = 'vertical';
                        isDraggingDismiss = true;
                    } else {
                        // Regular scrolling inside content
                        isTracking = false;
                        return;
                    }
                } else if (absX > absY * 1.3) {
                    // Horizontal movement -> tab switch swipe
                    gestureDirection = 'horizontal';
                    isSwipingTabs = true;
                }
            } else if (dismissDir === 'left' || dismissDir === 'right') {
                if (absX > absY) {
                    if ((dismissDir === 'left' && dx < 0) || (dismissDir === 'right' && dx > 0)) {
                        gestureDirection = 'horizontal-dismiss';
                        isDraggingDismiss = true;
                    }
                }
            }
        }

        if (isDraggingDismiss) {
            if (e.cancelable) e.preventDefault();
            modalEl.style.transition = 'none';

            const damped = (val) => val <= 80 ? val : 80 + Math.pow(val - 80, 0.85) * 1.5;

            if (dismissDir === 'bottom') {
                const translateY = Math.max(0, dy);
                const dampedY = damped(translateY);
                modalEl.style.transform = `translate3d(0, ${dampedY}px, 0)`;
                if (overlayEl) overlayEl.style.opacity = Math.max(0.2, 1 - dampedY / 400).toString();
            } else if (dismissDir === 'top') {
                const translateY = Math.min(0, dy);
                const dampedY = -damped(Math.abs(translateY));
                modalEl.style.transform = `translate3d(0, ${dampedY}px, 0)`;
                if (overlayEl) overlayEl.style.opacity = Math.max(0.2, 1 - Math.abs(dampedY) / 400).toString();
            } else if (dismissDir === 'right') {
                const translateX = Math.max(0, dx);
                const dampedX = damped(translateX);
                modalEl.style.transform = `translate3d(${dampedX}px, 0, 0)`;
                if (overlayEl) overlayEl.style.opacity = Math.max(0.2, 1 - dampedX / 400).toString();
            } else if (dismissDir === 'left') {
                const translateX = Math.min(0, dx);
                const dampedX = -damped(Math.abs(translateX));
                modalEl.style.transform = `translate3d(${dampedX}px, 0, 0)`;
                if (overlayEl) overlayEl.style.opacity = Math.max(0.2, 1 - Math.abs(dampedX) / 400).toString();
            }
        } else if (isSwipingTabs) {
            if (e.cancelable) e.preventDefault();
        }
    };

    const onTouchEnd = (e) => {
        if (!isTracking) return;
        isTracking = false;
        const elapsed = Math.max(1, Date.now() - startTime);

        if (isDraggingDismiss) {
            modalEl.style.transition = 'transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease';
            if (overlayEl) overlayEl.style.transition = 'opacity 0.2s ease';

            const t = e.changedTouches ? e.changedTouches[0] : null;
            const dx = t ? t.clientX - startX : 0;
            const dy = t ? t.clientY - startY : 0;

            let shouldDismiss = false;
            if (dismissDir === 'bottom') {
                const velocity = dy / elapsed;
                shouldDismiss = dy > 90 || (dy > 40 && velocity > 0.45);
            } else if (dismissDir === 'top') {
                const velocity = -dy / elapsed;
                shouldDismiss = dy < -90 || (dy < -40 && velocity > 0.45);
            } else if (dismissDir === 'right') {
                const velocity = dx / elapsed;
                shouldDismiss = dx > 80 || (dx > 35 && velocity > 0.45);
            } else if (dismissDir === 'left') {
                const velocity = -dx / elapsed;
                shouldDismiss = dx < -80 || (dx < -35 && velocity > 0.45);
            }

            if (shouldDismiss) {
                closeUI();
                setTimeout(() => {
                    modalEl.style.transition = '';
                    if (overlayEl) overlayEl.style.transition = '';
                }, 240);
            } else {
                modalEl.style.transform = 'translate3d(0, 0, 0)';
                if (overlayEl) overlayEl.style.opacity = '1';
                setTimeout(() => {
                    modalEl.style.transition = '';
                    if (overlayEl) overlayEl.style.transition = '';
                }, 240);
            }
            isDraggingDismiss = false;
        } else if (isSwipingTabs) {
            const t = e.changedTouches ? e.changedTouches[0] : null;
            const dx = t ? t.clientX - startX : 0;
            const dy = t ? t.clientY - startY : 0;
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);

            if (absX > 45 && absX > absY * 1.4 && elapsed < 600) {
                if (dx < -45) {
                    // Swiped left -> Next tab
                    switchTabRelative(1);
                } else if (dx > 45) {
                    // Swiped right -> Previous tab
                    switchTabRelative(-1);
                }
            }
            isSwipingTabs = false;
        }
    };

    if (modalEl._zeroSwipeTouchStart) {
        modalEl.removeEventListener('touchstart', modalEl._zeroSwipeTouchStart);
        modalEl.removeEventListener('touchmove', modalEl._zeroSwipeTouchMove);
        modalEl.removeEventListener('touchend', modalEl._zeroSwipeTouchEnd);
        modalEl.removeEventListener('touchcancel', modalEl._zeroSwipeTouchEnd);
    }

    modalEl._zeroSwipeTouchStart = onTouchStart;
    modalEl._zeroSwipeTouchMove = onTouchMove;
    modalEl._zeroSwipeTouchEnd = onTouchEnd;

    modalEl.addEventListener('touchstart', onTouchStart, { passive: true });
    modalEl.addEventListener('touchmove', onTouchMove, { passive: false });
    modalEl.addEventListener('touchend', onTouchEnd, { passive: true });
    modalEl.addEventListener('touchcancel', onTouchEnd, { passive: true });
}

function renderTab(id, panel, preset, modal, force = false) {
    const searchWrap = modal?.querySelector('.zero-search-wrap');
    if (searchWrap) {
        searchWrap.classList.toggle('hide-options', id === 'snapshots');
    }
    // Instant switch: skip DOM destruction & re-rendering if already rendered and clean
    if (!force && panel._rendered && !panel._dirty) {
        return;
    }
    panel.innerHTML = '';
    if (id === 'entries') renderEntries(panel, preset, modal);
    else if (id === 'snapshots') {
        const viewMode = UiStateManager.get().snapshotViewMode || 'local';
        renderSnapshots(panel, preset, modal, viewMode);
    }
    else if (id === 'editor') renderEditor(panel, preset, modal);

    panel._rendered = true;
    panel._dirty = false;
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

    _promptMap = new Map();
    preset.prompts.forEach(p => {
        if (p.identifier !== undefined && p.identifier !== null) {
            _promptMap.set(String(p.identifier), p);
            _promptMap.set(p.identifier, p);
        }
        if (p.name) _promptMap.set(String(p.name), p);
    });
    _groupMemberMap = new Map();

    // Toolbar (small, keep createElement)
    panel.appendChild(h('div', { class: 'zero-toolbar' },
        h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-folder"></i> 分组', onclick: () => showGroupManager(panel, preset, modal) }),
        h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-eye-slash"></i> 隐藏', onclick: () => showHiddenManager(panel, preset, modal) }),
        h('button', { class: 'zero-btn', html: '<i class="fa-solid fa-link"></i> 联动', onclick: () => showLinkageManager(panel, preset, modal) })
    ));

    const query = searchQuery ? searchQuery.trim().toLowerCase() : '';
    const cachedActions = UiStateManager.get().entryActions || ['inject-var', 'folder', 'preview'];
    // Pre-compute pinned set once for this entire render pass — avoids one
    // getSettings() + new Set() call per entry (O(n) → O(1) per member).
    const pinnedSet = PinnedManager.getSet(pName);

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
            html += groupSectionHTML(g, members, false, cachedActions, pName, pinnedSet);
        }
    });

    let filteredUngrouped = ungrouped;
    if (query) {
        filteredUngrouped = ungrouped.filter(p => matchPrompt(p, searchQuery, searchScopeName, searchScopeContent));
    }

    if (filteredUngrouped.length > 0) {
        const ugId = '__ungrouped';
        _groupMemberMap.set(ugId, filteredUngrouped);
        html += groupSectionHTML({ id: ugId, name: '未分组', col: UiStateManager.get().ungroupedCol }, filteredUngrouped, true, cachedActions, pName, pinnedSet);
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
            const p = _promptMap.get(id) || _promptMap.get(String(id));
            if (p) {
                const targetEnabled = cb.checked;
                const resolvedMap = resolvePromptConstraints(_currentPreset?.name, new Map([[id, targetEnabled]]), _promptMap);

                resolvedMap.forEach((en, resId) => {
                    const resP = _promptMap.get(resId);
                    if (resP) resP.enabled = en;

                    const entryEl = _currentModal?.querySelector(`.zero-entry[data-id="${esc(resId)}"]`);
                    if (entryEl) {
                        const switchCb = entryEl.querySelector('.zero-switch input');
                        if (switchCb) switchCb.checked = en;
                        entryEl.querySelector('.zero-entry-name')?.classList.toggle('disabled', !en);
                        updateGroupCount(entryEl.closest('.zero-group'));
                    }
                });

                updateGroupCount(entry.closest('.zero-group'));

                PresetManager.batchToggleMap(resolvedMap).catch(e => {
                    console.error('[Zero] batch toggle failed:', e);
                    toastr.error('切换失败');
                });
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
            if (action.dataset.action === 'pin') {
                PinnedManager.togglePin(_currentPreset.name, id);
                renderEntries(panel, _currentPreset, _currentModal);
            } else if (action.dataset.action === 'folder') {
                const groups = GroupManager.get(_currentPreset.name);
                if (groups.length === 0) { toastr.info('请先在「分组管理」中创建分组'); return; }
                const groupEl = entry.closest('.zero-group');
                const gid = groupEl?.dataset.gid;
                const isUngrouped = groupEl?.dataset.ungrouped === 'true';
                const currentGroup = isUngrouped ? { id: gid } : (groups.find(g => g.id === gid) || { id: gid });
                showGroupAssignMenu(_currentModal, panel, _currentPreset, prompt, currentGroup, isUngrouped);
            } else if (action.dataset.action === 'preview') {
                showContentPreview(_currentModal, prompt);
            } else if (action.dataset.action === 'inject-var') {
                import('../preset-manager/utils.js').then(m => {
                    m.showInjectVariableModal(prompt, _currentPreset.name, (freshPreset) => {
                        renderModalContent(_currentModal, freshPreset || _currentPreset);
                    });
                });
            } else if (action.dataset.action === 'multi-select') {
                enterMultiSelect(panel, _currentPreset, _currentModal, id);
                entry.classList.add('selected');
                const ic = entry.querySelector('.zero-sel-check');
                if (ic) ic.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
            } else if (action.dataset.action === 'edit') {
                const pIdx = _currentPreset?.prompts ? _currentPreset.prompts.indexOf(prompt) : -1;
                if (editorModule) {
                    editorModule.openQuickEditor(_currentPreset.name, prompt.name || prompt.identifier, prompt.identifier, pIdx >= 0 ? pIdx : undefined);
                } else {
                    import('../preset-manager/editor.js').then(m => {
                        editorModule = m;
                        m.openQuickEditor(_currentPreset.name, prompt.name || prompt.identifier, prompt.identifier, pIdx >= 0 ? pIdx : undefined);
                    });
                }
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
            const prompt = _promptMap.get(id);
            if (!msActive && prompt) {
                showEntryContextMenu(panel, entry, prompt);
            } else if (msActive) {
                toggleEntrySelection(id, entry, entry.querySelector('.zero-sel-check'));
            }
        }
    });

    // Long-press for entry actions
    let lpTimer = null, lpCancelled = false;
    panel.addEventListener('touchstart', (e) => {
        const entry = e.target.closest('.zero-entry');
        if (!entry || msActive) return;
        if (e.target.closest('.zero-switch') || e.target.closest('.zero-inline-action')) return;
        lpCancelled = false;
        lpTimer = setTimeout(() => {
            if (!lpCancelled) {
                const id = entry.dataset.id;
                const prompt = _promptMap.get(id);
                if (prompt) {
                    showEntryContextMenu(panel, entry, prompt);
                }
                if (navigator.vibrate) navigator.vibrate(15);
            }
        }, 450);
    }, { passive: true });
    panel.addEventListener('touchmove', () => { lpCancelled = true; clearTimeout(lpTimer); }, { passive: true });
    panel.addEventListener('touchend', () => clearTimeout(lpTimer));
}

function showEntryContextMenu(panel, entry, prompt) {
    const modalId = 'zero-entry-context-menu-modal';
    $(`#${modalId}`).remove();

    const name = prompt ? (prompt.name || prompt.identifier) : '条目';
    const isPinned = PinnedManager.isPinned(_currentPreset.name, prompt.identifier);
    const menuHtml = `
        <div id="${modalId}" class="zero-overlay" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: transparent; pointer-events: auto; z-index: 20050; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box;">
            <div class="zero-modal-card" style="background: var(--zero-bg-color, var(--SmartThemeBlurTintColor-Original, #1e1e28)); color: var(--zero-text-color, inherit); border: 1px solid var(--zero-border-color, var(--SmartThemeBorderColor, #444)); border-radius: 12px; width: 100%; max-width: 300px; padding: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.65); display: flex; flex-direction: column; gap: 8px; pointer-events: auto;">
                <div style="font-size: 13px; font-weight: bold; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.08); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--SmartThemeBodyColor); opacity: 0.9;">
                    ${esc(name)}
                </div>
                
                <div class="zero-ctx-item interactable" data-act="pin" style="padding: 10px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04);">
                    <i class="fa-solid fa-thumbtack" style="color: var(--SmartThemeQuoteColor); width: 16px;"></i>
                    <span>${isPinned ? '取消组内置顶' : '组内置顶'}</span>
                </div>

                <div class="zero-ctx-item interactable" data-act="inject-var" style="padding: 10px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04);">
                    <i class="fa-solid fa-code" style="color: var(--SmartThemeQuoteColor); width: 16px;"></i>
                    <span>注入变量 (自动包裹)</span>
                </div>

                <div class="zero-ctx-item interactable" data-act="folder" style="padding: 10px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04);">
                    <i class="fa-solid fa-folder-open" style="color: var(--SmartThemeQuoteColor); width: 16px;"></i>
                    <span>分组管理</span>
                </div>

                <div class="zero-ctx-item interactable" data-act="multi-select" style="padding: 10px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04);">
                    <i class="fa-solid fa-square-check" style="color: var(--SmartThemeQuoteColor); width: 16px;"></i>
                    <span>进入多选模式</span>
                </div>

                <div class="zero-ctx-item interactable" data-act="preview" style="padding: 10px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04);">
                    <i class="fa-solid fa-eye" style="color: var(--SmartThemeQuoteColor); width: 16px;"></i>
                    <span>预览条目内容</span>
                </div>

                <div class="zero-ctx-item interactable" data-act="edit" style="padding: 10px 12px; font-size: 13px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.04);">
                    <i class="fa-solid fa-pencil" style="color: var(--SmartThemeQuoteColor); width: 16px;"></i>
                    <span>在编辑器中打开</span>
                </div>

                <button id="close-zero-ctx-menu" class="interactable" style="margin-top: 4px; padding: 8px; border: none; border-radius: 6px; background: rgba(255,255,255,0.08); color: inherit; cursor: pointer; font-size: 12px;">取消</button>
            </div>
        </div>
    `;

    $('body').append(menuHtml);

    $(`#${modalId}`).on('pointerdown', (e) => {
        e.stopPropagation();
    });

    $(`#${modalId}`).on('click', (e) => {
        e.stopPropagation();
        if (e.target.id === modalId || e.target.id === 'close-zero-ctx-menu' || $(e.target).closest('#close-zero-ctx-menu').length) {
            $(`#${modalId}`).remove();
        }
    });

    $(`#${modalId} .zero-ctx-item`).on('click', function(e) {
        e.stopPropagation();
        const act = $(this).data('act');
        $(`#${modalId}`).remove();

        if (act === 'pin') {
            PinnedManager.togglePin(_currentPreset.name, prompt.identifier);
            renderEntries(panel, _currentPreset, _currentModal);
        } else if (act === 'inject-var') {
            import('../preset-manager/utils.js').then(m => {
                m.showInjectVariableModal(prompt, _currentPreset.name, (freshPreset) => {
                    renderModalContent(_currentModal, freshPreset || _currentPreset);
                });
            });
        } else if (act === 'folder') {
            const groups = GroupManager.get(_currentPreset.name);
            if (groups.length === 0) { toastr.info('请先在「分组管理」中创建分组'); return; }
            const groupEl = entry.closest('.zero-group');
            const gid = groupEl?.dataset.gid;
            const isUngrouped = groupEl?.dataset.ungrouped === 'true';
            const currentGroup = isUngrouped ? { id: gid } : (groups.find(g => g.id === gid) || { id: gid });
            showGroupAssignMenu(_currentModal, panel, _currentPreset, prompt, currentGroup, isUngrouped);
        } else if (act === 'multi-select') {
            const id = entry.dataset.id;
            enterMultiSelect(panel, _currentPreset, _currentModal, id);
            entry.classList.add('selected');
            const ic = entry.querySelector('.zero-sel-check');
            if (ic) ic.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        } else if (act === 'preview') {
            showContentPreview(_currentModal, prompt);
        } else if (act === 'edit') {
            const pIdx = _currentPreset?.prompts ? _currentPreset.prompts.indexOf(prompt) : -1;
            if (editorModule) {
                editorModule.openQuickEditor(_currentPreset.name, prompt.name || prompt.identifier, prompt.identifier, pIdx >= 0 ? pIdx : undefined);
            } else {
                import('../preset-manager/editor.js').then(m => {
                    editorModule = m;
                    m.openQuickEditor(_currentPreset.name, prompt.name || prompt.identifier, prompt.identifier, pIdx >= 0 ? pIdx : undefined);
                });
            }
        }
    });
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
            inner.innerHTML = renderGroupMembersHTML(members, null, _currentPreset?.name);
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
    const members = _groupMemberMap.get(gid) || [];

    // Ensure lazily rendered content is generated before toggling checks
    const inner = body.querySelector('.zero-group-inner');
    if (inner && !inner.hasChildNodes() && members.length > 0) {
        inner.innerHTML = renderGroupMembersHTML(members, null, _currentPreset?.name);
    }

    const initialMap = new Map();
    members.forEach(m => {
        if (m && m.identifier !== undefined && m.identifier !== null) {
            initialMap.set(String(m.identifier), enabled);
        }
    });

    const resolvedMap = resolvePromptConstraints(_currentPreset?.name, initialMap, _promptMap);

    resolvedMap.forEach((en, resId) => {
        const resP = _promptMap.get(resId);
        if (resP) resP.enabled = en;

        const entryEl = _currentModal?.querySelector(`.zero-entry[data-id="${esc(resId)}"]`);
        if (entryEl) {
            const switchCb = entryEl.querySelector('.zero-switch input');
            if (switchCb) switchCb.checked = en;
            entryEl.querySelector('.zero-entry-name')?.classList.toggle('disabled', !en);
            updateGroupCount(entryEl.closest('.zero-group'));
        }
    });

    updateGroupCount(groupEl);

    if (resolvedMap.size > 0) {
        PresetManager.batchToggleMap(resolvedMap).catch(e => {
            console.error('[Zero] batch toggle failed:', e);
            toastr.error('操作失败');
        });
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
        onclick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            previewBox.remove();
            const pIdx = _currentPreset?.prompts ? _currentPreset.prompts.indexOf(prompt) : -1;
            if (editorModule) {
                editorModule.openQuickEditor(_currentPreset.name, prompt.name || prompt.identifier, prompt.identifier, pIdx >= 0 ? pIdx : undefined);
            } else {
                import('../preset-manager/editor.js').then(m => {
                    editorModule = m;
                    m.openQuickEditor(_currentPreset.name, prompt.name || prompt.identifier, prompt.identifier, pIdx >= 0 ? pIdx : undefined);
                });
            }
        }
    });
    titleEl.appendChild(editBtn);

    if (typeof window.translate === 'function' && content.trim()) {
        const transBtn = h('button', {
            class: 'zero-icon-btn zero-preview-trans',
            style: 'opacity: 0.6;',
            title: '翻译内容',
            html: '<i class="fa-solid fa-language"></i>',
            onclick: async (e) => {
                e.stopPropagation();
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
        onclick: async (e) => {
            e.stopPropagation();
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
        h('button', {
            class: 'zero-btn primary',
            text: '关闭',
            onclick: (e) => {
                e.preventDefault();
                e.stopPropagation();
                previewBox.remove();
            }
        })
    ));
    previewBox.appendChild(previewContent);
    previewBox.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
    });
    previewBox.addEventListener('click', (e) => {
        if (e.target === previewBox) {
            e.preventDefault();
            e.stopPropagation();
            previewBox.remove();
        }
    });
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
        h('button', { class: 'zero-btn', title: '全选', html: '<i class="fa-solid fa-check-double"></i>', onclick: () => {
            panel.querySelectorAll('.zero-group-inner').forEach(inner => {
                if (!inner.hasChildNodes()) {
                    const groupEl = inner.closest('.zero-group');
                    const gid = groupEl.dataset.gid;
                    const members = _groupMemberMap.get(gid) || [];
                    inner.innerHTML = renderGroupMembersHTML(members, null, _currentPreset?.name);
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
        h('button', { class: 'zero-btn', title: '连选', html: '<i class="fa-solid fa-arrows-up-down"></i>', onclick: () => {
            const selectedIds = Array.from(msSelected);
            if (selectedIds.length < 2) {
                toastr.info('请先选择两个条目作为起点和终点');
                return;
            }
            const allEntries = Array.from(panel.querySelectorAll('.zero-entry[data-id]'));
            const indices = selectedIds.map(id => allEntries.findIndex(el => el.dataset.id === id)).filter(idx => idx !== -1);
            if (indices.length < 2) return;
            const minIdx = Math.min(...indices);
            const maxIdx = Math.max(...indices);
            for (let i = minIdx; i <= maxIdx; i++) {
                const el = allEntries[i];
                const id = el.dataset.id;
                if (!msSelected.has(id)) {
                    msSelected.add(id);
                    el.classList.add('selected');
                    const ic = el.querySelector('.zero-sel-check');
                    if (ic) ic.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
                }
            }
            updateMultiSelectBar();
        }}),
        h('button', { class: 'zero-btn', title: '反选', html: '<i class="fa-solid fa-right-left"></i>', onclick: () => {
            panel.querySelectorAll('.zero-group-inner').forEach(inner => {
                if (!inner.hasChildNodes()) {
                    const groupEl = inner.closest('.zero-group');
                    const gid = groupEl.dataset.gid;
                    const members = _groupMemberMap.get(gid) || [];
                    inner.innerHTML = renderGroupMembersHTML(members, null, _currentPreset?.name);
                }
            });
            panel.querySelectorAll('.zero-entry[data-id]').forEach(el => {
                const id = el.dataset.id;
                const ic = el.querySelector('.zero-sel-check');
                if (msSelected.has(id)) {
                    msSelected.delete(id);
                    el.classList.remove('selected');
                    if (ic) ic.innerHTML = '<i class="fa-solid fa-circle"></i>';
                } else {
                    msSelected.add(id);
                    el.classList.add('selected');
                    if (ic) ic.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
                }
            });
            updateMultiSelectBar();
            if (msSelected.size === 0) exitMultiSelect();
        }}),
        h('button', { class: 'zero-btn primary', title: '分组', html: '<i class="fa-solid fa-folder"></i>', onclick: () => showBatchGroupAssign(modal, panel, preset) }),
        h('button', { class: 'zero-btn', title: '退出', html: '<i class="fa-solid fa-xmark"></i>', onclick: exitMultiSelect })
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
    if (msSelected.size === 0) { toastr.info('未选择任何条目'); return; }

    const menuBox = h('div', { class: 'zero-confirm' });
    const menuContent = h('div', { class: 'zero-confirm-box zero-menu-box' },
        h('div', { class: 'zero-confirm-msg', text: `对 ${msSelected.size} 个条目进行分组操作：` })
    );
    
    // 从分组中清除选项
    menuContent.appendChild(h('button', {
        class: 'zero-menu-item',
        style: 'color: #ff5f5f; border-bottom: 1px solid rgba(255,255,255,0.05); margin-bottom: 6px; padding-bottom: 8px;',
        html: `<i class="fa-solid fa-right-from-bracket"></i> 从当前所有分组中清空/移出`,
        onclick: () => {
            Array.from(msSelected).forEach(id => {
                GroupManager.unassign(pName, id);
            });
            menuBox.remove();
            exitMultiSelect();
            renderEntries(panel, preset, modal);
        }
    }));

    if (groups.length === 0) {
        menuContent.appendChild(h('div', { class: 'zero-confirm-msg', style: 'font-size: 11px; opacity: 0.5; margin-top: 10px;', text: '暂无可用分组（请先在快照面板的 XML/分组设置中创建分组）' }));
    } else {
        groups.forEach(g => {
            menuContent.appendChild(h('button', {
                class: 'zero-menu-item',
                html: `<i class="fa-solid fa-folder"></i> 移入「${g.name}」`,
                onclick: () => {
                    GroupManager.assign(pName, g.id, Array.from(msSelected));
                    menuBox.remove();
                    exitMultiSelect();
                    renderEntries(panel, preset, modal);
                }
            }));
        });
    }

    menuContent.appendChild(h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px' },
        h('button', { class: 'zero-btn', text: '取消', onclick: (e) => { e.stopPropagation(); menuBox.remove(); } })
    ));
    menuBox.appendChild(menuContent);
    menuBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    menuBox.addEventListener('click', (e) => {
        if (e.target === menuBox) {
            e.stopPropagation();
            menuBox.remove();
        }
    });
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
            onclick: (e) => { e.stopPropagation(); menuBox.remove(); item.action(); }
        }));
    });
    menuContent.appendChild(h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px' },
        h('button', { class: 'zero-btn', text: '取消', onclick: (e) => { e.stopPropagation(); menuBox.remove(); } })
    ));
    menuBox.appendChild(menuContent);
    menuBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    menuBox.addEventListener('click', (e) => {
        if (e.target === menuBox) {
            e.stopPropagation();
            menuBox.remove();
        }
    });
    modal.appendChild(menuBox);
}

function showLinkageManager(panel, preset, modal) {
    const pName = preset.name;
    const menuBox = h('div', { class: 'zero-confirm' });
    const contentBox = h('div', { class: 'zero-confirm-box zero-group-mgr-box', style: 'max-width: 450px; height: 90vh; display: flex; flex-direction: column;' });
    contentBox.appendChild(h('div', { class: 'zero-confirm-msg', text: '条目联动管理' }));

    // Tab Navigation
    const tabContainer = h('div', { class: 'zero-tabs', style: 'margin-bottom: 12px; flex-shrink: 0;' });
    const listTab = h('div', {
        class: 'zero-tab active',
        html: '<i class="fa-solid fa-list"></i>规则列表',
        onclick: () => switchTab('list')
    });
    const createTab = h('div', {
        class: 'zero-tab',
        html: '<i class="fa-solid fa-pen-to-square"></i>联动配置',
        onclick: () => switchTab('create')
    });
    tabContainer.appendChild(listTab);
    tabContainer.appendChild(createTab);
    contentBox.appendChild(tabContainer);

    // Tab Panels Container
    const panelsContainer = h('div', { style: 'flex: 1; min-height: 0; display: flex; flex-direction: column;' });
    
    // Panel 1: Rules List
    const listPanel = h('div', { style: 'display: flex; flex-direction: column; height: 100%; min-height: 0;' });
    const listContainer = h('div', { class: 'zero-group-mgr-list', style: 'overflow-y: auto; flex: 1; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; background: rgba(0,0,0,0.15); padding: 8px;' });
    listPanel.appendChild(listContainer);

    function renderList() {
        listContainer.innerHTML = '';
        const linkages = LinkageManager.get(pName);
        if (linkages.length === 0) {
            const emptyBtn = h('button', {
                class: 'zero-btn primary',
                style: 'margin-top: 12px; font-size: 12px;',
                text: '新建联动规则 ➔',
                onclick: () => switchTab('create')
            });
            const emptyContainer = h('div', { class: 'zero-empty', style: 'padding: 40px 0; display: flex; flex-direction: column; align-items: center; gap: 10px;' },
                h('div', { text: '暂无联动规则', style: 'opacity: 0.5;' }),
                emptyBtn
            );
            listContainer.appendChild(emptyContainer);
            return;
        }

        // Group linkages by source
        const grouped = new Map();
        linkages.forEach(l => {
            if (!grouped.has(l.source)) grouped.set(l.source, []);
            grouped.get(l.source).push(l.target);
        });

        grouped.forEach((targets, source) => {
            const sourcePrompt = preset.prompts.find(p => p.identifier === source);
            const sName = sourcePrompt ? (sourcePrompt.name || sourcePrompt.identifier) : source;

            // Card container for each source
            const card = h('div', {
                style: 'background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; margin-bottom: 10px; overflow: hidden; display: flex; flex-direction: column;'
            });

            const chevron = h('i', { class: 'fa-solid fa-chevron-right', style: 'opacity: 0.5; font-size: 10px; transition: transform 0.2s; flex-shrink: 0;' });
            const cardBody = h('div', { style: 'padding: 4px 6px; display: none; flex-direction: column; gap: 2px; border-top: 1px solid rgba(255,255,255,0.03);' });

            // Card Header: Source Prompt Name (Collapsible on click)
            const cardHeader = h('div', {
                style: 'background: rgba(255,255,255,0.02); padding: 8px 12px; display: flex; align-items: center; gap: 8px; justify-content: space-between; cursor: pointer; user-select: none;',
                onclick: (e) => {
                    if (e.target.closest('.interactable')) return;
                    const isCollapsed = cardBody.style.display === 'none';
                    cardBody.style.display = isCollapsed ? 'flex' : 'none';
                    chevron.style.transform = isCollapsed ? 'rotate(90deg)' : 'none';
                }
            },
                h('div', { style: 'display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;' },
                    chevron,
                    h('i', { class: 'fa-solid fa-code-fork', style: 'color: var(--SmartThemeQuoteColor); font-size: 12px;' }),
                    h('span', { text: sName, style: 'font-weight: bold; font-size: 13px; color: var(--SmartThemeBodyColor); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' })
                ),
                h('span', {
                    class: 'interactable',
                    style: 'cursor: pointer; font-size: 11px; color: var(--SmartThemeQuoteColor); opacity: 0.8; padding: 2px 6px;',
                    text: '编辑',
                    onclick: (e) => {
                        e.stopPropagation();
                        sourceSelect.value = source;
                        switchTab('create');
                    }
                })
            );
            card.appendChild(cardHeader);

            // Card Body: Vertical Target List
            targets.forEach(tgt => {
                const targetPrompt = preset.prompts.find(p => p.identifier === tgt);
                const tName = targetPrompt ? (targetPrompt.name || targetPrompt.identifier) : tgt;

                const targetRow = h('div', {
                    style: 'display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-radius: 4px; font-size: 12px; transition: background 0.15s;'
                },
                    h('div', { style: 'display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;' },
                        h('i', { class: 'fa-solid fa-link', style: 'opacity: 0.4; font-size: 10px;' }),
                        h('span', { text: tName, style: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;' })
                    ),
                    h('i', {
                        class: 'fa-solid fa-trash-can interactable',
                        style: 'cursor: pointer; opacity: 0.4; transition: opacity 0.15s; font-size: 11px; padding: 2px 4px;',
                        onclick: (e) => {
                            e.stopPropagation();
                            LinkageManager.remove(pName, source, tgt);
                            renderList();
                        }
                    })
                );

                targetRow.addEventListener('mouseenter', () => {
                    targetRow.style.background = 'rgba(255,255,255,0.04)';
                    targetRow.querySelector('.fa-trash-can').style.opacity = '0.9';
                });
                targetRow.addEventListener('mouseleave', () => {
                    targetRow.style.background = 'transparent';
                    targetRow.querySelector('.fa-trash-can').style.opacity = '0.4';
                });

                cardBody.appendChild(targetRow);
            });

            card.appendChild(cardBody);
            listContainer.appendChild(card);
        });
    }

    // Panel 2: New Linkage Form (Asymmetrical Two-Step Panel)
    const createPanel = h('div', { style: 'display: none; flex-direction: column; gap: 10px; height: 100%; min-height: 0;' });
    
    const sourceSelect = h('select', { class: 'zero-preset-select', style: 'width: 100%;' });
    const targetContainer = h('div', {
        style: 'flex: 1; overflow-y: auto; border: 1px solid rgba(255,255,255,0.06); padding: 4px; border-radius: 6px; background: rgba(0,0,0,0.15); display: flex; flex-direction: column; gap: 2px;'
    });

    preset.prompts.forEach(p => {
        const name = p.name || p.identifier;
        sourceSelect.appendChild(h('option', { value: p.identifier, text: name }));

        const targetRow = h('label', { style: 'display: flex; align-items: center; gap: 8px; font-size: 12px; cursor: pointer; padding: 6px 8px; border-radius: 4px; transition: background 0.15s, border-color 0.15s; border-left: 3px solid transparent;' },
            h('input', { type: 'checkbox', class: 'zero-linkage-target-cb', value: p.identifier }),
            h('span', { text: name, style: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;' })
        );

        targetRow.querySelector('input').addEventListener('change', (e) => {
            targetRow.style.borderLeftColor = e.target.checked ? 'var(--SmartThemeQuoteColor)' : 'transparent';
            targetRow.style.background = e.target.checked ? 'rgba(123, 140, 222, 0.08)' : 'transparent';
        });

        targetRow.addEventListener('mouseenter', () => {
            const input = targetRow.querySelector('input');
            if (!input.disabled && !input.checked) {
                targetRow.style.background = 'rgba(255,255,255,0.04)';
            }
        });
        targetRow.addEventListener('mouseleave', () => {
            const input = targetRow.querySelector('input');
            if (!input.checked) {
                targetRow.style.background = 'transparent';
            }
        });
        
        targetContainer.appendChild(targetRow);
    });

    // Update target checkboxes availability and load existing linkages (Bi-directional Binding)
    function updateTargetAvailability() {
        const srcVal = sourceSelect.value;
        const linkages = LinkageManager.get(pName);
        // Find targets currently linked to this source
        const currentTargets = new Set(linkages.filter(l => l.source === srcVal).map(l => l.target));

        const cbs = targetContainer.querySelectorAll('.zero-linkage-target-cb');
        cbs.forEach(cb => {
            const label = cb.closest('label');
            if (cb.value === srcVal) {
                cb.checked = false;
                cb.disabled = true;
                label.style.opacity = '0.2';
                label.style.pointerEvents = 'none';
                label.style.background = 'transparent';
                label.style.borderLeftColor = 'transparent';
            } else {
                cb.disabled = false;
                label.style.opacity = '1';
                label.style.pointerEvents = 'auto';
                cb.checked = currentTargets.has(cb.value);
                label.style.borderLeftColor = cb.checked ? 'var(--SmartThemeQuoteColor)' : 'transparent';
                label.style.background = cb.checked ? 'rgba(123, 140, 222, 0.08)' : 'transparent';
            }
        });
    }

    sourceSelect.addEventListener('change', updateTargetAvailability);
    setTimeout(updateTargetAvailability, 0);

    // Search query states
    let searchQuery = '';
    let searchScopeName = true;
    let searchScopeContent = true;
    let searchDebounceTimer = null;

    // Filter targets by search text and scope
    function filterTargets(query) {
        const labels = targetContainer.querySelectorAll('label');
        labels.forEach(label => {
            const pId = label.querySelector('input').value;
            const p = preset.prompts.find(x => x.identifier === pId);
            if (!p) {
                label.style.display = 'none';
                return;
            }

            if (!query) {
                label.style.display = 'flex';
                return;
            }

            let matches = false;
            if (searchScopeName) {
                const name = (p.name || p.identifier || '').toLowerCase();
                if (name.includes(query)) matches = true;
            }
            if (searchScopeContent && !matches) {
                const content = (p.content || '').toLowerCase();
                if (content.includes(query)) matches = true;
            }

            label.style.display = matches ? 'flex' : 'none';
        });
    }

    // Bulk toggle checkboxes
    function toggleAllTargets(check) {
        const cbs = targetContainer.querySelectorAll('.zero-linkage-target-cb');
        cbs.forEach(cb => {
            const label = cb.closest('label');
            if (!cb.disabled && label.style.display !== 'none') {
                cb.checked = check;
                label.style.borderLeftColor = check ? 'var(--SmartThemeQuoteColor)' : 'transparent';
                label.style.background = check ? 'rgba(123, 140, 222, 0.08)' : 'transparent';
            }
        });
    }

    // Step 1 Section (Source Select)
    const sourceSection = h('div', {
        style: 'background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 8px 12px; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;'
    },
        h('div', { style: 'display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--SmartThemeEmColor); font-weight: bold;' },
            h('i', { class: 'fa-solid fa-arrow-turn-down', style: 'color: var(--SmartThemeQuoteColor);' }),
            h('span', { text: '第一步：选择源条目' })
        ),
        sourceSelect
    );

    // Collapsible Search Wrap Setup (Tab 2)
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
        placeholder: '过滤名称或内容...',
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
                nameBtn.classList.toggle('active', searchScopeName);
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
                contentBtn.classList.toggle('active', searchScopeContent);
                triggerSearch(searchInput.value);
            }
        })
    );
    searchWrap.appendChild(searchRow1);
    searchWrap.appendChild(searchRow2);

    const nameBtn = searchRow2.querySelector('.name-btn');
    const contentBtn = searchRow2.querySelector('.content-btn');

    function expandSearch() {
        searchWrap.classList.add('expanded');
        const titleEl = targetSection.querySelector('.target-title');
        const actionsEl = targetSection.querySelector('.target-quick-actions');
        if (enableAnim) {
            if (titleEl) {
                titleEl.style.opacity = '0';
                setTimeout(() => { titleEl.style.display = 'none'; }, 200);
            }
            if (actionsEl) {
                actionsEl.style.opacity = '0';
                setTimeout(() => { actionsEl.style.display = 'none'; }, 200);
            }
        } else {
            if (titleEl) titleEl.style.display = 'none';
            if (actionsEl) actionsEl.style.display = 'none';
        }
        searchBtn.innerHTML = '<i class="fa-solid fa-arrow-left"></i>';
        searchBtn.title = '返回';
        setTimeout(() => searchInput.focus(), 50);
    }

    function collapseSearch() {
        searchWrap.classList.remove('expanded');
        const titleEl = targetSection.querySelector('.target-title');
        const actionsEl = targetSection.querySelector('.target-quick-actions');
        if (enableAnim) {
            if (titleEl) {
                titleEl.style.display = 'flex';
                setTimeout(() => { titleEl.style.opacity = '1'; }, 50);
            }
            if (actionsEl) {
                actionsEl.style.display = 'flex';
                setTimeout(() => { actionsEl.style.opacity = '1'; }, 50);
            }
        } else {
            if (titleEl) {
                titleEl.style.display = 'flex';
                titleEl.style.opacity = '1';
            }
            if (actionsEl) {
                actionsEl.style.display = 'flex';
                actionsEl.style.opacity = '1';
            }
        }
        searchBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>';
        searchBtn.title = '搜索';
        searchInput.value = '';
        triggerSearch('');
    }

    function triggerSearch(val) {
        searchQuery = val.trim().toLowerCase();
        filterTargets(searchQuery);
    }

    searchInput.addEventListener('input', () => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
            triggerSearch(searchInput.value);
        }, 1000); // 1 second debounce
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            collapseSearch();
        }
    });

    // Step 2 Section (Target Checklist + Search)
    const targetSection = h('div', {
        style: 'background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; flex: 1; min-height: 0;'
    },
        h('div', { style: 'display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; min-height: 28px; position: relative; overflow: hidden;' },
            h('div', { class: 'target-title', style: 'display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--SmartThemeEmColor); font-weight: bold; transition: opacity 0.2s;' },
                h('i', { class: 'fa-solid fa-list-check', style: 'color: var(--SmartThemeQuoteColor);' }),
                h('span', { text: '第二步：配置联动目标' })
            ),
            searchWrap,
            h('div', { class: 'target-quick-actions', style: 'display: flex; gap: 8px; font-size: 11px; align-items: center; transition: opacity 0.2s;' },
                h('span', {
                    text: '全选',
                    class: 'interactable',
                    style: 'cursor: pointer; color: var(--SmartThemeQuoteColor);',
                    onclick: () => toggleAllTargets(true)
                }),
                h('span', {
                    text: '清空',
                    class: 'interactable',
                    style: 'cursor: pointer; opacity: 0.6;',
                    onclick: () => toggleAllTargets(false)
                })
            )
        ),
        targetContainer
    );

    const createForm = h('div', { style: 'display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0;' },
        sourceSection,
        targetSection,
        h('button', {
            class: 'zero-btn primary',
            style: 'width: 100%; justify-content: center; flex-shrink: 0; padding: 8px 0; font-weight: bold;',
            html: '<i class="fa-solid fa-floppy-disk"></i> 保存联动配置',
            onclick: () => {
                const src = sourceSelect.value;
                const cbs = targetContainer.querySelectorAll('.zero-linkage-target-cb');
                
                const checkedTgts = [];
                const uncheckedTgts = [];
                cbs.forEach(cb => {
                    if (cb.disabled) return;
                    if (cb.checked) {
                        checkedTgts.push(cb.value);
                    } else {
                        uncheckedTgts.push(cb.value);
                    }
                });

                let added = 0;
                let removed = 0;

                const currentLinkages = LinkageManager.get(pName);
                // Add checked rules
                checkedTgts.forEach(tgt => {
                    if (!currentLinkages.some(l => l.source === src && l.target === tgt)) {
                        LinkageManager.add(pName, src, tgt);
                        added++;
                    }
                });

                // Remove unchecked rules
                uncheckedTgts.forEach(tgt => {
                    if (currentLinkages.some(l => l.source === src && l.target === tgt)) {
                        LinkageManager.remove(pName, src, tgt);
                        removed++;
                    }
                });

                if (added > 0 || removed > 0) {
                    toastr.success(`联动规则已更新 (新建 ${added} 条，移除 ${removed} 条)`);
                    switchTab('list');
                } else {
                    toastr.info('联动配置未发生变化');
                }
            }
        })
    );
    createPanel.appendChild(createForm);

    panelsContainer.appendChild(listPanel);
    panelsContainer.appendChild(createPanel);
    contentBox.appendChild(panelsContainer);

    // Switch Tab helper
    function switchTab(tabId) {
        if (tabId === 'list') {
            listTab.classList.add('active');
            createTab.classList.remove('active');
            listPanel.style.display = 'flex';
            createPanel.style.display = 'none';
            setTimeout(renderList, 0);
        } else {
            listTab.classList.remove('active');
            createTab.classList.add('active');
            listPanel.style.display = 'none';
            createPanel.style.display = 'flex';
            setTimeout(updateTargetAvailability, 0);
        }
    }

    renderList();

    contentBox.appendChild(h('div', { class: 'zero-confirm-btns', style: 'margin-top:16px; flex-shrink: 0;' },
        h('button', {
            class: 'zero-btn',
            text: '关闭',
            onclick: (e) => {
                e.stopPropagation();
                menuBox.remove();
                renderEntries(panel, preset, modal);
            }
        })
    ));

    menuBox.appendChild(contentBox);
    menuBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    menuBox.addEventListener('click', (e) => {
        if (e.target === menuBox) {
            e.stopPropagation();
            menuBox.remove();
            renderEntries(panel, preset, modal);
        }
    });
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
    menuBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    menuBox.addEventListener('click', (e) => {
        if (e.target === menuBox) {
            e.stopPropagation();
            menuBox.remove();
        }
    });
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
    contentBox.appendChild(h('div', { class: 'zero-confirm-btns' }, h('button', { class: 'zero-btn primary', style: 'width:100%;', text: '完成', onclick: (e) => { e.stopPropagation(); menuBox.remove(); renderEntries(panel, preset, modal); } })));
    menuBox.appendChild(contentBox);
    menuBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    menuBox.addEventListener('click', (e) => {
        if (e.target === menuBox) {
            e.stopPropagation();
            menuBox.remove();
            renderEntries(panel, preset, modal);
        }
    });
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
    contentBox.appendChild(h('div', { class: 'zero-confirm-btns' }, h('button', { class: 'zero-btn primary', style: 'width:100%;', text: '完成', onclick: (e) => { e.stopPropagation(); menuBox.remove(); renderSnapshots(panel, preset, modal, 'local'); } })));
    menuBox.appendChild(contentBox);
    menuBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    menuBox.addEventListener('click', (e) => {
        if (e.target === menuBox) {
            e.stopPropagation();
            menuBox.remove();
            renderSnapshots(panel, preset, modal, 'local');
        }
    });
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
            onclick: (e) => { e.stopPropagation(); menuBox.remove(); item.action(); }
        }));
    });
    menuContent.appendChild(h('div', { class: 'zero-confirm-btns', style: 'margin-top:12px' },
        h('button', { class: 'zero-btn', text: '取消', onclick: (e) => { e.stopPropagation(); menuBox.remove(); } })
    ));
    menuBox.appendChild(menuContent);
    menuBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    menuBox.addEventListener('click', (e) => {
        if (e.target === menuBox) {
            e.stopPropagation();
            menuBox.remove();
        }
    });
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
        h('button', { class: 'zero-btn', text: '取消', onclick: (e) => { e.stopPropagation(); box.remove(); } }),
        h('button', { class: 'zero-btn primary', text: isOverwrite ? '覆盖保存' : '创建', onclick: async (e) => {
            e.stopPropagation();
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
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => {
        if (e.target === box) {
            e.stopPropagation();
            box.remove();
        }
    });
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
        const openai = await getOpenai();
        const promptManager = openai?.promptManager;
        if (!promptManager) { toastr.error('找不到预设编辑器'); return; }

        const ctx = SillyTavern.getContext();
        const prompt = (_promptMap && _promptMap.get(identifier)) ||
            (typeof promptManager.getPromptById === 'function' && promptManager.getPromptById(identifier)) ||
            (ctx.chatCompletionSettings?.prompts?.find(p => p.identifier === identifier)) ||
            (Array.isArray(promptManager.prompts) && promptManager.prompts.find(p => p.identifier === identifier));
        if (!prompt) { toastr.error('找不到该条目'); return; }

        promptManager.clearEditForm();
        promptManager.clearInspectForm();
        promptManager.loadPromptIntoEditForm(prompt);
        
        // Hide Zero overlay from layout completely (display: none) to eliminate
        // layout recalculations and animation stutter while ST native drawer opens
        if (overlay) {
            overlay.style.display = 'none';
            overlay.style.opacity = '0';
            overlay.style.pointerEvents = 'none';
        }
        promptManager.showPopup();

        const prefix = promptManager.configuration?.prefix || '';
        const popupId = prefix + 'prompt_manager_popup';
        const popup = document.getElementById(popupId) || document.getElementById('openai_prompt_manager_popup');

        if (popup) {
            const observer = new MutationObserver(() => {
                // React instantly when the closing animation starts (openDrawer class removed)
                if (!popup.classList.contains('openDrawer')) {
                    observer.disconnect();

                    // 1. Instantly restore Zero overlay (0ms latency!)
                    if (overlay) {
                        overlay.style.display = 'flex';
                        overlay.style.opacity = '1';
                        overlay.style.pointerEvents = 'auto';
                    }

                    // 2. Synchronously sync memory & save to preset data
                    try {
                        const ctx = SillyTavern.getContext();
                        const pm = ctx.getPresetManager?.('openai');
                        const updatedPrompt = (typeof promptManager.getPromptById === 'function' && promptManager.getPromptById(identifier)) ||
                            (Array.isArray(promptManager.prompts) && promptManager.prompts.find(x => x.identifier === identifier));

                        if (pm && updatedPrompt) {
                            const presetName = pm.getSelectedPresetName();
                            const presetObj = pm.getCompletionPresetByName(presetName);
                            if (presetObj && Array.isArray(presetObj.prompts)) {
                                const targetP = presetObj.prompts.find(x => x.identifier === identifier) ||
                                    presetObj.prompts.find(x => x.name === updatedPrompt.name || x.identifier === updatedPrompt.name);
                                if (targetP) {
                                    targetP.content = updatedPrompt.content;
                                    targetP.name = updatedPrompt.name;
                                    targetP.role = updatedPrompt.role;
                                }
                            }
                        }

                        // Persist to disk asynchronously in background without causing UI reflow
                        if (typeof ctx.saveSettingsDebounced === 'function') {
                            ctx.saveSettingsDebounced();
                        }

                        // Invalidate cache and reload memory models instantly
                        PresetManager.invalidate();
                        PresetManager.load().then(freshPreset => {
                            if (freshPreset) {
                                _currentPreset = freshPreset;
                                _promptMap = new Map(freshPreset.prompts.map(p => [p.identifier, p]));

                                // Update entry name in DOM in-place if changed
                                const updatedP = _promptMap.get(identifier);
                                if (updatedP && overlay) {
                                    const entryEl = overlay.querySelector(`.zero-entry[data-id="${esc(identifier)}"]`);
                                    if (entryEl) {
                                        const nameEl = entryEl.querySelector('.zero-entry-name');
                                        if (nameEl) nameEl.textContent = updatedP.name || updatedP.identifier;
                                    }
                                }
                                if (_currentPanels) markPanelsDirty(_currentPanels, UiStateManager.get().activeTab || 'entries');
                            }
                        }).catch(e => console.error('[Zero] load after native edit:', e));
                    } catch (err) {
                        console.error('[Zero] memory sync after native edit:', err);
                    }
                }
            });
            observer.observe(popup, { attributes: true, attributeFilter: ['class'] });
        } else {
            console.warn('[Zero] Could not find native popup:', popupId);
            if (overlay) {
                overlay.style.display = 'flex';
                overlay.style.opacity = '1';
                overlay.style.pointerEvents = 'auto';
            }
        }
    } catch (e) {
        console.error('[Zero] openNativeEditor failed:', e);
        toastr.error('无法打开编辑器');
        if (overlay) {
            overlay.style.display = 'flex';
            overlay.style.opacity = '1';
            overlay.style.pointerEvents = 'auto';
        }
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
                h('button', { class: 'zero-btn primary', text: '关闭', onclick: (e) => { e.stopPropagation(); compareBox.remove(); } })
            )
        );
        compareBox.appendChild(content);
        compareBox.addEventListener('pointerdown', (e) => e.stopPropagation());
        compareBox.addEventListener('click', (e) => {
            if (e.target === compareBox) {
                e.stopPropagation();
                compareBox.remove();
            }
        });
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
    let selectedThreshold = parseFloat(localStorage.getItem('zero_migration_similarity_threshold') || '0.8');
    const compareEnabled = UiStateManager.get().migrateContentCompare !== false;
    if (compareEnabled) {
        const thresholdSelect = h('select', { class: 'zero-preset-select', style: 'width:100%;' });
        const thresholdOptions = [
            { value: '1.0', text: '100% 完全一致' },
            { value: '0.9', text: '90% 高度相似' },
            { value: '0.8', text: '80% 相似' },
            { value: '0.7', text: '70% 相似' },
            { value: '0.0', text: '关闭内容匹配' }
        ];
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
    }

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
    const cancelBtn = h('button', { class: 'zero-btn', text: '取消', style: 'flex:1; justify-content:center;', onclick: (e) => { e.stopPropagation(); menuBox.remove(); } });

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

    menuBox.appendChild(contentBox);
    menuBox.addEventListener('pointerdown', (e) => e.stopPropagation());
    menuBox.addEventListener('click', (e) => {
        if (e.target === menuBox) {
            e.stopPropagation();
            menuBox.remove();
        }
    });
    targetModal.appendChild(menuBox);

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
}

// ═══════════════════════════════════════
//  Preset Operation Log Modal
// ═══════════════════════════════════════
export function openOpLogModal(presetName) {
    if (!presetName) presetName = PresetManager.cached()?.name || 'Default';
    const escapeHtml = esc;
    const existing = document.getElementById('zero-op-log-modal');
    if (existing) existing.remove();

    const logs = OpLogManager.get(presetName);

    const logModal = document.createElement('div');
    logModal.id = 'zero-op-log-modal';
    logModal.className = 'completion_prompt_manager_popup TH-script-editor-container regex_editor_template';
    Object.assign(logModal.style, {
        position: 'fixed',
        top: '0', left: '0', width: '100vw', height: '100vh',
        background: 'rgba(0,0,0,0.55)',
        zIndex: '22000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        boxSizing: 'border-box'
    });

    const formatTime = (ts) => {
        const d = new Date(ts);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    const getTypeColor = (type) => {
        switch(type) {
            case 'toggle': return 'var(--zero-accent-color, var(--SmartThemeQuoteColor, #7b8cde))';
            case 'batch_toggle': return 'var(--zero-warning-color, #ff8822)';
            case 'add': return 'var(--zero-success-color, #4CAF50)';
            case 'delete': return 'var(--zero-danger-color, #ff4d4f)';
            case 'snapshot_apply': return 'var(--zero-info-color, #2196F3)';
            default: return 'var(--zero-accent-color, var(--SmartThemeQuoteColor, #7b8cde))';
        }
    };

    let logItemsHtml = '';
    if (!logs || logs.length === 0) {
        logItemsHtml = `<p style="text-align: center; opacity: 0.5; font-size: 13px; padding: 40px 0; margin: 0;"><i class="fa-solid fa-folder-open" style="margin-right: 6px;"></i>暂无「${escapeHtml(presetName)}」的操作日志记录</p>`;
    } else {
        logItemsHtml = logs.map(l => {
            const color = getTypeColor(l.type);
            const timeStr = formatTime(l.ts);
            let detailHtml = '';
            if (l.detail) {
                detailHtml += `<div style="font-size: 12px; opacity: 0.75; line-height: 1.4; padding-left: 2px;">${escapeHtml(l.detail)}</div>`;
            }
            if (l.itemsDetail && (Array.isArray(l.itemsDetail.on) || Array.isArray(l.itemsDetail.off))) {
                const onList = (l.itemsDetail.on || []).map(n => escapeHtml(n));
                const offList = (l.itemsDetail.off || []).map(n => escapeHtml(n));
                const totalCount = onList.length + offList.length;
                if (totalCount > 0) {
                    detailHtml += `
                        <details style="margin-top: 4px; font-size: 11px; opacity: 0.9;">
                            <summary class="interactable" style="outline: none; cursor: pointer; user-select: none; color: var(--SmartThemeQuoteColor, #7b8cde); font-weight: 600;">
                                <i class="fa-solid fa-list-check" style="margin-right: 4px;"></i>查看变动条目列表 (${totalCount})
                            </summary>
                            <div style="margin-top: 6px; padding: 8px 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; word-break: break-all;">
                                ${onList.length ? `<div><strong style="color:#4caf50;">[开启 ${onList.length}]:</strong> ${onList.join('、')}</div>` : ''}
                                ${offList.length ? `<div><strong style="color:#ff5252;">[关闭 ${offList.length}]:</strong> ${offList.join('、')}</div>` : ''}
                            </div>
                        </details>
                    `;
                }
            }
            return `
                <div style="display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
                            <span style="font-size: 10px; font-weight: bold; padding: 2px 6px; border-radius: 4px; background: ${color}22; color: ${color}; border: 1px solid ${color}44; white-space: nowrap;">${escapeHtml(l.typeText || '操作')}</span>
                            <span style="font-size: 13px; font-weight: bold; color: var(--SmartThemeBodyColor); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(l.itemName || '默认预设')}</span>
                        </div>
                        <span style="font-size: 11px; opacity: 0.5; font-family: monospace; flex-shrink: 0;">${timeStr}</span>
                    </div>
                    ${detailHtml}
                </div>
            `;
        }).join('');
    }

    logModal.innerHTML = `
        <div class="zero-modal-card" style="background: var(--zero-bg-color, var(--SmartThemeBlurTintColor-Original, #1e1e28)); color: var(--zero-text-color, var(--SmartThemeBodyColor, #e0e0e0)); border: 1px solid var(--zero-border-color, var(--SmartThemeBorderColor, #444)); border-radius: 14px; width: 100%; max-width: 520px; display: flex; flex-direction: column; max-height: 85vh; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.6);">
            <!-- Header -->
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--SmartThemeBorderColor, #333); flex-shrink: 0;">
                <div style="display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 14px; color: var(--SmartThemeBodyColor);">
                    <i class="fa-solid fa-clock-rotate-left" style="color: var(--SmartThemeQuoteColor);"></i>
                    <span>预设操作日志</span>
                    <span style="font-size: 11px; opacity: 0.6; font-weight: normal;">(最新 ${logs.length}/20 条 | ${escapeHtml(presetName)})</span>
                </div>
                <div id="close-zero-op-log-modal" class="interactable" style="cursor: pointer; padding: 4px 8px; opacity: 0.7;"><i class="fa-solid fa-xmark"></i></div>
            </div>

            <!-- Body (Logs List) -->
            <div id="zero-op-log-list" style="padding: 14px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 8px;">
                ${logItemsHtml}
            </div>

            <!-- Footer -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-top: 1px solid var(--SmartThemeBorderColor, #333); background: rgba(0,0,0,0.1); flex-shrink: 0;">
                <button id="clear-zero-op-log-btn" class="interactable" style="padding: 6px 12px; border: 1px solid rgba(255,82,82,0.3); border-radius: 6px; background: rgba(255,82,82,0.12); color: #ff5252; cursor: pointer; font-size: 12px; font-weight: bold;"><i class="fa-solid fa-trash-can" style="margin-right: 4px;"></i> 清空日志</button>
                <button id="confirm-zero-op-log-btn" class="interactable" style="padding: 6px 16px; border: none; border-radius: 6px; background: var(--SmartThemeQuoteColor, #7b8cde); color: white; cursor: pointer; font-size: 12px; font-weight: bold;">关闭</button>
            </div>
        </div>
    `;

    document.body.appendChild(logModal);

    const closeLogModal = () => logModal.remove();

    logModal.querySelector('#close-zero-op-log-modal').addEventListener('click', closeLogModal);
    logModal.querySelector('#confirm-zero-op-log-btn').addEventListener('click', closeLogModal);

    logModal.querySelector('#clear-zero-op-log-btn').addEventListener('click', () => {
        OpLogManager.clear(presetName);
        toastr.success(`已清空「${presetName}」的操作日志`);
        openOpLogModal(presetName);
    });

    logModal.addEventListener('click', (e) => {
        if (e.target === logModal) closeLogModal();
    });
}

// Keep snapshot panel in sync when undo/redo or preset content updates
$(window).off('zero-history-changed.snapshot zero-content-updated.snapshot').on('zero-history-changed.snapshot zero-content-updated.snapshot', async () => {
    if (_currentModal && document.body.contains(_currentModal)) {
        PresetManager.invalidate();
        const freshPreset = await PresetManager.load();
        const listInfo = await PresetManager.listNames();
        if (freshPreset) {
            _currentPreset = freshPreset;
            _currentModal.innerHTML = '';
            buildModal(_currentModal, freshPreset, listInfo);
        }
    }
});


