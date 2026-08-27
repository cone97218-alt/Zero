import { getPresetPrompts, escapeHtml, debounce, savePresetWithoutRegexToast, getPresetRegexScripts, showBindRegexModal, syncBoundRegexOnPromptToggle, migrateBoundRegexes } from './utils.js';
import { HistoryManager, UiStateManager, GroupManager, OpLogManager } from '../qr-snapshot/state.js';
import { matchStitch, highlightText as highlightTextUtil } from '../qr-snapshot/search-util.js';

export let stitch_batch_mode = false;
let _cachedStitchPrompts = null;
let _cachedStitchName = null;

let isRestoringStitchScroll = false;
let isRestoringStitchPeekScroll = false;
let isRefreshingStitchList = false;
let isRefreshingTargetB = false;

export function initScroll() {
    const saveListScrollDebounced = debounce((effectiveName, scrollTop) => {
        localStorage.setItem(`zero_scroll_stitch_list_${effectiveName}`, scrollTop);
    }, 150);

    const savePeekScrollDebounced = debounce((nameB, scrollTop) => {
        localStorage.setItem(`zero_scroll_stitch_peek_${nameB}`, scrollTop);
    }, 150);

    $('#stitch-list').off('scroll.zero-stitch').on('scroll.zero-stitch', function() {
        if (isRestoringStitchScroll || isRefreshingStitchList) return;
        const nameA = $('#stitch-preset-source').val();
        const nameB = $('#stitch-preset-target').val();
        const effectiveName = nameA || nameB;
        if (effectiveName) {
            saveListScrollDebounced(effectiveName, $(this).scrollTop());
        }
    });

    $('#stitch-peek-body').off('scroll.zero-stitch-peek').on('scroll.zero-stitch-peek', function() {
        if (isRestoringStitchPeekScroll || isRefreshingTargetB) return;
        const nameB = $('#stitch-preset-target').val();
        if (nameB) {
            savePeekScrollDebounced(nameB, $(this).scrollTop());
        }
    });
}

export function restoreScroll() {
    const nameA = $('#stitch-preset-source').val();
    const nameB = $('#stitch-preset-target').val();
    const effectiveName = nameA || nameB;
    if (effectiveName) {
        const savedScroll = localStorage.getItem(`zero_scroll_stitch_list_${effectiveName}`) || 0;
        const $list = $('#stitch-list');
        isRestoringStitchScroll = true;
        $list.scrollTop(savedScroll);
        setTimeout(() => {
            isRestoringStitchScroll = false;
            isRefreshingStitchList = false;
        }, 50);
    } else {
        isRefreshingStitchList = false;
    }
}

export function restorePeekScroll() {
    const nameB = $('#stitch-preset-target').val();
    if (nameB) {
        const savedScroll = localStorage.getItem(`zero_scroll_stitch_peek_${nameB}`) || 0;
        const $peekBody = $('#stitch-peek-body');
        isRestoringStitchPeekScroll = true;
        $peekBody.scrollTop(savedScroll);
        setTimeout(() => {
            isRestoringStitchPeekScroll = false;
            isRefreshingTargetB = false;
        }, 50);
    } else {
        isRefreshingTargetB = false;
    }
}

export function toggleStitchBatchMode() {
    stitch_batch_mode = !stitch_batch_mode;
    return stitch_batch_mode;
}

export function resetStitchBatchMode() {
    stitch_batch_mode = false;
}

function renderStitchRowHTML(pA, index, effectiveName, regexMapA, currentPresetNames, highlightText, badgeMode, nameA, nameB) {
    const nameStr = highlightText(pA.name || pA.identifier || '未命名', 'name');
    const boundIds = Array.isArray(pA.bound_regex_ids) ? pA.bound_regex_ids : [];

    let regexBadgeHtml = '';
    if (badgeMode === 'all') {
        if (boundIds.length > 0) {
            const boundNames = boundIds.map(id => regexMapA.get(String(id)) || id);
            const boundTitle = `已绑定 ${boundIds.length} 个预设正则:\n` + boundNames.join('\n');
            regexBadgeHtml = `<span class="stitch-bound-regex-badge interactable" data-prompt-id="${escapeHtml(pA.identifier)}" data-preset="${escapeHtml(effectiveName)}" style="background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeQuoteColor); padding: 1px 6px; border-radius: 4px; font-size: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;" title="${escapeHtml(boundTitle)} (点击管理绑定正则)"><i class="fa-solid fa-link"></i> 正则 (${boundIds.length}): ${escapeHtml(boundNames.slice(0, 2).join(', '))}${boundNames.length > 2 ? '...' : ''}</span>`;
        } else {
            regexBadgeHtml = `<span class="stitch-bound-regex-badge interactable" data-prompt-id="${escapeHtml(pA.identifier)}" data-preset="${escapeHtml(effectiveName)}" style="background: rgba(255,255,255,0.03); border: 1px dashed var(--SmartThemeBorderColor); color: var(--SmartThemeEmColor); padding: 1px 6px; border-radius: 4px; font-size: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; opacity: 0.7;" title="点击绑定预设正则"><i class="fa-solid fa-link"></i> 绑定正则</span>`;
        }
    } else if (badgeMode === 'bound_only') {
        if (boundIds.length > 0) {
            const boundNames = boundIds.map(id => regexMapA.get(String(id)) || id);
            const boundTitle = `已绑定 ${boundIds.length} 个预设正则:\n` + boundNames.join('\n');
            regexBadgeHtml = `<span class="stitch-bound-regex-badge interactable" data-prompt-id="${escapeHtml(pA.identifier)}" data-preset="${escapeHtml(effectiveName)}" style="background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeQuoteColor); padding: 1px 6px; border-radius: 4px; font-size: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;" title="${escapeHtml(boundTitle)} (点击管理绑定正则)"><i class="fa-solid fa-link"></i> 正则 (${boundIds.length}): ${escapeHtml(boundNames.slice(0, 2).join(', '))}${boundNames.length > 2 ? '...' : ''}</span>`;
        }
    }
    
    let metaHtml = '';
    const metaParts = [];
    if (pA.fav_origin_preset) {
        let badgeColor = 'rgba(123, 140, 222, 0.15)';
        let badgeTextColor = 'var(--zero-info-color, #2196F3)';
        let originText = pA.fav_origin_preset;
        const exists = currentPresetNames.includes(pA.fav_origin_preset);
        if (!exists) {
            badgeColor = 'rgba(255, 255, 255, 0.05)';
            badgeTextColor = 'rgba(255, 255, 255, 0.4)';
            originText = `${pA.fav_origin_preset} (已删除)`;
        }
        metaParts.push(`<span style="background: ${badgeColor}; color: ${badgeTextColor}; padding: 1px 6px; border-radius: 4px; font-size: 10px; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-map-pin"></i> ${highlightText(originText, 'origin')}</span>`);
    }
    if (pA.fav_note) {
        metaParts.push(`<span style="color: var(--SmartThemeBodyColor); opacity: 0.6; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-tag"></i> 备注: ${highlightText(pA.fav_note, 'note')}</span>`);
    }
    if (regexBadgeHtml) {
        metaParts.push(regexBadgeHtml);
    }
    if (metaParts.length > 0) {
        metaHtml = `<div class="stitch-item-meta" style="font-size: 11px; margin-top: 4px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; opacity: 0.85;">${metaParts.join('')}</div>`;
    }

    return `
        <div class="stitch-row interactable" style="
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 10px;
            background: rgba(255,255,255,0.03);
            border-radius: 6px;
            font-size: 13px;
            margin-bottom: 2px;
            cursor: pointer;
        ">
            <label style="margin: 0; display: ${stitch_batch_mode ? 'flex' : 'none'}; align-items: center; cursor: pointer;">
                <input type="checkbox" class="stitch-item-cb interactable" data-index="${index}" style="margin: 0; cursor: pointer;">
            </label>
            <div class="stitch-row-expand-trigger" style="flex: 1; overflow: hidden;">
                <div style="text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${nameStr}</div>
                ${metaHtml}
            </div>
            <div style="display: ${stitch_batch_mode ? 'none' : 'flex'}; gap: 12px; align-items: center; margin-left: 8px; position: relative;">
                <i class="fa-solid fa-chevron-down stitch-row-expand-trigger" style="padding: 4px; font-size: 10px; opacity: 0.5; cursor: pointer;"></i>
                <button class="stitch-menu-btn interactable" data-index="${index}" title="操作" style="padding: 4px; background: none; border: none; color: inherit; cursor: pointer; opacity: 0.6; font-size: 14px;">
                    <i class="fa-solid fa-ellipsis-vertical"></i>
                </button>
                <div class="stitch-action-dropdown" data-index="${index}" style="
                    display: none;
                    position: absolute;
                    right: 0;
                    top: 24px;
                    background: var(--zero-bg-color, var(--SmartThemeBlurTintColor));
                    color: var(--zero-text-color, inherit);
                    border: 1px solid var(--zero-border-color, var(--SmartThemeBorderColor));
                    border-radius: 8px;
                    z-index: 1000;
                    min-width: 100px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    flex-direction: column;
                    overflow: hidden;
                ">
                    <div class="stitch-bind-regex-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; color: var(--SmartThemeQuoteColor); display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-link" style="width: 14px;"></i> 绑定正则
                    </div>
                    <div class="stitch-edit-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-pencil" style="width: 14px;"></i> 编辑
                    </div>
                    <div class="stitch-clone-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-clone" style="width: 14px;"></i> 复制
                    </div>
                    <div class="stitch-move-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-sort" style="width: 14px;"></i> 移动
                    </div>
                    <div class="stitch-fav-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-star" style="width: 14px; color: var(--SmartThemeQuoteColor);"></i> 收藏
                    </div>
                    ${nameA && nameB ? `
                    <div class="stitch-action-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-arrow-right-to-bracket" style="width: 14px;"></i> 缝合
                    </div>` : ''}
                    <div class="stitch-delete-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; color: #ff5f5f; display: flex; align-items: center; gap: 8px; border-top: 1px solid rgba(255,255,255,0.05);">
                        <i class="fa-solid fa-trash-can" style="width: 14px;"></i> 删除
                    </div>
                </div>
            </div>
        </div>
        <div class="stitch-content" data-index="${index}" style="
            display: none;
            padding: 8px;
            background: rgba(0,0,0,0.2);
            border-radius: 6px;
            margin-top: 2px;
            margin-bottom: 4px;
            font-family: monospace;
            font-size: 11px;
            white-space: pre-wrap;
            word-break: break-all;
            color: var(--SmartThemeBodyColor);
        ">${highlightText(pA.content || '', 'content')}</div>
    `;
}

