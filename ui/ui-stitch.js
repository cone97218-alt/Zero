import { getPresetPrompts, escapeHtml } from './ui-utils.js';

export let stitch_batch_mode = false;
let _cachedStitchPrompts = null;
let _cachedStitchName = null;

export function toggleStitchBatchMode() {
    stitch_batch_mode = !stitch_batch_mode;
    return stitch_batch_mode;
}

export function resetStitchBatchMode() {
    stitch_batch_mode = false;
}

export async function renderStitchList(forceRefresh = true) {
    const nameA = $('#stitch-preset-source').val();
    const nameB = $('#stitch-preset-target').val();
    
    if (!nameA && !nameB) return;
    
    const effectiveName = nameA || nameB;
    if (!effectiveName) return;

    const $body = $('.zero-panel-body');
    const scrollPos = $body.scrollTop();
    const $list = $('#stitch-list');
    
    if (forceRefresh || _cachedStitchName !== nameA) {
        $list.html('<p style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</p>');
    }

    try {
        if (forceRefresh || _cachedStitchName !== effectiveName || !_cachedStitchPrompts) {
            _cachedStitchPrompts = await getPresetPrompts(effectiveName);
            _cachedStitchName = effectiveName;
        }
        
        const promptsA = _cachedStitchPrompts;
        
        $list.empty();
        
        renderTargetBPeek();
        
        if (promptsA.length === 0) {
            $list.html('<p style="text-align: center; opacity: 0.5; font-size: 12px; margin-top: 20px;">源预设为空</p>');
            return;
        }

        const rowParts = [];
        promptsA.forEach((pA, index) => {
            const nameStr = escapeHtml(pA.name || pA.identifier || '未命名');
            
            rowParts.push(`
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
                    <div class="stitch-row-expand-trigger" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameStr}</div>
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
                            background: var(--SmartThemeBlurTintColor);
                            border: 1px solid var(--SmartThemeBorderColor);
                            border-radius: 8px;
                            z-index: 1000;
                            min-width: 100px;
                            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                            flex-direction: column;
                            overflow: hidden;
                        ">
                            <div class="stitch-edit-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px; hover: background: rgba(255,255,255,0.05);">
                                <i class="fa-solid fa-pencil" style="width: 14px;"></i> 编辑
                            </div>
                            <div class="stitch-clone-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px; hover: background: rgba(255,255,255,0.05);">
                                <i class="fa-solid fa-clone" style="width: 14px;"></i> 复制
                            </div>
                            <div class="stitch-move-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px; hover: background: rgba(255,255,255,0.05);">
                                <i class="fa-solid fa-sort" style="width: 14px;"></i> 移动
                            </div>
                            ${nameA && nameB ? `
                            <div class="stitch-action-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px; hover: background: rgba(255,255,255,0.05);">
                                <i class="fa-solid fa-arrow-right-to-bracket" style="width: 14px;"></i> 缝合
                            </div>` : ''}
                            <div class="stitch-delete-btn interactable" data-index="${index}" style="padding: 8px 12px; cursor: pointer; font-size: 12px; color: #ff5f5f; display: flex; align-items: center; gap: 8px; border-top: 1px solid rgba(255,255,255,0.05); hover: background: rgba(255,255,255,0.05);">
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
                ">${escapeHtml(pA.content || '')}</div>
            `);
        });
        $list.html(rowParts.join(''));

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

        setTimeout(() => {
            $body.scrollTop(scrollPos);
        }, 0);
    } catch (e) {
        console.error('[Zero] Failed to render stitch list:', e);
        $list.html('<p style="text-align: center; color: var(--SmartThemeShadowColor);">加载失败</p>');
    }
}

export async function performStitch(itemsA, targetName, position) {
    const items = Array.isArray(itemsA) ? itemsA : [itemsA];
    if (items.length === 0) return;

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

        const clones = [];
        for (const itemA of items) {
            const cloneA = JSON.parse(JSON.stringify(itemA));
            cloneA.identifier = 'system_prompt_' + Date.now() + Math.floor(Math.random() * 1000) + '_' + Math.floor(Math.random() * 1000); 
            targetPreset.prompts.push(cloneA);
            clones.push({ identifier: cloneA.identifier, enabled: false });
        }

        if (position === 'top') {
            orderArray.unshift(...clones);
        } else if (position === 'bottom') {
            orderArray.push(...clones);
        } else {
            const idx = orderArray.findIndex(o => o && o.identifier === position);
            if (idx !== -1) {
                orderArray.splice(idx + 1, 0, ...clones);
            } else {
                orderArray.push(...clones);
            }
        }

        const isActive = pm.getSelectedPresetName() === targetName;
        await pm.savePreset(targetName, targetPreset, { skipUpdate: !isActive });
        
        toastr.success(items.length > 1 ? `成功缝合 ${items.length} 个条目！` : '缝合成功！');
    } catch (err) {
        console.error('[Zero] Perform stitch failed:', err);
        toastr.error('缝合失败');
    }
}

export async function performMove(itemsA, presetName, position) {
    const items = Array.isArray(itemsA) ? itemsA : [itemsA];
    if (items.length === 0) return;

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
        await pm.savePreset(presetName, preset, { skipUpdate: !isActive });
        
        _cachedStitchPrompts = await getPresetPrompts(presetName);
        renderStitchList(false);

        toastr.success(items.length > 1 ? `成功移动 ${items.length} 个条目！` : '移动成功！');
        
        if (isActive && typeof pm.loadPreset === 'function') {
            await pm.loadPreset(presetName);
        }
    } catch (err) {
        console.error('[Zero] Perform move failed:', err);
        toastr.error('移动失败');
    }
}

