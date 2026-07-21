/**
 * Preset Manager Extension for Zero
 * Handles button injection into the Extensions menu and full-screen tabbed panel.
 *
 * 子模块采用懒加载策略：仅在用户首次打开面板时并行加载，之后缓存复用。
 */

import { PresetManager, HistoryManager, UiStateManager } from '../qr-snapshot/state.js';
import { syncTheme } from './utils.js';

// ── 懒加载缓存 ──────────────────────────────────────────────────────────────
let _contrast = null;
let _stitch   = null;
let _manage   = null;
let _checker  = null;
let _editor   = null;
let _regex    = null;
let _modulesLoaded = false;

// ── 选项卡渲染缓存（避免切换 Tab 重复渲染 DOM） ──────────────────────────────
export const renderedTabs = new Set();

// ── 预设列表缓存（避免切 Tab 重复拉取）──────────────────────────────────────
let _presetsListCache = null;
let _presetsLastFetch  = 0;
const PRESETS_CACHE_TTL = 60000; // 60 秒内跳过重复拉取

// ui-manage.js 写操作完成后，通过事件通知缓存失效
window.addEventListener('zero-presets-list-changed', () => { _presetsLastFetch = 0; });

/** 供外部模块主动失效缓存（如批量导入/删除后） */
export function invalidatePresetsCache() { _presetsLastFetch = 0; }

export function applyAvoidStatusbar() {
    try {
        const avoid = UiStateManager.get().avoidStatusbar !== false;
        if (avoid) {
            $('body').addClass('zero-avoid-statusbar');
        } else {
            $('body').removeClass('zero-avoid-statusbar');
        }
    } catch (e) {
        console.error('[Zero] Failed to apply statusbar avoidance:', e);
    }
}

async function loadModules() {
    if (_modulesLoaded) return;
    [_contrast, _stitch, _manage, _checker, _editor, _regex] = await Promise.all([
        import('./contrast.js'),
        import('./stitch.js'),
        import('./manage.js'),
        import('./checker.js'),
        import('./editor.js'),
        import('./regex-tab.js'),
    ]);
    _modulesLoaded = true;
}

const PANEL_ID = 'zero-preset-manager-panel';
const BTN_ID = 'zero-preset-manager-btn';

export async function getPresetsList(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && _presetsListCache && (now - _presetsLastFetch) < PRESETS_CACHE_TTL) {
        return _presetsListCache;
    }
    PresetManager.invalidate();
    const list = await PresetManager.listNames();
    _presetsListCache = list;
    _presetsLastFetch = now;
    return list;
}

export async function populatePresetSelects() {
    try {
        const list = await getPresetsList();
        const $selectA = $('#contrast-preset-a');
        const $selectB = $('#contrast-preset-b');
        const $stitchA = $('#stitch-preset-source');
        const $stitchB = $('#stitch-preset-target');
        const $checkS = $('#check-preset-select');
        
        const normalNames = list.names.filter(n => !n.startsWith('★'));
        const favNames = list.names.filter(n => n.startsWith('★'));

        const buildOptionsHtml = (includeNone = true) => {
            let html = includeNone ? '<option value="">-- 无 --</option>' : '';
            if (normalNames.length > 0) {
                html += `<optgroup label="📂 我的预设">`;
                normalNames.forEach(name => {
                    html += `<option value="${name}">${name}</option>`;
                });
                html += `</optgroup>`;
            }
            if (favNames.length > 0) {
                html += `<optgroup label="⭐ 我的收藏夹">`;
                favNames.forEach(name => {
                    const displayName = name.slice(1);
                    html += `<option value="${name}">${displayName}</option>`;
                });
                html += `</optgroup>`;
            }
            return html;
        };

        $selectA.html(buildOptionsHtml(true));
        $selectB.html(buildOptionsHtml(true));
        $stitchA.html(buildOptionsHtml(true));
        $stitchB.html(buildOptionsHtml(true));
        $checkS.html(buildOptionsHtml(false));

        if (_contrast) _contrast.pruneManualLinks(list.names);
        if (_regex) _regex.populateRegexSelects(list);
        
        const lastA = localStorage.getItem('zero_last_a');
        const lastB = localStorage.getItem('zero_last_b');
        const lastStitchA = localStorage.getItem('zero_last_stitch_a');
        const lastStitchB = localStorage.getItem('zero_last_stitch_b');
        
        if (lastA && list.names.includes(lastA)) $selectA.val(lastA);
        if (lastB && list.names.includes(lastB)) $selectB.val(lastB);
        else if (list.names.length > 1 && !lastB) $selectB.val(list.names[1]);
        
        if (lastStitchA && list.names.includes(lastStitchA)) $stitchA.val(lastStitchA);
        if (lastStitchB && list.names.includes(lastStitchB)) $stitchB.val(lastStitchB);
        else if (list.names.length > 1 && !lastStitchB) $stitchB.val(list.names[1]);
        
        const lastCheck = localStorage.getItem('zero_last_check_preset');
        if (lastCheck && list.names.includes(lastCheck)) $checkS.val(lastCheck);
        else $checkS.val(list.active);
        
    } catch (e) {
        console.error('[Zero] Failed to populate presets:', e);
    }
}

