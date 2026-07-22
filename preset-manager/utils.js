export function syncTheme() {
    try {
        if (window.parent && window.parent !== window) {
            document.documentElement.setAttribute('style',
                window.parent.document.documentElement.getAttribute('style')
            );
        }
    } catch (e) {
        console.warn('[Zero] Failed to sync theme variables:', e);
    }
}

export function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export async function getPresetPrompts(name) {
    try {
        const ctx = SillyTavern.getContext();
        const pm = ctx.getPresetManager('openai');
        if (!pm) throw new Error('OpenAI PresetManager not found');

        const presetData = pm.getCompletionPresetByName(name);
        if (!presetData || !presetData.prompts) return [];

        let prompts = presetData.prompts;
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

        if (orderList.length > 0) {
            const validIds = new Map();
            orderList.forEach((po, idx) => {
                if (po && po.identifier) validIds.set(po.identifier, idx);
            });

            return prompts
                .filter(p => validIds.has(p.identifier))
                .sort((a, b) => validIds.get(a.identifier) - validIds.get(b.identifier));
        }

        return [];
    } catch (e) {
        console.error('[Zero] getPresetPrompts failed for:', name, e);
        return [];
    }
}

export function refreshNativePresetManager(pm) {
    if (!pm) return;
    try {
        if (typeof pm.render === 'function') pm.render();
        else if (typeof pm.populate === 'function') pm.populate();
    } catch (e) {
        console.warn('[Zero] Failed to refresh native preset manager:', e);
    }
}

export function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

export async function showCollectModal(promptOrPrompts, originPreset = '') {
    if (!promptOrPrompts) return;
    const prompts = Array.isArray(promptOrPrompts) ? promptOrPrompts : [promptOrPrompts];
    if (prompts.length === 0) return;

    try {
        const pm = SillyTavern.getContext().getPresetManager('openai');
        if (!pm) {
            toastr.error('未找到预设管理器');
            return;
        }

        // 1. 获取所有以 ★ 开头的预设
        const list = pm.getPresetList();
        const presetNames = pm.isKeyedApi() ? (list.preset_names || []) : Object.keys(list.preset_names || {});
        const favoritePresets = presetNames.filter(name => name.startsWith('★'));

        // 2. 构造弹窗 HTML
        const modalId = 'zero-collect-modal';
        $(`#${modalId}`).remove();

        const favRows = favoritePresets.map(name => {
            const displayName = name.slice(1); // 去掉 ★ 前缀显示
            return `
                <div class="zero-collect-row interactable" data-name="${escapeHtml(name)}" style="
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    background: rgba(255,255,255,0.03);
                    border-radius: 8px;
                    font-size: 13px;
                    cursor: pointer;
                    margin-bottom: 6px;
                    transition: background 0.15s;
                ">
                    <i class="fa-solid fa-folder-open" style="color: var(--SmartThemeQuoteColor); font-size: 14px;"></i>
                    <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(displayName)}</div>
                </div>
            `;
        }).join('');

        const isBatch = prompts.length > 1;
        const displayNameText = isBatch 
            ? `选中的 ${prompts.length} 个条目`
            : escapeHtml(prompts[0].name || prompts[0].identifier || '未命名');

        const $panel = $('#zero-preset-manager-panel');
        let top = 0, left = 0, width = '100vw', height = '100vh';
        let isFixedCoords = false;
        if ($panel.length) {
            const rect = $panel[0].getBoundingClientRect();
            top = rect.top;
            left = rect.left;
            width = rect.width;
            height = rect.height;
            isFixedCoords = true;
        }

        const modalHtml = `
            <div id="${modalId}" style="
                position: fixed;
                top: ${isFixedCoords ? top + 'px' : '0'};
                left: ${isFixedCoords ? left + 'px' : '0'};
                width: ${isFixedCoords ? width + 'px' : '100vw'};
                height: ${isFixedCoords ? height + 'px' : '100vh'};
                background: rgba(0,0,0,0.7);
                backdrop-filter: blur(4px);
                z-index: 30005;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                font-family: var(--mainFontFamily, sans-serif);
                color: var(--SmartThemeBodyColor, #dcdcd2);
            ">
                <div style="
                    background: var(--SmartThemeBlurTintColor, #171717);
                    border: 1px solid var(--SmartThemeBorderColor, #444);
                    border-radius: 16px;
                    width: 100%;
                    max-width: 380px;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
                    overflow: hidden;
                ">
                    <!-- Header -->
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 16px 20px;
                        border-bottom: 1px solid var(--SmartThemeBorderColor, #444);
                    ">
                        <div style="font-weight: bold; font-size: 15px; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-star" style="color: var(--SmartThemeQuoteColor);"></i>
                            <span>${isBatch ? '批量收藏条目' : '收藏至收藏夹'}</span>
                        </div>
                        <div class="close-collect-modal interactable" style="cursor: pointer; opacity: 0.8; font-size: 16px;">
                            <i class="fa-solid fa-xmark"></i>
                        </div>
                    </div>

                    <!-- Body -->
                    <div style="padding: 20px; display: flex; flex-direction: column; gap: 16px;">
                        <div>
                            <div style="font-size: 11px; opacity: 0.6; margin-bottom: 4px;">收藏条目：</div>
                            <div style="font-size: 13px; font-weight: bold; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border-left: 3px solid var(--SmartThemeQuoteColor); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                                ${displayNameText}
                            </div>
                        </div>

                        <!-- 备注输入 -->
                        <div>
                            <div style="font-size: 11px; opacity: 0.6; margin-bottom: 6px;">添加备注 (可选)：</div>
                            <input type="text" id="zero-fav-note-input" class="interactable" placeholder="输入条目备注..." style="
                                width: 100%;
                                background: rgba(0,0,0,0.2);
                                border: 1px solid var(--SmartThemeBorderColor, #444);
                                color: inherit;
                                padding: 8px 12px;
                                border-radius: 8px;
                                font-size: 13px;
                                outline: none;
                                box-sizing: border-box;
                            ">
                        </div>

                        <!-- 收藏夹列表 -->
                        <div>
                            <div style="font-size: 11px; opacity: 0.6; margin-bottom: 6px;">选择已有收藏夹：</div>
                            <div style="max-height: 140px; overflow-y: auto; padding-right: 4px;">
                                ${favRows.length > 0 ? favRows : '<p style="text-align: center; opacity: 0.5; font-size: 12px; padding: 10px;">暂无收藏夹，请在下方新建</p>'}
                            </div>
                        </div>

                        <!-- 新建收藏夹 -->
                        <div style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 12px;">
                            <div style="font-size: 11px; opacity: 0.6; margin-bottom: 6px;">新建收藏夹：</div>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" id="new-fav-name" class="interactable" placeholder="收藏夹名称" style="
                                    flex: 1;
                                    background: rgba(0,0,0,0.2);
                                    border: 1px solid var(--SmartThemeBorderColor, #444);
                                    color: inherit;
                                    padding: 8px 12px;
                                    border-radius: 8px;
                                    font-size: 13px;
                                    outline: none;
                                ">
                                <button id="create-fav-btn" class="interactable" style="
                                    background: var(--SmartThemeQuoteColor);
                                    color: white;
                                    border: none;
                                    border-radius: 8px;
                                    padding: 0 14px;
                                    cursor: pointer;
                                    font-size: 13px;
                                    font-weight: bold;
                                    display: flex;
                                    align-items: center;
                                    justify-content: center;
                                ">
                                    <i class="fa-solid fa-plus"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);

        const closeModal = () => {
            $(`#${modalId}`).remove();
        };

        const getNote = () => $(`#${modalId} #zero-fav-note-input`).val().trim();

        $(`#${modalId} .close-collect-modal`).on('click', closeModal);

        $(`#${modalId} .zero-collect-row`).on('click', async function() {
            const presetName = $(this).data('name');
            const note = getNote();
            await saveToFavoritePreset(presetName, prompts, false, originPreset, note);
            closeModal();
        });

        $(`#${modalId} .zero-collect-row`).on('mouseenter', function() {
            $(this).css('background', 'rgba(255,255,255,0.08)');
        }).on('mouseleave', function() {
            $(this).css('background', 'rgba(255,255,255,0.03)');
        });

        $(`#${modalId} #create-fav-btn`).on('click', async () => {
            const rawName = $(`#${modalId} #new-fav-name`).val().trim();
            if (!rawName) {
                toastr.warning('请输入收藏夹名称');
                return;
            }
            if (rawName.startsWith('★')) {
                toastr.warning('名称无需手动输入 ★ 标识');
                return;
            }
            const presetName = '★' + rawName;

            if (presetNames.includes(presetName)) {
                toastr.warning('该收藏夹已存在');
                return;
            }

            await saveToFavoritePreset(presetName, [], true);
            showCollectModal(prompts, originPreset);
        });

    } catch (e) {
        console.error('[Zero] showCollectModal failed:', e);
        toastr.error('收藏失败，请检查控制台');
    }
}

