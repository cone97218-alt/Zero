import { PresetManager, HistoryManager } from '../qr-snapshot/state.js';
import { escapeHtml, refreshNativePresetManager } from './utils.js';
import { populatePresetSelects } from './main.js';

export async function renderManageTab() {
    const $list = $('#manage-preset-list');
    $list.html('<p style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> 加载中...</p>');

    try {
        PresetManager.invalidate();
        const list = await PresetManager.listNames();
        const activeName = list.active;
        
        $list.empty();
        $('#manage-select-all').prop('checked', false);

        if (list.names.length === 0) {
            $list.html('<p style="text-align: center; opacity: 0.5; padding: 20px;">暂无预设</p>');
            return;
        }

        const rowParts = [];
        list.names.forEach(name => {
            const isActive = name === activeName;
            rowParts.push(`
                <div class="manage-preset-row interactable" data-name="${escapeHtml(name)}" style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: rgba(255,255,255,0.03); border-radius: 8px; font-size: 13px;">
                    <input type="checkbox" class="interactable" style="flex-shrink: 0;" ${isActive ? 'disabled' : ''}>
                    <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${name}</div>
                    ${isActive ? '<span style="font-size: 11px; color: var(--SmartThemeQuoteColor); opacity: 0.8; margin-right: 4px;">使用中</span>' : ''}
                    <button class="manage-preset-rename interactable zero-icon-btn" data-name="${escapeHtml(name)}" title="重命名" style="flex-shrink: 0; opacity: 0.6; padding: 2px 6px; cursor: pointer; transition: opacity 0.15s;">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                </div>
            `);
        });
        $list.html(rowParts.join(''));

        $('.manage-preset-row').off('click').on('click', function(e) {
            if ($(e.target).is('input') || $(e.target).closest('.manage-preset-rename').length) return;
            const $cb = $(this).find('input[type="checkbox"]');
            if ($cb.is(':disabled')) return;
            $cb.prop('checked', !$cb.is(':checked'));
        });

        $('.manage-preset-rename').off('click').on('click', async function(e) {
            e.stopPropagation();
            const name = $(this).data('name');
            await handleRename(name);
        });

    } catch (e) {
        console.error('[Zero] Failed to render manage tab:', e);
        $list.html('<p style="text-align: center; color: var(--SmartThemeShadowColor);">加载失败</p>');
    }
}

export async function handleRename(oldName) {
    if (!oldName) return;

    try {
        const { Popup } = await import('/scripts/popup.js');
        const { getSanitizedFilename } = await import('/scripts/utils.js');
        const { eventSource, event_types } = await import('/script.js');

        const newNameRaw = await Popup.show.input('重命名预设', '请输入新的预设名称：', oldName);
        if (newNameRaw === null) return; // User cancelled

        const newName = await getSanitizedFilename(newNameRaw.trim());
        if (!newName || newName === oldName) return;

        HistoryManager.record();
        const pm = SillyTavern.getContext().getPresetManager('openai');
        if (!pm) {
            toastr.error('未找到预设管理器');
            return;
        }

        const { preset_names } = pm.getPresetList();
        const isKeyed = pm.isKeyedApi();
        const exists = isKeyed ? preset_names.includes(newName) : Object.keys(preset_names).includes(newName);
        if (exists) {
            toastr.error('该预设名称已存在');
            return;
        }

        const activeName = pm.getSelectedPresetName();
        const isEditingActive = (oldName === activeName);

        // 1. Retrieve the complete preset settings object synchronously from memory
        const presetObj = pm.getCompletionPresetByName(oldName);
        if (!presetObj) {
            toastr.error('未找到源预设数据');
            return;
        }

        // 2. Perform native rename operations (emits events & preserves ST extensions)
        await eventSource.emit(event_types.PRESET_RENAMED_BEFORE, { apiId: 'openai', oldName, newName });
        const extensions = pm.readPresetExtensionField({ name: oldName, path: '' });
        
        await pm.savePreset(newName, presetObj);
        if (extensions) {
            await pm.writePresetExtensionField({ name: newName, path: '', value: extensions });
        }
        await pm.deletePreset(oldName);
        
        await eventSource.emit(event_types.PRESET_RENAMED, { apiId: 'openai', oldName, newName });

        // 3. Rename Zero's internal settings (groups, hidden items, linkages, snapshots)
        PresetManager.renameSettings(oldName, newName);

        // 4. Restore active preset selection if it wasn't the one renamed
        if (!isEditingActive) {
            const activeVal = pm.findPreset(activeName);
            if (activeVal !== undefined && activeVal !== null) {
                pm.selectPreset(activeVal);
            }
        }
        window.dispatchEvent(new Event('zero-presets-list-changed')); // 通知缓存失效
        refreshNativePresetManager(pm);
        
        await renderManageTab();
        await populatePresetSelects();

    } catch (e) {
        console.error('[Zero] Failed to rename preset:', oldName, e);
        toastr.error('重命名失败，请检查控制台');
    }
}