function ensurePanel() {
    if ($(`#${PANEL_ID}`).length) return;

    const panelHtml = `
        <div id="${PANEL_ID}" style="
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: var(--SmartThemeBlurTintColor, #171717);
            color: var(--SmartThemeBodyColor, #dcdcd2);
            z-index: 9999;
            padding-top: 0;
            flex-direction: column;
            overflow: hidden;
            overflow-x: hidden;
            font-family: var(--mainFontFamily, sans-serif);
            opacity: 0;
            transition: opacity 0.15s ease-out;
        ">
            <!-- Tabs Navigation -->
            <div class="zero-tabs-nav" style="
                display: flex;
                background: var(--SmartThemeBlurTintColor, #171717);
                border-bottom: 1px solid var(--SmartThemeBorderColor, #444);
                padding: 0 8px;
                flex-shrink: 0;
                align-items: center;
                justify-content: space-between;
            ">
                <div style="display: flex; flex: 1;">
                    <div class="zero-tab-link active" data-tab="contrast" style="padding: 10px 12px; font-size: 13px; cursor: pointer; border-bottom: 2px solid var(--SmartThemeBorderColor, #444);">对照</div>
                    <div class="zero-tab-link" data-tab="stitch" style="padding: 10px 12px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent;">缝合</div>
                    <div class="zero-tab-link" data-tab="regex" style="padding: 10px 12px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent;">正则</div>
                    <div class="zero-tab-link" data-tab="check" style="padding: 10px 12px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent;">自查</div>
                    <div class="zero-tab-link" data-tab="manage" style="padding: 10px 12px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent;">管理</div>
                    <div class="zero-tab-link" data-tab="settings" style="padding: 10px 12px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent;">设置</div>
                </div>
                <div style="display: flex; align-items: center; gap: 4px; margin-right: 8px;">
                    <button id="zero-history-undo" class="interactable zero-icon-btn" title="撤回上一个操作" style="background: none; border: none; color: inherit; padding: 8px; cursor: pointer; opacity: 0.4; font-size: 14px; display: flex; align-items: center; justify-content: center;" disabled>
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>
                    <button id="zero-history-redo" class="interactable zero-icon-btn" title="还原上一个操作" style="background: none; border: none; color: inherit; padding: 8px; cursor: pointer; opacity: 0.4; font-size: 14px; display: flex; align-items: center; justify-content: center;" disabled>
                        <i class="fa-solid fa-rotate-right"></i>
                    </button>
                </div>
                <div id="zero-panel-close" class="interactable" style="cursor: pointer; padding: 10px; font-size: 16px; opacity: 0.8;">
                    <i class="fa-solid fa-xmark"></i>
                </div>
            </div>

            <!-- Content Area -->
            <div class="zero-panel-body" style="flex: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; background: var(--SmartThemeBlurTintColor, #171717);">
                
                <!-- Contrast Tab -->
                <div id="zero-tab-contrast" class="zero-tab-content" style="padding: 12px; display: flex; flex-direction: column; gap: 12px; flex: 1; overflow: hidden; height: 100%;">
                    <div class="contrast-setup" style="display: flex; flex-direction: column; gap: 8px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                            <span style="font-size: 12px; opacity: 0.7; width: 60px; flex-shrink: 0;">预设 A:</span>
                            <select id="contrast-preset-a" class="interactable" style="flex: 1; min-width: 0; padding: 4px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;"></select>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                            <span style="font-size: 12px; opacity: 0.7; width: 60px; flex-shrink: 0;">预设 B:</span>
                            <select id="contrast-preset-b" class="interactable" style="flex: 1; min-width: 0; padding: 4px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;"></select>
                            <button id="contrast-search-toggle" class="interactable" title="展开/折叠搜索" style="width: 28px; height: 28px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                <i class="fa-solid fa-magnifying-glass"></i>
                            </button>
                        </div>
                        <div id="contrast-search-container" style="display: none; flex-direction: column; gap: 6px; margin-top: 4px; padding: 6px 0; background: none; box-shadow: none;">
                            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                                <span style="font-size: 11px; opacity: 0.7; width: 60px; flex-shrink: 0;">搜索条目:</span>
                                <div style="position: relative; flex: 1; display: flex; align-items: center;">
                                    <input type="text" id="contrast-search-input" class="interactable" placeholder="输入关键字搜索..." style="width: 100%; padding: 0 24px 0 8px; height: 28px !important; box-sizing: border-box !important; line-height: 1.2 !important; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-size: inherit !important;">
                                    <i id="contrast-search-clear" class="fa-solid fa-circle-xmark interactable" title="清空搜索" style="position: absolute; right: 8px; cursor: pointer; opacity: 0.5; display: none; font-size: 12px;"></i>
                                </div>
                            </div>
                            <div id="contrast-search-filters" style="display: flex; gap: 6px; align-items: center; padding-left: 68px;">
                                <span class="contrast-search-filter-badge interactable active" data-filter="name" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">名称</span>
                                <span class="contrast-search-filter-badge interactable active" data-filter="content" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">内容</span>
                                <span class="contrast-search-filter-badge interactable active" data-filter="note" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">备注</span>
                                <span class="contrast-search-filter-badge interactable active" data-filter="origin" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">来源</span>
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px; margin-top: 4px;">
                            <button id="contrast-auto-match" class="interactable" style="flex: 1; padding: 6px; font-size: 12px; background: var(--SmartThemeBorderColor); color: inherit; border: none; border-radius: 4px;">自动匹配</button>
                            <button id="manage-manual-matches" class="interactable" title="管理手动匹配记录" style="width: 36px; padding: 6px; font-size: 12px; background: rgba(255,255,255,0.05); color: inherit; border: none; border-radius: 4px;"><i class="fa-solid fa-list-check"></i></button>
                            <button id="contrast-start" class="interactable" style="flex: 1; padding: 6px; font-size: 12px; background: var(--SmartThemeQuoteColor, #7b8cde); color: white; border: none; border-radius: 4px;">开始对比</button>
                        </div>
                    </div>
                    <div id="contrast-list" style="display: flex; flex-direction: column; gap: 8px; flex: 1; overflow-y: auto;">
                        <p style="text-align: center; opacity: 0.5; font-size: 12px; margin-top: 20px;">请选择预设并开始对比</p>
                    </div>
                </div>

                <!-- Stitch Tab -->
                <div id="zero-tab-stitch" class="zero-tab-content" style="padding: 12px; display: none; flex-direction: column; gap: 12px; position: relative; flex: 1; overflow: hidden; height: 100%;">
                    <div class="stitch-setup" style="display: flex; flex-direction: column; gap: 8px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                            <span style="font-size: 12px; opacity: 0.7; width: 80px; flex-shrink: 0;">源预设 (A):</span>
                            <select id="stitch-preset-source" class="interactable" style="flex: 1; min-width: 0; padding: 4px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;"></select>
                            <button id="stitch-swap-btn" class="interactable" title="互换预设" style="width: 28px; height: 28px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                <i class="fa-solid fa-right-left fa-rotate-90"></i>
                            </button>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                            <span style="font-size: 12px; opacity: 0.7; width: 80px; flex-shrink: 0;">目标预设 (B):</span>
                            <select id="stitch-preset-target" class="interactable" style="flex: 1; min-width: 0; padding: 4px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;"></select>
                            <button id="stitch-mode-toggle" class="interactable" title="切换批量模式" style="width: 28px; height: 28px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-right: 4px;">
                                <i class="fa-solid fa-layer-group"></i>
                            </button>
                            <button id="stitch-search-toggle" class="interactable" title="展开/折叠搜索" style="width: 28px; height: 28px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                <i class="fa-solid fa-magnifying-glass"></i>
                            </button>
                        </div>
                        <div id="stitch-search-container" style="display: none; flex-direction: column; gap: 6px; margin-top: 4px; padding: 6px 0; background: none; box-shadow: none;">
                            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                                <span style="font-size: 11px; opacity: 0.7; width: 60px; flex-shrink: 0;">搜索条目:</span>
                                <div style="position: relative; flex: 1; display: flex; align-items: center;">
                                    <input type="text" id="stitch-search-input" class="interactable" placeholder="输入关键字搜索..." style="width: 100%; padding: 0 24px 0 8px; height: 28px !important; box-sizing: border-box !important; line-height: 1.2 !important; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-size: inherit !important;">
                                    <i id="stitch-search-clear" class="fa-solid fa-circle-xmark interactable" title="清空搜索" style="position: absolute; right: 8px; cursor: pointer; opacity: 0.5; display: none; font-size: 12px;"></i>
                                </div>
                            </div>
                            <div id="stitch-search-filters" style="display: flex; gap: 6px; align-items: center; padding-left: 68px;">
                                <span class="stitch-search-filter-badge interactable active" data-filter="name" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">名称</span>
                                <span class="stitch-search-filter-badge interactable active" data-filter="content" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">内容</span>
                                <span class="stitch-search-filter-badge interactable active" data-filter="note" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">备注</span>
                                <span class="stitch-search-filter-badge interactable active" data-filter="origin" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">来源</span>
                            </div>
                        </div>
                    </div>
                    <div id="stitch-controls" style="display: none; align-items: center; gap: 6px; padding: 4px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-top: 4px; flex-shrink: 0;">
                        <div style="display: flex; gap: 4px;">
                            <button id="stitch-all" class="interactable" title="全选" style="width: 32px; height: 32px; padding: 0; background: rgba(255,255,255,0.05); color: inherit; border: none; border-radius: 4px; cursor: pointer;">
                                <i class="fa-solid fa-check-double"></i>
                            </button>
                            <button id="stitch-invert" class="interactable" title="反选" style="width: 32px; height: 32px; padding: 0; background: rgba(255,255,255,0.05); color: inherit; border: none; border-radius: 4px; cursor: pointer;">
                                <i class="fa-solid fa-right-left"></i>
                            </button>
                            <button id="stitch-range" class="interactable" title="连选 (勾选起始和结束条目后点击)" style="width: 32px; height: 32px; padding: 0; background: rgba(255,255,255,0.05); color: inherit; border: none; border-radius: 4px; cursor: pointer;">
                                <i class="fa-solid fa-arrows-up-down"></i>
                            </button>
                        </div>
                        <div style="flex: 1;"></div>
                        <div style="display: flex; gap: 6px;">
                            <button id="stitch-batch-delete" class="interactable" title="从源预设中删除选中的条目" style="width: 32px; height: 32px; padding: 0; background: rgba(255,0,0,0.1); color: #ff5f5f; border: none; border-radius: 4px; cursor: pointer;">
                                <i class="fa-solid fa-trash-can"></i>
                            </button>
                            <button id="stitch-batch-move" class="interactable" title="在本预设内移动选中的条目" style="width: 32px; height: 32px; padding: 0; background: rgba(255,255,255,0.1); color: inherit; border: none; border-radius: 4px; cursor: pointer;">
                                <i class="fa-solid fa-sort"></i>
                            </button>
                            <button id="stitch-batch-fav" class="interactable" title="批量收藏" style="width: 32px; height: 32px; padding: 0; background: rgba(255, 255, 255, 0.05); color: var(--SmartThemeQuoteColor); border: 1px solid var(--SmartThemeQuoteColor); border-radius: 4px; cursor: pointer;">
                                <i class="fa-solid fa-star"></i>
                            </button>
                            <button id="stitch-batch-execute" class="interactable" title="批量缝合" style="width: 32px; height: 32px; padding: 0; background: var(--SmartThemeQuoteColor); color: white; border: none; border-radius: 4px; cursor: pointer;">
                                <i class="fa-solid fa-arrow-right-to-bracket"></i>
                            </button>
                        </div>
                    </div>
                    <div id="stitch-list" style="display: flex; flex-direction: column; gap: 8px; flex: 1; overflow-y: auto; padding-bottom: 60px;">
                        <p style="text-align: center; opacity: 0.5; font-size: 12px; margin-top: 20px;">请选择预设并开始缝合</p>
                    </div>

                    <!-- PEEK DRAWER -->
                    <div id="stitch-target-peek-drawer" style="
                        display: none;
                        position: absolute;
                        right: 12px;
                        bottom: 12px;
                        z-index: 100;
                        transition: none;
                        box-shadow: 0 -4px 16px rgba(0,0,0,0.25);
                        background: var(--SmartThemeBlurTintColor);
                        border: 1px solid var(--SmartThemeBorderColor);
                        border-radius: 12px;
                        overflow: hidden;
                        display: flex;
                        flex-direction: column;
                    ">
                        <div id="stitch-peek-header" class="interactable" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: 10px 16px;
                            background: rgba(255,255,255,0.05);
                            border-bottom: 1px solid var(--SmartThemeBorderColor);
                            cursor: pointer;
                            user-select: none;
                            flex-shrink: 0;
                        ">
                            <div style="font-weight: bold; font-size: 13px; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-eye"></i> 目标预设 (B)
                            </div>
                             <div style="display: flex; align-items: center; gap: 8px;">
                                <button id="stitch-peek-search-toggle" class="interactable" title="展开/折叠搜索" style="width: 24px; height: 24px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 11px; margin-right: 4px;">
                                    <i class="fa-solid fa-magnifying-glass"></i>
                                </button>
                                <div id="stitch-peek-toggle-icon" style="font-size: 12px; opacity: 0.8;">
                                    <i class="fa-solid fa-chevron-up"></i>
                                </div>
                            </div>
                        </div>
                        <div id="stitch-peek-body" style="
                            display: none;
                            flex-direction: column;
                            gap: 8px;
                            padding: 12px;
                            overflow-y: auto;
                            flex: 1;
                        ">
                            <div id="stitch-peek-search-container" style="display: none; flex-direction: column; gap: 6px; margin-bottom: 8px; flex-shrink: 0; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                                <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                                    <span style="font-size: 11px; opacity: 0.7; width: 60px; flex-shrink: 0;">搜索条目:</span>
                                    <div style="position: relative; flex: 1; display: flex; align-items: center;">
                                        <input type="text" id="stitch-peek-search-input" class="interactable" placeholder="输入关键字搜索..." style="width: 100%; padding: 0 24px 0 8px; height: 28px !important; box-sizing: border-box !important; line-height: 1.2 !important; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-size: inherit !important;">
                                        <i id="stitch-peek-search-clear" class="fa-solid fa-circle-xmark interactable" title="清空搜索" style="position: absolute; right: 8px; cursor: pointer; opacity: 0.5; display: none; font-size: 12px;"></i>
                                    </div>
                                </div>
                                <div id="stitch-peek-search-filters" style="display: flex; gap: 6px; align-items: center; padding-left: 68px;">
                                    <span class="stitch-peek-search-filter-badge interactable active" data-filter="name" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">名称</span>
                                    <span class="stitch-peek-search-filter-badge interactable active" data-filter="content" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">内容</span>
                                    <span class="stitch-peek-search-filter-badge interactable active" data-filter="note" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">备注</span>
                                    <span class="stitch-peek-search-filter-badge interactable active" data-filter="origin" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">来源</span>
                                </div>
                            </div>
                            <div id="stitch-peek-list" style="display: flex; flex-direction: column; gap: 6px;"></div>
                        </div>
                    </div>
                </div>

                <!-- Regex Tab -->
                <div id="zero-tab-regex" class="zero-tab-content" style="padding: 12px; display: none; flex-direction: column; gap: 12px; position: relative; flex: 1; overflow: hidden; height: 100%;">
                    <div class="regex-setup" style="display: flex; flex-direction: column; gap: 8px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                            <span style="font-size: 12px; opacity: 0.7; width: 60px; flex-shrink: 0;">预设 A:</span>
                            <select id="regex-preset-source" class="interactable" style="flex: 1; min-width: 0; padding: 4px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;"></select>
                            <button id="regex-swap-btn" class="interactable" title="互换预设 A 与 B" style="width: 28px; height: 28px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                <i class="fa-solid fa-right-left fa-rotate-90"></i>
                            </button>
                        </div>
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                            <span style="font-size: 12px; opacity: 0.7; width: 60px; flex-shrink: 0;">预设 B:</span>
                            <select id="regex-preset-target" class="interactable" style="flex: 1; min-width: 0; padding: 4px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;"></select>
                            <button id="regex-refresh-btn" class="interactable" title="刷新列表" style="width: 28px; height: 28px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                <i class="fa-solid fa-rotate"></i>
                            </button>
                        </div>
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px;">
                            <select id="regex-filter-select" class="interactable" style="flex: 1; min-width: 0; padding: 4px 8px; height: 28px !important; box-sizing: border-box !important; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-size: 12px;">
                                <option value="all">全部</option>
                                <option value="onlyA">仅 A 有</option>
                                <option value="onlyB">仅 B 有</option>
                                <option value="both">都有</option>
                            </select>
                            <div style="display: flex; gap: 4px; flex-shrink: 0;">
                                <button id="regex-select-all" class="interactable" title="全选" style="width: 28px; height: 28px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;">
                                    <i class="fa-solid fa-check-double"></i>
                                </button>
                                <button id="regex-select-invert" class="interactable" title="反选" style="width: 28px; height: 28px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;">
                                    <i class="fa-solid fa-right-left"></i>
                                </button>
                                <button id="regex-select-range" class="interactable" title="连选 (勾选起始和结束项目后点击)" style="width: 28px; height: 28px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;">
                                    <i class="fa-solid fa-arrows-up-down"></i>
                                </button>
                            </div>
                            <button id="regex-migrate-selected-btn" class="interactable" title="迁移选中正则" style="width: 28px; height: 28px; padding: 0; background: var(--SmartThemeQuoteColor); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                <i class="fa-solid fa-file-export"></i>
                            </button>
                        </div>
                    </div>
                    <div id="regex-list" style="display: flex; flex-direction: column; gap: 6px; flex: 1; min-height: 0; max-height: 550px; overflow-y: auto !important; -webkit-overflow-scrolling: touch;">
                        <p style="text-align: center; opacity: 0.5; font-size: 12px; margin-top: 20px;">请选择预设并管理正则</p>
                    </div>
                </div>

                <!-- Check Tab -->
                <div id="zero-tab-check" class="zero-tab-content" style="padding: 12px; display: none; flex-direction: column; gap: 12px; flex: 1; overflow: hidden; height: 100%;">
                    <div class="check-setup" style="display: flex; flex-direction: column; gap: 8px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                            <span style="font-size: 12px; opacity: 0.7; width: 60px; flex-shrink: 0;">预设:</span>
                            <select id="check-preset-select" class="interactable" style="flex: 1; min-width: 0; padding: 4px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px;"></select>
                            <button id="check-refresh-btn" class="interactable" title="刷新自查" style="width: 32px; height: 32px; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer;"><i class="fa-solid fa-rotate"></i></button>
                        </div>
                    </div>
                    <div id="check-results-container" style="display: flex; flex-direction: column; gap: 8px; flex: 1; overflow-y: auto;">
                        <p style="text-align: center; opacity: 0.5; font-size: 12px; margin-top: 20px;">请选择预设并开始自查</p>
                    </div>
                </div>

                <!-- Manage Tab -->
                <div id="zero-tab-manage" class="zero-tab-content" style="padding: 12px; display: none; flex-direction: column; gap: 12px; flex: 1; overflow: hidden; height: 100%;">
                    <div style="display: flex; gap: 8px; margin-bottom: 4px; flex-shrink: 0;">
                        <button id="manage-import" class="interactable" style="flex: 1; padding: 10px; font-size: 13px; background: var(--SmartThemeQuoteColor); color: white; border: none; border-radius: 8px;"><i class="fa-solid fa-file-import"></i> 批量导入</button>
                        <button id="manage-delete" class="interactable" style="flex: 1; padding: 10px; font-size: 13px; background: rgba(255,100,100,0.1); color: #ff5555; border: none; border-radius: 8px;"><i class="fa-solid fa-trash-can"></i> 批量删除</button>
                    </div>
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 0 4px; font-size: 12px; opacity: 0.6; flex-shrink: 0;">
                        <span>全部预设</span>
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                            <input type="checkbox" id="manage-select-all" class="interactable"> <span>全选</span>
                        </label>
                    </div>
                    <div id="manage-preset-list" style="display: flex; flex-direction: column; gap: 6px; flex: 1; overflow-y: auto;"></div>
                    <input type="file" id="manage-import-input" multiple accept=".json" style="display: none;">
                </div>

                <!-- Settings Tab -->
                <div id="zero-tab-settings" class="zero-tab-content" style="padding: 12px 12px 80px 12px; display: none; flex-direction: column; gap: 12px; flex: 1; overflow-y: auto !important; -webkit-overflow-scrolling: touch; min-height: 0;">
                    <!-- 1. 通知设置 (折叠) -->
                    <div class="zero-settings-section" style="
                        display: flex;
                        flex-direction: column;
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid var(--SmartThemeBorderColor, #444);
                        border-radius: 10px;
                        overflow: hidden;
                    ">
                        <div class="zero-settings-header interactable" id="zero-settings-toast-toggle" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: 14px;
                            cursor: pointer;
                            user-select: none;
                        ">
                            <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-bell" style="color: var(--SmartThemeQuoteColor);"></i> 通知
                            </div>
                            <i class="fa-solid fa-chevron-right zero-settings-chevron" style="transition: transform 0.15s; font-size: 12px; opacity: 0.7;"></i>
                        </div>
                        <div class="zero-settings-body" id="zero-settings-toast-body" style="
                            display: none;
                            flex-direction: column;
                            gap: 14px;
                            padding: 0 14px 14px 14px;
                        ">
                            <!-- 快照切换 -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">快照切换</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">应用或切换快照成功时，显示 Toast 提示信息。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-toast-switch" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                            <!-- 快照覆盖 -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">快照覆盖</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">使用当前状态覆盖已有快照成功时，显示 Toast 提示信息。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-toast-overwrite" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                            <!-- 预设缝合 -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">预设缝合</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">条目缝合至目标预设成功时，显示 Toast 提示信息。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-toast-stitch" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                            <!-- 快照二次确认 -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">快照二次确认</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">应用或覆盖快照时，显示二次确认弹窗。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-confirm-snapshot" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- 2. 快照与模型方案 (折叠) -->
                    <div class="zero-settings-section" style="
                        display: flex;
                        flex-direction: column;
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid var(--SmartThemeBorderColor, #444);
                        border-radius: 10px;
                        overflow: hidden;
                    ">
                        <div class="zero-settings-header interactable" id="zero-settings-decouple-toggle" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: 14px;
                            cursor: pointer;
                            user-select: none;
                        ">
                            <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-camera" style="color: var(--SmartThemeQuoteColor);"></i> 快照与模型方案
                            </div>
                            <i class="fa-solid fa-chevron-right zero-settings-chevron" style="transition: transform 0.15s; font-size: 12px; opacity: 0.7;"></i>
                        </div>
                        
                        <div class="zero-settings-body" id="zero-settings-decouple-body" style="
                            display: none;
                            flex-direction: column;
                            gap: 12px;
                            padding: 0 14px 14px 14px;
                        ">
                            <!-- Decouple Option -->
                            <div class="zero-settings-option-card interactable" data-val="true">
                                <input type="radio" name="zero-setting-decouple" value="true" class="interactable" style="margin-top: 3px; accent-color: var(--SmartThemeQuoteColor); width: 15px; height: 15px; cursor: pointer;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 3px; color: var(--SmartThemeBodyColor);">完全解耦模式</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">快照部分仅管理日常条目，不控制或保存破限条目、采样参数及附加参数。破限相关的条目与参数独立交由「模型方案」进行专属管理。</span>
                                </div>
                            </div>
                            <!-- No Decouple Option -->
                            <div class="zero-settings-option-card interactable" data-val="false">
                                <input type="radio" name="zero-setting-decouple" value="false" class="interactable" style="margin-top: 3px; accent-color: var(--SmartThemeQuoteColor); width: 15px; height: 15px; cursor: pointer;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 3px; color: var(--SmartThemeBodyColor);">不解耦模式 (默认)</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">快照部分统一管理日常和破限条目。创建或应用快照时，会一并记录和恢复所有条目的开关状态，并保存与还原当前预设的采样参数及附加参数。</span>
                                </div>
                            </div>
                            <!-- Content Comparison Switch -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">预设迁移时内容对比</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">在导入与迁移快照时，开启对未成功匹配的条目进行内容文本相似度比对。关闭此项可极大提升导入面板的加载速度。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-migrate-compare" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- 3. 缝合设置 (折叠) -->
                    <div class="zero-settings-section" style="
                        display: flex;
                        flex-direction: column;
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid var(--SmartThemeBorderColor, #444);
                        border-radius: 10px;
                        overflow: hidden;
                    ">
                        <div class="zero-settings-header interactable" id="zero-settings-stitch-toggle" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: 14px;
                            cursor: pointer;
                            user-select: none;
                        ">
                            <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-scissors" style="color: var(--SmartThemeQuoteColor);"></i> 缝合设置
                            </div>
                            <i class="fa-solid fa-chevron-right zero-settings-chevron" style="transition: transform 0.15s; font-size: 12px; opacity: 0.7;"></i>
                        </div>
                        <div class="zero-settings-body" id="zero-settings-stitch-body" style="
                            display: none;
                            flex-direction: column;
                            gap: 14px;
                            padding: 0 14px 14px 14px;
                        ">
                            <!-- 缝合成功后收起目标预设 B -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">缝合成功后收起目标预设 B</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">在缝合模块，成功将条目缝合后，目标预设 B 抽屉自动收回折叠状态。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-stitch-collapse-b" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                            <!-- 自动迁移绑定的预设正则 -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">自动迁移绑定的预设正则</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">在跨预设缝合或覆盖条目时，自动将条目所绑定的预设正则脚本同步迁移至目标预设。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-stitch-auto-migrate-regex" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                            <!-- 缝合界面正则绑定 Badge 展示模式 -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">缝合界面绑定正则展示模式</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">控制缝合 Tab 列表中提示词条目旁正则绑定 Badge 的展示策略。</span>
                                </div>
                                <select id="zero-setting-stitch-regex-badge-mode" class="interactable" style="padding: 4px 8px; font-size: 12px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; flex-shrink: 0;">
                                    <option value="bound_only">仅展示已绑定 (默认)</option>
                                    <option value="all">全部展示 (含未绑定虚线按钮)</option>
                                    <option value="none">不展示</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 4. UI 设置 (折叠) -->
                    <div class="zero-settings-section" style="
                        display: flex;
                        flex-direction: column;
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid var(--SmartThemeBorderColor, #444);
                        border-radius: 10px;
                        overflow: hidden;
                    ">
                        <div class="zero-settings-header interactable" id="zero-settings-ui-toggle" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: 14px;
                            cursor: pointer;
                            user-select: none;
                        ">
                            <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-palette" style="color: var(--SmartThemeQuoteColor);"></i> UI
                            </div>
                            <i class="fa-solid fa-chevron-right zero-settings-chevron" style="transition: transform 0.15s; font-size: 12px; opacity: 0.7;"></i>
                        </div>
                        
                        <div class="zero-settings-body" id="zero-settings-ui-body" style="
                            display: none;
                            flex-direction: column;
                            gap: 14px;
                            padding: 0 14px 14px 14px;
                        ">
                            <!-- 搜索框展开动画 -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">搜索框展开动画</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">在相机栏界面，点击搜索图标展开搜索框时显示平滑 of 过渡动画。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-ui-search-anim" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>

                            <!-- 导航与状态栏设置 (子折叠) -->
                            <div class="zero-settings-section sub-section" style="
                                display: flex;
                                flex-direction: column;
                                background: rgba(0, 0, 0, 0.15);
                                border: 1px solid rgba(255, 255, 255, 0.05);
                                border-radius: 8px;
                                overflow: hidden;
                                margin-top: 4px;
                            ">
                                <div class="zero-settings-header sub-header interactable" id="zero-settings-nav-status-toggle" style="
                                    display: flex;
                                    align-items: center;
                                    justify-content: space-between;
                                    padding: 10px 12px;
                                    cursor: pointer;
                                    user-select: none;
                                ">
                                    <div style="font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; color: var(--SmartThemeBodyColor);">
                                        <i class="fa-solid fa-square-caret-down" style="color: var(--SmartThemeQuoteColor); font-size: 13px;"></i> 导航与状态栏设置
                                    </div>
                                    <i class="fa-solid fa-chevron-right zero-settings-chevron" style="transition: transform 0.15s; font-size: 10px; opacity: 0.7;"></i>
                                </div>
                                <div class="zero-settings-body sub-body" id="zero-settings-nav-status-body" style="
                                    display: none;
                                    flex-direction: column;
                                    gap: 12px;
                                    padding: 0 12px 12px 12px;
                                ">
                                    <!-- 避让顶部状态栏 -->
                                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 8px;">
                                        <div style="flex: 1;">
                                            <strong style="display: block; font-size: 12px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">避让顶部状态栏</strong>
                                            <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">在移动端全屏显示时，为顶部留出安全区域以避让系统状态栏或刘海屏。</span>
                                        </div>
                                        <label class="zero-switch">
                                            <input type="checkbox" id="zero-setting-ui-avoid-statusbar" class="interactable">
                                            <span class="zero-slider"></span>
                                        </label>
                                    </div>

                                    <!-- Tab 标题样式 -->
                                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                        <div style="flex: 1;">
                                            <strong style="display: block; font-size: 12px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">Tab 标题样式</strong>
                                            <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">选择预设管理顶部 Tab 页签显示文字还是 FontAwesome 图标。</span>
                                        </div>
                                        <select id="zero-setting-ui-tab-style" class="interactable" style="padding: 4px 8px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-size: 12px; cursor: pointer;">
                                            <option value="text">文字标题</option>
                                            <option value="icon">图标标题</option>
                                        </select>
                                    </div>

                                    <!-- Tab 栏位置 -->
                                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                        <div style="flex: 1;">
                                            <strong style="display: block; font-size: 12px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">Tab 栏位置</strong>
                                            <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">将 Tab 导航栏放置在页面顶部或底部（底部模式更适合手机手势操作）。</span>
                                        </div>
                                        <select id="zero-setting-ui-tab-pos" class="interactable" style="padding: 4px 8px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-size: 12px; cursor: pointer;">
                                            <option value="top">顶部标题</option>
                                            <option value="bottom">底部标题</option>
                                        </select>
                                    </div>

                                    <!-- Tab 标题大小 -->
                                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                        <div style="flex: 1;">
                                            <strong style="display: block; font-size: 12px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">Tab 标题大小</strong>
                                            <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">调整预设管理 Tab 栏页签标题（包含文字和图标）的显示大小。</span>
                                        </div>
                                        <select id="zero-setting-ui-tab-size" class="interactable" style="padding: 4px 8px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-size: 12px; cursor: pointer;">
                                            <option value="13px">小 (13px)</option>
                                            <option value="15px">中 (15px - 默认)</option>
                                            <option value="17px">大 (17px)</option>
                                            <option value="19px">超大 (19px)</option>
                                        </select>
                                    </div>

                                    <!-- 点击当前激活 Tab 退出 -->
                                    <div id="zero-setting-ui-active-exit-row" style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                        <div style="flex: 1;">
                                            <strong style="display: block; font-size: 12px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">点击当前激活 Tab 退出</strong>
                                            <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">Tab 栏在底部时，点击当前已处于激活状态 of Tab 页签可隐藏关闭按钮并直接退出预设管理。</span>
                                        </div>
                                        <label class="zero-switch">
                                            <input type="checkbox" id="zero-setting-ui-active-exit" class="interactable">
                                            <span class="zero-slider"></span>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <!-- 快照弹窗设置 (子折叠) -->
                            <div class="zero-settings-section sub-section" style="
                                display: flex;
                                flex-direction: column;
                                background: rgba(0, 0, 0, 0.15);
                                border: 1px solid rgba(255, 255, 255, 0.05);
                                border-radius: 8px;
                                overflow: hidden;
                                margin-top: 8px;
                            ">
                                <div class="zero-settings-header sub-header interactable" id="zero-settings-snapshot-modal-toggle" style="
                                    display: flex;
                                    align-items: center;
                                    justify-content: space-between;
                                    padding: 10px 12px;
                                    cursor: pointer;
                                    user-select: none;
                                ">
                                    <div style="font-weight: 600; font-size: 13px; display: flex; align-items: center; gap: 6px; color: var(--SmartThemeBodyColor);">
                                        <i class="fa-solid fa-window-restore" style="color: var(--SmartThemeQuoteColor); font-size: 13px;"></i> 快照弹窗样式与比例
                                    </div>
                                    <i class="fa-solid fa-chevron-right zero-settings-chevron" style="transition: transform 0.15s; font-size: 10px; opacity: 0.7;"></i>
                                </div>
                                <div class="zero-settings-body sub-body" id="zero-settings-snapshot-modal-body" style="
                                    display: none;
                                    flex-direction: column;
                                    gap: 12px;
                                    padding: 0 12px 12px 12px;
                                ">
                                    <!-- 快照弹窗样式 -->
                                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-top: 8px;">
                                        <div style="flex: 1;">
                                            <strong style="display: block; font-size: 12px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">快照弹窗样式</strong>
                                            <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">设置快照面板显示为普通中心弹窗，还是从特定方向滑出。</span>
                                        </div>
                                        <select id="zero-setting-ui-modal-style" class="interactable" style="padding: 4px 8px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-size: 12px; cursor: pointer;">
                                            <option value="center">普通弹窗</option>
                                            <option value="top">从上弹出</option>
                                            <option value="bottom">从下弹出</option>
                                            <option value="left">从左弹出</option>
                                            <option value="right">从右弹出</option>
                                        </select>
                                    </div>

                                    <!-- 快照弹窗动效 -->
                                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                        <div style="flex: 1;">
                                            <strong style="display: block; font-size: 12px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">快照弹窗动效</strong>
                                            <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">设置快照面板显示时的过渡动画效果。</span>
                                        </div>
                                        <select id="zero-setting-ui-modal-anim" class="interactable" style="padding: 4px 8px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-size: 12px; cursor: pointer;">
                                            <option value="slide">方向滑入</option>
                                            <option value="scale">弹性缩放</option>
                                            <option value="fade">渐显淡入</option>
                                            <option value="none">无动画</option>
                                        </select>
                                    </div>
                                    
                                    <!-- 快照弹窗所占比例 -->
                                    <div style="display: flex; flex-direction: column; gap: 6px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px;">
                                            <div style="flex: 1;">
                                                <strong style="display: block; font-size: 12px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">弹窗尺寸比例</strong>
                                                <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">调整快照弹窗在对应弹出方向上的屏幕高度/宽度占比。</span>
                                            </div>
                                            <span id="zero-setting-ui-modal-scale-val" style="font-size: 12px; font-weight: bold; color: var(--SmartThemeQuoteColor);">80%</span>
                                        </div>
                                        <input type="range" id="zero-setting-ui-modal-scale" class="interactable" min="20" max="100" step="5" style="width: 100%; accent-color: var(--SmartThemeQuoteColor); cursor: pointer; background: rgba(255,255,255,0.1); border-radius: 4px; height: 6px; outline: none; margin-top: 4px;">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 5. 对照设置 (折叠) -->
                    <div class="zero-settings-section" style="
                        display: flex;
                        flex-direction: column;
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid var(--SmartThemeBorderColor, #444);
                        border-radius: 10px;
                        overflow: hidden;
                    ">
                        <div class="zero-settings-header interactable" id="zero-settings-contrast-toggle" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: 14px;
                            cursor: pointer;
                            user-select: none;
                        ">
                            <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-code-compare" style="color: var(--SmartThemeQuoteColor);"></i> 对照设置
                            </div>
                            <i class="fa-solid fa-chevron-right zero-settings-chevron" style="transition: transform 0.15s; font-size: 12px; opacity: 0.7;"></i>
                        </div>
                        <div class="zero-settings-body" id="zero-settings-contrast-body" style="
                            display: none;
                            flex-direction: column;
                            gap: 14px;
                            padding: 0 14px 14px 14px;
                        ">
                            <!-- 内容自动匹配 -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">内容相似度匹配</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">对名称不一致的条目根据文本内容相似度进行自动匹配。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-contrast-similarity-enable" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                            <!-- 相似度匹配阈值 -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">匹配相似度阈值</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">设定内容相似度自动关联的百分比阈值 (1% - 100%)。</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 4px;">
                                    <input type="number" id="zero-setting-contrast-similarity-threshold" class="interactable" min="1" max="100" step="1" value="80" style="width: 50px; padding: 4px 6px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; text-align: center; font-size: 12px;">
                                    <span style="font-size: 12px; opacity: 0.8;">%</span>
                                </div>
                            </div>
                            <!-- 切换键位置设置 (顶部) -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">在顶部显示功能键</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">在对比详情的属性对比区域下方显示「上一个」「下一个」切换按钮。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-contrast-nav-top" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                            <!-- 切换键位置设置 (中部) -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">在中部显示功能键</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">在对比详情的预设 A 内容框下方显示「上一个」「下一个」切换按钮。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-contrast-nav-middle" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                            <!-- 切换键位置设置 (底部) -->
                            <div style="display: flex; align-items: center; justify-content: space-between; gap: 20px; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 12px; margin-top: 4px;">
                                <div style="flex: 1;">
                                    <strong style="display: block; font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); margin-bottom: 2px;">在底部显示功能键</strong>
                                    <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.4;">在对比详情的最底部显示「上一个」「下一个」切换栏。</span>
                                </div>
                                <label class="zero-switch">
                                    <input type="checkbox" id="zero-setting-contrast-nav-bottom" class="interactable">
                                    <span class="zero-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- 6. 使用教程 (折叠) -->
                    <div class="zero-settings-section" style="
                        display: flex;
                        flex-direction: column;
                        background: rgba(255, 255, 255, 0.03);
                        border: 1px solid var(--SmartThemeBorderColor, #444);
                        border-radius: 10px;
                        overflow: hidden;
                    ">
                        <div class="zero-settings-header interactable" id="zero-settings-tutorial-toggle" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: 14px;
                            cursor: pointer;
                            user-select: none;
                        ">
                            <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-book" style="color: var(--SmartThemeQuoteColor);"></i> 使用教程
                            </div>
                            <i class="fa-solid fa-chevron-right zero-settings-chevron" style="transition: transform 0.15s; font-size: 12px; opacity: 0.7;"></i>
                        </div>
                        <div class="zero-settings-body" id="zero-settings-tutorial-body" style="
                            display: none;
                            flex-direction: column;
                            gap: 16px;
                            padding: 0 14px 14px 14px;
                        ">
                            <!-- 1. 快照与相机栏 -->
                            <div style="border-bottom: 1px dashed rgba(255,255,255,0.06); padding-bottom: 12px;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                    <i class="fa-solid fa-camera" style="color: var(--SmartThemeQuoteColor); font-size: 14px;"></i>
                                    <strong style="font-size: 13px; color: var(--SmartThemeBodyColor);">快照与相机浮窗</strong>
                                </div>
                                <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.5; padding-left: 22px;">
                                    点击顶部/侧边 QR 栏的相机图标，即可弹出快照管理面板。支持一键创建快照、精准还原特定历史状态，并提供分组管理与隐藏功能，方便您快速切换条目状态。
                                </span>
                            </div>

                            <!-- 2. 对照模块 -->
                            <div style="border-bottom: 1px dashed rgba(255,255,255,0.06); padding-bottom: 12px;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                    <i class="fa-solid fa-code-compare" style="color: var(--SmartThemeQuoteColor); font-size: 14px;"></i>
                                    <strong style="font-size: 13px; color: var(--SmartThemeBodyColor);">差异对照 (Contrast)</strong>
                                </div>
                                <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.5; padding-left: 22px;">
                                    在预设管理器中选择「对照」页，可以对两个预设的 Prompt 块进行多维度比对。支持直观的高亮 Diff 视图展示，并允许一键将单个条目的改动、新增或缺失同步到另一方。
                                </span>
                            </div>

                            <!-- 3. 缝合模块 -->
                            <div style="border-bottom: 1px dashed rgba(255,255,255,0.06); padding-bottom: 12px;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                    <i class="fa-solid fa-scissors" style="color: var(--SmartThemeQuoteColor); font-size: 14px;"></i>
                                    <strong style="font-size: 13px; color: var(--SmartThemeBodyColor);">预设缝合 (Stitch)</strong>
                                </div>
                                <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.5; padding-left: 22px;">
                                    「缝合」模块用于灵活搬运条目。您可以将源预设 A 中的多个 Prompt 块拖拽排序或一键复制导入目标预设 B。内置了批量选择、连选、批量收藏和批量删除功能。
                                </span>
                            </div>

                            <!-- 4. 自查模块 -->
                            <div style="border-bottom: 1px dashed rgba(255,255,255,0.06); padding-bottom: 12px;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                    <i class="fa-solid fa-circle-check" style="color: var(--SmartThemeQuoteColor); font-size: 14px;"></i>
                                    <strong style="font-size: 13px; color: var(--SmartThemeBodyColor);">合规自查 (Checker)</strong>
                                </div>
                                <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.5; padding-left: 22px;">
                                    使用「自查」模块对指定预设进行静态检查。自动识别宏语法损坏（如 <code>{{}}</code> 缺失）、Token 超限风险、拼写或敏感占位符等问题，帮助您在运行前排查潜在故障。
                                </span>
                            </div>

                            <!-- 5. 批量管理 -->
                            <div>
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                                    <i class="fa-solid fa-list-check" style="color: var(--SmartThemeQuoteColor); font-size: 14px;"></i>
                                    <strong style="font-size: 13px; color: var(--SmartThemeBodyColor);">批量管理与备份 (Manage)</strong>
                                </div>
                                <span style="display: block; font-size: 11px; color: var(--SmartThemeEmColor, #999); line-height: 1.5; padding-left: 22px;">
                                    「管理」模块支持批量的预设 JSON 文件导入及删除。无需逐个手动设置，轻松同步外部他人的高级预设，并与原生预设下拉菜单无缝联动。
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (!$('#zero-styles').length) {
        $('head').append(`
            <style id="zero-styles">
                #stitch-target-peek-drawer {
                    position: absolute !important;
                    right: 12px;
                    bottom: 12px;
                    width: 320px;
                    height: 38px; /* Collapsed state */
                }
                #stitch-target-peek-drawer.expanded {
                    height: 400px; /* Expanded height on desktop */
                    max-height: calc(100% - 24px);
                }
                #stitch-target-peek-drawer.expanded #stitch-peek-body {
                    display: flex !important;
                }
                @media (max-width: 768px) {
                    #stitch-target-peek-drawer {
                        width: calc(100% - 24px) !important;
                        left: 12px;
                        right: 12px !important;
                        bottom: 12px !important;
                    }
                    #stitch-target-peek-drawer.expanded {
                        height: 60% !important; /* On mobile, cover 60% */
                        max-height: 80vh !important;
                    }
                }
                #stitch-list::-webkit-scrollbar,
                #contrast-list::-webkit-scrollbar,
                #check-results-container::-webkit-scrollbar,
                #manage-preset-list::-webkit-scrollbar,
                #stitch-peek-body::-webkit-scrollbar {
                    display: none;
                }
                #stitch-list,
                #contrast-list,
                #check-results-container,
                #manage-preset-list,
                #stitch-peek-body {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
                .stitch-peek-insert-btn {
                    transition: all 0.15s ease;
                }
                .stitch-peek-insert-btn:hover {
                    opacity: 1 !important;
                    color: var(--SmartThemeQuoteColor, #7b8cde) !important;
                    transform: scale(1.2);
                }
                .manage-preset-rename {
                    transition: opacity 0.15s ease;
                }
                .manage-preset-rename:hover {
                    opacity: 1 !important;
                    color: var(--SmartThemeQuoteColor, #7b8cde);
                }
                .zero-settings-option-card {
                     display: flex;
                     align-items: flex-start;
                     gap: 12px;
                     padding: 12px;
                     background: rgba(255, 255, 255, 0.02);
                     border: 1px solid transparent;
                     border-radius: 8px;
                     cursor: pointer;
                     transition: all 0.15s ease-out;
                 }
                 .zero-settings-option-card:hover {
                     background: rgba(255, 255, 255, 0.05) !important;
                 }
                 .zero-settings-option-card.active {
                     border-color: var(--SmartThemeQuoteColor, #7b8cde) !important;
                     background: rgba(255, 255, 255, 0.05) !important;
                 }
                 .zero-settings-chevron.expanded {
                     transform: rotate(90deg);
                 }
                 .zero-settings-section {
                     flex-shrink: 0 !important;
                 }
            </style>
        `);
    }

    $('body').append(panelHtml);

    $(`#${PANEL_ID} .zero-tab-link`).on('click', function(e) {
        const tab = $(this).data('tab');
        localStorage.setItem('zero_last_main_tab', tab);
        
        const isActive = $(this).hasClass('active');
        if (isActive && e.originalEvent) {
            const state = UiStateManager.get();
            if (state.tabBarPosition === 'bottom' && state.clickActiveTabToExit === true) {
                closePanel();
                return;
            }
        }

        $(`#${PANEL_ID} .zero-tab-link`).removeClass('active');
        $(this).addClass('active');

        applyTabSettings();

        $(`#${PANEL_ID} .zero-tab-content`).css('display', 'none');
        $(`#zero-tab-${tab}`).css('display', 'flex');
        
        // Defer heavy tab rendering to a macro-task so the tab switch highlights instantly
        setTimeout(() => {
            if (tab === 'manage') {
                if (!renderedTabs.has('manage')) {
                    _manage.renderManageTab();
                    renderedTabs.add('manage');
                }
            }
            else if (tab === 'contrast') {
                if (!renderedTabs.has('contrast')) {
                    populatePresetSelects().then(() => {
                        $('#contrast-search-input').val('');
                        $('#contrast-search-clear').hide();
                        renderedTabs.add('contrast');
                        if (_contrast && typeof _contrast.restoreScroll === 'function') _contrast.restoreScroll();
                    });
                } else {
                    if (_contrast && typeof _contrast.restoreScroll === 'function') _contrast.restoreScroll();
                }
            }
            else if (tab === 'stitch') {
                if (!renderedTabs.has('stitch')) {
                    populatePresetSelects().then(() => {
                        $('#stitch-search-input').val('');
                        $('#stitch-search-clear').hide();
                        $('#stitch-peek-search-input').val('');
                        $('#stitch-peek-search-clear').hide();
                        return _stitch.renderStitchList();
                    }).then(() => {
                        renderedTabs.add('stitch');
                        if (_stitch && typeof _stitch.restorePeekScroll === 'function') _stitch.restorePeekScroll();
                    });
                } else {
                    if (_stitch && typeof _stitch.restorePeekScroll === 'function') _stitch.restorePeekScroll();
                }
            }
            else if (tab === 'regex') {
                if (!renderedTabs.has('regex')) {
                    populatePresetSelects().then(() => {
                        if (_regex) {
                            _regex.initRegexTab();
                            _regex.renderRegexList();
                        }
                        renderedTabs.add('regex');
                    });
                } else {
                    if (_regex) _regex.renderRegexList();
                }
            }
            else if (tab === 'check') {
                if (!renderedTabs.has('check')) {
                    populatePresetSelects().then(() => {
                        _checker.Checker.render('check-results-container', $('#check-preset-select').val());
                        renderedTabs.add('check');
                    });
                }
            }
            else if (tab === 'settings') {
                renderSettingsTab();
            }
        }, 0);
    });

    $(`#zero-panel-close`).on('click', () => closePanel());

    $('body').off('click', '#zero-history-undo').on('click', '#zero-history-undo', async function() {
        const $btn = $(this);
        if ($btn.prop('disabled')) return;
        $('#zero-history-undo, #zero-history-redo')
            .prop('disabled', true)
            .css('opacity', '0.4')
            .css('cursor', 'default');
        try {
            await HistoryManager.undo();
        } finally {
            HistoryManager.updateButtonsState();
        }
    });

    $('body').off('click', '#zero-history-redo').on('click', '#zero-history-redo', async function() {
        const $btn = $(this);
        if ($btn.prop('disabled')) return;
        $('#zero-history-undo, #zero-history-redo')
            .prop('disabled', true)
            .css('opacity', '0.4')
            .css('cursor', 'default');
        try {
            await HistoryManager.redo();
        } finally {
            HistoryManager.updateButtonsState();
        }
    });

    $(window).off('zero-history-changed.zero').on('zero-history-changed.zero', async () => {
        _presetsLastFetch = 0; // Force cache invalidation so fresh preset list renders
        renderedTabs.clear();  // Clear tab rendering cache so all tabs reload fresh data
        await refreshActiveTab();
    });

    // 折叠切换监听
    $('body').off('click', '#zero-settings-toast-toggle').on('click', '#zero-settings-toast-toggle', function() {
        const $body = $('#zero-settings-toast-body');
        const $chevron = $(this).find('.zero-settings-chevron');
        $body.slideToggle(150, function() {
            if ($body.is(':visible')) {
                $body.css('display', 'flex');
                $chevron.addClass('expanded');
            } else {
                $chevron.removeClass('expanded');
            }
        });
    });

    $('body').off('click', '#zero-settings-decouple-toggle').on('click', '#zero-settings-decouple-toggle', function() {
        const $body = $('#zero-settings-decouple-body');
        const $chevron = $(this).find('.zero-settings-chevron');
        $body.slideToggle(150, function() {
            if ($body.is(':visible')) {
                $body.css('display', 'flex');
                $chevron.addClass('expanded');
            } else {
                $chevron.removeClass('expanded');
            }
        });
    });

    $('body').off('click', '#zero-settings-stitch-toggle').on('click', '#zero-settings-stitch-toggle', function() {
        const $body = $('#zero-settings-stitch-body');
        const $chevron = $(this).find('.zero-settings-chevron');
        $body.slideToggle(150, function() {
            if ($body.is(':visible')) {
                $body.css('display', 'flex');
                $chevron.addClass('expanded');
            } else {
                $chevron.removeClass('expanded');
            }
        });
    });

    $('body').off('click', '#zero-settings-ui-toggle').on('click', '#zero-settings-ui-toggle', function() {
        const $body = $('#zero-settings-ui-body');
        const $chevron = $(this).find('.zero-settings-chevron');
        $body.slideToggle(150, function() {
            if ($body.is(':visible')) {
                $body.css('display', 'flex');
                $chevron.addClass('expanded');
            } else {
                $chevron.removeClass('expanded');
            }
        });
    });

    $('body').off('click', '#zero-settings-contrast-toggle').on('click', '#zero-settings-contrast-toggle', function() {
        const $body = $('#zero-settings-contrast-body');
        const $chevron = $(this).find('.zero-settings-chevron');
        $body.slideToggle(150, function() {
            if ($body.is(':visible')) {
                $body.css('display', 'flex');
                $chevron.addClass('expanded');
            } else {
                $chevron.removeClass('expanded');
            }
        });
    });

    $('body').off('click', '#zero-settings-tutorial-toggle').on('click', '#zero-settings-tutorial-toggle', function() {
        const $body = $('#zero-settings-tutorial-body');
        const $chevron = $(this).find('.zero-settings-chevron');
        $body.slideToggle(150, function() {
            if ($body.is(':visible')) {
                $body.css('display', 'flex');
                $chevron.addClass('expanded');
            } else {
                $chevron.removeClass('expanded');
            }
        });
    });

    // 子折叠：导航与状态栏设置
    $('body').off('click', '#zero-settings-nav-status-toggle').on('click', '#zero-settings-nav-status-toggle', function() {
        const $body = $('#zero-settings-nav-status-body');
        const $chevron = $(this).find('.zero-settings-chevron');
        $body.slideToggle(150, function() {
            if ($body.is(':visible')) {
                $body.css('display', 'flex');
                $chevron.addClass('expanded');
            } else {
                $chevron.removeClass('expanded');
            }
        });
    });

    // 子折叠：快照弹窗设置
    $('body').off('click', '#zero-settings-snapshot-modal-toggle').on('click', '#zero-settings-snapshot-modal-toggle', function() {
        const $body = $('#zero-settings-snapshot-modal-body');
        const $chevron = $(this).find('.zero-settings-chevron');
        $body.slideToggle(150, function() {
            if ($body.is(':visible')) {
                $body.css('display', 'flex');
                $chevron.addClass('expanded');
            } else {
                $chevron.removeClass('expanded');
            }
        });
    });

    // 通知开关监听
    $('body').off('change', '#zero-setting-toast-switch').on('change', '#zero-setting-toast-switch', function() {
        const checked = $(this).is(':checked');
        UiStateManager.save({ toastOnSnapshotSwitch: checked });
        toastr.success(checked ? '已开启快照切换提示' : '已关闭快照切换提示');
    });

    $('body').off('change', '#zero-setting-toast-overwrite').on('change', '#zero-setting-toast-overwrite', function() {
        const checked = $(this).is(':checked');
        UiStateManager.save({ toastOnSnapshotOverwrite: checked });
        toastr.success(checked ? '已开启快照覆盖提示' : '已关闭快照覆盖提示');
    });

    $('body').off('change', '#zero-setting-toast-stitch').on('change', '#zero-setting-toast-stitch', function() {
        const checked = $(this).is(':checked');
        UiStateManager.save({ toastOnPresetStitch: checked });
        toastr.success(checked ? '已开启预设缝合提示' : '已关闭预设缝合提示');
    });

    $('body').off('change', '#zero-setting-confirm-snapshot').on('change', '#zero-setting-confirm-snapshot', function() {
        const checked = $(this).is(':checked');
        UiStateManager.save({ confirmOnSnapshot: checked });
        toastr.success(checked ? '已开启快照二次确认' : '已关闭快照二次确认');
    });

    $('body').off('change', '#zero-setting-ui-search-anim').on('change', '#zero-setting-ui-search-anim', function() {
        const checked = $(this).is(':checked');
        UiStateManager.save({ searchBarAnimation: checked });
        toastr.success(checked ? '已开启搜索框展开动画' : '已关闭搜索框展开动画');
    });

    $('body').off('change', '#zero-setting-ui-avoid-statusbar').on('change', '#zero-setting-ui-avoid-statusbar', function() {
        const checked = $(this).is(':checked');
        UiStateManager.save({ avoidStatusbar: checked });
        applyAvoidStatusbar();
        toastr.success(checked ? '已开启避让状态栏' : '已关闭避让状态栏');
    });

    $('body').off('change', '#zero-setting-ui-tab-style').on('change', '#zero-setting-ui-tab-style', function() {
        const val = $(this).val();
        UiStateManager.save({ tabTitleStyle: val });
        applyTabSettings();
        toastr.success('Tab 标题样式已更新');
    });

    $('body').off('change', '#zero-setting-ui-tab-pos').on('change', '#zero-setting-ui-tab-pos', function() {
        const val = $(this).val();
        UiStateManager.save({ tabBarPosition: val });
        applyTabSettings();
        toastr.success('Tab 栏位置已更新');
    });

    $('body').off('change', '#zero-setting-ui-active-exit').on('change', '#zero-setting-ui-active-exit', function() {
        const checked = $(this).is(':checked');
        UiStateManager.save({ clickActiveTabToExit: checked });
        applyTabSettings();
        toastr.success(checked ? '已开启激活 Tab 点击退出' : '已关闭激活 Tab 点击退出');
    });

    $('body').off('change', '#zero-setting-ui-modal-style').on('change', '#zero-setting-ui-modal-style', function() {
        const val = $(this).val();
        UiStateManager.save({ snapshotModalStyle: val });
        toastr.success('快照弹窗样式已更新');
    });

    $('body').off('change', '#zero-setting-ui-modal-anim').on('change', '#zero-setting-ui-modal-anim', function() {
        const val = $(this).val();
        UiStateManager.save({ snapshotModalAnimation: val });
        toastr.success('快照弹窗动效已更新');
    });

    $('body').off('change', '#zero-setting-stitch-collapse-b').on('change', '#zero-setting-stitch-collapse-b', function() {
        const checked = $(this).is(':checked');
        UiStateManager.save({ collapseTargetBOnStitch: checked });
        toastr.success(checked ? '已开启缝合成功后自动折叠' : '已关闭缝合成功后自动折叠');
    });

    $('body').off('change', '#zero-setting-stitch-auto-migrate-regex').on('change', '#zero-setting-stitch-auto-migrate-regex', function() {
        const checked = $(this).is(':checked');
        UiStateManager.save({ autoMigrateBoundRegex: checked });
        toastr.success(checked ? '已开启缝合条目时自动迁移正则' : '已关闭缝合条目时自动迁移正则');
    });

    $('body').off('change', '#zero-setting-stitch-regex-badge-mode').on('change', '#zero-setting-stitch-regex-badge-mode', function() {
        const val = $(this).val();
        UiStateManager.save({ stitchRegexBadgeMode: val });
        toastr.success('已更新缝合界面绑定正则展示模式');
        if ($('#zero-tab-stitch').is(':visible')) {
            import('./stitch.js').then(m => m.renderStitchList(true));
        }
    });

    $('body').off('change', '#zero-setting-ui-tab-size').on('change', '#zero-setting-ui-tab-size', function() {
        const val = $(this).val();
        UiStateManager.save({ tabTitleSize: val });
        applyTabSettings();
        toastr.success('Tab 标题大小已更新');
    });

    $('body').off('input', '#zero-setting-ui-modal-scale').on('input', '#zero-setting-ui-modal-scale', function() {
        const val = $(this).val();
        $('#zero-setting-ui-modal-scale-val').text(`${val}%`);
    });

    $('body').off('change', '#zero-setting-ui-modal-scale').on('change', '#zero-setting-ui-modal-scale', function() {
        const val = parseInt($(this).val());
        UiStateManager.save({ snapshotModalScale: val });
        toastr.success('快照弹窗尺寸已更新');
    });

    $('body').off('change', '#zero-setting-migrate-compare').on('change', '#zero-setting-migrate-compare', function() {
        const checked = $(this).is(':checked');
        UiStateManager.save({ migrateContentCompare: checked });
        toastr.success(checked ? '已开启预设迁移内容对比' : '已关闭预设迁移内容对比（加载将更快速）');
    });

    // 解耦模式单选卡片点击
    $('body').off('click', '.zero-settings-option-card').on('click', '.zero-settings-option-card', function() {
        const val = $(this).data('val') === true;
        $(`input[name="zero-setting-decouple"][value="${val}"]`).prop('checked', true);
        $('.zero-settings-option-card').removeClass('active');
        $(this).addClass('active');

        // Save
        const currentVal = UiStateManager.get().decoupleJailbreak === true;
        if (currentVal !== val) {
            UiStateManager.save({ decoupleJailbreak: val });
            toastr.success(val ? '已开启完全解耦模式' : '已关闭完全解耦模式（快照将管理全部参数）');
        }
    });

    $('#contrast-auto-match').on('click', () => _contrast.performAutoMatch());
    $('#contrast-start').on('click', () => _contrast.startComparison());
    $('#manage-manual-matches').on('click', () => _contrast.showManualLinksManager());
    $('#contrast-standalone-regex').on('click', async () => {
        const nameA = $('#contrast-preset-a').val();
        const nameB = $('#contrast-preset-b').val();
        const { showStandaloneRegexManagerModal } = await import('./utils.js');
        showStandaloneRegexManagerModal(nameA, nameB, () => _contrast.performAutoMatch());
    });

    const autoMigrateInit = UiStateManager.get().autoMigrateBoundRegex !== false;
    $('#contrast-auto-migrate-regex-toggle').prop('checked', autoMigrateInit);
    $('#contrast-auto-migrate-regex-toggle').on('change', function() {
        UiStateManager.save({ autoMigrateBoundRegex: $(this).is(':checked') });
    });

    $('#contrast-preset-a').on('change', function() {
        $('#contrast-search-input').val('');
        $('#contrast-search-clear').hide();
        localStorage.setItem('zero_last_a', $(this).val());
        _contrast.performAutoMatch();
    });
    $('#contrast-preset-b').on('change', function() {
        $('#contrast-search-input').val('');
        $('#contrast-search-clear').hide();
        localStorage.setItem('zero_last_b', $(this).val());
        _contrast.performAutoMatch();
    });

    let contrastSearchTimeout = null;

    // Contrast Settings Event Listeners
    $('body').off('change', '#zero-setting-contrast-similarity-enable').on('change', '#zero-setting-contrast-similarity-enable', function() {
        const checked = $(this).is(':checked');
        localStorage.setItem('zero_contrast_similarity_enable', checked.toString());
        _contrast.performAutoMatch();
    });

    $('body').off('input change', '#zero-setting-contrast-similarity-threshold').on('input change', '#zero-setting-contrast-similarity-threshold', function(e) {
        const rawVal = $(this).val();
        if (e.type === 'change' || (rawVal !== '' && !isNaN(parseInt(rawVal)))) {
            let val = parseInt(rawVal);
            if (isNaN(val) || val < 1) val = 1;
            if (val > 100) val = 100;
            if (e.type === 'change') {
                $(this).val(val);
            }
            localStorage.setItem('zero_contrast_similarity_threshold', val.toString());
            clearTimeout(contrastSearchTimeout);
            contrastSearchTimeout = setTimeout(() => {
                _contrast.performAutoMatch();
            }, 500);
        }
    });

    $('body').off('change', '#zero-setting-contrast-nav-top').on('change', '#zero-setting-contrast-nav-top', function() {
        const checked = $(this).is(':checked');
        localStorage.setItem('zero_contrast_nav_top', checked.toString());
    });

    $('body').off('change', '#zero-setting-contrast-nav-middle').on('change', '#zero-setting-contrast-nav-middle', function() {
        const checked = $(this).is(':checked');
        localStorage.setItem('zero_contrast_nav_middle', checked.toString());
    });

    $('body').off('change', '#zero-setting-contrast-nav-bottom').on('change', '#zero-setting-contrast-nav-bottom', function() {
        const checked = $(this).is(':checked');
        localStorage.setItem('zero_contrast_nav_bottom', checked.toString());
    });
    $('body').off('input', '#contrast-search-input').on('input', '#contrast-search-input', function() {
        const query = $(this).val().trim();
        if (query) {
            $('#contrast-search-clear').show();
        } else {
            $('#contrast-search-clear').hide();
        }
        
        clearTimeout(contrastSearchTimeout);
        contrastSearchTimeout = setTimeout(() => {
            _contrast.performAutoMatch();
        }, 1000); // 1s delay to adapt to low-performance devices
    });

    $('body').off('click', '#contrast-search-clear').on('click', '#contrast-search-clear', function() {
        $('#contrast-search-input').val('');
        $('#contrast-search-clear').hide();
        clearTimeout(contrastSearchTimeout);
        _contrast.performAutoMatch();
    });

    $('body').off('click', '#contrast-search-toggle').on('click', '#contrast-search-toggle', function() {
        const $container = $('#contrast-search-container');
        const isCollapsed = $container.css('display') === 'none';
        if (isCollapsed) {
            $container.css('display', 'flex');
            $(this).css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white');
            $('#contrast-search-input').focus();
        } else {
            $container.css('display', 'none');
            $(this).css('background', 'rgba(255,255,255,0.05)').css('color', 'inherit');
        }
    });

    $('body').off('click', '.contrast-search-filter-badge').on('click', '.contrast-search-filter-badge', function() {
        $(this).toggleClass('active');
        if ($(this).hasClass('active')) {
            $(this).css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white').css('opacity', '1');
        } else {
            $(this).css('background', 'rgba(255,255,255,0.08)').css('color', 'inherit').css('opacity', '0.5');
        }
        clearTimeout(contrastSearchTimeout);
        _contrast.performAutoMatch();
    });

    $('#stitch-preset-source').on('change', function() {
        $('#stitch-search-input').val('');
        $('#stitch-search-clear').hide();
        $('#stitch-peek-search-input').val('');
        $('#stitch-peek-search-clear').hide();
        localStorage.setItem('zero_last_stitch_a', $(this).val());
        _stitch.renderStitchList();
    });
    $('#stitch-preset-target').on('change', function() {
        $('#stitch-search-input').val('');
        $('#stitch-search-clear').hide();
        $('#stitch-peek-search-input').val('');
        $('#stitch-peek-search-clear').hide();
        localStorage.setItem('zero_last_stitch_b', $(this).val());
        _stitch.renderStitchList();
    });

    let searchTimeout = null;
    $('body').off('input', '#stitch-search-input').on('input', '#stitch-search-input', function() {
        const query = $(this).val().trim();
        if (query) {
            $('#stitch-search-clear').show();
        } else {
            $('#stitch-search-clear').hide();
        }
        
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            _stitch.renderStitchList(false);
        }, 1000); // 1s delay to adapt to low-performance devices
    });

    $('body').off('click', '#stitch-search-clear').on('click', '#stitch-search-clear', function() {
        $('#stitch-search-input').val('');
        $('#stitch-search-clear').hide();
        clearTimeout(searchTimeout);
        _stitch.renderStitchList(false);
    });

    $('body').off('click', '#stitch-search-toggle').on('click', '#stitch-search-toggle', function() {
        const $container = $('#stitch-search-container');
        const isCollapsed = $container.css('display') === 'none';
        if (isCollapsed) {
            $container.css('display', 'flex');
            $(this).css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white');
            $('#stitch-search-input').focus();
        } else {
            $container.css('display', 'none');
            $(this).css('background', 'rgba(255,255,255,0.05)').css('color', 'inherit');
        }
    });

    $('body').off('click', '.stitch-search-filter-badge').on('click', '.stitch-search-filter-badge', function() {
        $(this).toggleClass('active');
        if ($(this).hasClass('active')) {
            $(this).css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white').css('opacity', '1');
        } else {
            $(this).css('background', 'rgba(255,255,255,0.08)').css('color', 'inherit').css('opacity', '0.5');
        }
        clearTimeout(searchTimeout);
        _stitch.renderStitchList(false);
    });

    let peekSearchTimeout = null;
    $('body').off('input', '#stitch-peek-search-input').on('input', '#stitch-peek-search-input', function() {
        const query = $(this).val().trim();
        if (query) {
            $('#stitch-peek-search-clear').show();
        } else {
            $('#stitch-peek-search-clear').hide();
        }
        
        clearTimeout(peekSearchTimeout);
        peekSearchTimeout = setTimeout(() => {
            _stitch.renderTargetBPeek();
        }, 1000); // 1s delay to adapt to low-performance devices
    });

    $('body').off('click', '#stitch-peek-search-clear').on('click', '#stitch-peek-search-clear', function() {
        $('#stitch-peek-search-input').val('');
        $('#stitch-peek-search-clear').hide();
        clearTimeout(peekSearchTimeout);
        _stitch.renderTargetBPeek();
    });

    $('body').off('click', '.stitch-peek-search-filter-badge').on('click', '.stitch-peek-search-filter-badge', function() {
        $(this).toggleClass('active');
        if ($(this).hasClass('active')) {
            $(this).css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white').css('opacity', '1');
        } else {
            $(this).css('background', 'rgba(255,255,255,0.08)').css('color', 'inherit').css('opacity', '0.5');
        }
        clearTimeout(peekSearchTimeout);
        _stitch.renderTargetBPeek();
    });

    $('body').off('click', '#stitch-peek-search-toggle').on('click', '#stitch-peek-search-toggle', function(e) {
        e.stopPropagation(); // Prevent accordion from folding/unfolding the drawer
        const $container = $('#stitch-peek-search-container');
        const isCollapsed = $container.css('display') === 'none';
        if (isCollapsed) {
            $container.css('display', 'flex');
            $(this).css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white');
            $('#stitch-peek-search-input').focus();
        } else {
            $container.css('display', 'none');
            $(this).css('background', 'rgba(255,255,255,0.05)').css('color', 'inherit');
        }
    });

    $('#check-preset-select').on('change', function() {
        localStorage.setItem('zero_last_check_preset', $(this).val());
        _checker.Checker.render('check-results-container', $(this).val());
    });
    $('#check-refresh-btn').on('click', function() {
        _checker.Checker.render('check-results-container', $('#check-preset-select').val());
    });

    window.addEventListener('zero-open-editor', (e) => {
        const { presetName, itemName } = e.detail;
        _editor.openQuickEditor(presetName, itemName);
    });

    $('body').off('click', '#stitch-swap-btn').on('click', '#stitch-swap-btn', function() {
        const $source = $('#stitch-preset-source');
        const $target = $('#stitch-preset-target');
        const valA = $source.val();
        const valB = $target.val();
        
        $source.val(valB);
        $target.val(valA);
        
        localStorage.setItem('zero_last_stitch_a', valB);
        localStorage.setItem('zero_last_stitch_b', valA);

        // Swap search input values and clear button visibility
        const qA = $('#stitch-search-input').val();
        const qB = $('#stitch-peek-search-input').val();
        $('#stitch-search-input').val(qB);
        $('#stitch-peek-search-input').val(qA);
        
        if (qB) $('#stitch-search-clear').show();
        else $('#stitch-search-clear').hide();
        
        if (qA) $('#stitch-peek-search-clear').show();
        else $('#stitch-peek-search-clear').hide();

        // Swap active filter badges
        const filters = ['name', 'content', 'note', 'origin'];
        filters.forEach(f => {
            const $badgeA = $(`.stitch-search-filter-badge[data-filter="${f}"]`);
            const $badgeB = $(`.stitch-peek-search-filter-badge[data-filter="${f}"]`);
            const isActiveA = $badgeA.hasClass('active');
            const isActiveB = $badgeB.hasClass('active');
            
            if (isActiveA) $badgeB.addClass('active');
            else $badgeB.removeClass('active');
            
            if (isActiveB) $badgeA.addClass('active');
            else $badgeA.removeClass('active');
            
            // Sync styles
            if ($badgeA.hasClass('active')) {
                $badgeA.css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white').css('opacity', '1');
            } else {
                $badgeA.css('background', 'rgba(255,255,255,0.08)').css('color', 'inherit').css('opacity', '0.5');
            }
            
            if ($badgeB.hasClass('active')) {
                $badgeB.css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white').css('opacity', '1');
            } else {
                $badgeB.css('background', 'rgba(255,255,255,0.08)').css('color', 'inherit').css('opacity', '0.5');
            }
        });
        
        _stitch.renderStitchList();
    });

    $('body').off('click', '#stitch-mode-toggle').on('click', '#stitch-mode-toggle', function() {
        _stitch.toggleStitchBatchMode();
        _stitch.renderStitchList();
    });

    $('body').off('click', '#stitch-batch-execute').on('click', '#stitch-batch-execute', async function() {
        const selectedIndexes = $('.stitch-item-cb:checked').map(function() {
            return parseInt($(this).data('index'));
        }).get();

        if (selectedIndexes.length === 0) {
            toastr.info('请先在左侧勾选要缝合的条目');
            return;
        }

        const nameB = $('#stitch-preset-target').val();
        if (!nameB) {
            toastr.warning('请选择目标预设 (B)');
            return;
        }

        // Expand B drawer automatically
        const $drawer = $('#stitch-target-peek-drawer');
        if ($drawer.css('display') === 'none') {
            toastr.warning('目标预设 (B) 无效，请在底部选择有效的预设');
            return;
        }

        $drawer.addClass('expanded');
        $('#stitch-peek-body').css('display', 'flex');
        $('#stitch-peek-toggle-icon i').removeClass('fa-chevron-up').addClass('fa-chevron-down');
    });

    $('body').off('click', '#stitch-batch-delete').on('click', '#stitch-batch-delete', async function() {
        const selectedIndexes = $('.stitch-item-cb:checked').map(function() {
            return parseInt($(this).data('index'));
        }).get();

        if (selectedIndexes.length === 0) {
            toastr.info('请选择要删除的条目');
            return;
        }

        const items = selectedIndexes.map(idx => window.zero_stitch_promptsA[idx]);
        const nameA = $('#stitch-preset-source').val();
        await _stitch.performBatchDelete(items, nameA);
    });

    $('body').off('click', '#stitch-batch-move').on('click', '#stitch-batch-move', async function() {
        const selectedIndexes = $('.stitch-item-cb:checked').map(function() {
            return parseInt($(this).data('index'));
        }).get();

        if (selectedIndexes.length === 0) {
            toastr.info('请选择要移动的条目');
            return;
        }

        const items = selectedIndexes.map(idx => window.zero_stitch_promptsA[idx]);
        const nameA = $('#stitch-preset-source').val();
        await _stitch.showMoveModal(items, nameA);
    });

    $('body').off('click', '#stitch-batch-fav').on('click', '#stitch-batch-fav', async function() {
        const selectedIndexes = $('.stitch-item-cb:checked').map(function() {
            return parseInt($(this).data('index'));
        }).get();

        if (selectedIndexes.length === 0) {
            toastr.info('请选择要收藏的条目');
            return;
        }

        const items = selectedIndexes.map(idx => window.zero_stitch_promptsA[idx]);
        const nameA = $('#stitch-preset-source').val();
        const { showCollectModal } = await import('./utils.js');
        await showCollectModal(items, nameA);
        
        $('.stitch-item-cb').prop('checked', false).trigger('change');
        _stitch.resetStitchBatchMode();
        _stitch.renderStitchList();
    });

    $('body').off('click', '.stitch-action-btn').on('click', '.stitch-action-btn', async function(e) {
        e.stopPropagation();
        const index = parseInt($(this).data('index'));
        
        // 1. Uncheck other checkboxes, then check only this item
        $('.stitch-item-cb').prop('checked', false).removeAttr('checked').trigger('change');
        $(`.stitch-item-cb[data-index="${index}"]`).prop('checked', true).attr('checked', 'checked').trigger('change');

        const nameB = $('#stitch-preset-target').val();
        if (!nameB) {
            toastr.warning('请选择目标预设 (B)');
            return;
        }

        // 2. Expand B drawer automatically
        const $drawer = $('#stitch-target-peek-drawer');
        if ($drawer.css('display') === 'none') {
            toastr.warning('目标预设 (B) 无效，请先选择有效的预设');
            return;
        }

        $drawer.addClass('expanded');
        $('#stitch-peek-body').css('display', 'flex');
        $('#stitch-peek-toggle-icon i').removeClass('fa-chevron-up').addClass('fa-chevron-down');
    });

    $('body').off('click', '.stitch-delete-btn').on('click', '.stitch-delete-btn', async function(e) {
        e.stopPropagation();
        const index = parseInt($(this).data('index'));
        const pA = window.zero_stitch_promptsA ? window.zero_stitch_promptsA[index] : null;
        if (!pA) return;
        const nameA = $('#stitch-preset-source').val();
        await _stitch.performBatchDelete([pA], nameA);
    });

    $('body').off('click', '.stitch-clone-btn').on('click', '.stitch-clone-btn', async function(e) {
        e.stopPropagation();
        const index = parseInt($(this).data('index'));
        const pA = window.zero_stitch_promptsA ? window.zero_stitch_promptsA[index] : null;
        if (!pA) return;
        const nameA = $('#stitch-preset-source').val();
        await _stitch.performSingleClone(pA, nameA);
    });

    $('body').off('click', '.stitch-move-btn').on('click', '.stitch-move-btn', async function(e) {
        e.stopPropagation();
        const index = parseInt($(this).data('index'));
        const pA = window.zero_stitch_promptsA ? window.zero_stitch_promptsA[index] : null;
        if (!pA) return;
        const nameA = $('#stitch-preset-source').val();
        await _stitch.showMoveModal([pA], nameA);
    });

    $('body').off('click', '.stitch-edit-btn').on('click', '.stitch-edit-btn', async function(e) {
        e.stopPropagation();
        const index = parseInt($(this).data('index'));
        const pA = window.zero_stitch_promptsA ? window.zero_stitch_promptsA[index] : null;
        if (!pA) return;
        const presetName = $('#stitch-preset-source').val();
        const itemName = pA.name || pA.identifier;
        if (presetName && itemName) {
            _editor.openQuickEditor(presetName, itemName);
        }
    });

    $('body').off('click', '.stitch-fav-btn').on('click', '.stitch-fav-btn', async function(e) {
        e.stopPropagation();
        const index = parseInt($(this).data('index'));
        const pA = window.zero_stitch_promptsA ? window.zero_stitch_promptsA[index] : null;
        if (!pA) return;
        const nameA = $('#stitch-preset-source').val();
        const { showCollectModal } = await import('./utils.js');
        await showCollectModal(pA, nameA);
    });

    $('body').off('click', '.stitch-menu-btn').on('click', '.stitch-menu-btn', function(e) {
        e.stopPropagation();
        $('.stitch-action-dropdown').not($(this).siblings('.stitch-action-dropdown')).hide();
        $(this).siblings('.stitch-action-dropdown').toggle();
    });

    $('body').off('click', '.stitch-action-dropdown > div').on('click', '.stitch-action-dropdown > div', function() {
        $(this).parent().hide();
    });

    $('body').off('mouseenter', '.stitch-action-dropdown > div').on('mouseenter', '.stitch-action-dropdown > div', function() {
        $(this).css('background', 'rgba(255,255,255,0.08)');
    }).off('mouseleave', '.stitch-action-dropdown > div').on('mouseleave', '.stitch-action-dropdown > div', function() {
        $(this).css('background', 'none');
    });

    $(document).off('click.zero-stitch').on('click.zero-stitch', function() {
        $('.stitch-action-dropdown').hide();
    });

    $('body').off('click', '.stitch-row').on('click', '.stitch-row', function(e) {
        if ($(e.target).closest('.stitch-item-cb, button, .stitch-action-dropdown, .stitch-row-expand-trigger').length) return;
        $(this).find('.stitch-row-expand-trigger').first().click();
    });

    $('body').off('click', '#stitch-all').on('click', '#stitch-all', function() {
        $('.stitch-item-cb').prop('checked', true).attr('checked', 'checked').trigger('change');
    });

    $('body').off('click', '#stitch-invert').on('click', '#stitch-invert', function() {
        $('.stitch-item-cb').each(function() {
            const val = !$(this).is(':checked');
            $(this).prop('checked', val).trigger('change');
            if (val) $(this).attr('checked', 'checked');
            else $(this).removeAttr('checked');
        });
    });

    $('body').off('click', '#stitch-range').on('click', '#stitch-range', function() {
        const checked = $('.stitch-item-cb:checked');
        if (checked.length < 2) {
            toastr.info('请先手动勾选起始和结束条目（至少勾选两个）');
            return;
        }
        const indexes = checked.map(function() { return parseInt($(this).data('index')); }).get();
        const start = Math.min(...indexes);
        const end = Math.max(...indexes);
        for (let i = start; i <= end; i++) {
            $(`.stitch-item-cb[data-index="${i}"]`).prop('checked', true).attr('checked', 'checked').trigger('change');
        }
    });

    $('body').off('click', '#stitch-peek-header').on('click', '#stitch-peek-header', function(e) {
        e.stopPropagation();
        const $drawer = $('#stitch-target-peek-drawer');
        const $icon = $('#stitch-peek-toggle-icon i');
        $drawer.toggleClass('expanded');
        if ($drawer.hasClass('expanded')) {
            $icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
        } else {
            $icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
        }
    });

    $('#manage-import').on('click', () => $('#manage-import-input').trigger('click'));
    $('#manage-import-input').on('change', async function() {
        const files = Array.from(this.files);
        if (files.length === 0) return;
        await _manage.handleBatchImport(files);
        this.value = '';
    });
    $('#manage-delete').on('click', () => _manage.handleBatchDelete());
    $('#manage-select-all').on('change', function() {
        const checked = $(this).is(':checked');
        $('#manage-preset-list input[type="checkbox"]:not(:disabled)').prop('checked', checked);
    });

    if (_contrast && typeof _contrast.initScroll === 'function') _contrast.initScroll();
    if (_stitch && typeof _stitch.initScroll === 'function') _stitch.initScroll();

    syncTheme();
}