export async function renderStitchList(forceRefresh = true) {
    isRefreshingStitchList = true;
    const nameA = $('#stitch-preset-source').val();
    const nameB = $('#stitch-preset-target').val();
    
    if (!nameA && !nameB) return;
    
    const effectiveName = nameA || nameB;
    if (!effectiveName) return;

    // Show/hide note and origin filter badges based on whether preset starts with ★
    const isFav = effectiveName.startsWith('★');
    const $noteBadge = $('.stitch-search-filter-badge[data-filter="note"]');
    const $originBadge = $('.stitch-search-filter-badge[data-filter="origin"]');
    if (isFav) {
        $noteBadge.show();
        $originBadge.show();
    } else {
        $noteBadge.hide().removeClass('active').css('background', 'rgba(255,255,255,0.08)').css('color', 'inherit').css('opacity', '0.5');
        $originBadge.hide().removeClass('active').css('background', 'rgba(255,255,255,0.08)').css('color', 'inherit').css('opacity', '0.5');
    }

    const $list = $('#stitch-list');
    
    if (forceRefresh || _cachedStitchName !== nameA) {
        $list.html('<p style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</p>');
    }

    try {
        if (forceRefresh || _cachedStitchName !== effectiveName || !_cachedStitchPrompts) {
            _cachedStitchPrompts = await getPresetPrompts(effectiveName);
            _cachedStitchName = effectiveName;
        }
        
        let promptsA = _cachedStitchPrompts;
        const query = $('#stitch-search-input').val()?.trim();
        const queryLower = query?.toLowerCase();
        const activeFilters = [];
        $('.stitch-search-filter-badge.active').each(function() {
            activeFilters.push($(this).data('filter'));
        });

        const highlightText = (text, filterName) => {
            return highlightTextUtil(text, query, activeFilters.includes(filterName));
        };

        if (queryLower) {
            promptsA = promptsA.filter(p => matchStitch(p, queryLower, activeFilters));
        }
        
        const pm = SillyTavern.getContext().getPresetManager('openai');
        const presetListObj = pm ? pm.getPresetList() : null;
        const currentPresetNames = presetListObj ? (pm.isKeyedApi() ? (presetListObj.preset_names || []) : Object.keys(presetListObj.preset_names || {})) : [];

        const srcPresetObj = pm ? pm.getCompletionPresetByName(effectiveName) : null;
        const regexListA = srcPresetObj ? getPresetRegexScripts(srcPresetObj) : [];
        const regexMapA = new Map();
        regexListA.forEach(r => regexMapA.set(String(r.id || r.scriptName), r.scriptName || r.id));
        
        $list.empty();
        
        renderTargetBPeek();
        
        if (promptsA.length === 0) {
            const msg = queryLower ? '无匹配结果' : '源预设为空';
            $list.html(`<p style="text-align: center; opacity: 0.5; font-size: 12px; margin-top: 20px;">${msg}</p>`);
            return;
        }

        const badgeMode = UiStateManager.get().stitchRegexBadgeMode || 'bound_only';
        const isGroupDisplay = UiStateManager.get().stitchGroupByPresetGroup === true;

        if (isGroupDisplay) {
            const rawGroups = GroupManager.get(effectiveName) || [];
            const assignedIds = new Set();
            const groupSections = [];

            rawGroups.forEach(g => {
                const groupMembers = [];
                const gIds = new Set(g.ids || []);
                gIds.forEach(id => assignedIds.add(id));

                promptsA.forEach((pA, index) => {
                    if (gIds.has(pA.identifier)) {
                        groupMembers.push({ pA, index });
                    }
                });

                if (groupMembers.length > 0) {
                    const rowsHtml = groupMembers.map(m => renderStitchRowHTML(m.pA, m.index, effectiveName, regexMapA, currentPresetNames, highlightText, badgeMode, nameA, nameB)).join('');
                    const isCollapsed = g.col === true;
                    groupSections.push(`
                        <div class="stitch-group" data-gid="${escapeHtml(g.id)}">
                            <div class="stitch-group-header interactable" data-gid="${escapeHtml(g.id)}" style="
                                display: flex;
                                align-items: center;
                                justify-content: space-between;
                                padding: 7px 10px;
                                background: rgba(255, 255, 255, 0.04);
                                border: 1px solid rgba(255, 255, 255, 0.08);
                                border-radius: 6px;
                                cursor: pointer;
                                user-select: none;
                                margin-top: 4px;
                                margin-bottom: 4px;
                            ">
                                <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                                    <i class="fa-solid fa-chevron-down stitch-group-chevron" style="font-size: 11px; opacity: 0.7; transition: transform 0.2s; ${isCollapsed ? 'transform: rotate(-90deg);' : ''}"></i>
                                    <i class="fa-solid fa-folder" style="color: var(--SmartThemeQuoteColor); font-size: 12px; opacity: 0.9;"></i>
                                    <span style="font-weight: 600; font-size: 13px; color: var(--SmartThemeBodyColor); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(g.name)}</span>
                                    <span style="font-size: 10px; opacity: 0.6; background: rgba(255,255,255,0.08); padding: 1px 6px; border-radius: 8px; flex-shrink: 0;">${groupMembers.length}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <label class="stitch-group-cb-label" style="display: ${stitch_batch_mode ? 'flex' : 'none'}; align-items: center; gap: 4px; font-size: 11px; margin: 0; cursor: pointer; opacity: 0.85;">
                                        <input type="checkbox" class="stitch-group-select-all interactable" data-gid="${escapeHtml(g.id)}" style="margin: 0; cursor: pointer;" title="全选/取消全选本组条目">
                                        <span>全选</span>
                                    </label>
                                </div>
                            </div>
                            <div class="stitch-group-body" data-gid="${escapeHtml(g.id)}" style="
                                display: ${isCollapsed ? 'none' : 'flex'};
                                flex-direction: column;
                                gap: 2px;
                                padding-left: 8px;
                                border-left: 2px solid rgba(255,255,255,0.06);
                                margin-left: 8px;
                                margin-bottom: 6px;
                            ">
                                ${rowsHtml}
                            </div>
                        </div>
                    `);
                }
            });

            // Ungrouped prompts
            const ungroupedMembers = [];
            promptsA.forEach((pA, index) => {
                if (!assignedIds.has(pA.identifier)) {
                    ungroupedMembers.push({ pA, index });
                }
            });

            if (ungroupedMembers.length > 0) {
                const rowsHtml = ungroupedMembers.map(m => renderStitchRowHTML(m.pA, m.index, effectiveName, regexMapA, currentPresetNames, highlightText, badgeMode, nameA, nameB)).join('');
                const ugCollapsed = UiStateManager.get().ungroupedCol === true;
                groupSections.push(`
                    <div class="stitch-group" data-gid="__ungrouped">
                        <div class="stitch-group-header interactable" data-gid="__ungrouped" style="
                            display: flex;
                            align-items: center;
                            justify-content: space-between;
                            padding: 7px 10px;
                            background: rgba(255, 255, 255, 0.04);
                            border: 1px solid rgba(255, 255, 255, 0.08);
                            border-radius: 6px;
                            cursor: pointer;
                            user-select: none;
                            margin-top: 4px;
                            margin-bottom: 4px;
                        ">
                            <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                                <i class="fa-solid fa-chevron-down stitch-group-chevron" style="font-size: 11px; opacity: 0.7; transition: transform 0.2s; ${ugCollapsed ? 'transform: rotate(-90deg);' : ''}"></i>
                                <i class="fa-solid fa-folder-open" style="color: var(--SmartThemeEmColor); font-size: 12px; opacity: 0.7;"></i>
                                <span style="font-weight: 600; font-size: 13px; color: var(--SmartThemeBodyColor); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">未分组</span>
                                <span style="font-size: 10px; opacity: 0.6; background: rgba(255,255,255,0.08); padding: 1px 6px; border-radius: 8px; flex-shrink: 0;">${ungroupedMembers.length}</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <label class="stitch-group-cb-label" style="display: ${stitch_batch_mode ? 'flex' : 'none'}; align-items: center; gap: 4px; font-size: 11px; margin: 0; cursor: pointer; opacity: 0.85;">
                                    <input type="checkbox" class="stitch-group-select-all interactable" data-gid="__ungrouped" style="margin: 0; cursor: pointer;" title="全选/取消全选本组条目">
                                    <span>全选</span>
                                </label>
                            </div>
                        </div>
                        <div class="stitch-group-body" data-gid="__ungrouped" style="
                            display: ${ugCollapsed ? 'none' : 'flex'};
                            flex-direction: column;
                            gap: 2px;
                            padding-left: 8px;
                            border-left: 2px solid rgba(255,255,255,0.06);
                            margin-left: 8px;
                            margin-bottom: 6px;
                        ">
                            ${rowsHtml}
                        </div>
                    </div>
                `);
            }

            $list.html(groupSections.join(''));
        } else {
            const rowParts = promptsA.map((pA, index) => renderStitchRowHTML(pA, index, effectiveName, regexMapA, currentPresetNames, highlightText, badgeMode, nameA, nameB));
            $list.html(rowParts.join(''));
        }

        // Toggle stitch group collapse
        $('.stitch-group-header').off('click').on('click', function(e) {
            if ($(e.target).closest('.stitch-group-select-all, .stitch-group-cb-label').length) return;
            const gid = String($(this).data('gid'));
            const $body = $(`.stitch-group-body[data-gid="${gid}"]`);
            const $chevron = $(this).find('.stitch-group-chevron');
            const isCurrentlyHidden = $body.css('display') === 'none';
            if (isCurrentlyHidden) {
                $body.css('display', 'flex');
                $chevron.css('transform', 'rotate(0deg)');
            } else {
                $body.css('display', 'none');
                $chevron.css('transform', 'rotate(-90deg)');
            }
            if (gid === '__ungrouped') {
                UiStateManager.save({ ungroupedCol: !isCurrentlyHidden });
            } else {
                GroupManager.setCollapse(effectiveName, gid, !isCurrentlyHidden);
            }
        });

        // Group select-all checkbox handler
        $('.stitch-group-select-all').off('change').on('change', function(e) {
            e.stopPropagation();
            const isChecked = $(this).is(':checked');
            const gid = String($(this).data('gid'));
            const $body = $(`.stitch-group-body[data-gid="${gid}"]`);
            $body.find('.stitch-item-cb').prop('checked', isChecked).trigger('change');
            if (isChecked) {
                $body.find('.stitch-item-cb').attr('checked', 'checked');
            } else {
                $body.find('.stitch-item-cb').removeAttr('checked');
            }
        });

        // Bind regex modal click handler for badge
        $('.stitch-bound-regex-badge').off('click').on('click', async function(e) {
            e.stopPropagation();
            const promptId = String($(this).data('prompt-id'));
            const presetName = String($(this).data('preset') || effectiveName);
            const presetObj = pm ? pm.getCompletionPresetByName(presetName) : null;
            if (!presetObj || !Array.isArray(presetObj.prompts)) return;
            const targetPrompt = presetObj.prompts.find(p => String(p.identifier) === promptId);
            if (targetPrompt) {
                await showBindRegexModal(targetPrompt, presetName, () => {
                    renderStitchList(true);
                });
            }
        });

        // Dropdown menu bind regex handler
        $('.stitch-bind-regex-btn').off('click').on('click', async function(e) {
            e.stopPropagation();
            $('.stitch-action-dropdown').hide();
            const idx = parseInt($(this).data('index'));
            const targetPrompt = promptsA[idx];
            if (targetPrompt) {
                await showBindRegexModal(targetPrompt, effectiveName, () => {
                    renderStitchList(true);
                });
            }
        });

        // Toggle item contents (Accordion style - one open at a time)
        $('.stitch-row-expand-trigger').off('click').on('click', function(e) {
            e.stopPropagation();
            const $row = $(this).closest('.stitch-row');
            const idx = $row.find('.stitch-item-cb').data('index');
            const $content = $(`.stitch-content[data-index="${idx}"]`);
            const $icon = $row.find('.fa-chevron-down, .fa-chevron-up');
            
            const isOpening = $content.css('display') === 'none';
            
            if (isOpening) {
                // Collapse all other contents in A
                $('.stitch-content').not($content).hide();
                // Reset all other chevrons in A
                $('.stitch-row').not($row).find('.fa-chevron-up').removeClass('fa-chevron-up').addClass('fa-chevron-down');
                
                // Expand current content
                $content.show();
                $icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
            } else {
                // Collapse current content
                $content.hide();
                $icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
            }
        });

        if (stitch_batch_mode) {
            $('#stitch-controls').css('display', 'flex');
            $('#stitch-mode-toggle').css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white');
        } else {
            $('#stitch-controls').css('display', 'none');
            $('#stitch-mode-toggle').css('background', 'rgba(255,255,255,0.05)').css('color', 'inherit');
        }
        
        window.zero_stitch_promptsA = promptsA;
        window.zero_stitch_sourceName = effectiveName;

        restoreScroll();
    } catch (e) {
        console.error('[Zero] Failed to render stitch list:', e);
        $list.html('<p style="text-align: center; color: var(--SmartThemeShadowColor);">加载失败</p>');
        isRefreshingStitchList = false;
    }
}

