/**
 * Preset Manager Extension for Zero
 * Handles button injection into the Extensions menu and full-screen tabbed panel.
 *
 * 子模块采用懒加载策略：仅在用户首次打开面板时并行加载，之后缓存复用。
 */

import { PresetManager } from '../qr-state.js';
import { syncTheme } from './ui-utils.js';

// ── 懒加载缓存 ──────────────────────────────────────────────────────────────
let _contrast = null;
let _stitch   = null;
let _manage   = null;
let _checker  = null;
let _editor   = null;
let _modulesLoaded = false;

// ── 预设列表缓存（避免切 Tab 重复拉取）──────────────────────────────────────
let _presetsListCache = null;
let _presetsLastFetch  = 0;
const PRESETS_CACHE_TTL = 8000; // 8 秒内跳过重复拉取

// ui-manage.js 写操作完成后，通过事件通知缓存失效
window.addEventListener('zero-presets-list-changed', () => { _presetsLastFetch = 0; });

/** 供外部模块主动失效缓存（如批量导入/删除后） */
export function invalidatePresetsCache() { _presetsLastFetch = 0; }

async function loadModules() {
    if (_modulesLoaded) return;
    [_contrast, _stitch, _manage, _checker, _editor] = await Promise.all([
        import('./ui-contrast.js'),
        import('./ui-stitch.js'),
        import('./ui-manage.js'),
        import('./ui-checker.js'),
        import('./ui-editor.js'),
    ]);
    _modulesLoaded = true;
}

const PANEL_ID = 'zero-preset-manager-panel';
const BTN_ID = 'zero-preset-manager-btn';

export async function populatePresetSelects() {
    try {
        const now = Date.now();
        let list;
        if (_presetsListCache && (now - _presetsLastFetch) < PRESETS_CACHE_TTL) {
            list = _presetsListCache; // 命中缓存，跳过网络请求
        } else {
            PresetManager.invalidate();
            list = await PresetManager.listNames();
            _presetsListCache = list;
            _presetsLastFetch = now;
        }
        const $selectA = $('#contrast-preset-a');
        const $selectB = $('#contrast-preset-b');
        const $stitchA = $('#stitch-preset-source');
        const $stitchB = $('#stitch-preset-target');
        const $checkS = $('#check-preset-select');
        
        const noneOption = '<option value="">-- 无 --</option>';
        $selectA.empty().append(noneOption);
        $selectB.empty().append(noneOption);
        $stitchA.empty().append(noneOption);
        $stitchB.empty().append(noneOption);
        $checkS.empty();
        
        list.names.forEach(name => {
            $selectA.append(`<option value="${name}">${name}</option>`);
            $selectB.append(`<option value="${name}">${name}</option>`);
            $stitchA.append(`<option value="${name}">${name}</option>`);
            $stitchB.append(`<option value="${name}">${name}</option>`);
            $checkS.append(`<option value="${name}">${name}</option>`);
        });

        if (_contrast) _contrast.pruneManualLinks(list.names);
        
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
                    <div class="zero-tab-link" data-tab="check" style="padding: 10px 12px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent;">自查</div>
                    <div class="zero-tab-link" data-tab="manage" style="padding: 10px 12px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent;">管理</div>
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
                            <button id="stitch-mode-toggle" class="interactable" title="切换批量模式" style="width: 28px; height: 28px; padding: 0; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                                <i class="fa-solid fa-layer-group"></i>
                            </button>
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
                            <button id="stitch-batch-move" class="interactable" title="在本预设内移动选中的条目" style="padding: 0 12px; height: 32px; font-size: 11px; background: rgba(255,255,255,0.1); color: inherit; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-sort"></i> 移动选定项
                            </button>
                            <button id="stitch-batch-execute" class="interactable" title="批量缝合" style="padding: 0 12px; height: 32px; font-size: 11px; background: var(--SmartThemeQuoteColor); color: white; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-arrow-right-to-bracket"></i> 确认批量缝合
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
                            <div id="stitch-peek-toggle-icon" style="font-size: 12px; opacity: 0.8;">
                                <i class="fa-solid fa-chevron-up"></i>
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
                            <div id="stitch-peek-list" style="display: flex; flex-direction: column; gap: 6px;"></div>
                        </div>
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
            </style>
        `);
    }

    $('body').append(panelHtml);

    $(`#${PANEL_ID} .zero-tab-link`).on('click', function() {
        const tab = $(this).data('tab');
        localStorage.setItem('zero_last_main_tab', tab);
        
        $(`#${PANEL_ID} .zero-tab-link`).removeClass('active').css('border-bottom-color', 'transparent');
        $(this).addClass('active').css('border-bottom-color', 'var(--SmartThemeBorderColor, #444)');

        $(`#${PANEL_ID} .zero-tab-content`).css('display', 'none');
        $(`#zero-tab-${tab}`).css('display', 'flex');
        
        if (tab === 'manage') _manage.renderManageTab();
        else if (tab === 'contrast') populatePresetSelects();
        else if (tab === 'stitch') populatePresetSelects().then(() => _stitch.renderStitchList());
        else if (tab === 'check') populatePresetSelects().then(() => {
            _checker.Checker.render('check-results-container', $('#check-preset-select').val());
        });
    });

    $(`#zero-panel-close`).on('click', () => closePanel());

    $('#contrast-auto-match').on('click', () => _contrast.performAutoMatch());
    $('#contrast-start').on('click', () => _contrast.startComparison());
    $('#manage-manual-matches').on('click', () => _contrast.showManualLinksManager());

    $('#contrast-preset-a').on('change', function() {
        localStorage.setItem('zero_last_a', $(this).val());
        _contrast.performAutoMatch();
    });
    $('#contrast-preset-b').on('change', function() {
        localStorage.setItem('zero_last_b', $(this).val());
        _contrast.performAutoMatch();
    });

    $('#stitch-preset-source').on('change', function() {
        localStorage.setItem('zero_last_stitch_a', $(this).val());
        _stitch.renderStitchList();
    });
    $('#stitch-preset-target').on('change', function() {
        localStorage.setItem('zero_last_stitch_b', $(this).val());
        _stitch.renderStitchList();
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

    syncTheme();
}

export async function showPanel() {
    await loadModules();
    ensurePanel();
    syncTheme();
    _presetsLastFetch = 0; // 每次打开面板强制刷新预设列表
    populatePresetSelects();
    
    const lastTab = localStorage.getItem('zero_last_main_tab') || 'contrast';
    $(`#${PANEL_ID} .zero-tab-link[data-tab="${lastTab}"]`).click();

    const $panel = $(`#${PANEL_ID}`);
    $panel.css('display', 'flex');
    $panel[0].offsetHeight;
    $panel.css('opacity', '1');
}

export function closePanel() {
    const $panel = $(`#${PANEL_ID}`);
    $panel.css('opacity', '0');
    setTimeout(() => {
        $panel.css('display', 'none');
    }, 150);
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
    
    const observer = new MutationObserver(() => {
        if (!$(`#${BTN_ID}`).length && $('#extensionsMenu.options-content').length) {
            injectExtensionButton();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