export async function showPanel() {
    renderedTabs.clear(); // Clear rendering cache on open to force fresh data load
    _presetsLastFetch = 0; // Force cache invalidation so the initial tab load is fresh
    await loadModules();
    ensurePanel();
    applyTabSettings();
    syncTheme();
    
    // Initialize history button states
    HistoryManager.updateButtonsState();
    
    const $panel = $(`#${PANEL_ID}`);
    $panel.css('display', 'flex');
    $panel[0].offsetHeight;
    $panel.css('opacity', '1');

    // Defer heavy tab rendering to a macro-task after the panel opacity transition completes smoothly
    setTimeout(() => {
        const lastTab = localStorage.getItem('zero_last_main_tab') || 'contrast';
        $(`#${PANEL_ID} .zero-tab-link[data-tab="${lastTab}"]`).click();
    }, 200);
}

export function closePanel() {
    renderedTabs.clear(); // Clear cache on close to release DOM resources
    const $panel = $(`#${PANEL_ID}`);
    $panel.css('opacity', '0');
    setTimeout(() => {
        $panel.css('display', 'none');
    }, 150);
    
    try {
        HistoryManager.clear();
    } catch (e) {
        console.error('[Zero] Failed to clear history:', e);
    }
}

export function injectExtensionButton() {
    if ($(`#${BTN_ID}`).length) return;

    const btnHtml = `
        <div id="${BTN_ID}" class="list_item interactable" title="打开预设管理">
            <i class="fa-solid fa-list-ul"></i>
            <span class="list_item_text">预设管理</span>
        </div>
    `;

    const $target = $('#extensionsMenu.options-content');
    if ($target.length) {
        $target.append(btnHtml);
        $(`#${BTN_ID}`).on('click', () => showPanel());
    }
}