let _lastStitchAutoGroupState = null;

export async function undoLastStitchGroup() {
    if (!_lastStitchAutoGroupState || !_lastStitchAutoGroupState.targetPresetName) {
        toastr.info('暂无可撤回的缝合分组变动');
        return;
    }

    const { targetPresetName, items } = _lastStitchAutoGroupState;
    if (!Array.isArray(items) || items.length === 0) return;

    // 1. Unassign all cloned items from target groups in a single batch call
    const clonedIds = items.map(it => it.clonedIdentifier);
    GroupManager.unassign(targetPresetName, clonedIds);

    // 2. Restore original source groups if any
    const restoreGroupMap = new Map();
    items.forEach(item => {
        if (item.originalSourceGroupName) {
            if (!restoreGroupMap.has(item.originalSourceGroupName)) {
                restoreGroupMap.set(item.originalSourceGroupName, []);
            }
            restoreGroupMap.get(item.originalSourceGroupName).push(item.clonedIdentifier);
        }
    });

    for (const [origGroupName, ids] of restoreGroupMap.entries()) {
        const tgtGroups = GroupManager.get(targetPresetName);
        let origGroup = tgtGroups.find(g => g.name === origGroupName);
        if (!origGroup) {
            origGroup = GroupManager.create(targetPresetName, origGroupName);
        }
        GroupManager.assign(targetPresetName, origGroup.id, ids);
    }

    _lastStitchAutoGroupState = null;
    toastr.success(`已撤回自动分组，还原 ${items.length} 个条目的分组设置`);
    window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName: targetPresetName } }));
    renderStitchList(true);
}