async function saveToFavoritePreset(presetName, prompts, isNewPreset = false, originPreset = '', note = '') {
    try {
        const pm = SillyTavern.getContext().getPresetManager('openai');
        let presetData;

        if (isNewPreset) {
            presetData = {
                prompts: [],
                prompt_order: [{ character_id: '100001', order: [] }]
            };
        } else {
            presetData = pm.getCompletionPresetByName(presetName);
            if (!presetData) {
                toastr.error('未找到指定的收藏夹预设');
                return;
            }
        }

        if (!Array.isArray(presetData.prompts)) presetData.prompts = [];

        let orderArray = null;
        if (Array.isArray(presetData.prompt_order) && presetData.prompt_order.length > 0) {
            let globalEntry = presetData.prompt_order.find(item => item && String(item.character_id) === '100001');
            if (!globalEntry) {
                const first = presetData.prompt_order[0];
                if (first && Array.isArray(first.order)) {
                    globalEntry = first;
                    orderArray = first.order;
                } else {
                    orderArray = presetData.prompt_order;
                }
            } else {
                orderArray = globalEntry.order;
            }
        }

        if (!orderArray) {
            const newOrderArray = presetData.prompts.map(p => ({ identifier: p.identifier, enabled: true }));
            presetData.prompt_order = [{ character_id: '100001', order: newOrderArray }];
            orderArray = newOrderArray;
        }

        let addedCount = 0;
        let duplicateCount = 0;

        // O(1) duplicate lookup using a Set of combined name and content
        const existingSet = new Set(presetData.prompts.map(p => `${p.name}|||${p.content}`));

        for (const promptItem of prompts) {
            const key = `${promptItem.name}|||${promptItem.content}`;
            if (existingSet.has(key)) {
                duplicateCount++;
                continue;
            }

            const clone = JSON.parse(JSON.stringify(promptItem));
            clone.identifier = 'system_prompt_fav_' + Date.now() + Math.floor(Math.random() * 1000) + '_' + Math.floor(Math.random() * 1000);

            // Write notes and origin
            if (note) {
                clone.fav_note = note;
            } else if (promptItem.fav_note) {
                clone.fav_note = promptItem.fav_note;
            }

            if (originPreset && !originPreset.startsWith('★')) {
                clone.fav_origin_preset = originPreset;
            } else if (promptItem.fav_origin_preset) {
                clone.fav_origin_preset = promptItem.fav_origin_preset;
            }

            presetData.prompts.push(clone);
            orderArray.push({ identifier: clone.identifier, enabled: true });
            addedCount++;
        }

        if (duplicateCount > 0 && addedCount === 0) {
            toastr.warning(`${duplicateCount} 个条目在当前收藏夹中已存在`);
            return;
        } else if (duplicateCount > 0) {
            toastr.info(`已成功收藏 ${addedCount} 个条目，过滤了 ${duplicateCount} 个重复项`);
        }

        // Check if we can skip native list update and avoid triggering selection changes
        const activeName = pm.getSelectedPresetName();
        const skipUpdate = activeName !== presetName;
        await savePresetWithoutRegexToast(pm, presetName, presetData, { skipUpdate });

        if (isNewPreset) {
            const { presets, preset_names } = pm.getPresetList();
            const isKeyed = pm.isKeyedApi();
            if (isKeyed) {
                preset_names.push(presetName);
                $(pm.select).append($('<option></option>', { value: presetName, text: presetName }));
            } else {
                presets.push(presetData);
                const newIdx = presets.length - 1;
                preset_names[presetName] = newIdx;
                $(pm.select).append($('<option></option>', { value: newIdx, text: presetName }));
            }
        }

        window.dispatchEvent(new Event('zero-presets-list-changed'));

        if (activeName === presetName) {
            refreshNativePresetManager(pm);
        }

        if (isNewPreset) {
            try {
                const { addPresetToCache } = await import('./main.js');
                addPresetToCache(presetName);
            } catch (e) {
                console.warn('[Zero] Failed to add preset to cache:', e);
            }
        }

        // Silent non-blocking updates for dropdown selects
        import('./main.js').then(({ populatePresetSelects }) => {
            populatePresetSelects();
        }).catch(e => {
            console.warn('[Zero] Failed to populate preset selects after fav save:', e);
        });
    } catch (e) {
        console.error('[Zero] saveToFavoritePreset failed:', e);
        toastr.error('保存至收藏夹失败');
    }
}