export async function performBatchDelete(items, presetName) {
    if (!confirm(`确定要从预设 "${presetName}" 中删除选中的 ${items.length} 个条目吗？该操作不可撤销。`)) return;
    
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

        await manager.savePreset(presetName, preset, { skipUpdate: !isActive });
        
        toastr.success(`成功从 "${presetName}" 中删除 ${items.length} 个条目`);
        
        if (isActive && typeof manager.loadPreset === 'function') {
            await manager.loadPreset(presetName);
        }
    } catch (err) {
        console.error('[Zero] Batch delete failed:', err);
        toastr.error('删除失败: ' + err.message);
    }
}

export async function performSingleClone(item, presetName) {
    try {
        const manager = SillyTavern.getContext().getPresetManager('openai');
        const preset = manager.getCompletionPresetByName(presetName);
        if (!preset) throw new Error('Preset not found');

        const originalId = item.identifier;
        const newId = 'system_prompt_' + Date.now() + Math.floor(Math.random() * 1000);
        
        const clone = JSON.parse(JSON.stringify(item));
        clone.identifier = newId;
        clone.name = (clone.name || clone.identifier) + ' (副本)';
        
        if (Array.isArray(preset.prompts)) {
            preset.prompts.push(clone);
        } else if (preset.prompts && typeof preset.prompts === 'object') {
            preset.prompts[newId] = clone;
        }

        if (preset.prompt_order) {
            const updateOrder = (order) => {
                const idx = order.findIndex(p => {
                    const id = (p && typeof p === 'object') ? p.identifier : p;
                    return id === originalId;
                });
                if (idx !== -1) {
                    const newItem = (order[0] && typeof order[0] === 'object') ? { identifier: newId, enabled: true } : newId;
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

        await manager.savePreset(presetName, preset, { skipUpdate: !isActive });
        
        toastr.success('已复制条目');
        
        if (isActive && typeof manager.loadPreset === 'function') {
            await manager.loadPreset(presetName);
        }
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
            <div id="move-modal" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); z-index: 20000; display: flex; align-items: center; justify-content: center; padding: 20px;">
                <div style="background: var(--SmartThemeBlurTintColor); padding: 24px; border-radius: 16px; width: 100%; max-width: 360px; border: 1px solid var(--SmartThemeBorderColor); display: flex; flex-direction: column;">
                    <div style="font-weight: bold; margin-bottom: 4px; font-size: 16px;">${title}</div>
                    <div style="font-size: 11px; opacity: 0.6; margin-bottom: 16px;">${desc}</div>
                    
                    <div style="margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px;">
                        <label style="font-size: 12px; opacity: 0.8;">插入位置:</label>
                        <select id="move-position-select" class="interactable" style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: 13px;">
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

export async function renderTargetBPeek() {
    const nameB = $('#stitch-preset-target').val();
    const $drawer = $('#stitch-target-peek-drawer');
    const $list = $('#stitch-peek-list');

    if (!nameB) {
        $drawer.css('display', 'none');
        return;
    }

    $drawer.css('display', 'flex');
    $list.html('<p style="text-align: center; padding: 10px; font-size: 11px; opacity: 0.6;"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</p>');

    try {
        const promptsB = await getPresetPrompts(nameB);
        $list.empty();

        if (promptsB.length === 0) {
            $list.html('<p style="text-align: center; opacity: 0.5; font-size: 11px; padding: 10px; margin-bottom: 8px;">目标预设 B 为空，请点击下方按钮直接插入</p>');
            
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

            const peekParts = [firstInsertRow];
            promptsB.forEach((pB, index) => {
                const nameStr = escapeHtml(pB.name || pB.identifier || '未命名');
                peekParts.push(`
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
                    ">${escapeHtml(pB.content || '')}</div>
                `);
            });
            $list.html(peekParts.join(''));
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
        const doInsertStitch = async (position) => {
            const selectedIndexes = $('.stitch-item-cb:checked').map(function() {
                return parseInt($(this).data('index'));
            }).get();

            if (selectedIndexes.length === 0) {
                toastr.warning('请先在左侧主界面勾选需要缝合的条目');
                return;
            }

            const items = selectedIndexes.map(idx => window.zero_stitch_promptsA[idx]);
            const nameB = $('#stitch-preset-target').val();
            
            await performStitch(items, nameB, position);
            
            // Clear checked state
            $('.stitch-item-cb').prop('checked', false).removeAttr('checked').trigger('change');
            
            // Reload list and sync B peek drawer
            await renderStitchList(true);
        };

        $('.stitch-peek-insert-top').off('click').on('click', function(e) {
            e.stopPropagation();
            doInsertStitch('top');
        });

        $('.stitch-peek-insert-btn').off('click').on('click', function(e) {
            e.stopPropagation();
            const id = $(this).data('id');
            doInsertStitch(id);
        });

    } catch (e) {
        console.error('[Zero] Failed to render target B peek:', e);
        $list.html('<p style="text-align: center; color: #ff5555; font-size: 11px; padding: 10px;">加载失败</p>');
    }
}