export async function performStitch(itemsA, targetName, position) {
    const items = Array.isArray(itemsA) ? itemsA : [itemsA];
    if (items.length === 0) return;

    HistoryManager.record();
    try {
        if (!targetName) throw new Error('未选择目标预设');
        const pm = SillyTavern.getContext().getPresetManager('openai');
        const targetPreset = pm.getCompletionPresetByName(targetName);
        if (!targetPreset) throw new Error('Target preset not found');

        if (!Array.isArray(targetPreset.prompts)) targetPreset.prompts = [];

        let orderArray = null;
        if (Array.isArray(targetPreset.prompt_order) && targetPreset.prompt_order.length > 0) {
            let globalEntry = targetPreset.prompt_order.find(item => item && String(item.character_id) === '100001');
            if (!globalEntry) {
                const first = targetPreset.prompt_order[0];
                if (first && Array.isArray(first.order)) {
                    globalEntry = first;
                    orderArray = first.order;
                } else {
                    orderArray = targetPreset.prompt_order;
                }
            } else {
                orderArray = globalEntry.order;
            }
        } 
        
        if (!orderArray) {
            const newOrderArray = targetPreset.prompts.map(p => ({ identifier: p.identifier, enabled: true }));
            targetPreset.prompt_order = [{ character_id: '100001', order: newOrderArray }];
            orderArray = newOrderArray;
        }

        // Determine insertion index in targetPreset orderArray
        let insertionIdx = orderArray.length;
        if (position === 'top') {
            insertionIdx = 0;
        } else if (position === 'bottom') {
            insertionIdx = orderArray.length;
        } else {
            const idx = orderArray.findIndex(o => {
                const id = (o && typeof o === 'object') ? o.identifier : o;
                return String(id) === String(position);
            });
            if (idx !== -1) {
                insertionIdx = idx + 1;
            }
        }

        // Infer adjacent upper/lower item group in targetPreset
        const prevItem = insertionIdx > 0 ? orderArray[insertionIdx - 1] : null;
        const nextItem = insertionIdx < orderArray.length ? orderArray[insertionIdx] : null;
        const prevId = prevItem ? ((prevItem && typeof prevItem === 'object') ? prevItem.identifier : prevItem) : null;
        const nextId = nextItem ? ((nextItem && typeof nextItem === 'object') ? nextItem.identifier : nextItem) : null;
        const tgtGroups = GroupManager.get(targetName);

        const prevGroup = prevId ? tgtGroups.find(g => g.ids.includes(prevId)) : null;
        const nextGroup = nextId ? tgtGroups.find(g => g.ids.includes(nextId)) : null;

        let autoInferredGroup = null;
        if (position !== 'top' && position !== 'bottom') {
            if (prevGroup && nextGroup && prevGroup.id === nextGroup.id) {
                autoInferredGroup = prevGroup;
            } else if (prevGroup) {
                autoInferredGroup = prevGroup;
            }
        }

        const clones = [];
        const sourcePresetName = $('#stitch-preset-source').val();
        const autoGroupItems = [];
        const isObjOrderFormat = orderArray.length === 0 || typeof orderArray[0] === 'object';
        const srcGroups = sourcePresetName ? GroupManager.get(sourcePresetName) : [];

        const srcGroupMap = new Map();
        const autoInferredIds = [];

        const autoMigrate = sourcePresetName && sourcePresetName !== targetName && UiStateManager.get().autoMigrateBoundRegex !== false;
        const srcPresetObj = autoMigrate ? pm.getCompletionPresetByName(sourcePresetName) : null;

        for (const itemA of items) {
            const cloneA = JSON.parse(JSON.stringify(itemA));
            cloneA.identifier = 'system_prompt_' + Date.now() + Math.floor(Math.random() * 1000) + '_' + Math.floor(Math.random() * 1000); 
            targetPreset.prompts.push(cloneA);
            clones.push(isObjOrderFormat ? { identifier: cloneA.identifier, enabled: false } : cloneA.identifier);

            let srcGroupName = null;
            if (sourcePresetName) {
                const srcGroup = srcGroups.find(g => g.ids.includes(itemA.identifier));
                if (srcGroup) srcGroupName = srcGroup.name;
            }

            if (srcGroupName && sourcePresetName !== targetName) {
                // Item has an original group from source preset -> preserve it in target preset
                if (!srcGroupMap.has(srcGroupName)) {
                    srcGroupMap.set(srcGroupName, []);
                }
                srcGroupMap.get(srcGroupName).push(cloneA.identifier);
            } else if (autoInferredGroup) {
                // Item had NO original group, but was inserted inside a group in target preset
                autoInferredIds.push(cloneA.identifier);
                autoGroupItems.push({
                    clonedIdentifier: cloneA.identifier,
                    inferredGroupName: autoInferredGroup.name,
                    originalSourceGroupName: srcGroupName
                });
            }

            // Auto-migrate bound regexes if enabled
            if (autoMigrate && srcPresetObj && Array.isArray(itemA.bound_regex_ids) && itemA.bound_regex_ids.length > 0) {
                migrateBoundRegexes(srcPresetObj, targetPreset, itemA.bound_regex_ids);
            }
        }

        // Apply group assignments in batch
        for (const [groupName, ids] of srcGroupMap.entries()) {
            const currentTgtGroups = GroupManager.get(targetName);
            let tgtGroup = currentTgtGroups.find(g => g.name === groupName);
            if (!tgtGroup) {
                tgtGroup = GroupManager.create(targetName, groupName);
            }
            GroupManager.assign(targetName, tgtGroup.id, ids);
        }

        if (autoInferredGroup && autoInferredIds.length > 0) {
            GroupManager.assign(targetName, autoInferredGroup.id, autoInferredIds);
        }

        _lastStitchAutoGroupState = autoGroupItems.length > 0 ? {
            targetPresetName: targetName,
            items: autoGroupItems
        } : null;

        if (position === 'top') {
            orderArray.unshift(...clones);
        } else if (position === 'bottom') {
            orderArray.push(...clones);
        } else {
            if (insertionIdx > 0 && insertionIdx <= orderArray.length) {
                orderArray.splice(insertionIdx, 0, ...clones);
            } else {
                orderArray.push(...clones);
            }
        }

        const isActive = pm.getSelectedPresetName() === targetName;
        savePresetWithoutRegexToast(pm, targetName, targetPreset, { skipUpdate: !isActive }).then(async () => {
            await syncBoundRegexOnPromptToggle(null, targetName);
            if (isActive && typeof pm.loadPreset === 'function') {
                return savePresetWithoutRegexToast(pm, targetName, null, { loadOnly: true });
            }
        }).catch(err => {
            console.error('[Zero] Background save/load failed in performStitch:', err);
        });
        OpLogManager.add(targetName, 'stitch', '缝合', items.length === 1 ? (items[0].name || items[0].identifier) : `缝合 ${items.length} 个条目`, `从「${sourcePresetName || '其它预设'}」缝合至此预设`);

        $('body').off('click', '#undo-stitch-group-link').on('click', '#undo-stitch-group-link', function(e) {
            e.preventDefault();
            e.stopPropagation();
            undoLastStitchGroup();
        });

        if (autoGroupItems.length > 0 && autoInferredGroup) {
            toastr.success(`已缝合 ${items.length} 个条目，并根据上下文自动加入分组「${escapeHtml(autoInferredGroup.name)}」 <a id="undo-stitch-group-link" style="color: #ffaa55; text-decoration: underline; margin-left: 6px; cursor: pointer; font-weight: bold;">[撤回分组]</a>`, '', { timeOut: 10000, escapeHtml: false });
        } else if (UiStateManager.get().toastOnPresetStitch === true) {
            toastr.success(`成功缝合至预设「${targetName}」`);
        }
    } catch (err) {
        console.error('[Zero] Perform stitch failed:', err);
        toastr.error('缝合失败');
    }
}