export async function savePresetWithoutRegexToast(pm, presetName, presetData, options = {}) {
    const originalToastInfo = window.toastr ? window.toastr.info : null;
    if (originalToastInfo) {
        window.toastr.info = function (message, title, ...args) {
            if (title && (title.includes('contains enabled regex') || title.includes('包含已启用正则') || title.includes('regex') || title.includes('正则'))) {
                console.log('[Zero] Suppressed regex warning toast:', title);
                return;
            }
            return originalToastInfo.call(window.toastr, message, title, ...args);
        };
    }
    try {
        if (options.loadOnly) {
            if (typeof pm.loadPreset === 'function') {
                await pm.loadPreset(presetName);
            }
        } else {
            await pm.savePreset(presetName, presetData, options);
        }
    } finally {
        if (originalToastInfo) {
            setTimeout(() => {
                if (window.toastr) window.toastr.info = originalToastInfo;
            }, 100);
        }
    }
}

// ── Preset Regex Helper Functions ──────────────────────────────────────────────

export function getPresetRegexScripts(presetNameOrObj) {
    try {
        let presetObj = presetNameOrObj;
        if (typeof presetNameOrObj === 'string') {
            const pm = SillyTavern.getContext().getPresetManager('openai');
            presetObj = pm?.getCompletionPresetByName(presetNameOrObj);
        }
        if (!presetObj) return [];
        if (!presetObj.extensions) presetObj.extensions = {};
        if (!Array.isArray(presetObj.extensions.regex_scripts)) {
            presetObj.extensions.regex_scripts = [];
        }
        return presetObj.extensions.regex_scripts;
    } catch (e) {
        console.error('[Zero] getPresetRegexScripts failed:', e);
        return [];
    }
}

export function migrateBoundRegexes(srcPresetObj, tgtPresetObj, boundIds) {
    if (!srcPresetObj || !tgtPresetObj || !Array.isArray(boundIds) || boundIds.length === 0) return 0;

    const srcRegexes = getPresetRegexScripts(srcPresetObj);
    if (srcRegexes.length === 0) return 0;

    if (!tgtPresetObj.extensions) tgtPresetObj.extensions = {};
    if (!Array.isArray(tgtPresetObj.extensions.regex_scripts)) {
        tgtPresetObj.extensions.regex_scripts = [];
    }
    const tgtRegexes = tgtPresetObj.extensions.regex_scripts;

    let count = 0;
    for (const boundId of boundIds) {
        const srcRegex = srcRegexes.find(r => r && (String(r.id) === String(boundId) || String(r.scriptName) === String(boundId)));
        if (!srcRegex) continue;

        const existingIdx = tgtRegexes.findIndex(r => r && (
            (srcRegex.id && String(r.id) === String(srcRegex.id)) ||
            (srcRegex.scriptName && String(r.scriptName) === String(srcRegex.scriptName))
        ));

        const clonedRegex = JSON.parse(JSON.stringify(srcRegex));
        if (existingIdx !== -1) {
            tgtRegexes[existingIdx] = clonedRegex;
        } else {
            tgtRegexes.push(clonedRegex);
        }
        count++;
    }
    return count;
}

