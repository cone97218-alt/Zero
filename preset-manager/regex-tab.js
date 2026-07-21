import { escapeHtml, getPresetRegexScripts, migrateBoundRegexes, savePresetWithoutRegexToast, showBindRegexModal, showBindPromptToRegexModal } from './utils.js';
import { HistoryManager } from '../qr-snapshot/state.js';

let _currentRegexFilter = 'all';

export async function populateRegexSelects(presetList) {
    try {
        const $source = $('#regex-preset-source');
        const $target = $('#regex-preset-target');
        if (!$source.length || !$target.length) return;

        const normalNames = (presetList?.names || []).filter(n => !n.startsWith('★'));
        const favNames = (presetList?.names || []).filter(n => n.startsWith('★'));

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

        const currentSrc = $source.val();
        const currentTgt = $target.val();

        $source.html(buildOptionsHtml(false));
        $target.html(buildOptionsHtml(true));

        if (currentSrc && presetList.names.includes(currentSrc)) {
            $source.val(currentSrc);
        } else if (presetList.active) {
            $source.val(presetList.active);
        }

        if (currentTgt && presetList.names.includes(currentTgt)) {
            $target.val(currentTgt);
        } else if (presetList.names.length > 1) {
            const defaultTgt = presetList.names.find(n => n !== $source.val());
            if (defaultTgt) $target.val(defaultTgt);
        }
    } catch (e) {
        console.error('[Zero] Failed to populate regex selects:', e);
    }
}