export async function performMove(itemsA, presetName, position) {
    const items = Array.isArray(itemsA) ? itemsA : [itemsA];
    if (items.length === 0) return;

    HistoryManager.record();
    try {
        const pm = SillyTavern.getContext().getPresetManager('openai');
        const preset = pm.getCompletionPresetByName(presetName);
        if (!preset) throw new Error('Preset not found');

        let orderArray = null;
        if (Array.isArray(preset.prompt_order) && preset.prompt_order.length > 0) {
            let globalEntry = preset.prompt_order.find(item => item && String(item.character_id) === '100001');
            if (!globalEntry) {
                const first = preset.prompt_order[0];
                if (first && Array.isArray(first.order)) {
                    orderArray = first.order;
                } else {
                    orderArray = preset.prompt_order;
                }
            } else {
                orderArray = globalEntry.order;
            }
        } 
        
        if (!orderArray) {
            const newOrderArray = (preset.prompts || []).map(p => ({ identifier: p.identifier, enabled: true }));
            preset.prompt_order = [{ character_id: '100001', order: newOrderArray }];
            orderArray = newOrderArray;
        }

        const idsToMove = items.map(p => p.identifier);
        
        const extracted = [];
        for (let i = orderArray.length - 1; i >= 0; i--) {
            const item = orderArray[i];
            const id = (item && typeof item === 'object') ? item.identifier : item;
            if (idsToMove.includes(id)) {
                extracted.unshift(item);
                orderArray.splice(i, 1);
            }
        }

        if (extracted.length === 0) throw new Error('无法在排序中找到所选条目');

        if (position === 'top') {
            orderArray.unshift(...extracted);
        } else if (position === 'bottom') {
            orderArray.push(...extracted);
        } else {
            const idx = orderArray.findIndex(o => {
                const id = (o && typeof o === 'object') ? o.identifier : o;
                return id === position;
            });
            if (idx !== -1) {
                orderArray.splice(idx + 1, 0, ...extracted);
            } else {
                orderArray.push(...extracted);
            }
        }

        const isActive = pm.getSelectedPresetName() === presetName;
        savePresetWithoutRegexToast(pm, presetName, preset, { skipUpdate: !isActive }).then(async () => {
            await syncBoundRegexOnPromptToggle(null, presetName);
            if (isActive && typeof pm.loadPreset === 'function') {
                return savePresetWithoutRegexToast(pm, presetName, null, { loadOnly: true });
            }
        }).catch(err => {
            console.error('[Zero] Background save/load failed in performMove:', err);
        });
        
        _cachedStitchPrompts = await getPresetPrompts(presetName);
        renderStitchList(false);
    } catch (err) {
        console.error('[Zero] Perform move failed:', err);
        toastr.error('移动失败');
    }
}

export async function performBatchDelete(items, presetName) {
    HistoryManager.record();
    try {
        const manager = SillyTavern.getContext().getPresetManager('openai');
        const preset = manager.getCompletionPresetByName(presetName);
        if (!preset) throw new Error('Preset not found');

        const idsToRemove = items.map(p => p.identifier);
        
        if (Array.isArray(preset.prompts)) {
            preset.prompts = preset.prompts.filter(p => !idsToRemove.includes(p.identifier));
        } else if (preset.prompts && typeof preset.prompts === 'object') {
            idsToRemove.forEach(id => {
                if (preset.prompts[id]) delete preset.prompts[id];
            });
        }

        if (preset.prompt_order) {
            if (Array.isArray(preset.prompt_order)) {
                preset.prompt_order.forEach(entry => {
                    if (entry && Array.isArray(entry.order)) {
                        entry.order = entry.order.filter(item => {
                            const id = (item && typeof item === 'object') ? item.identifier : item;
                            return !idsToRemove.includes(id);
                        });
                    }
                });
                
                preset.prompt_order = preset.prompt_order.filter(item => {
                    const id = (item && typeof item === 'object') ? item.identifier : item;
                    if (item && item.character_id) return true;
                    return !idsToRemove.includes(id);
                });
            } else if (typeof preset.prompt_order === 'object') {
                Object.keys(preset.prompt_order).forEach(key => {
                    if (Array.isArray(preset.prompt_order[key])) {
                        preset.prompt_order[key] = preset.prompt_order[key].filter(item => {
                            const id = (item && typeof item === 'object') ? item.identifier : item;
                            return !idsToRemove.includes(id);
                        });
                    }
                });
            }
        }

        const isActive = manager.getSelectedPresetName() === presetName;
        
        _cachedStitchPrompts = _cachedStitchPrompts.filter(p => !idsToRemove.includes(p.identifier));
        renderStitchList(false);

        savePresetWithoutRegexToast(manager, presetName, preset, { skipUpdate: !isActive }).then(async () => {
            await syncBoundRegexOnPromptToggle(null, presetName);
            if (isActive && typeof manager.loadPreset === 'function') {
                return savePresetWithoutRegexToast(manager, presetName, null, { loadOnly: true });
            }
        }).catch(err => {
            console.error('[Zero] Background save/load failed in performBatchDelete:', err);
        });
    } catch (err) {
        console.error('[Zero] Batch delete failed:', err);
        toastr.error('删除失败: ' + err.message);
    }
}