export async function showBindRegexModal(promptOrPrompts, presetName, onSavedCallback) {
    if (!promptOrPrompts || !presetName) return;
    const prompts = Array.isArray(promptOrPrompts) ? promptOrPrompts : [promptOrPrompts];
    if (prompts.length === 0) return;

    try {
        const pm = SillyTavern.getContext().getPresetManager('openai');
        if (!pm) {
            toastr.error('未找到预设管理器');
            return;
        }

        const presetObj = pm.getCompletionPresetByName(presetName);
        if (!presetObj) {
            toastr.error(`未找到预设: ${presetName}`);
            return;
        }

        const regexScripts = getPresetRegexScripts(presetObj);
        const firstPrompt = prompts[0];
        const currentBoundIds = new Set(Array.isArray(firstPrompt.bound_regex_ids) ? firstPrompt.bound_regex_ids : []);

        const modalId = 'zero-bind-regex-modal';
        $(`#${modalId}`).remove();

        const isBatch = prompts.length > 1;
        const displayNameText = isBatch
            ? `选中的 ${prompts.length} 个条目`
            : escapeHtml(firstPrompt.name || firstPrompt.identifier || '未命名条目');

        const $panel = $('#zero-preset-manager-panel');
        let top = 0, left = 0, width = '100vw', height = '100vh';
        let isFixedCoords = false;
        if ($panel.length) {
            const rect = $panel[0].getBoundingClientRect();
            top = rect.top;
            left = rect.left;
            width = rect.width;
            height = rect.height;
            isFixedCoords = true;
        }

        const regexRowsHtml = regexScripts.length > 0 ? regexScripts.map(script => {
            const scriptId = script.id || script.scriptName;
            const isChecked = currentBoundIds.has(scriptId);
            const scriptTitle = escapeHtml(script.scriptName || script.id || '未命名正则');
            const patternStr = escapeHtml(script.findRegex || '');
            const isDisabled = script.disabled === true;

            return `
                <label class="zero-regex-bind-row interactable" style="
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 10px 12px;
                    background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 8px;
                    font-size: 13px;
                    cursor: pointer;
                    margin-bottom: 6px;
                    transition: background 0.15s;
                    ${isDisabled ? 'opacity: 0.6;' : ''}
                ">
                    <input type="checkbox" class="zero-bind-checkbox" value="${escapeHtml(scriptId)}" ${isChecked ? 'checked' : ''} style="cursor: pointer;" />
                    <div style="flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 2px;">
                        <div style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px;">
                            <span>${scriptTitle}</span>
                            ${isDisabled ? '<span style="font-size: 10px; opacity: 0.7; background: rgba(255,255,255,0.1); padding: 1px 4px; border-radius: 4px;">已禁用</span>' : ''}
                        </div>
                        <div style="font-size: 11px; opacity: 0.6; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${patternStr}
                        </div>
                    </div>
                </label>
            `;
        }).join('') : `
            <div style="text-align: center; padding: 20px 0; opacity: 0.6; font-size: 13px;">
                <i class="fa-solid fa-code" style="font-size: 24px; margin-bottom: 8px; display: block; opacity: 0.4;"></i>
                预设「${escapeHtml(presetName)}」尚未包含任何预设正则脚本。
            </div>
        `;

        const modalHtml = `
            <div id="${modalId}" style="
                position: fixed;
                top: ${isFixedCoords ? top + 'px' : '0'};
                left: ${isFixedCoords ? left + 'px' : '0'};
                width: ${isFixedCoords ? width + 'px' : '100vw'};
                height: ${isFixedCoords ? height + 'px' : '100vh'};
                background: rgba(0,0,0,0.7);
                backdrop-filter: blur(4px);
                z-index: 30005;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                font-family: var(--mainFontFamily, sans-serif);
                color: var(--SmartThemeBodyColor, #dcdcd2);
            ">
                <div style="
                    background: var(--SmartThemeBlurTintColor, #171717);
                    border: 1px solid var(--SmartThemeBorderColor, #444);
                    border-radius: 16px;
                    width: 100%;
                    max-width: 440px;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
                    overflow: hidden;
                    max-height: 85vh;
                ">
                    <!-- Header -->
                    <div style="
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 16px 20px;
                        border-bottom: 1px solid var(--SmartThemeBorderColor, #444);
                    ">
                        <div style="font-weight: bold; font-size: 15px; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-link" style="color: var(--SmartThemeQuoteColor);"></i>
                            <span>正则绑定设置</span>
                        </div>
                        <div class="close-bind-modal interactable" style="cursor: pointer; opacity: 0.8; font-size: 16px;">
                            <i class="fa-solid fa-xmark"></i>
                        </div>
                    </div>

                    <!-- Target prompt badge -->
                    <div style="padding: 12px 20px 0 20px;">
                        <div style="font-size: 12px; opacity: 0.7; margin-bottom: 4px;">目标条目：</div>
                        <div style="
                            font-size: 13px; font-weight: bold; padding: 8px 12px;
                            background: rgba(255,255,255,0.05); border-radius: 6px;
                            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                        ">
                            ${displayNameText}
                        </div>
                    </div>

                    <!-- Body -->
                    <div style="padding: 16px 20px; flex: 1; overflow-y: auto; display: flex; flex-direction: column;">
                        <div style="font-size: 12px; opacity: 0.7; margin-bottom: 8px;">勾选要绑定的预设正则：</div>
                        <div style="display: flex; flex-direction: column;">
                            ${regexRowsHtml}
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="
                        padding: 14px 20px;
                        border-top: 1px solid var(--SmartThemeBorderColor, #444);
                        display: flex;
                        justify-content: flex-end;
                        gap: 10px;
                        background: rgba(0,0,0,0.15);
                    ">
                        <button class="close-bind-modal interactable" style="
                            padding: 8px 16px; border: none; border-radius: 6px;
                            background: rgba(255,255,255,0.1); color: inherit; cursor: pointer; font-size: 13px;
                        ">取消</button>
                        <button id="save-regex-binding-btn" class="interactable" style="
                            padding: 8px 20px; border: none; border-radius: 6px;
                            background: var(--SmartThemeQuoteColor, #4a90e2); color: white; cursor: pointer; font-size: 13px; font-weight: bold;
                        ">确认保存</button>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);

        $(`#${modalId}`).find('.close-bind-modal').on('click', () => {
            $(`#${modalId}`).remove();
        });

        $(`#${modalId}`).find('#save-regex-binding-btn').on('click', async () => {
            const checkedIds = [];
            $(`#${modalId}`).find('.zero-bind-checkbox:checked').each(function() {
                checkedIds.push($(this).val());
            });

            for (const p of prompts) {
                const targetInPreset = presetObj.prompts.find(x => x.identifier === p.identifier);
                if (targetInPreset) {
                    targetInPreset.bound_regex_ids = [...checkedIds];
                }
                p.bound_regex_ids = [...checkedIds];
            }

            const isActive = pm.getSelectedPresetName() === presetName;
            await savePresetWithoutRegexToast(pm, presetName, presetObj, { skipUpdate: !isActive });
            toastr.success(`已更新正则绑定 (${checkedIds.length} 个正则)`);
            $(`#${modalId}`).remove();
            if (typeof onSavedCallback === 'function') onSavedCallback(checkedIds);
        });

    } catch (e) {
        console.error('[Zero] showBindRegexModal error:', e);
        toastr.error('打开绑定框失败');
    }
}