export function init() {
    injectExtensionButton();
    applyAvoidStatusbar();
    
    // Stop event bubbling for typing events on all Zero inputs/textareas to prevent SillyTavern's heavy global key/input listeners from lagging mobile devices
    $('body').on('keydown keyup keypress input', '#zero-preset-manager-panel input, #zero-preset-manager-panel textarea, #zero-quick-editor input, #zero-quick-editor textarea', function(e) {
        e.stopPropagation();
    });
    
    // Background preloading of UI modules to eliminate lag on first open
    setTimeout(() => {
        loadModules().catch(() => {});
    }, 2000);
    
    const observer = new MutationObserver(() => {
        if (!$(`#${BTN_ID}`).length && $('#extensionsMenu.options-content').length) {
            injectExtensionButton();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

export function renderSettingsTab() {
    const isDecouple = UiStateManager.get().decoupleJailbreak === true;
    $(`input[name="zero-setting-decouple"][value="${isDecouple}"]`).prop('checked', true);
    $('.zero-settings-option-card').removeClass('active');
    $(`.zero-settings-option-card[data-val="${isDecouple}"]`).addClass('active');

    // Toast switches
    const state = UiStateManager.get();
    $('#zero-setting-toast-switch').prop('checked', state.toastOnSnapshotSwitch === true);
    $('#zero-setting-toast-overwrite').prop('checked', state.toastOnSnapshotOverwrite === true);
    $('#zero-setting-toast-stitch').prop('checked', state.toastOnPresetStitch === true);
    $('#zero-setting-confirm-snapshot').prop('checked', state.confirmOnSnapshot === true);

    // Stitch switches
    $('#zero-setting-stitch-collapse-b').prop('checked', state.collapseTargetBOnStitch === true);
    $('#zero-setting-stitch-auto-migrate-regex').prop('checked', state.autoMigrateBoundRegex !== false);
    $('#zero-setting-stitch-regex-badge-mode').val(state.stitchRegexBadgeMode || 'bound_only');

    // UI switches
    $('#zero-setting-ui-search-anim').prop('checked', state.searchBarAnimation !== false);
    $('#zero-setting-ui-avoid-statusbar').prop('checked', state.avoidStatusbar !== false);
    $('#zero-setting-migrate-compare').prop('checked', state.migrateContentCompare !== false);

    // Tab Bar switches
    $('#zero-setting-ui-tab-style').val(state.tabTitleStyle || 'text');
    $('#zero-setting-ui-tab-pos').val(state.tabBarPosition || 'top');
    $('#zero-setting-ui-tab-size').val(state.tabTitleSize || '15px');
    $('#zero-setting-ui-active-exit').prop('checked', state.clickActiveTabToExit === true);

    // Snapshot Modal switches
    $('#zero-setting-ui-modal-style').val(state.snapshotModalStyle || 'center');
    $('#zero-setting-ui-modal-anim').val(state.snapshotModalAnimation || 'slide');
    const scale = state.snapshotModalScale || 80;
    $('#zero-setting-ui-modal-scale').val(scale);
    $('#zero-setting-ui-modal-scale-val').text(`${scale}%`);

    // Contrast settings
    const contrastSimilarityEnable = localStorage.getItem('zero_contrast_similarity_enable') === 'true';
    const contrastSimilarityThreshold = localStorage.getItem('zero_contrast_similarity_threshold') || '80';
    const contrastNavTop = localStorage.getItem('zero_contrast_nav_top') === 'true';
    const contrastNavMiddle = localStorage.getItem('zero_contrast_nav_middle') === 'true';
    const contrastNavBottom = localStorage.getItem('zero_contrast_nav_bottom') !== 'false';

    $('#zero-setting-contrast-similarity-enable').prop('checked', contrastSimilarityEnable);
    $('#zero-setting-contrast-similarity-threshold').val(contrastSimilarityThreshold);
    $('#zero-setting-contrast-nav-top').prop('checked', contrastNavTop);
    $('#zero-setting-contrast-nav-middle').prop('checked', contrastNavMiddle);
    $('#zero-setting-contrast-nav-bottom').prop('checked', contrastNavBottom);
}

export async function refreshActiveTab() {
    const tab = $(`#${PANEL_ID} .zero-tab-link.active`).data('tab');
    if (tab === 'manage') {
        if (_manage && typeof _manage.renderManageTab === 'function') {
            await _manage.renderManageTab();
        }
    } else if (tab === 'contrast') {
        await populatePresetSelects();
        if (_contrast && typeof _contrast.performAutoMatch === 'function') {
            await _contrast.performAutoMatch();
        }
    } else if (tab === 'stitch') {
        await populatePresetSelects();
        if (_stitch && typeof _stitch.renderStitchList === 'function') {
            await _stitch.renderStitchList();
        }
    } else if (tab === 'regex') {
        await populatePresetSelects();
        if (_regex && typeof _regex.renderRegexList === 'function') {
            await _regex.renderRegexList();
        }
    } else if (tab === 'check') {
        await populatePresetSelects();
        if (_checker && _checker.Checker && typeof _checker.Checker.render === 'function') {
            _checker.Checker.render('check-results-container', $('#check-preset-select').val());
        }
    } else if (tab === 'settings') {
        renderSettingsTab();
    }
}

export function applyTabSettings() {
    const state = UiStateManager.get();
    const isBottom = state.tabBarPosition === 'bottom';
    const isIcon = state.tabTitleStyle === 'icon';
    const clickActiveExit = state.clickActiveTabToExit === true;

    // 1. Position zero-tabs-nav at top or bottom
    const $panel = $(`#${PANEL_ID}`);
    if (!$panel.length) return; // Guard clause if panel is not loaded yet
    
    $panel.css('flex-direction', isBottom ? 'column-reverse' : 'column');

    const $nav = $(`.zero-tabs-nav`);
    if (isBottom) {
        $nav.css({
            'border-top': '1px solid var(--SmartThemeBorderColor, #444)',
            'border-bottom': 'none'
        });
    } else {
        $nav.css({
            'border-top': 'none',
            'border-bottom': '1px solid var(--SmartThemeBorderColor, #444)'
        });
    }

    // 2. Render Text vs Icon titles
    const tabMeta = {
        contrast: { text: '对照', icon: '<i class="fa-solid fa-code-compare"></i>' },
        stitch: { text: '缝合', icon: '<i class="fa-solid fa-scissors"></i>' },
        regex: { text: '正则', icon: '<i class="fa-solid fa-terminal"></i>' },
        check: { text: '自查', icon: '<i class="fa-solid fa-stethoscope"></i>' },
        manage: { text: '管理', icon: '<i class="fa-solid fa-list-ul"></i>' },
        settings: { text: '设置', icon: '<i class="fa-solid fa-gear"></i>' }
    };

    // Ensure tabs wrapper stretches to full width and centers contents
    $nav.find('> div:first-child').css({
        'display': 'flex',
        'flex': '1',
        'justify-content': 'space-around',
        'align-items': 'stretch'
    });

    const tabSize = state.tabTitleSize || '15px';

    $(`#${PANEL_ID} .zero-tab-link`).each(function() {
        const tab = $(this).data('tab');
        const meta = tabMeta[tab];
        if (meta) {
            if (isIcon) {
                $(this).html(meta.icon).attr('title', meta.text);
            } else {
                $(this).text(meta.text).removeAttr('title');
            }
        }

        // Apply distributed spacing & custom font/icon size
        $(this).css({
            'flex': '1',
            'text-align': 'center',
            'font-size': tabSize,
            'padding': '12px 6px',        // Comfortable padding for tapping
            'transition': 'all 0.15s ease-out',
            'cursor': 'pointer',
            'display': 'flex',
            'align-items': 'center',
            'justify-content': 'center'
        });

        // Ensure icon size inherits the custom size
        $(this).find('i').css('font-size', 'inherit');

        // Adjust active/inactive border positions
        const isActive = $(this).hasClass('active');
        if (isActive) {
            $(this).css({
                'font-weight': 'bold',
                'opacity': '1',
                'color': 'var(--SmartThemeQuoteColor)',
                'background': 'rgba(255, 255, 255, 0.02)',
                'border-bottom': isBottom ? 'none' : '3px solid var(--SmartThemeQuoteColor)',
                'border-top': isBottom ? '3px solid var(--SmartThemeQuoteColor)' : 'none'
            });
            $(this).find('i').css('color', 'var(--SmartThemeQuoteColor)');
        } else {
            $(this).css({
                'font-weight': 'normal',
                'opacity': '0.55',
                'color': 'inherit',
                'background': 'transparent',
                'border-bottom': 'none',
                'border-top': 'none'
            });
            $(this).find('i').css('color', 'inherit');
        }
    });

    // 3. Close button visibility
    if (isBottom && clickActiveExit) {
        $('#zero-panel-close').hide();
    } else {
        $('#zero-panel-close').show();
    }
}