export async function performSingleClone(item, presetName) {
    HistoryManager.record();
    try {
        const manager = SillyTavern.getContext().getPresetManager('openai');
        const preset = manager.getCompletionPresetByName(presetName);
        if (!preset) throw new Error('Preset not found');

        const originalId = item.identifier;
        const newId = 'system_prompt_' + Date.now() + Math.floor(Math.random() * 1000);
        
        const clone = JSON.parse(JSON.stringify(item));
        clone.identifier = newId;
        clone.name = (clone.name || clone.identifier) + ' (副本)';
        clone.enabled = false;
        
        if (Array.isArray(preset.prompts)) {
            preset.prompts.push(clone);
        } else if (preset.prompts && typeof preset.prompts === 'object') {
            preset.prompts[newId] = clone;
        }

        // Inherit original item's group
        const groups = GroupManager.get(presetName);
        const originalGroup = groups.find(g => g.ids.includes(originalId));
        if (originalGroup) {
            GroupManager.assign(presetName, originalGroup.id, [newId]);
        }

        if (preset.prompt_order) {
            const updateOrder = (order) => {
                const idx = order.findIndex(p => {
                    const id = (p && typeof p === 'object') ? p.identifier : p;
                    return id === originalId;
                });
                if (idx !== -1) {
                    const newItem = (order[0] && typeof order[0] === 'object') ? { identifier: newId, enabled: false } : newId;
                    order.splice(idx + 1, 0, newItem);
                }
            };

            if (Array.isArray(preset.prompt_order)) {
                preset.prompt_order.forEach(entry => {
                    if (entry && Array.isArray(entry.order)) updateOrder(entry.order);
                });
                
                const isFlatOrder = preset.prompt_order.some(p => (typeof p === 'string' || (p && p.identifier)));
                if (isFlatOrder) updateOrder(preset.prompt_order);

            } else if (typeof preset.prompt_order === 'object') {
                Object.keys(preset.prompt_order).forEach(key => {
                    if (Array.isArray(preset.prompt_order[key])) updateOrder(preset.prompt_order[key]);
                });
            }
        }

        const isActive = manager.getSelectedPresetName() === presetName;
        
        const idx = _cachedStitchPrompts.findIndex(p => p.identifier === originalId);
        if (idx !== -1) {
            _cachedStitchPrompts.splice(idx + 1, 0, clone);
        } else {
            _cachedStitchPrompts.push(clone);
        }
        renderStitchList(false);

        savePresetWithoutRegexToast(manager, presetName, preset, { skipUpdate: !isActive }).then(async () => {
            await syncBoundRegexOnPromptToggle(null, presetName);
            if (isActive && typeof manager.loadPreset === 'function') {
                return savePresetWithoutRegexToast(manager, presetName, null, { loadOnly: true });
            }
        }).catch(err => {
            console.error('[Zero] Background save/load failed in performSingleClone:', err);
        });
    } catch (err) {
        console.error('[Zero] Single clone failed:', err);
        toastr.error('复制失败: ' + err.message);
    }
}