export async function showBindPromptToRegexModal(regexScript, presetName, onSavedCallback) {
    if (!presetName || !regexScript) return;
    try {
        const pm = SillyTavern.getContext().getPresetManager('openai');
        const presetObj = pm.getCompletionPresetByName(presetName);
        if (!presetObj) {
            toastr.error('未找到指定的预设');
            return;
        }

        const scriptId = String(regexScript.id || regexScript.scriptName);
        const scriptTitle = escapeHtml(regexScript.scriptName || regexScript.id || '未命名正则');
        const prompts = presetObj.prompts || [];

        const modalId = 'zero-bind-prompt-to-regex-modal';
        $(`#${modalId}`).remove();

        const promptRowsHtml = prompts.map((p, idx) => {
            const pId = p.identifier;
            const pName = escapeHtml(p.name || p.identifier || `条目 ${idx + 1}`);
            const pRole = p.role || 'user';
            const isChecked = Array.isArray(p.bound_regex_ids) && p.bound_regex_ids.includes(scriptId);

            return `
                <label class="interactable zero-prompt-item-row" style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 5px 8px;
                    background: rgba(255,255,255,0.03);
                    border: 1px solid rgba(255,255,255,0.06);
                    border-radius: 6px;
                    font-size: 12px;
                    cursor: pointer;
                    margin-bottom: 3px;
                ">
                    <input type="checkbox" class="zero-prompt-bind-cb interactable" data-index="${idx}" value="${escapeHtml(pId)}" ${isChecked ? 'checked' : ''} style="cursor: pointer; flex-shrink: 0;" />
                    <div style="flex: 1; overflow: hidden; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                        <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${pName}</span>
                        <span style="font-size: 10px; opacity: 0.6; background: rgba(255,255,255,0.08); padding: 1px 4px; border-radius: 4px; flex-shrink: 0;">${pRole}</span>
                    </div>
                </label>
            `;
        }).join('');

        const modalHtml = `
            <div id="${modalId}" style="
                position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
                background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
                z-index: 30005; display: flex; align-items: center; justify-content: center;
                padding: 16px; font-family: var(--mainFontFamily, sans-serif); color: var(--SmartThemeBodyColor, #dcdcd2);
            ">
                <div style="
                    background: var(--SmartThemeBlurTintColor, #171717); border: 1px solid var(--SmartThemeBorderColor, #444);
                    border-radius: 12px; width: 100%; max-width: 440px; display: flex; flex-direction: column;
                    box-shadow: 0 8px 30px rgba(0,0,0,0.5); overflow: hidden; max-height: 80vh;
                ">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--SmartThemeBorderColor, #444);">
                        <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 8px;">
                            <i class="fa-solid fa-link" style="color: var(--SmartThemeQuoteColor);"></i>
                            <span>预设正则绑定条目 (${escapeHtml(presetName)})</span>
                        </div>
                        <div class="close-modal interactable" style="cursor: pointer; opacity: 0.8; font-size: 15px;"><i class="fa-solid fa-xmark"></i></div>
                    </div>
                    <div style="padding: 10px 16px 0 16px;">
                        <div style="font-size: 11px; opacity: 0.7; margin-bottom: 3px;">正则脚本：</div>
                        <div style="font-size: 12px; font-weight: bold; padding: 6px 10px; background: rgba(255,255,255,0.05); border-radius: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${scriptTitle}
                        </div>
                    </div>
                    <div style="padding: 8px 16px 0 16px; flex-shrink: 0;">
                        <input type="text" id="zero-prompt-search-input" class="interactable" placeholder="搜索条目名称..." style="width: 100%; box-sizing: border-box; padding: 5px 8px; background: var(--SmartThemeChatTintColor); color: inherit; border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; font-size: 12px;">
                    </div>
                    <div id="zero-prompt-list-container" style="padding: 8px 16px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;">
                        ${promptRowsHtml}
                    </div>
                    <div style="padding: 10px 16px; border-top: 1px solid var(--SmartThemeBorderColor, #444); display: flex; justify-content: space-between; align-items: center; background: transparent;">
                        <div style="display: flex; gap: 4px;">
                            <button id="zero-prompt-select-all" class="interactable" title="全选" style="width: 28px; height: 28px; padding: 0; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; background: rgba(255,255,255,0.05); color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;"><i class="fa-solid fa-check-double"></i></button>
                            <button id="zero-prompt-select-invert" class="interactable" title="反选" style="width: 28px; height: 28px; padding: 0; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; background: rgba(255,255,255,0.05); color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;"><i class="fa-solid fa-right-left"></i></button>
                            <button id="zero-prompt-select-range" class="interactable" title="连选 (勾选起始和结束条目后点击)" style="width: 28px; height: 28px; padding: 0; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; background: rgba(255,255,255,0.05); color: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px;"><i class="fa-solid fa-arrows-up-down"></i></button>
                        </div>
                        <div style="display: flex; gap: 8px;">
                            <button class="close-modal interactable" style="padding: 6px 14px; border: none; border-radius: 6px; background: rgba(255,255,255,0.1); color: inherit; cursor: pointer; font-size: 12px;">取消</button>
                            <button id="save-prompt-binding-btn" class="interactable" style="padding: 6px 16px; border: none; border-radius: 6px; background: var(--SmartThemeQuoteColor, #4a90e2); color: white; cursor: pointer; font-size: 12px; font-weight: bold;">保存绑定</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);

        const $modal = $(`#${modalId}`);
        $modal.find('.close-modal').on('click', () => $modal.remove());

        $modal.find('#zero-prompt-search-input').on('input', function() {
            const q = $(this).val().trim().toLowerCase();
            $modal.find('.zero-prompt-item-row').each(function() {
                const text = $(this).text().toLowerCase();
                $(this).toggle(text.includes(q));
            });
        });

        $modal.find('#zero-prompt-select-all').on('click', function() {
            $modal.find('.zero-prompt-item-row:visible .zero-prompt-bind-cb').prop('checked', true);
        });

        $modal.find('#zero-prompt-select-invert').on('click', function() {
            $modal.find('.zero-prompt-item-row:visible .zero-prompt-bind-cb').each(function() {
                $(this).prop('checked', !$(this).is(':checked'));
            });
        });

        $modal.find('#zero-prompt-select-range').on('click', function() {
            const $checked = $modal.find('.zero-prompt-bind-cb:checked');
            if ($checked.length < 2) {
                toastr.info('请先勾选起始和结束条目');
                return;
            }
            const indexes = $checked.map(function() { return parseInt($(this).data('index')); }).get();
            const start = Math.min(...indexes);
            const end = Math.max(...indexes);
            for (let i = start; i <= end; i++) {
                $modal.find(`.zero-prompt-bind-cb[data-index="${i}"]`).prop('checked', true);
            }
        });

        $modal.find('#save-prompt-binding-btn').on('click', async () => {
            const checkedPromptIds = new Set();
            $modal.find('.zero-prompt-bind-cb:checked').each(function() {
                checkedPromptIds.add($(this).val());
            });

            let count = 0;
            presetObj.prompts.forEach(p => {
                if (!Array.isArray(p.bound_regex_ids)) p.bound_regex_ids = [];
                const has = p.bound_regex_ids.includes(scriptId);
                const shouldHave = checkedPromptIds.has(p.identifier);

                if (shouldHave && !has) {
                    p.bound_regex_ids.push(scriptId);
                    count++;
                } else if (!shouldHave && has) {
                    p.bound_regex_ids = p.bound_regex_ids.filter(id => id !== scriptId);
                    count++;
                }
            });

            const isActive = pm.getSelectedPresetName() === presetName;
            await savePresetWithoutRegexToast(pm, presetName, presetObj, { skipUpdate: !isActive });
            toastr.success(`已保存关联的 ${checkedPromptIds.size} 个条目`);
            $modal.remove();
            if (typeof onSavedCallback === 'function') onSavedCallback(Array.from(checkedPromptIds));
        });

    } catch (e) {
        console.error('[Zero] showBindPromptToRegexModal error:', e);
        toastr.error('打开绑定面板失败');
    }
}