export async function handleBatchDelete() {
    const selected = $('#manage-preset-list input:checked').closest('.manage-preset-row').map(function() {
        return $(this).data('name');
    }).get();

    if (selected.length === 0) {
        toastr.info('请选择要删除的预设');
        return;
    }

    HistoryManager.record();
    let successCount = 0;
    let failCount = 0;
    const pm = SillyTavern.getContext().getPresetManager('openai');

    for (const name of selected) {
        try {
            await pm.deletePreset(name);
            successCount++;
        } catch (e) {
            console.error('[Zero] Failed to delete preset:', name, e);
            failCount++;
        }
    }

    if (successCount > 0) {
        window.dispatchEvent(new Event('zero-presets-list-changed')); // 通知缓存失效
        if (pm && pm.select) {
            for (const name of selected) {
                $(pm.select).find('option').filter(function() {
                    return $(this).text().trim() === name;
                }).remove();
            }
        }
        refreshNativePresetManager(pm);
    }
    if (failCount > 0) toastr.error(`${failCount} 个预设删除失败`);

    await renderManageTab();
}

export async function handleBatchImport(files) {
    HistoryManager.record();
    let successCount = 0;
    let failCount = 0;
    const pm = SillyTavern.getContext().getPresetManager('openai');
    const importedNames = [];

    for (const file of files) {
        try {
            const text = await file.text();
            const presetData = JSON.parse(text);
            
            let name = file.name.replace(/\.[^/.]+$/, "");
            
            await pm.savePreset(name, presetData, { skipUpdate: true });
            importedNames.push({ name, data: presetData });
            successCount++;
        } catch (e) {
            console.error('[Zero] Failed to import file:', file.name, e);
            failCount++;
        }
    }

    if (successCount > 0) {
        window.dispatchEvent(new Event('zero-presets-list-changed')); // 通知缓存失效
        
        if (pm) {
            const { presets, preset_names } = pm.getPresetList();
            const isKeyed = pm.isKeyedApi();
            
            for (const item of importedNames) {
                const { name, data } = item;
                const exists = isKeyed ? preset_names.includes(name) : Object.keys(preset_names).includes(name);
                
                if (exists) {
                    const idx = isKeyed ? preset_names.indexOf(name) : preset_names[name];
                    presets[idx] = data;
                } else {
                    presets.push(data);
                    const newIdx = presets.length - 1;
                    if (isKeyed) {
                        preset_names.push(name);
                        $(pm.select).append($('<option></option>', { value: name, text: name }));
                    } else {
                        preset_names[name] = newIdx;
                        $(pm.select).append($('<option></option>', { value: newIdx, text: name }));
                    }
                }
            }
            refreshNativePresetManager(pm);
        }
    }
    if (failCount > 0) toastr.error(`${failCount} 个文件导入失败`);

    await renderManageTab();
    await populatePresetSelects();
}