export async function showMoveModal(items, presetName) {
    try {
        const prompts = await getPresetPrompts(presetName);
        const itemIds = items.map(i => i.identifier);
        // Exclude items being moved from the target options so user doesn't insert after an item being moved
        const validPrompts = prompts.filter(p => !itemIds.includes(p.identifier));
        
        const targetOptions = `
            <option value="top">-- 最顶部 --</option>
            <option value="bottom" selected>-- 最底部 --</option>
            ${validPrompts.map(p => `<option value="${p.identifier}">在 "${escapeHtml(p.name || p.identifier)}" 之后</option>`).join('')}
        `;

        const isBatch = items.length > 1;
        const title = isBatch ? '移动条目' : '移动条目';
        const desc = isBatch 
            ? `在 <b>${presetName}</b> 内移动选中的 <b>${items.length}</b> 个条目`
            : `在 <b>${presetName}</b> 内移动 <b>${escapeHtml(items[0].name || items[0].identifier)}</b>`;

        const modalHtml = `
            <div id="move-modal" class="zero-overlay" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: transparent; pointer-events: none; z-index: 20000; display: flex; align-items: center; justify-content: center; padding: 20px;">
                <div class="zero-modal-card" style="pointer-events: auto; background: var(--zero-bg-color, var(--SmartThemeBlurTintColor-Original, #1e1e28)); color: var(--zero-text-color, inherit); padding: 24px; border-radius: 16px; width: 100%; max-width: 360px; border: 1px solid var(--zero-border-color, var(--SmartThemeBorderColor)); display: flex; flex-direction: column;">
                    <div style="font-weight: bold; margin-bottom: 4px; font-size: 16px; color: var(--zero-text-color, inherit);">${title}</div>
                    <div style="font-size: 11px; color: var(--zero-muted-color, #999); margin-bottom: 16px;">${desc}</div>
                    
                    <div style="margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px;">
                        <label style="font-size: 12px; opacity: 0.8;">插入位置:</label>
                        <select id="move-position-select" class="interactable" style="padding: 8px; background: var(--zero-card-bg, var(--SmartThemeChatTintColor, rgba(255,255,255,0.05))); border: 1px solid var(--zero-border-color, var(--SmartThemeBorderColor)); color: inherit; border-radius: 4px; font-size: 13px;">
                            ${targetOptions}
                        </select>
                    </div>
                    
                    <div style="display: flex; gap: 10px;">
                        <button id="confirm-move" class="interactable" style="flex: 1; padding: 10px; border: none; border-radius: 8px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; font-size: 13px;">确认移动</button>
                        <button id="close-move-modal" class="interactable" style="flex: 1; padding: 10px; border: none; border-radius: 8px; background: rgba(255,255,255,0.1); color: inherit; cursor: pointer; font-size: 13px;">取消</button>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);
        $('#close-move-modal').on('click', () => $('#move-modal').remove());

        $('#confirm-move').on('click', async () => {
            const position = $('#move-position-select').val();
            await performMove(items, presetName, position);
            $('#move-modal').remove();
            if (isBatch) {
                $('.stitch-item-cb').prop('checked', false).trigger('change');
                resetStitchBatchMode();
                // renderStitchList is called in performMove
            }
        });
    } catch (err) {
        console.error('[Zero] Failed to show move modal:', err);
        toastr.error('无法显示移动窗口');
    }
}

function renderPeekRowHTML(pB, index, nameB, regexMapB, highlightText, badgeMode) {
    const nameStr = highlightText(pB.name || pB.identifier || '未命名', 'name');
    const boundIdsB = Array.isArray(pB.bound_regex_ids) ? pB.bound_regex_ids : [];

    let regexBadgeHtmlB = '';
    if (badgeMode === 'all') {
        if (boundIdsB.length > 0) {
            const boundNamesB = boundIdsB.map(id => regexMapB.get(String(id)) || id);
            const boundTitleB = `已绑定 ${boundIdsB.length} 个预设正则:\n` + boundNamesB.join('\n');
            regexBadgeHtmlB = `<span class="stitch-peek-bound-regex-badge interactable" data-prompt-id="${escapeHtml(pB.identifier)}" data-preset="${escapeHtml(nameB)}" style="background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeQuoteColor); padding: 1px 5px; border-radius: 4px; font-size: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;" title="${escapeHtml(boundTitleB)} (点击管理绑定正则)"><i class="fa-solid fa-link"></i> 正则 (${boundIdsB.length})</span>`;
        } else {
            regexBadgeHtmlB = `<span class="stitch-peek-bound-regex-badge interactable" data-prompt-id="${escapeHtml(pB.identifier)}" data-preset="${escapeHtml(nameB)}" style="background: rgba(255,255,255,0.03); border: 1px dashed var(--SmartThemeBorderColor); color: var(--SmartThemeEmColor); padding: 1px 5px; border-radius: 4px; font-size: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; opacity: 0.7;" title="点击绑定预设正则"><i class="fa-solid fa-link"></i> 正则</span>`;
        }
    } else if (badgeMode === 'bound_only') {
        if (boundIdsB.length > 0) {
            const boundNamesB = boundIdsB.map(id => regexMapB.get(String(id)) || id);
            const boundTitleB = `已绑定 ${boundIdsB.length} 个预设正则:\n` + boundNamesB.join('\n');
            regexBadgeHtmlB = `<span class="stitch-peek-bound-regex-badge interactable" data-prompt-id="${escapeHtml(pB.identifier)}" data-preset="${escapeHtml(nameB)}" style="background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeQuoteColor); padding: 1px 5px; border-radius: 4px; font-size: 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;" title="${escapeHtml(boundTitleB)} (点击管理绑定正则)"><i class="fa-solid fa-link"></i> 正则 (${boundIdsB.length})</span>`;
        }
    }

    return `
        <div class="stitch-peek-row interactable" data-index="${index}" style="
            padding: 6px 10px;
            background: rgba(255,255,255,0.03);
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2px;
        ">
            <span class="stitch-peek-expand-trigger" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${nameStr}</span>
            <div style="display: flex; align-items: center; gap: 4px;">
                ${regexBadgeHtmlB}
                <i class="fa-solid fa-plus stitch-peek-insert-btn interactable" title="在此处下方插入已勾选的条目" data-id="${pB.identifier}" style="padding: 4px 8px; cursor: pointer; opacity: 0.6; font-size: 13px;"></i>
                <i class="fa-solid fa-chevron-down stitch-peek-expand-trigger" style="padding: 4px; font-size: 10px; opacity: 0.5;"></i>
            </div>
        </div>
        <div class="stitch-peek-content" data-index="${index}" style="
            display: none;
            padding: 8px;
            background: rgba(0,0,0,0.2);
            border-radius: 6px;
            margin-top: 2px;
            margin-bottom: 4px;
            font-family: monospace;
            font-size: 11px;
            white-space: pre-wrap;
            word-break: break-all;
            color: var(--SmartThemeBodyColor);
        ">${highlightText(pB.content || '', 'content')}</div>
    `;
}

export async function renderTargetBPeek() {
    isRefreshingTargetB = true;
    const nameB = $('#stitch-preset-target').val();
    const $drawer = $('#stitch-target-peek-drawer');
    const $list = $('#stitch-peek-list');

    if (!nameB) {
        $drawer.css('display', 'none');
        isRefreshingTargetB = false;
        return;
    }

    $drawer.css('display', 'flex');

    // Show/hide note and origin filter badges based on whether preset B starts with ★
    const isFavB = nameB.startsWith('★');
    const $noteBadgeB = $('.stitch-peek-search-filter-badge[data-filter="note"]');
    const $originBadgeB = $('.stitch-peek-search-filter-badge[data-filter="origin"]');
    if (isFavB) {
        $noteBadgeB.show();
        $originBadgeB.show();
    } else {
        $noteBadgeB.hide().removeClass('active').css('background', 'rgba(255,255,255,0.08)').css('color', 'inherit').css('opacity', '0.5');
        $originBadgeB.hide().removeClass('active').css('background', 'rgba(255,255,255,0.08)').css('color', 'inherit').css('opacity', '0.5');
    }

    $list.html('<p style="text-align: center; padding: 10px; font-size: 11px; opacity: 0.6;"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</p>');

    try {
        const pm = SillyTavern.getContext().getPresetManager('openai');
        let promptsB = await getPresetPrompts(nameB);
        const query = $('#stitch-peek-search-input').val()?.trim();
        const queryLower = query?.toLowerCase();
        const activeFilters = [];
        $('.stitch-peek-search-filter-badge.active').each(function() {
            activeFilters.push($(this).data('filter'));
        });

        const highlightText = (text, filterName) => {
            return highlightTextUtil(text, query, activeFilters.includes(filterName));
        };

        if (queryLower) {
            promptsB = promptsB.filter(p => matchStitch(p, queryLower, activeFilters));
        }

        const tgtPresetObj = pm ? pm.getCompletionPresetByName(nameB) : null;
        const regexListB = tgtPresetObj ? getPresetRegexScripts(tgtPresetObj) : [];
        const regexMapB = new Map();
        regexListB.forEach(r => regexMapB.set(String(r.id || r.scriptName), r.scriptName || r.id));

        $list.empty();

        if (promptsB.length === 0) {
            const msg = queryLower ? '无匹配结果' : '目标预设 B 为空，请点击下方按钮直接插入';
            $list.html(`<p style="text-align: center; opacity: 0.5; font-size: 11px; padding: 10px; margin-bottom: 8px;">${msg}</p>`);
            
            const emptyInsertRow = `
                <div class="stitch-peek-insert-top interactable" style="
                    padding: 8px;
                    background: rgba(255,255,255,0.02);
                    border: 1px dashed rgba(255,255,255,0.1);
                    border-radius: 6px;
                    font-size: 11px;
                    cursor: pointer;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    gap: 6px;
                    color: var(--SmartThemeQuoteColor);
                ">
                    <i class="fa-solid fa-plus"></i> 插入到最前面
                </div>
            `;
            $list.append(emptyInsertRow);
        } else {
            const firstInsertRow = `
                <div class="stitch-peek-insert-top interactable" style="
                    padding: 6px 10px;
                    background: rgba(255,255,255,0.02);
                    border: 1px dashed rgba(255,255,255,0.1);
                    border-radius: 6px;
                    font-size: 11px;
                    cursor: pointer;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    gap: 6px;
                    margin-bottom: 6px;
                    color: var(--SmartThemeQuoteColor);
                ">
                    <i class="fa-solid fa-plus"></i> 插入到最前面
                </div>
            `;

            const badgeMode = UiStateManager.get().stitchRegexBadgeMode || 'bound_only';
            const isGroupDisplay = UiStateManager.get().stitchGroupByPresetGroup === true;

            if (isGroupDisplay) {
                const rawGroupsB = GroupManager.get(nameB) || [];
                const assignedIdsB = new Set();
                const peekSections = [firstInsertRow];

                rawGroupsB.forEach(g => {
                    const groupMembers = [];
                    const gIds = new Set(g.ids || []);
                    gIds.forEach(id => assignedIdsB.add(id));

                    promptsB.forEach((pB, index) => {
                        if (gIds.has(pB.identifier)) {
                            groupMembers.push({ pB, index });
                        }
                    });

                    if (groupMembers.length > 0) {
                        const rowsHtml = groupMembers.map(m => renderPeekRowHTML(m.pB, m.index, nameB, regexMapB, highlightText, badgeMode)).join('');
                        const isCollapsed = g.col === true;
                        peekSections.push(`
                            <div class="stitch-peek-group" data-gid="${escapeHtml(g.id)}">
                                <div class="stitch-peek-group-header interactable" data-gid="${escapeHtml(g.id)}" style="
                                    display: flex;
                                    align-items: center;
                                    justify-content: space-between;
                                    padding: 5px 8px;
                                    background: rgba(255, 255, 255, 0.04);
                                    border: 1px solid rgba(255, 255, 255, 0.08);
                                    border-radius: 6px;
                                    cursor: pointer;
                                    user-select: none;
                                    margin-top: 4px;
                                    margin-bottom: 4px;
                                ">
                                    <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
                                        <i class="fa-solid fa-chevron-down stitch-peek-group-chevron" style="font-size: 10px; opacity: 0.7; transition: transform 0.2s; ${isCollapsed ? 'transform: rotate(-90deg);' : ''}"></i>
                                        <i class="fa-solid fa-folder" style="color: var(--SmartThemeQuoteColor); font-size: 11px; opacity: 0.9;"></i>
                                        <span style="font-weight: 600; font-size: 12px; color: var(--SmartThemeBodyColor); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(g.name)}</span>
                                        <span style="font-size: 10px; opacity: 0.6; background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 8px; flex-shrink: 0;">${groupMembers.length}</span>
                                    </div>
                                </div>
                                <div class="stitch-peek-group-body" data-gid="${escapeHtml(g.id)}" style="
                                    display: ${isCollapsed ? 'none' : 'flex'};
                                    flex-direction: column;
                                    gap: 2px;
                                    padding-left: 6px;
                                    border-left: 2px solid rgba(255,255,255,0.06);
                                    margin-left: 6px;
                                    margin-bottom: 4px;
                                ">
                                    ${rowsHtml}
                                </div>
                            </div>
                        `);
                    }
                });

                // Ungrouped prompts in B
                const ungroupedMembersB = [];
                promptsB.forEach((pB, index) => {
                    if (!assignedIdsB.has(pB.identifier)) {
                        ungroupedMembersB.push({ pB, index });
                    }
                });

                if (ungroupedMembersB.length > 0) {
                    const rowsHtml = ungroupedMembersB.map(m => renderPeekRowHTML(m.pB, m.index, nameB, regexMapB, highlightText, badgeMode)).join('');
                    const ugCollapsed = UiStateManager.get().ungroupedCol === true;
                    peekSections.push(`
                        <div class="stitch-peek-group" data-gid="__ungrouped">
                            <div class="stitch-peek-group-header interactable" data-gid="__ungrouped" style="
                                display: flex;
                                align-items: center;
                                justify-content: space-between;
                                padding: 5px 8px;
                                background: rgba(255, 255, 255, 0.04);
                                border: 1px solid rgba(255, 255, 255, 0.08);
                                border-radius: 6px;
                                cursor: pointer;
                                user-select: none;
                                margin-top: 4px;
                                margin-bottom: 4px;
                            ">
                                <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0;">
                                    <i class="fa-solid fa-chevron-down stitch-peek-group-chevron" style="font-size: 10px; opacity: 0.7; transition: transform 0.2s; ${ugCollapsed ? 'transform: rotate(-90deg);' : ''}"></i>
                                    <i class="fa-solid fa-folder-open" style="color: var(--SmartThemeEmColor); font-size: 11px; opacity: 0.7;"></i>
                                    <span style="font-weight: 600; font-size: 12px; color: var(--SmartThemeBodyColor); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">未分组</span>
                                    <span style="font-size: 10px; opacity: 0.6; background: rgba(255,255,255,0.08); padding: 1px 5px; border-radius: 8px; flex-shrink: 0;">${ungroupedMembersB.length}</span>
                                </div>
                            </div>
                            <div class="stitch-peek-group-body" data-gid="__ungrouped" style="
                                display: ${ugCollapsed ? 'none' : 'flex'};
                                flex-direction: column;
                                gap: 2px;
                                padding-left: 6px;
                                border-left: 2px solid rgba(255,255,255,0.06);
                                margin-left: 6px;
                                margin-bottom: 4px;
                            ">
                                ${rowsHtml}
                            </div>
                        </div>
                    `);
                }

                $list.html(peekSections.join(''));
            } else {
                const peekParts = [firstInsertRow, ...promptsB.map((pB, index) => renderPeekRowHTML(pB, index, nameB, regexMapB, highlightText, badgeMode))];
                $list.html(peekParts.join(''));
            }

            // Toggle peek group collapse
            $('.stitch-peek-group-header').off('click').on('click', function(e) {
                e.stopPropagation();
                const gid = String($(this).data('gid'));
                const $body = $(`.stitch-peek-group-body[data-gid="${gid}"]`);
                const $chevron = $(this).find('.stitch-peek-group-chevron');
                const isCurrentlyHidden = $body.css('display') === 'none';
                if (isCurrentlyHidden) {
                    $body.css('display', 'flex');
                    $chevron.css('transform', 'rotate(0deg)');
                } else {
                    $body.css('display', 'none');
                    $chevron.css('transform', 'rotate(-90deg)');
                }
                if (gid === '__ungrouped') {
                    UiStateManager.save({ ungroupedCol: !isCurrentlyHidden });
                } else {
                    GroupManager.setCollapse(nameB, gid, !isCurrentlyHidden);
                }
            });

            $('.stitch-peek-bound-regex-badge').off('click').on('click', async function(e) {
                e.stopPropagation();
                const promptId = String($(this).data('prompt-id'));
                const presetName = String($(this).data('preset') || nameB);
                const presetObj = pm ? pm.getCompletionPresetByName(presetName) : null;
                if (!presetObj || !Array.isArray(presetObj.prompts)) return;
                const targetPrompt = presetObj.prompts.find(p => String(p.identifier) === promptId);
                if (targetPrompt) {
                    await showBindRegexModal(targetPrompt, presetName, () => {
                        renderTargetBPeek();
                    });
                }
            });
        }

        // Toggle item contents (Accordion style - one open at a time)
        $('.stitch-peek-expand-trigger').off('click').on('click', function(e) {
            e.stopPropagation();
            const $row = $(this).closest('.stitch-peek-row');
            const idx = $row.data('index');
            const $content = $(`.stitch-peek-content[data-index="${idx}"]`);
            const $icon = $row.find('.fa-chevron-down, .fa-chevron-up');
            
            const isOpening = $content.css('display') === 'none';
            
            if (isOpening) {
                // Collapse all other contents
                $('.stitch-peek-content').not($content).hide();
                // Reset all other chevron icons to down
                $('.stitch-peek-row').not($row).find('.fa-chevron-up').removeClass('fa-chevron-up').addClass('fa-chevron-down');
                
                // Expand current content
                $content.show();
                $icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
            } else {
                // Collapse current content
                $content.hide();
                $icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
            }
        });

        // Insert handler function
        const doInsertStitch = async (position, $btn) => {
            const selectedIndexes = $('.stitch-item-cb:checked').map(function() {
                return parseInt($(this).data('index'));
            }).get();

            if (selectedIndexes.length === 0) {
                toastr.warning('请先在左侧主界面勾选需要缝合的条目');
                return;
            }

            const items = selectedIndexes.map(idx => window.zero_stitch_promptsA[idx]);
            const nameB = $('#stitch-preset-target').val();
            
            // If it's a single item, we show a visual checkmark on the button
            let oldClass = '';
            if ($btn && items.length === 1) {
                oldClass = $btn.attr('class');
                $btn.attr('class', 'fa-solid fa-check').css('color', '#55ff55').css('opacity', '1');
            }

            await performStitch(items, nameB, position);
            
            // Clear checked state
            $('.stitch-item-cb').prop('checked', false).removeAttr('checked').trigger('change');
            
            // Reload list and sync B peek drawer
            await renderStitchList(true);

            // Collapse target preset B drawer if enabled in settings
            if (UiStateManager.get().collapseTargetBOnStitch === true) {
                const $drawer = $('#stitch-target-peek-drawer');
                if ($drawer.hasClass('expanded')) {
                    $drawer.removeClass('expanded');
                    $('#stitch-peek-toggle-icon i').removeClass('fa-chevron-down').addClass('fa-chevron-up');
                }
            }
        };

        $('.stitch-peek-insert-top').off('click').on('click', function(e) {
            e.stopPropagation();
            doInsertStitch('top', $(this));
        });

        $('.stitch-peek-insert-btn').off('click').on('click', function(e) {
            e.stopPropagation();
            const eTarget = $(e.target);
            const $btn = eTarget.hasClass('stitch-peek-insert-btn') ? eTarget : eTarget.find('.stitch-peek-insert-btn');
            const id = $btn.attr('data-id');
            doInsertStitch(id, $btn);
        });

        restorePeekScroll();
    } catch (e) {
        console.error('[Zero] Failed to render target B peek:', e);
        $list.html('<p style="text-align: center; color: #ff5555; font-size: 11px; padding: 10px;">加载失败</p>');
        isRefreshingTargetB = false;
    }
}