export async function showStandaloneRegexManagerModal(nameA, nameB, onMigratedCallback) {
    if (!nameA || !nameB) {
        toastr.info('请先选择源预设与目标预设');
        return;
    }
    const pm = SillyTavern.getContext().getPresetManager('openai');
    const srcPresetObj = pm.getCompletionPresetByName(nameA);
    const tgtPresetObj = pm.getCompletionPresetByName(nameB);
    if (!srcPresetObj || !tgtPresetObj) {
        toastr.error('无法定位选中的预设');
        return;
    }

    const srcRegexes = getPresetRegexScripts(srcPresetObj);
    const tgtRegexes = getPresetRegexScripts(tgtPresetObj);

    const modalId = 'zero-standalone-regex-modal';
    $(`#${modalId}`).remove();

    const $panel = $('#zero-preset-manager-panel');
    let top = 0, left = 0, width = '100vw', height = '100vh';
    let isFixedCoords = false;
    if ($panel.length) {
        const rect = $panel[0].getBoundingClientRect();
        top = rect.top;
        left = rect.left;
        width = rect.width;
        height = rect.height;
        isFixedCoords = true;
    }

    const tgtRegexSet = new Set(tgtRegexes.map(r => String(r.id || r.scriptName)));

    const srcRowsHtml = srcRegexes.length > 0 ? srcRegexes.map(script => {
        const scriptId = script.id || script.scriptName;
        const existsInTgt = tgtRegexSet.has(String(scriptId));
        const scriptTitle = escapeHtml(script.scriptName || script.id || '未命名正则');
        const patternStr = escapeHtml(script.findRegex || '');

        return `
            <label class="interactable" style="
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 10px 12px;
                background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.06);
                border-radius: 8px;
                font-size: 13px;
                cursor: pointer;
                margin-bottom: 6px;
            ">
                <input type="checkbox" class="zero-migrate-regex-checkbox" value="${escapeHtml(scriptId)}" style="cursor: pointer;" />
                <div style="flex: 1; overflow: hidden; display: flex; flex-direction: column; gap: 2px;">
                    <div style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 8px;">
                        <span>${scriptTitle}</span>
                        ${existsInTgt ? '<span style="font-size: 10px; color: var(--SmartThemeQuoteColor); background: rgba(74,144,226,0.15); padding: 1px 6px; border-radius: 4px;">目标中已存在</span>' : ''}
                    </div>
                    <div style="font-size: 11px; opacity: 0.6; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${patternStr}
                    </div>
                </div>
            </label>
        `;
    }).join('') : `
        <div style="text-align: center; padding: 20px 0; opacity: 0.6; font-size: 13px;">
            源预设「${escapeHtml(nameA)}」暂无预设正则脚本。
        </div>
    `;

    const modalHtml = `
        <div id="${modalId}" style="
            position: fixed;
            top: ${isFixedCoords ? top + 'px' : '0'};
            left: ${isFixedCoords ? left + 'px' : '0'};
            width: ${isFixedCoords ? width + 'px' : '100vw'};
            height: ${isFixedCoords ? height + 'px' : '100vh'};
            background: rgba(0,0,0,0.7);
            backdrop-filter: blur(4px);
            z-index: 30005;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            font-family: var(--mainFontFamily, sans-serif);
            color: var(--SmartThemeBodyColor, #dcdcd2);
        ">
            <div style="
                background: var(--SmartThemeBlurTintColor, #171717);
                border: 1px solid var(--SmartThemeBorderColor, #444);
                border-radius: 16px;
                width: 100%;
                max-width: 480px;
                display: flex;
                flex-direction: column;
                box-shadow: 0 8px 30px rgba(0,0,0,0.5);
                overflow: hidden;
                max-height: 85vh;
            ">
                <!-- Header -->
                <div style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    border-bottom: 1px solid var(--SmartThemeBorderColor, #444);
                ">
                    <div style="font-weight: bold; font-size: 15px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-code-compare" style="color: var(--SmartThemeQuoteColor);"></i>
                        <span>独立正则迁移</span>
                    </div>
                    <div class="close-standalone-modal interactable" style="cursor: pointer; opacity: 0.8; font-size: 16px;">
                        <i class="fa-solid fa-xmark"></i>
                    </div>
                </div>

                <!-- Source -> Target Subtitle -->
                <div style="padding: 12px 20px 0 20px; display: flex; align-items: center; gap: 8px; font-size: 13px;">
                    <div style="font-weight: bold; color: var(--SmartThemeQuoteColor); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                        ${escapeHtml(nameA)}
                    </div>
                    <i class="fa-solid fa-arrow-right" style="opacity: 0.5;"></i>
                    <div style="font-weight: bold; color: var(--SmartThemeQuoteColor); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">
                        ${escapeHtml(nameB)}
                    </div>
                </div>

                <!-- Body -->
                <div style="padding: 16px 20px; flex: 1; overflow-y: auto; display: flex; flex-direction: column;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                        <div style="font-size: 12px; opacity: 0.7;">勾选需要迁移的正则脚本：</div>
                        <button id="select-all-standalone-regex" class="interactable" style="background: none; border: none; color: var(--SmartThemeQuoteColor); font-size: 11px; cursor: pointer;">全选</button>
                    </div>
                    <div style="display: flex; flex-direction: column;">
                        ${srcRowsHtml}
                    </div>
                </div>

                <!-- Footer -->
                <div style="
                    padding: 14px 20px;
                    border-top: 1px solid var(--SmartThemeBorderColor, #444);
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                    background: rgba(0,0,0,0.15);
                ">
                    <button class="close-standalone-modal interactable" style="
                        padding: 8px 16px; border: none; border-radius: 6px;
                        background: rgba(255,255,255,0.1); color: inherit; cursor: pointer; font-size: 13px;
                    ">关闭</button>
                    <button id="exec-standalone-regex-migrate-btn" class="interactable" style="
                        padding: 8px 20px; border: none; border-radius: 6px;
                        background: var(--SmartThemeQuoteColor, #4a90e2); color: white; cursor: pointer; font-size: 13px; font-weight: bold;
                    ">迁移选中正则</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    $(`#${modalId}`).find('.close-standalone-modal').on('click', () => {
        $(`#${modalId}`).remove();
    });

    $(`#${modalId}`).find('#select-all-standalone-regex').on('click', function() {
        const $boxes = $(`#${modalId}`).find('.zero-migrate-regex-checkbox');
        const allChecked = $boxes.length === $boxes.filter(':checked').length;
        $boxes.prop('checked', !allChecked);
    });

    $(`#${modalId}`).find('#exec-standalone-regex-migrate-btn').on('click', async () => {
        const checkedIds = [];
        $(`#${modalId}`).find('.zero-migrate-regex-checkbox:checked').each(function() {
            checkedIds.push($(this).val());
        });

        if (checkedIds.length === 0) {
            toastr.info('请先勾选需要迁移的正则');
            return;
        }

        try {
            const count = migrateBoundRegexes(srcPresetObj, tgtPresetObj, checkedIds);
            if (count > 0) {
                const isActive = pm.getSelectedPresetName() === nameB;
                await savePresetWithoutRegexToast(pm, nameB, tgtPresetObj, { skipUpdate: !isActive });
                toastr.success(`已将 ${count} 个正则脚本成功迁移至「${nameB}」`);
                $(`#${modalId}`).remove();
                if (typeof onMigratedCallback === 'function') onMigratedCallback(count);
            } else {
                toastr.info('未发现可迁移的正则');
            }
        } catch (err) {
            console.error('[Zero] Standalone regex migration failed:', err);
            toastr.error('正则迁移失败');
        }
    });
}