export async function renderRegexList(forceRefresh = false) {
    const srcName = $('#regex-preset-source').val();
    const tgtName = $('#regex-preset-target').val();
    _currentRegexFilter = $('#regex-filter-select').val() || 'all';
    const $list = $('#regex-list');

    if (!srcName) {
        $list.html('<p style="text-align: center; opacity: 0.5; font-size: 12px; margin-top: 20px;">请选择预设 A</p>');
        return;
    }

    try {
        const pm = SillyTavern.getContext().getPresetManager('openai');
        if (!pm) return;

        const srcPresetObj = pm.getCompletionPresetByName(srcName);
        if (!srcPresetObj) {
            $list.html('<p style="text-align: center; opacity: 0.5; font-size: 12px; margin-top: 20px;">未找到预设 A</p>');
            return;
        }

        const listA = getPresetRegexScripts(srcPresetObj);
        const tgtPresetObj = tgtName ? pm.getCompletionPresetByName(tgtName) : null;
        const listB = tgtPresetObj ? getPresetRegexScripts(tgtPresetObj) : [];

        const mapA = new Map();
        listA.forEach(r => mapA.set(String(r.id || r.scriptName), r));

        const mapB = new Map();
        listB.forEach(r => mapB.set(String(r.id || r.scriptName), r));

        const unionKeys = new Set([...mapA.keys(), ...mapB.keys()]);
        const promptsA = srcPresetObj.prompts || [];
        const promptsB = tgtPresetObj ? (tgtPresetObj.prompts || []) : [];

        // Build prompt binding lookup for Preset A: regexId -> prompt names list
        const bindingMapA = new Map();
        promptsA.forEach(p => {
            if (Array.isArray(p.bound_regex_ids)) {
                p.bound_regex_ids.forEach(bid => {
                    if (!bindingMapA.has(bid)) bindingMapA.set(bid, []);
                    bindingMapA.get(bid).push(p.name || p.identifier || '未命名条目');
                });
            }
        });

        // Build prompt binding lookup for Preset B: regexId -> prompt names list
        const bindingMapB = new Map();
        promptsB.forEach(p => {
            if (Array.isArray(p.bound_regex_ids)) {
                p.bound_regex_ids.forEach(bid => {
                    if (!bindingMapB.has(bid)) bindingMapB.set(bid, []);
                    bindingMapB.get(bid).push(p.name || p.identifier || '未命名条目');
                });
            }
        });

        // Filter scripts according to _currentRegexFilter
        const filteredList = [];
        unionKeys.forEach(key => {
            const inA = mapA.has(key);
            const inB = mapB.has(key);
            const script = mapA.get(key) || mapB.get(key);

            let include = false;
            if (!tgtName) {
                include = inA;
            } else if (_currentRegexFilter === 'onlyA') {
                include = inA && !inB;
            } else if (_currentRegexFilter === 'onlyB') {
                include = !inA && inB;
            } else if (_currentRegexFilter === 'both') {
                include = inA && inB;
            } else {
                // 'all'
                include = true;
            }

            if (include) {
                filteredList.push({ script, key, inA, inB });
            }
        });

        $list.empty();

        if (filteredList.length === 0) {
            let msg = `预设「${escapeHtml(srcName)}」暂无正则脚本`;
            if (tgtName) {
                if (_currentRegexFilter === 'onlyA') msg = '无仅 A 有的正则脚本';
                else if (_currentRegexFilter === 'onlyB') msg = '无仅 B 有的正则脚本';
                else if (_currentRegexFilter === 'both') msg = '无 A 与 B 共有的正则脚本';
            }
            $list.html(`<p style="text-align: center; opacity: 0.5; font-size: 12px; margin-top: 20px;">${msg}</p>`);
            return;
        }

        const rowsHtml = filteredList.map((item, idx) => {
            const { script, key, inA, inB } = item;
            const scriptId = script.id || script.scriptName;
            const scriptTitle = escapeHtml(script.scriptName || script.id || '未命名正则');
            const findRegex = escapeHtml(script.findRegex || '');
            const replaceStr = escapeHtml(script.replaceString || '');
            const isDisabled = script.disabled === true;

            const boundA = bindingMapA.get(key) || [];
            const boundB = bindingMapB.get(key) || [];

            let categoryBadge = '';
            if (tgtName) {
                if (inA && !inB) categoryBadge = '<span style="font-size: 10px; color: var(--SmartThemeQuoteColor); background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px;">仅A有</span>';
                else if (!inA && inB) categoryBadge = '<span style="font-size: 10px; color: var(--SmartThemeEmColor); background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px;">仅B有</span>';
                else if (inA && inB) categoryBadge = '<span style="font-size: 10px; color: var(--SmartThemeBodyColor); background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px;">A与B都有</span>';
            }

            let boundHtml = '';
            if (boundA.length > 0 || boundB.length > 0) {
                let badgeA = boundA.length > 0 ? `
                    <span style="background: rgba(255,255,255,0.05); color: var(--SmartThemeQuoteColor); padding: 2px 6px; border-radius: 4px; font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="fa-solid fa-link"></i> 已绑定 ${boundA.length} 个 A 条目: ${boundA.slice(0, 2).map(n => escapeHtml(n)).join(', ')}${boundA.length > 2 ? '...' : ''}
                    </span>
                ` : '';
                let badgeB = boundB.length > 0 ? `
                    <span style="background: rgba(255,255,255,0.05); color: var(--SmartThemeEmColor); padding: 2px 6px; border-radius: 4px; font-size: 10px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="fa-solid fa-link"></i> 已绑定 ${boundB.length} 个 B 条目: ${boundB.slice(0, 2).map(n => escapeHtml(n)).join(', ')}${boundB.length > 2 ? '...' : ''}
                    </span>
                ` : '';
                boundHtml = `
                    <div style="margin-top: 4px; font-size: 11px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                        ${badgeA}
                        ${badgeB}
                    </div>
                `;
            } else {
                boundHtml = `
                    <div style="margin-top: 4px; font-size: 11px; opacity: 0.5; color: var(--SmartThemeEmColor);">
                        <span>未绑定任何条目</span>
                    </div>
                `;
            }

            let actionButtons = '';
            if (inA && inB) {
                // Present in both A & B: Equal access to bind prompts in A or B
                actionButtons += `<button class="zero-regex-bind-prompts-btn interactable" data-id="${escapeHtml(scriptId)}" data-preset="${escapeHtml(srcName)}" title="绑定 预设 A (${escapeHtml(srcName)}) 的条目" style="background: rgba(255,255,255,0.06); border: none; border-radius: 4px; height: 28px; padding: 0 6px; font-size: 11px; color: var(--SmartThemeQuoteColor); cursor: pointer; display: flex; align-items: center; gap: 3px;"><i class="fa-solid fa-link"></i><span>A</span></button>`;
                actionButtons += `<button class="zero-regex-bind-prompts-btn interactable" data-id="${escapeHtml(scriptId)}" data-preset="${escapeHtml(tgtName)}" title="绑定 预设 B (${escapeHtml(tgtName)}) 的条目" style="background: rgba(255,255,255,0.06); border: none; border-radius: 4px; height: 28px; padding: 0 6px; font-size: 11px; color: var(--SmartThemeEmColor); cursor: pointer; display: flex; align-items: center; gap: 3px;"><i class="fa-solid fa-link"></i><span>B</span></button>`;
            } else if (inA) {
                // Only in A
                actionButtons += `<button class="zero-regex-bind-prompts-btn interactable" data-id="${escapeHtml(scriptId)}" data-preset="${escapeHtml(srcName)}" title="绑定/解绑 预设 A 的条目" style="background: rgba(255,255,255,0.06); border: none; border-radius: 4px; width: 28px; height: 28px; padding: 0; font-size: 12px; color: var(--SmartThemeQuoteColor); cursor: pointer; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-link"></i></button>`;
                if (tgtName) {
                    actionButtons += `<button class="zero-regex-single-migrate-btn interactable" data-id="${escapeHtml(scriptId)}" title="复制此正则至 预设 B (${escapeHtml(tgtName)})" style="background: rgba(255,255,255,0.06); border: none; border-radius: 4px; width: 28px; height: 28px; padding: 0; font-size: 12px; color: var(--SmartThemeBodyColor); cursor: pointer; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-file-export"></i></button>`;
                }
            } else if (inB) {
                // Only in B
                actionButtons += `<button class="zero-regex-bind-prompts-btn interactable" data-id="${escapeHtml(scriptId)}" data-preset="${escapeHtml(tgtName)}" title="绑定/解绑 预设 B 的条目" style="background: rgba(255,255,255,0.06); border: none; border-radius: 4px; width: 28px; height: 28px; padding: 0; font-size: 12px; color: var(--SmartThemeEmColor); cursor: pointer; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-link"></i></button>`;
                actionButtons += `<button class="zero-regex-single-import-btn interactable" data-id="${escapeHtml(scriptId)}" title="复制此正则至 预设 A (${escapeHtml(srcName)})" style="background: rgba(255,255,255,0.06); border: none; border-radius: 4px; width: 28px; height: 28px; padding: 0; font-size: 12px; color: var(--SmartThemeEmColor); cursor: pointer; display: flex; align-items: center; justify-content: center;"><i class="fa-solid fa-file-import"></i></button>`;
            }

            return `
                <div class="zero-regex-row interactable" data-id="${escapeHtml(scriptId)}" data-index="${idx}" style="
                    display: flex;
                    flex-direction: column;
                    padding: 10px 12px;
                    background: var(--SmartThemeChatTintColor, rgba(255,255,255,0.03));
                    border-radius: 8px;
                    border: none !important;
                    margin-bottom: 6px;
                    ${isDisabled ? 'opacity: 0.6;' : ''}
                ">
                    <!-- Header (Two-Line Layout for narrow screens) -->
                    <div class="zero-regex-row-header" style="display: flex; flex-direction: column; gap: 6px; width: 100%; cursor: pointer; user-select: none;">
                        <!-- Line 1: Checkbox & Title & Chevron -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
                            <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                                <input type="checkbox" class="zero-regex-item-cb interactable" data-index="${idx}" value="${escapeHtml(scriptId)}" style="cursor: pointer; flex-shrink: 0;" />
                                <span style="font-weight: bold; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; color: var(--SmartThemeBodyColor);">${scriptTitle}</span>
                            </div>
                            <i class="fa-solid fa-chevron-right zero-regex-chevron" style="font-size: 12px; color: var(--SmartThemeBodyColor); opacity: 0.6; transition: transform 0.15s; flex-shrink: 0;"></i>
                        </div>

                        <!-- Line 2: Badges & Bindings (Left) & Action Buttons (Right) -->
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;">
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; flex: 1;">
                                ${categoryBadge}
                                ${isDisabled ? '<span style="font-size: 10px; opacity: 0.7; color: var(--SmartThemeEmColor); background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px;">已禁用</span>' : ''}
                                ${boundHtml}
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                                ${actionButtons}
                            </div>
                        </div>
                    </div>

                    <!-- Body (Collapsed, Pattern & Replace ONLY) -->
                    <div class="zero-regex-row-body" style="display: none; flex-direction: column; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.08); width: 100%; max-height: 250px !important; overflow-y: auto !important; box-sizing: border-box !important;">
                        <div style="font-size: 11px; font-family: monospace; opacity: 0.8; word-break: break-all; background: rgba(0,0,0,0.2); padding: 6px 10px; border-radius: 6px; color: var(--SmartThemeBodyColor);">
                            <span style="opacity: 0.6; color: var(--SmartThemeEmColor);">Pattern:</span> ${findRegex || '(空)'}
                        </div>
                        ${replaceStr ? `
                            <div style="font-size: 11px; font-family: monospace; opacity: 0.8; word-break: break-all; background: rgba(0,0,0,0.15); padding: 6px 10px; border-radius: 6px; color: var(--SmartThemeBodyColor);">
                                <span style="opacity: 0.6; color: var(--SmartThemeEmColor);">Replace:</span> ${replaceStr}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        $list.html(rowsHtml);

        // Accordion click handling: Expand only 1 row at a time
        $list.find('.zero-regex-row-header').off('click').on('click', function(e) {
            if ($(e.target).closest('.zero-regex-item-cb, button').length) return;
            const $row = $(this).closest('.zero-regex-row');
            const $body = $row.find('.zero-regex-row-body');
            const $chevron = $row.find('.zero-regex-chevron');
            const isVisible = $body.is(':visible');

            // Close all other bodies and reset chevrons (Accordion behavior)
            $list.find('.zero-regex-row-body').not($body).slideUp(120);
            $list.find('.zero-regex-chevron').not($chevron).css('transform', 'rotate(0deg)');

            if (isVisible) {
                $body.slideUp(120);
                $chevron.css('transform', 'rotate(0deg)');
            } else {
                $body.slideDown(120);
                $chevron.css('transform', 'rotate(90deg)');
            }
        });

        // Bind events for bind prompts buttons (supports both Preset A and Preset B)
        $list.find('.zero-regex-bind-prompts-btn').off('click').on('click', async function(e) {
            e.stopPropagation();
            const scriptId = String($(this).data('id'));
            const presetName = String($(this).data('preset') || srcName);
            const targetPresetObj = pm.getCompletionPresetByName(presetName);
            if (!targetPresetObj) return;

            const list = getPresetRegexScripts(targetPresetObj);
            const script = list.find(r => String(r.id || r.scriptName) === scriptId);
            if (script) {
                await showBindPromptToRegexModal(script, presetName, () => {
                    renderRegexList(true);
                });
            }
        });

        // Bind events for single migration buttons (A -> B)
        $list.find('.zero-regex-single-migrate-btn').off('click').on('click', async function(e) {
            e.stopPropagation();
            const scriptId = String($(this).data('id'));
            if (!tgtName) {
                toastr.info('请先选择预设 B');
                return;
            }
            try {
                const count = migrateBoundRegexes(srcPresetObj, tgtPresetObj, [scriptId]);
                if (count > 0) {
                    const isActive = pm.getSelectedPresetName() === tgtName;
                    await savePresetWithoutRegexToast(pm, tgtName, tgtPresetObj, { skipUpdate: !isActive });
                    toastr.success(`正则已成功复制至「${tgtName}」`);
                    renderRegexList(true);
                } else {
                    toastr.info('预设 B 中已包含该正则');
                }
            } catch (err) {
                console.error('[Zero] Regex migration failed:', err);
                toastr.error('复制失败');
            }
        });

        // Bind events for single import buttons (B -> A)
        $list.find('.zero-regex-single-import-btn').off('click').on('click', async function(e) {
            e.stopPropagation();
            const scriptId = String($(this).data('id'));
            if (!tgtPresetObj) return;
            try {
                const count = migrateBoundRegexes(tgtPresetObj, srcPresetObj, [scriptId]);
                if (count > 0) {
                    const isActive = pm.getSelectedPresetName() === srcName;
                    await savePresetWithoutRegexToast(pm, srcName, srcPresetObj, { skipUpdate: !isActive });
                    toastr.success(`正则已成功复制至「${srcName}」`);
                    renderRegexList(true);
                } else {
                    toastr.info('预设 A 中已包含该正则');
                }
            } catch (err) {
                console.error('[Zero] Regex import failed:', err);
                toastr.error('复制失败');
            }
        });

    } catch (e) {
        console.error('[Zero] renderRegexList failed:', e);
        $list.html('<p style="text-align: center; color: #ff5555; font-size: 12px; margin-top: 20px;">加载正则列表失败</p>');
    }
}

export function initRegexTab() {
    $('#regex-preset-source').off('change').on('change', function() {
        renderRegexList();
    });

    $('#regex-preset-target').off('change').on('change', function() {
        renderRegexList();
    });

    $('#regex-swap-btn').off('click').on('click', function() {
        const $src = $('#regex-preset-source');
        const $tgt = $('#regex-preset-target');
        const valSrc = $src.val();
        const valTgt = $tgt.val();
        $src.val(valTgt);
        $tgt.val(valSrc);
        renderRegexList();
    });

    $('#regex-refresh-btn').off('click').on('click', function() {
        renderRegexList(true);
        toastr.success('已刷新正则列表');
    });

    $('#regex-filter-select').off('change').on('change', function() {
        _currentRegexFilter = $(this).val();
        renderRegexList();
    });

    $('#regex-select-all').off('click').on('click', function() {
        const $cbs = $('#regex-list .zero-regex-item-cb');
        const allChecked = $cbs.length === $cbs.filter(':checked').length;
        $cbs.prop('checked', !allChecked);
    });

    $('#regex-select-invert').off('click').on('click', function() {
        $('#regex-list .zero-regex-item-cb').each(function() {
            $(this).prop('checked', !$(this).is(':checked'));
        });
    });

    $('#regex-select-range').off('click').on('click', function() {
        const $checked = $('#regex-list .zero-regex-item-cb:checked');
        if ($checked.length < 2) {
            toastr.info('请先手动勾选起始和结束项目（至少勾选两个）');
            return;
        }
        const indexes = $checked.map(function() { return parseInt($(this).data('index')); }).get();
        const start = Math.min(...indexes);
        const end = Math.max(...indexes);
        for (let i = start; i <= end; i++) {
            $(`#regex-list .zero-regex-item-cb[data-index="${i}"]`).prop('checked', true);
        }
    });

    $('#regex-migrate-selected-btn').off('click').on('click', async function() {
        const srcName = $('#regex-preset-source').val();
        const tgtName = $('#regex-preset-target').val();

        if (!srcName || !tgtName) {
            toastr.info('请选择预设 A 与预设 B');
            return;
        }

        const checkedIds = [];
        $('#regex-list .zero-regex-item-cb:checked').each(function() {
            checkedIds.push($(this).val());
        });

        if (checkedIds.length === 0) {
            toastr.info('请先勾选需要迁移的正则脚本');
            return;
        }

        try {
            const pm = SillyTavern.getContext().getPresetManager('openai');
            const srcPresetObj = pm.getCompletionPresetByName(srcName);
            const tgtPresetObj = pm.getCompletionPresetByName(tgtName);

            const count = migrateBoundRegexes(srcPresetObj, tgtPresetObj, checkedIds);
            if (count > 0) {
                const isActive = pm.getSelectedPresetName() === tgtName;
                await savePresetWithoutRegexToast(pm, tgtName, tgtPresetObj, { skipUpdate: !isActive });
                toastr.success(`已将 ${count} 个正则脚本成功复制至「${tgtName}」`);
                renderRegexList(true);
            } else {
                toastr.info('预设 B 中已包含选中的正则');
            }
        } catch (err) {
            console.error('[Zero] Batch regex migration failed:', err);
            toastr.error('复制失败');
        }
    });
}