const _debouncedRegexSave = debounce(async (pm, targetPresetName, presetObj, isActive) => {
    try {
        await savePresetWithoutRegexToast(pm, targetPresetName, presetObj, { skipUpdate: !isActive });
    } catch (e) {
        console.warn('[Zero] Debounced regex save failed:', e);
    }
}, 150);

/**
 * Sync bound regex disabled states when prompt entries are toggled (enabled/disabled)
 * @param {Array<{identifier: string, enabled: boolean}>|Map<string, boolean>} toggledItems
 * @param {string} [presetName]
 */
export async function syncBoundRegexOnPromptToggle(toggledItems, presetName = '') {
    try {
        const { UiStateManager } = await import('../qr-snapshot/state.js');
        const state = UiStateManager.get();
        if (state.autoToggleBoundRegex === false) return;

        const pm = SillyTavern.getContext().getPresetManager('openai');
        if (!pm) return;

        const targetPresetName = presetName || pm.getSelectedPresetName();
        if (!targetPresetName) return;

        const presetObj = pm.getCompletionPresetByName(targetPresetName);
        if (!presetObj || !Array.isArray(presetObj.prompts)) return;

        const regexScripts = getPresetRegexScripts(presetObj);
        if (!Array.isArray(regexScripts) || regexScripts.length === 0) return;

        const togglesMap = new Map();
        if (toggledItems instanceof Map) {
            toggledItems.forEach((enabled, id) => togglesMap.set(String(id), !!enabled));
        } else if (Array.isArray(toggledItems)) {
            toggledItems.forEach(item => {
                if (item && item.identifier !== undefined) {
                    togglesMap.set(String(item.identifier), !!item.enabled);
                }
            });
        }

        if (togglesMap.size === 0) return;

        const promptEnabledMap = new Map();
        presetObj.prompts.forEach(p => {
            const idStr = String(p.identifier);
            if (togglesMap.has(idStr)) {
                promptEnabledMap.set(idStr, togglesMap.get(idStr));
            } else {
                promptEnabledMap.set(idStr, p.enabled !== false);
            }
        });

        const regexToPromptsMap = new Map();
        presetObj.prompts.forEach(p => {
            if (Array.isArray(p.bound_regex_ids) && p.bound_regex_ids.length > 0) {
                p.bound_regex_ids.forEach(rId => {
                    const rIdStr = String(rId);
                    if (!regexToPromptsMap.has(rIdStr)) {
                        regexToPromptsMap.set(rIdStr, []);
                    }
                    regexToPromptsMap.get(rIdStr).push(p);
                });
            }
        });

        let regexChanged = false;

        regexScripts.forEach(script => {
            const scriptIdStr = String(script.id || script.scriptName);
            const boundPrompts = regexToPromptsMap.get(scriptIdStr);
            if (!boundPrompts || boundPrompts.length === 0) return;

            const hasAnyEnabledBoundPrompt = boundPrompts.some(p => {
                const idStr = String(p.identifier);
                return promptEnabledMap.get(idStr) === true;
            });

            const shouldBeDisabled = !hasAnyEnabledBoundPrompt;

            if (script.disabled !== shouldBeDisabled) {
                script.disabled = shouldBeDisabled;
                regexChanged = true;
            }
        });

        if (regexChanged) {
            const isActive = pm.getSelectedPresetName() === targetPresetName;
            if ($('#zero-tab-regex').is(':visible')) {
                import('./regex-tab.js').then(m => m.renderRegexList());
            }
            _debouncedRegexSave(pm, targetPresetName, presetObj, isActive);
        }
    } catch (e) {
        console.error('[Zero] syncBoundRegexOnPromptToggle failed:', e);
    }
}

