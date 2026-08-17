import { HistoryManager } from '../qr-snapshot/state.js';

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
    if (text === null || text === undefined) return '';
    return String(text)
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
        if ($panel.length && $panel.is(':visible') && !$('#comparison-overlay').is(':visible') && !$('#zero-quick-editor').is(':visible')) {
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
                <div class="zero-modal-card" style="
                    background: var(--zero-bg-color, var(--SmartThemeBlurTintColor-Original, #1e1e28));
                    color: var(--zero-text-color, var(--SmartThemeBodyColor, #e0e0e0));
                    border: 1px solid var(--zero-border-color, var(--SmartThemeBorderColor, #444));
                    border-radius: 16px;
                    width: 100%;
                    max-width: 380px;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 8px 30px rgba(0,0,0,0.6);
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

        $(`#${modalId}`).on('click', (e) => {
            if (e.target.id === modalId) {
                closeModal();
            }
        });

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
        if ($panel.length && $panel.is(':visible') && !$('#comparison-overlay').is(':visible') && !$('#zero-quick-editor').is(':visible')) {
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
                background: rgba(0,0,0,0.6);
                backdrop-filter: blur(2px);
                z-index: 30005;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                font-family: var(--mainFontFamily, sans-serif);
                color: var(--SmartThemeBodyColor, #dcdcd2);
            ">
                <div class="zero-modal-card" style="
                    background: var(--zero-bg-color, var(--SmartThemeBlurTintColor-Original, #1e1e28));
                    color: var(--zero-text-color, var(--SmartThemeBodyColor, #e0e0e0));
                    border: 1px solid var(--zero-border-color, var(--SmartThemeBorderColor, #444));
                    border-radius: 16px;
                    width: 100%;
                    max-width: 440px;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 8px 30px rgba(0,0,0,0.6);
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

        $(`#${modalId}`).on('click', (e) => {
            if (e.target.id === modalId) {
                $(`#${modalId}`).remove();
            }
        });

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
            await syncBoundRegexOnPromptToggle(null, presetName);
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
                        <span style="font-weight: 500; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${pName}</span>
                        <span style="font-size: 10px; opacity: 0.6; background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 4px; flex-shrink: 0;">${escapeHtml(pRole)}</span>
                    </div>
                </label>
            `;
        }).join('');

        const modalHtml = `
            <div id="${modalId}" style="
                position: fixed;
                top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.6);
                backdrop-filter: blur(2px);
                z-index: 30005;
                display: flex;
                align-items: center;
                justify-content: center;
            ">
                <div class="zero-modal-card" style="
                    background: var(--zero-bg-color, var(--SmartThemeBlurTintColor-Original, #1e1e28));
                    color: var(--zero-text-color, var(--SmartThemeBodyColor, #e0e0e0));
                    border: 1px solid var(--zero-border-color, var(--SmartThemeBorderColor, #444));
                    border-radius: 12px;
                    width: 420px;
                    max-width: 90vw;
                    max-height: 80vh;
                    display: flex;
                    flex-direction: column;
                    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
                    overflow: hidden;
                ">
                    <!-- Header -->
                    <div style="
                        padding: 14px 18px;
                        border-bottom: 1px solid var(--SmartThemeBorderColor, #444);
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        background: rgba(0,0,0,0.15);
                    ">
                        <div style="font-size: 14px; font-weight: bold; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-link" style="color: var(--SmartThemeQuoteColor);"></i>
                            <span>预设正则绑定条目 (${escapeHtml(presetName)})</span>
                        </div>
                        <button class="close-modal interactable" style="background: none; border: none; color: inherit; cursor: pointer; font-size: 16px; opacity: 0.6;"><i class="fa-solid fa-xmark"></i></button>
                    </div>

                    <!-- Filter Bar -->
                    <div style="padding: 10px 18px 4px 18px; display: flex; flex-direction: column; gap: 8px;">
                        <div style="font-size: 12px; opacity: 0.85;">
                            为正则「<strong style="color: var(--SmartThemeQuoteColor);">${scriptTitle}</strong>」勾选绑定的提示词条目：
                        </div>
                        <input type="text" id="zero-prompt-search-input" class="interactable" placeholder="搜索提示词名称..." style="
                            padding: 6px 10px;
                            border: 1px solid var(--SmartThemeBorderColor);
                            border-radius: 6px;
                            background: rgba(0,0,0,0.2);
                            color: inherit;
                            font-size: 12px;
                            width: 100%;
                            box-sizing: border-box;
                        " />
                    </div>

                    <!-- Body -->
                    <div style="padding: 8px 18px 14px 18px; flex: 1; overflow-y: auto; display: flex; flex-direction: column;">
                        <div id="zero-prompt-list-container" style="display: flex; flex-direction: column;">
                            ${promptRowsHtml}
                        </div>
                    </div>

                    <!-- Footer -->
                    <div style="
                        padding: 10px 18px;
                        border-top: 1px solid var(--SmartThemeBorderColor, #444);
                        display: flex;
                        align-items: center;
                        justify-content: space-between;
                        background: rgba(0,0,0,0.15);
                    ">
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
        $modal.on('click', (e) => {
            if (e.target.id === modalId) $modal.remove();
        });
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

            presetObj.prompts.forEach(p => {
                if (!Array.isArray(p.bound_regex_ids)) p.bound_regex_ids = [];
                const has = p.bound_regex_ids.includes(scriptId);
                const shouldHave = checkedPromptIds.has(p.identifier);

                if (shouldHave && !has) {
                    p.bound_regex_ids.push(scriptId);
                } else if (!shouldHave && has) {
                    p.bound_regex_ids = p.bound_regex_ids.filter(id => id !== scriptId);
                }
            });

            const isActive = pm.getSelectedPresetName() === presetName;
            await savePresetWithoutRegexToast(pm, presetName, presetObj, { skipUpdate: !isActive });
            await syncBoundRegexOnPromptToggle(null, presetName);
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
    if (!nameA) return;
    try {
        const pm = SillyTavern.getContext().getPresetManager('openai');
        const presetObjA = pm.getCompletionPresetByName(nameA);
        const presetObjB = nameB ? pm.getCompletionPresetByName(nameB) : null;

        if (!presetObjA) {
            toastr.error(`未找到预设: ${nameA}`);
            return;
        }

        const modalId = 'zero-standalone-regex-modal';
        $(`#${modalId}`).remove();

        const regexesA = getPresetRegexScripts(presetObjA);
        const regexesB = presetObjB ? getPresetRegexScripts(presetObjB) : [];

        const renderRegexRows = (regexList, presetName, otherPresetName) => {
            if (regexList.length === 0) {
                return `<div style="padding: 12px; font-size: 12px; opacity: 0.5; text-align: center;">(该预设无独立正则)</div>`;
            }
            return regexList.map((r, idx) => {
                const title = escapeHtml(r.scriptName || r.id || `正则 ${idx + 1}`);
                const isDis = r.disabled === true;
                const rId = String(r.id || r.scriptName);

                let migrateBtnHtml = '';
                if (otherPresetName) {
                    migrateBtnHtml = `
                        <button class="zero-standalone-migrate-btn interactable" data-id="${escapeHtml(rId)}" data-from="${escapeHtml(presetName)}" data-to="${escapeHtml(otherPresetName)}" title="复制至 ${escapeHtml(otherPresetName)}" style="
                            padding: 2px 8px; font-size: 11px; border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; background: rgba(255,255,255,0.05); color: inherit; cursor: pointer;
                        ">
                            <i class="fa-solid fa-copy"></i> 复制
                        </button>
                    `;
                }

                return `
                    <div style="
                        display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 10px;
                        background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; margin-bottom: 4px; font-size: 12px;
                    ">
                        <div style="flex: 1; overflow: hidden; display: flex; align-items: center; gap: 6px;">
                            <span style="font-weight: 500; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${title}</span>
                            ${isDis ? `<span style="font-size: 10px; opacity: 0.6; background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 3px;">禁用</span>` : ''}
                        </div>
                        ${migrateBtnHtml}
                    </div>
                `;
            }).join('');
        };

        const modalHtml = `
            <div id="${modalId}" style="
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.6); backdrop-filter: blur(2px); z-index: 30005;
                display: flex; align-items: center; justify-content: center;
            ">
                <div class="zero-modal-card" style="
                    background: var(--zero-bg-color, var(--SmartThemeBlurTintColor-Original, #1e1e28)); color: var(--zero-text-color, var(--SmartThemeBodyColor, #e0e0e0)); border: 1px solid var(--zero-border-color, var(--SmartThemeBorderColor, #444)); border-radius: 12px;
                    width: ${nameB ? '680px' : '400px'}; max-width: 95vw; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.6); overflow: hidden;
                ">
                    <div style="padding: 14px 18px; border-bottom: 1px solid var(--SmartThemeBorderColor); display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.15);">
                        <div style="font-size: 14px; font-weight: bold; display: flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-code" style="color: var(--SmartThemeQuoteColor);"></i>
                            <span>预设独立正则管理</span>
                        </div>
                        <button class="close-modal interactable" style="background: none; border: none; color: inherit; cursor: pointer; font-size: 16px; opacity: 0.6;"><i class="fa-solid fa-xmark"></i></button>
                    </div>

                    <div style="padding: 16px; flex: 1; overflow-y: auto; display: flex; gap: 16px;">
                        <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
                            <div style="font-weight: bold; font-size: 13px; margin-bottom: 8px; color: var(--SmartThemeQuoteColor); display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-file-code"></i> ${escapeHtml(nameA)} (${regexesA.length})
                            </div>
                            <div style="flex: 1; overflow-y: auto;">
                                ${renderRegexRows(regexesA, nameA, nameB)}
                            </div>
                        </div>

                        ${nameB ? `
                        <div style="width: 1px; background: var(--SmartThemeBorderColor); opacity: 0.5;"></div>
                        <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
                            <div style="font-weight: bold; font-size: 13px; margin-bottom: 8px; color: var(--SmartThemeEmColor); display: flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-file-code"></i> ${escapeHtml(nameB)} (${regexesB.length})
                            </div>
                            <div style="flex: 1; overflow-y: auto;">
                                ${renderRegexRows(regexesB, nameB, nameA)}
                            </div>
                        </div>
                        ` : ''}
                    </div>

                    <div style="padding: 12px 18px; border-top: 1px solid var(--SmartThemeBorderColor); display: flex; justify-content: flex-end; background: rgba(0,0,0,0.15);">
                        <button class="close-modal interactable" style="padding: 6px 16px; border: none; border-radius: 6px; background: rgba(255,255,255,0.1); color: inherit; cursor: pointer; font-size: 12px;">关闭</button>
                    </div>
                </div>
            </div>
        `;

        $('body').append(modalHtml);
        const $modal = $(`#${modalId}`);
        $modal.on('click', (e) => {
            if (e.target.id === modalId) $modal.remove();
        });
        $modal.find('.close-modal').on('click', () => $modal.remove());

        $modal.find('.zero-standalone-migrate-btn').on('click', async function() {
            const scriptId = String($(this).data('id'));
            const fromName = String($(this).data('from'));
            const toName = String($(this).data('to'));

            const fromObj = pm.getCompletionPresetByName(fromName);
            const toObj = pm.getCompletionPresetByName(toName);

            if (!fromObj || !toObj) return;

            try {
                const count = migrateBoundRegexes(fromObj, toObj, [scriptId]);
                if (count > 0) {
                    const isActive = pm.getSelectedPresetName() === toName;
                    await savePresetWithoutRegexToast(pm, toName, toObj, { skipUpdate: !isActive });
                    toastr.success(`已成功复制 1 个正则至「${toName}」`);
                    $modal.remove();
                    if (typeof onMigratedCallback === 'function') onMigratedCallback();
                } else {
                    toastr.info(`「${toName}」中已包含该正则`);
                }
            } catch (err) {
                console.error('[Zero] Standalone regex migration failed:', err);
                toastr.error('正则迁移失败');
            }
        });
    } catch (e) {
        console.error('[Zero] showStandaloneRegexManagerModal failed:', e);
    }
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
 * @param {Array<{identifier: string, enabled: boolean}>|Map<string, boolean>|null} [toggledItems]
 * @param {string} [presetName]
 */
export async function syncBoundRegexOnPromptToggle(toggledItems = null, presetName = '') {
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

        const isActivePreset = pm.getSelectedPresetName() === targetPresetName;

        // Build map of prompt toggles passed explicitly in this call
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

        // If target preset is active, get character-level prompt order overrides
        const activePromptOrderMap = new Map();
        if (isActivePreset && pm.activeCharacter) {
            try {
                const promptOrder = pm.getPromptOrderForCharacter(pm.activeCharacter);
                if (Array.isArray(promptOrder)) {
                    promptOrder.forEach(o => {
                        if (o && o.identifier !== undefined) {
                            activePromptOrderMap.set(String(o.identifier), o.enabled !== false);
                        }
                    });
                }
            } catch (e) {
                console.warn('[Zero] Failed to get prompt order for active character:', e);
            }
        }

        // Build accurate promptEnabledMap for ALL prompts in the target preset
        const promptEnabledMap = new Map();
        presetObj.prompts.forEach(p => {
            if (!p || p.identifier === undefined) return;
            const idStr = String(p.identifier);
            if (togglesMap.has(idStr)) {
                promptEnabledMap.set(idStr, togglesMap.get(idStr));
            } else if (activePromptOrderMap.has(idStr)) {
                promptEnabledMap.set(idStr, activePromptOrderMap.get(idStr));
            } else {
                promptEnabledMap.set(idStr, p.enabled !== false);
            }
        });

        // Build mapping from normalized regex script ID -> list of prompts bound to it
        const regexToPromptsMap = new Map();
        presetObj.prompts.forEach(p => {
            if (Array.isArray(p.bound_regex_ids) && p.bound_regex_ids.length > 0) {
                p.bound_regex_ids.forEach(rId => {
                    const rIdStr = String(rId).trim();
                    if (!rIdStr) return;
                    if (!regexToPromptsMap.has(rIdStr)) {
                        regexToPromptsMap.set(rIdStr, []);
                    }
                    regexToPromptsMap.get(rIdStr).push(p);
                });
            }
        });

        let regexChanged = false;

        regexScripts.forEach(script => {
            if (!script) return;
            const idKey = script.id !== undefined && script.id !== null ? String(script.id).trim() : '';
            const nameKey = script.scriptName ? String(script.scriptName).trim() : '';

            const boundPromptsSet = new Set();
            if (idKey && regexToPromptsMap.has(idKey)) {
                regexToPromptsMap.get(idKey).forEach(p => boundPromptsSet.add(p));
            }
            if (nameKey && regexToPromptsMap.has(nameKey)) {
                regexToPromptsMap.get(nameKey).forEach(p => boundPromptsSet.add(p));
            }

            const boundPrompts = Array.from(boundPromptsSet);
            if (boundPrompts.length === 0) return;

            // If ANY prompt bound to this regex is enabled, regex should be enabled.
            // If ALL prompts bound to this regex are disabled, regex should be disabled.
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

export async function showInjectVariableModal(promptOrName, presetName = '', onSaveCallback = null) {
    let prompt = typeof promptOrName === 'object' ? promptOrName : null;
    let pm = null;
    try {
        pm = SillyTavern.getContext().getPresetManager('openai');
    } catch (e) {}

    if (!pm) {
        toastr.error('未找到预设管理器');
        return;
    }

    if (!presetName) {
        presetName = pm.getSelectedPresetName() || '';
    }

    const presetObj = pm.getCompletionPresetByName(presetName);
    if (!presetObj) {
        toastr.error(`未找到预设「${presetName}」`);
        return;
    }

    if (!prompt && typeof promptOrName === 'string') {
        prompt = presetObj.prompts.find(p => p.identifier === promptOrName || p.name === promptOrName);
    }

    if (!prompt) {
        toastr.error('未找到指定的 Prompt 条目');
        return;
    }

    const rawName = prompt.name || prompt.identifier || 'var_1';
    let defaultVar = rawName.trim()
        .replace(/\s+/g, '_')
        .replace(/[^\w\u4e00-\u9fa5_-]/g, '')
        .toLowerCase();
    if (!defaultVar) defaultVar = 'var_1';

    const modalId = 'zero-inject-var-modal';
    $(`#${modalId}`).remove();

    const originalContent = prompt.content || '';

    const modalHtml = `
        <div id="${modalId}" class="completion_prompt_manager_popup TH-script-editor-container regex_editor_template" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.6); backdrop-filter: blur(2px); z-index: 30005; display: flex; align-items: center; justify-content: center; padding: 20px; box-sizing: border-box; font-family: var(--mainFontFamily, sans-serif); color: var(--SmartThemeBodyColor, #dcdcd2);">
            <div class="zero-modal-card" style="pointer-events: auto; background: var(--zero-bg-color, var(--SmartThemeBlurTintColor-Original, #1e1e28)); color: var(--zero-text-color, inherit); border: 1px solid var(--zero-border-color, var(--SmartThemeBorderColor, #444)); border-radius: 14px; width: 100%; max-width: 680px; display: flex; flex-direction: column; max-height: 90vh; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.6);">
                <!-- Header -->
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--SmartThemeBorderColor, #333); flex-shrink: 0;">
                    <div style="display: flex; align-items: center; gap: 8px; font-weight: bold; font-size: 14px; color: var(--SmartThemeBodyColor);">
                        <i class="fa-solid fa-code" style="color: var(--SmartThemeQuoteColor);"></i>
                        <span>注入变量包裹与插入</span>
                        <span style="font-size: 11px; opacity: 0.6; font-weight: normal;">(目标: ${escapeHtml(prompt.name || prompt.identifier)})</span>
                    </div>
                    <div id="close-inject-var-modal" class="interactable" style="cursor: pointer; padding: 4px 8px; opacity: 0.7;"><i class="fa-solid fa-xmark"></i></div>
                </div>

                <!-- Body -->
                <div style="padding: 16px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 14px;">
                    <!-- Collapsible Settings Header (Default Collapsed) -->
                    <div id="toggle-inject-settings-btn" class="interactable" style="cursor: pointer; padding: 10px 14px; background: rgba(255,255,255,0.04); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 8px; font-size: 12px; display: flex; align-items: center; justify-content: space-between; user-select: none; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden;">
                            <i class="fa-solid fa-sliders" style="color: var(--SmartThemeQuoteColor); flex-shrink: 0;"></i>
                            <span style="font-weight: bold; color: var(--SmartThemeBodyColor); flex-shrink: 0;">变量注入设置</span>
                            <span style="font-size: 11px; opacity: 0.85; font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">(名称: <span id="summary-var-name" style="color: var(--SmartThemeQuoteColor); font-weight: bold; background: transparent; padding: 0;">${escapeHtml(defaultVar)}</span> | 语法: <span id="summary-var-type" style="color: var(--SmartThemeQuoteColor); font-weight: bold; background: transparent; padding: 0;">setvar</span>)</span>
                        </div>
                        <i class="chevron fa-solid fa-chevron-right" style="transition: transform 0.2s ease; font-size: 11px; opacity: 0.7; margin-left: 8px; flex-shrink: 0;"></i>
                    </div>

                    <!-- Collapsible Settings Body (Hidden by default) -->
                    <div id="inject-settings-container" style="display: none; flex-direction: column; gap: 12px; padding: 12px; background: rgba(255,255,255,0.02); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 8px; flex-shrink: 0;">
                        <!-- Variable Name Input -->
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <label style="font-size: 12px; font-weight: bold; color: var(--SmartThemeBodyColor);">变量名称 (Variable Name):</label>
                            <input type="text" id="zero-inject-var-name-input" class="interactable" value="${escapeHtml(defaultVar)}" placeholder="输入变量标识符..." style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor, #444); color: inherit; border-radius: 6px; font-size: 13px; box-sizing: border-box;">
                        </div>

                        <!-- Macro Type Selection -->
                        <div style="display: flex; flex-direction: column; gap: 6px;">
                            <label style="font-size: 12px; font-weight: bold; color: var(--SmartThemeBodyColor);">变量语法 / 宏类型:</label>
                            <select id="zero-inject-var-type-select" class="interactable" style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor, #444); color: inherit; border-radius: 6px; font-size: 12px; box-sizing: border-box;">
                                <option value="setvar" selected>setvar :: 局部变量赋值 ( {{setvar::变量名::内容}} )</option>
                                <option value="addvar">addvar :: 局部变量累加/追加 ( {{addvar::变量名::内容}} )</option>
                                <option value="getvar">getvar :: 局部变量读取 ( {{getvar::变量名}} )</option>
                                ${localStorage.getItem('zero_enable_global_vars') === 'true' ? `
                                <option value="setglobalvar">setglobalvar :: 全局变量赋值 ( {{setglobalvar::变量名::内容}} )</option>
                                <option value="addglobalvar">addglobalvar :: 全局变量累加/追加 ( {{addglobalvar::变量名::内容}} )</option>
                                <option value="getglobalvar">getglobalvar :: 全局变量读取 ( {{getglobalvar::变量名}} )</option>
                                ` : ''}
                            </select>
                        </div>

                        <!-- SET Options (Auto Wrap Checkbox) -->
                        <div id="zero-inject-set-options" style="display: flex; align-items: center; gap: 8px; font-size: 12px; margin-top: 2px;">
                            <input type="checkbox" id="zero-inject-var-wrap-check" checked style="cursor: pointer;">
                            <label for="zero-inject-var-wrap-check" style="cursor: pointer; user-select: none;">自动包裹全条目文字 (把现有文字保存在变量值内部)</label>
                        </div>

                        <!-- GET Options (Position Choice) -->
                        <div id="zero-inject-get-options" style="display: none; flex-direction: column; gap: 6px; font-size: 12px;">
                            <label style="font-weight: bold; color: var(--SmartThemeBodyColor);">读取宏插入位置:</label>
                            <div style="display: flex; gap: 14px; align-items: center; flex-wrap: wrap;">
                                <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                    <input type="radio" name="zero-get-pos" value="cursor" checked style="accent-color: var(--SmartThemeQuoteColor);"> 🎯 光标 / 选中文本位置
                                </label>
                                <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                    <input type="radio" name="zero-get-pos" value="top" style="accent-color: var(--SmartThemeQuoteColor);"> ⬆️ 文本最顶部
                                </label>
                                <label style="cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                    <input type="radio" name="zero-get-pos" value="bottom" style="accent-color: var(--SmartThemeQuoteColor);"> ⬇️ 文本最底部
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- Text Area with Insert at Cursor Button (Enlarged, max 500px, internal scroll) -->
                    <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
                        <div style="display: flex; align-items: center; justify-content: space-between;">
                            <label style="font-size: 12px; opacity: 0.85; font-weight: bold;">条目文本内容编辑与定位区:</label>
                            <button id="zero-inject-var-insert-cursor-btn" class="interactable" style="display: none; padding: 4px 10px; font-size: 11px; border-radius: 6px; background: rgba(123,140,222,0.25); color: var(--SmartThemeQuoteColor); border: 1px solid rgba(123,140,222,0.4); cursor: pointer;"><i class="fa-solid fa-i-cursor" style="margin-right: 4px;"></i> 插入到下方选定光标处</button>
                        </div>
                        <textarea id="zero-inject-var-editor-textarea" class="interactable zero-quick-textarea task_name_edit" data-for="world_entry_content_zero" style="width: 100%; min-height: 220px; max-height: 500px; height: 320px; padding: 12px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 8px; font-size: 13px; font-family: monospace; color: inherit; box-sizing: border-box; resize: vertical; overflow-y: auto; line-height: 1.5;">${escapeHtml(originalContent)}</textarea>
                    </div>

                    <!-- Result Preview Area (Max 500px, internal scroll) -->
                    <div style="display: flex; flex-direction: column; gap: 6px; flex-shrink: 0;">
                        <label style="font-size: 11px; opacity: 0.65; font-weight: bold;">生成结果预览:</label>
                        <div id="zero-inject-var-preview" style="padding: 10px 12px; background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; font-size: 12px; font-family: monospace; min-height: 60px; max-height: 500px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; color: var(--SmartThemeQuoteColor, #7b8cde);">
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div style="display: flex; justify-content: flex-end; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--SmartThemeBorderColor, #333); background: rgba(0,0,0,0.1); flex-shrink: 0;">
                    <button id="cancel-inject-var-btn" class="interactable" style="padding: 8px 16px; border: none; border-radius: 6px; background: rgba(255,255,255,0.1); color: inherit; cursor: pointer; font-size: 12px;">取消</button>
                    <button id="confirm-inject-var-btn" class="interactable" style="padding: 8px 18px; border: none; border-radius: 6px; background: var(--SmartThemeQuoteColor, #7b8cde); color: white; cursor: pointer; font-size: 12px; font-weight: bold;"><i class="fa-solid fa-bolt" style="margin-right: 4px;"></i> 确认注入</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(modalHtml);

    $(`#${modalId}`).on('click', (e) => {
        if (e.target.id === modalId) {
            $(`#${modalId}`).remove();
        }
    });

    // Collapsible Settings Toggle
    $('#toggle-inject-settings-btn').on('click', function() {
        const $container = $('#inject-settings-container');
        const $chevron = $(this).find('.chevron');
        const isVisible = $container.is(':visible');
        if (isVisible) {
            $container.slideUp(180);
            $chevron.css('transform', 'rotate(0deg)');
        } else {
            $container.slideDown(180);
            $chevron.css('transform', 'rotate(90deg)');
        }
    });

    const updateTypeVisibility = () => {
        const varType = $('#zero-inject-var-type-select').val();
        const varName = $('#zero-inject-var-name-input').val().trim() || defaultVar;
        const isWrite = varType === 'setvar' || varType === 'setglobalvar' || varType === 'addvar' || varType === 'addglobalvar';

        $('#summary-var-name').text(varName);
        $('#summary-var-type').text(varType);

        if (isWrite) {
            $('#zero-inject-set-options').show();
            $('#zero-inject-get-options').hide();
            $('#zero-inject-var-insert-cursor-btn').hide();
        } else {
            $('#zero-inject-set-options').hide();
            $('#zero-inject-get-options').css('display', 'flex');
            $('#zero-inject-var-insert-cursor-btn').show();
        }
        updatePreview();
    };

    const getGeneratedContent = () => {
        const varName = $('#zero-inject-var-name-input').val().trim() || defaultVar;
        const varType = $('#zero-inject-var-type-select').val();
        const currentText = $('#zero-inject-var-editor-textarea').val();
        const isWrite = varType === 'setvar' || varType === 'setglobalvar' || varType === 'addvar' || varType === 'addglobalvar';

        if (isWrite) {
            const shouldWrap = $('#zero-inject-var-wrap-check').is(':checked');
            return shouldWrap ? `{{${varType}::${varName}::${currentText}}}` : `{{${varType}::${varName}::}}\n${currentText}`;
        } else {
            const pos = $('input[name="zero-get-pos"]:checked').val();
            const macro = `{{${varType}::${varName}}}`;
            if (pos === 'top') {
                return `${macro}\n${currentText}`;
            } else if (pos === 'bottom') {
                return `${currentText}\n${macro}`;
            } else {
                return currentText;
            }
        }
    };

    const updatePreview = () => {
        const result = getGeneratedContent();
        $('#zero-inject-var-preview').text(result);
    };

    const doInsertAtCursor = () => {
        const varName = $('#zero-inject-var-name-input').val().trim() || defaultVar;
        const varType = $('#zero-inject-var-type-select').val();
        const macro = `{{${varType}::${varName}}}`;
        
        const $textarea = $('#zero-inject-var-editor-textarea');
        const el = $textarea[0];
        const start = el.selectionStart !== undefined ? el.selectionStart : el.value.length;
        const end = el.selectionEnd !== undefined ? el.selectionEnd : el.value.length;
        const val = el.value;

        const newVal = val.slice(0, start) + macro + val.slice(end);
        $textarea.val(newVal);
        el.focus();
        el.setSelectionRange(start + macro.length, start + macro.length);
        updatePreview();
    };

    updateTypeVisibility();

    $('#zero-inject-var-type-select').on('change', updateTypeVisibility);
    $('#zero-inject-var-name-input, #zero-inject-var-wrap-check, input[name="zero-get-pos"]').on('input change', updatePreview);
    $('#zero-inject-var-editor-textarea').on('input', updatePreview);
    $('#zero-inject-var-insert-cursor-btn').on('click', doInsertAtCursor);

    $('#close-inject-var-modal, #cancel-inject-var-btn').on('click', () => {
        $(`#${modalId}`).remove();
    });

    $('#confirm-inject-var-btn').on('click', async function() {
        const varName = $('#zero-inject-var-name-input').val().trim();
        if (!varName) {
            toastr.warning('请输入有效的变量名称');
            return;
        }

        const varType = $('#zero-inject-var-type-select').val();
        let newContent = '';

        if (varType === 'getvar' || varType === 'getglobalvar') {
            const pos = $('input[name="zero-get-pos"]:checked').val();
            if (pos === 'cursor') {
                const currentText = $('#zero-inject-var-editor-textarea').val();
                const macro = `{{${varType}::${varName}}}`;
                if (!currentText.includes(macro)) {
                    doInsertAtCursor();
                }
                newContent = $('#zero-inject-var-editor-textarea').val();
            } else {
                newContent = getGeneratedContent();
            }
        } else {
            newContent = getGeneratedContent();
        }

        const { HistoryManager, PresetManager } = await import('../qr-snapshot/state.js');
        HistoryManager.record();

        // 1. Update the passed prompt object
        prompt.content = newContent;

        const pId = prompt.identifier;
        const pName = prompt.name;

        // 2. Find and update the exact target prompt object inside presetObj.prompts (Crucial for pm.savePreset)
        if (presetObj && Array.isArray(presetObj.prompts)) {
            let targetPrompt = pId ? presetObj.prompts.find(p => p.identifier === pId) : null;
            if (!targetPrompt && pName) {
                targetPrompt = presetObj.prompts.find(p => p.name === pName);
            }
            if (targetPrompt) {
                targetPrompt.content = newContent;
            }
        }

        // 3. Sync to ST promptManager so in-memory character prompt content updates permanently
        try {
            const openai = await import('/scripts/openai.js');
            const promptManager = openai?.promptManager;
            if (promptManager) {
                const stPrompt = (typeof promptManager.getPromptById === 'function' && promptManager.getPromptById(pId)) ||
                    (Array.isArray(promptManager.prompts) && promptManager.prompts.find(x => x.identifier === pId || x.name === pName));
                if (stPrompt) {
                    stPrompt.content = newContent;
                }
                promptManager.saveServiceSettings?.();
                if (typeof promptManager.renderDebounced === 'function') {
                    promptManager.renderDebounced();
                } else {
                    promptManager.render?.();
                }
            }
        } catch (e) {
            console.warn('[Zero] Failed to sync to promptManager:', e);
        }

        // 4. Save preset file/storage
        const isActive = pm.getSelectedPresetName() === presetName;
        await savePresetWithoutRegexToast(pm, presetName, presetObj, { skipUpdate: !isActive });

        // 5. Force invalidate and reload Zero's PresetManager state cache once
        let freshPreset = null;
        if (PresetManager) {
            PresetManager.invalidate?.();
            freshPreset = await PresetManager.load?.();
        }

        $(`#${modalId}`).remove();
        toastr.success(`已成功为条目「${prompt.name || prompt.identifier}」注入变量 ${varName}`);

        window.dispatchEvent(new CustomEvent('zero-content-updated'));

        if (typeof onSaveCallback === 'function') {
            onSaveCallback(freshPreset);
        }
    });
}

export function showVariableRenameModal(oldName, presetName, callback) {
    $('#zero-var-rename-modal').remove();

    const modalHtml = `
        <div id="zero-var-rename-modal" class="zero-modal-overlay" style="position: absolute; inset: 0; background: var(--SmartThemeChatTintColor, #1e1e2d); opacity: 1; border-radius: inherit; z-index: 20000; display: flex; align-items: center; justify-content: center; padding: 16px;">
            <div class="zero-modal-content" style="background: var(--SmartThemeChatTintColor, #1e1e2d); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 10px; width: 100%; max-width: 440px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; color: var(--SmartThemeBodyColor, #ccc); font-family: inherit;">
                <!-- Header -->
                <div style="padding: 14px 16px; border-bottom: 1px solid var(--SmartThemeBorderColor, #444); display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03);">
                    <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-pen-to-square" style="color: var(--SmartThemeQuoteColor);"></i> 变量重命名与类型变更
                    </div>
                    <div id="close-rename-var-modal" class="interactable" style="cursor: pointer; padding: 4px 8px; opacity: 0.7;"><i class="fa-solid fa-xmark"></i></div>
                </div>

                <!-- Body -->
                <div style="padding: 16px; display: flex; flex-direction: column; gap: 14px; font-size: 12px;">
                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: var(--SmartThemeBodyColor);">原变量名称:</label>
                        <div style="padding: 6px 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; font-weight: bold; opacity: 0.9;">${escapeHtml(oldName)}</div>
                    </div>

                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: var(--SmartThemeBodyColor);">新变量名称:</label>
                        <input type="text" id="zero-rename-var-name-input" class="interactable" value="${escapeHtml(oldName)}" placeholder="输入新的变量名..." style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 13px; box-sizing: border-box;">
                    </div>

                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: var(--SmartThemeBodyColor);">批量更改宏语法类型 (可选):</label>
                        <select id="zero-rename-var-type-select" class="interactable" style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px; box-sizing: border-box;">
                            <option value="keep" selected>保持原类型 (不变动 set / add / get 语法)</option>
                            <option value="set">强制转换为 set (赋值/设置，例: {{setvar::新名::内容}})</option>
                            <option value="add">强制转换为 add (累加/追加，例: {{addvar::新名::内容}})</option>
                            <option value="get">强制转换为 get (读取，例: {{getvar::新名}})</option>
                        </select>
                    </div>
                </div>

                <!-- Footer -->
                <div style="padding: 12px 16px; border-top: 1px solid var(--SmartThemeBorderColor, #444); display: flex; justify-content: flex-end; gap: 10px; background: rgba(0,0,0,0.1);">
                    <button id="cancel-rename-var-btn" class="interactable" title="取消" style="padding: 6px 14px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 6px; color: inherit; cursor: pointer; font-size: 12px;"><i class="fa-solid fa-xmark"></i></button>
                    <button id="confirm-rename-var-btn" class="interactable" title="确认修改" style="padding: 6px 14px; background: var(--SmartThemeQuoteColor, #7b8cde); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px;"><i class="fa-solid fa-check"></i></button>
                </div>
            </div>
        </div>
    `;

    const $container = $('#zero-preset-manager').length ? $('#zero-preset-manager') : ($('#zero-preset-dialog').length ? $('#zero-preset-dialog') : $('body'));
    if ($container.css('position') === 'static') {
        $container.css('position', 'relative');
    }
    $container.append(modalHtml);
    const $modal = $('#zero-var-rename-modal');
    $modal.find('#zero-rename-var-name-input').focus().select();

    const closeModal = () => $modal.remove();
    $modal.find('#close-rename-var-modal, #cancel-rename-var-btn').on('click', closeModal);

    $modal.find('#confirm-rename-var-btn').on('click', async () => {
        const newName = $modal.find('#zero-rename-var-name-input').val().trim();
        const targetType = $modal.find('#zero-rename-var-type-select').val();

        if (!newName) {
            toastr.warning('变量名称不能为空');
            return;
        }

        try {
            const pm = SillyTavern.getContext().getPresetManager('openai');
            if (!pm) throw new Error('无法获取预设管理器');
            const presetObj = pm.getCompletionPresetByName(presetName);
            if (!presetObj || !Array.isArray(presetObj.prompts)) throw new Error('未找到对应预设条目');

            const escapeRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(\\{\\{)(set|setglobal|add|addglobal|get|getglobal)(var::)${escapeRegExp(oldName)}(::[\\s\\S]*?|\\}\\})`, 'gi');
            
            let count = 0;
            presetObj.prompts.forEach(p => {
                if (!p.content) return;
                let modified = false;
                p.content = p.content.replace(regex, (match, p1, p2, p3, p4) => {
                    modified = true;
                    let newType = p2;
                    if (targetType === 'set') {
                        newType = p2.includes('global') ? 'setglobal' : 'set';
                    } else if (targetType === 'add') {
                        newType = p2.includes('global') ? 'addglobal' : 'add';
                    } else if (targetType === 'get') {
                        newType = p2.includes('global') ? 'getglobal' : 'get';
                    }

                    if (targetType === 'get' || newType.startsWith('get')) {
                        return `{{${newType}var::${newName}}}`;
                    }

                    let tail = p4;
                    if (p4 === '}}') tail = '::}}';
                    return `{{${newType}var::${newName}${tail}}`;
                });
                if (modified) count++;
            });

            if (count > 0) {
                HistoryManager.record();
                const isActive = pm.getSelectedPresetName() === presetName;
                await savePresetWithoutRegexToast(pm, presetName, presetObj, { skipUpdate: !isActive });

                const typeMsg = targetType !== 'keep' ? ` 并转换语法为 ${targetType}` : '';
                toastr.success(`已在 ${count} 个条目中将变量 "${oldName}" 改名为 "${newName}"${typeMsg}`);

                closeModal();
                window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName } }));
                if (typeof callback === 'function') callback({ oldName, newName, targetType, count });
            } else {
                toastr.info('未发现包含该变量的条目');
                closeModal();
            }
        } catch (err) {
            console.error('[Zero] Rename and type convert failed:', err);
            toastr.error('操作失败: ' + err.message);
        }
    });
}

export function showBatchVariableEditModal(selectedNames, presetName, callback) {
    if (!Array.isArray(selectedNames) || selectedNames.length === 0) {
        toastr.info('请先勾选需要修改的变量');
        return;
    }

    $('#zero-batch-var-modal').remove();

    const tagsHtml = selectedNames.map(name => `
        <span style="font-size: 11px; padding: 2px 6px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; font-weight: bold;">
            ${escapeHtml(name)}
        </span>
    `).join('');

    const modalHtml = `
        <div id="zero-batch-var-modal" class="zero-modal-overlay" style="position: absolute; inset: 0; background: var(--SmartThemeChatTintColor, #1e1e2d); opacity: 1; border-radius: inherit; z-index: 20000; display: flex; align-items: center; justify-content: center; padding: 16px;">
            <div class="zero-modal-content" style="background: var(--SmartThemeChatTintColor, #1e1e2d); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 10px; width: 100%; max-width: 480px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; color: var(--SmartThemeBodyColor, #ccc); font-family: inherit;">
                <!-- Header -->
                <div style="padding: 14px 16px; border-bottom: 1px solid var(--SmartThemeBorderColor, #444); display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03);">
                    <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-list-check" style="color: var(--SmartThemeQuoteColor);"></i> 批量修改选中变量 (${selectedNames.length} 个)
                    </div>
                    <div id="close-batch-var-modal" class="interactable" style="cursor: pointer; padding: 4px 8px; opacity: 0.7;"><i class="fa-solid fa-xmark"></i></div>
                </div>

                <!-- Body -->
                <div style="padding: 16px; display: flex; flex-direction: column; gap: 14px; font-size: 12px; overflow-y: auto; max-height: 70vh;">
                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: var(--SmartThemeBodyColor);">已选变量 (${selectedNames.length} 个):</label>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px; max-height: 90px; overflow-y: auto; padding: 6px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px;">
                            ${tagsHtml}
                        </div>
                    </div>

                    <!-- Macro Type Change -->
                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: var(--SmartThemeBodyColor);">1. 批量修改宏语法类型:</label>
                        <select id="zero-batch-var-type-select" class="interactable" style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px; box-sizing: border-box;">
                            <option value="keep" selected>保持原语法类型 (不变动 set / add / get)</option>
                            <option value="set">统一转换为 set (赋值/设置，例: {{setvar::变量名::...}})</option>
                            <option value="add">统一转换为 add (累加/追加，例: {{addvar::变量名::...}})</option>
                            <option value="get">统一转换为 get (读取，例: {{getvar::变量名}})</option>
                        </select>
                    </div>

                    <!-- Name Batch Rule -->
                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: var(--SmartThemeBodyColor);">2. 批量重命名规则:</label>
                        <select id="zero-batch-var-name-rule-select" class="interactable" style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px; box-sizing: border-box; margin-bottom: 8px;">
                            <option value="keep" selected>保持原名称 (不更名)</option>
                            <option value="prefix">添加统一前缀 (Prefix)</option>
                            <option value="suffix">添加统一后缀 (Suffix)</option>
                            <option value="replace">文本查找替换 (Find & Replace)</option>
                        </select>

                        <!-- Sub Inputs -->
                        <div id="zero-batch-rule-prefix-box" style="display: none;">
                            <input type="text" id="zero-batch-var-prefix-input" class="interactable" placeholder="输入添加的前缀，如 my_" style="width: 100%; padding: 7px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px; box-sizing: border-box;">
                        </div>

                        <div id="zero-batch-rule-suffix-box" style="display: none;">
                            <input type="text" id="zero-batch-var-suffix-input" class="interactable" placeholder="输入添加的后缀，如 _val" style="width: 100%; padding: 7px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px; box-sizing: border-box;">
                        </div>

                        <div id="zero-batch-rule-replace-box" style="display: none; display: flex; gap: 8px;">
                            <input type="text" id="zero-batch-var-search-input" class="interactable" placeholder="要查找的字符..." style="flex: 1; padding: 7px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px; box-sizing: border-box;">
                            <input type="text" id="zero-batch-var-replace-input" class="interactable" placeholder="替换为..." style="flex: 1; padding: 7px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px; box-sizing: border-box;">
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div style="padding: 12px 16px; border-top: 1px solid var(--SmartThemeBorderColor, #444); display: flex; justify-content: flex-end; gap: 10px; background: rgba(0,0,0,0.1);">
                    <button id="cancel-batch-var-btn" class="interactable" title="取消" style="padding: 6px 14px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 6px; color: inherit; cursor: pointer; font-size: 12px;"><i class="fa-solid fa-xmark"></i></button>
                    <button id="confirm-batch-var-btn" class="interactable" title="应用批量修改" style="padding: 6px 14px; background: var(--SmartThemeQuoteColor, #7b8cde); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px;"><i class="fa-solid fa-check"></i></button>
                </div>
            </div>
        </div>
    `;

    const $container = $('#zero-preset-manager').length ? $('#zero-preset-manager') : ($('#zero-preset-dialog').length ? $('#zero-preset-dialog') : $('body'));
    if ($container.css('position') === 'static') {
        $container.css('position', 'relative');
    }
    $container.append(modalHtml);
    const $modal = $('#zero-batch-var-modal');
    const closeModal = () => $modal.remove();

    $modal.find('#close-batch-var-modal, #cancel-batch-var-btn').on('click', closeModal);

    $modal.find('#zero-batch-var-name-rule-select').on('change', function() {
        const val = $(this).val();
        $modal.find('#zero-batch-rule-prefix-box').toggle(val === 'prefix');
        $modal.find('#zero-batch-rule-suffix-box').toggle(val === 'suffix');
        $modal.find('#zero-batch-rule-replace-box').toggle(val === 'replace');
    });

    $modal.find('#confirm-batch-var-btn').on('click', async () => {
        const targetType = $modal.find('#zero-batch-var-type-select').val();
        const nameRule = $modal.find('#zero-batch-var-name-rule-select').val();

        if (targetType === 'keep' && nameRule === 'keep') {
            toastr.info('未选择任何修改规则');
            return;
        }

        const prefixVal = $modal.find('#zero-batch-var-prefix-input').val() || '';
        const suffixVal = $modal.find('#zero-batch-var-suffix-input').val() || '';
        const searchVal = $modal.find('#zero-batch-var-search-input').val() || '';
        const replaceVal = $modal.find('#zero-batch-var-replace-input').val() || '';

        try {
            const pm = SillyTavern.getContext().getPresetManager('openai');
            if (!pm) throw new Error('无法获取预设管理器');
            const presetObj = pm.getCompletionPresetByName(presetName);
            if (!presetObj || !Array.isArray(presetObj.prompts)) throw new Error('未找到对应预设条目');

            const escapeRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            let totalModifiedEntries = 0;
            let modifiedVarsCount = 0;

            HistoryManager.record();

            selectedNames.forEach(oldName => {
                let newName = oldName;
                if (nameRule === 'prefix' && prefixVal) {
                    newName = prefixVal + oldName;
                } else if (nameRule === 'suffix' && suffixVal) {
                    newName = oldName + suffixVal;
                } else if (nameRule === 'replace' && searchVal) {
                    newName = oldName.replaceAll(searchVal, replaceVal);
                }

                newName = newName.trim();
                if (!newName) return;

                const regex = new RegExp(`(\\{\\{)(set|setglobal|add|addglobal|get|getglobal)(var::)${escapeRegExp(oldName)}(::[\\s\\S]*?|\\}\\})`, 'gi');
                let varModified = false;

                presetObj.prompts.forEach(p => {
                    if (!p.content) return;
                    let entryModified = false;
                    p.content = p.content.replace(regex, (match, p1, p2, p3, p4) => {
                        entryModified = true;
                        varModified = true;
                        let newType = p2;
                        if (targetType === 'set') {
                            newType = p2.includes('global') ? 'setglobal' : 'set';
                        } else if (targetType === 'add') {
                            newType = p2.includes('global') ? 'addglobal' : 'add';
                        } else if (targetType === 'get') {
                            newType = p2.includes('global') ? 'getglobal' : 'get';
                        }

                        if (targetType === 'get' || newType.startsWith('get')) {
                            return `{{${newType}var::${newName}}}`;
                        }

                        let tail = p4;
                        if (p4 === '}}') tail = '::}}';
                        return `{{${newType}var::${newName}${tail}}`;
                    });
                    if (entryModified) totalModifiedEntries++;
                });

                if (varModified) modifiedVarsCount++;
            });

            if (modifiedVarsCount > 0) {
                const isActive = pm.getSelectedPresetName() === presetName;
                await savePresetWithoutRegexToast(pm, presetName, presetObj, { skipUpdate: !isActive });

                toastr.success(`已成功批量修改 ${modifiedVarsCount} 个变量 (影响 ${totalModifiedEntries} 个条目)`);
                closeModal();
                window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName } }));
                if (typeof callback === 'function') callback({ modifiedVarsCount, totalModifiedEntries });
            } else {
                toastr.info('选中的变量未在预设条目中匹配到引用');
                closeModal();
            }
        } catch (err) {
            console.error('[Zero] Batch edit variables failed:', err);
            toastr.error('批量修改失败: ' + err.message);
        }
    });
}

export function showBatchEntryVariableEditModal(selectedItems, presetName, callback) {
    if (!Array.isArray(selectedItems) || selectedItems.length === 0) {
        toastr.info('请先勾选需要修改的条目');
        return;
    }

    $('#zero-batch-entry-var-modal').remove();

    const entriesListHtml = selectedItems.map(item => `
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 8px; background: rgba(255,255,255,0.05); border-radius: 4px; border: 1px solid var(--SmartThemeBorderColor);">
            <span style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(item.entryName)}</span>
            <span style="opacity: 0.7; font-size: 10px; margin-left: 8px; flex-shrink: 0;">(变量: ${escapeHtml(item.varName || '')}, 语法: ${escapeHtml(String(item.macroType || '').toUpperCase())})</span>
        </div>
    `).join('');

    const defaultVarName = selectedItems[0].varName;
    const sameVarName = selectedItems.every(i => i.varName === defaultVarName);

    const modalHtml = `
        <div id="zero-batch-entry-var-modal" class="zero-modal-overlay" style="position: absolute; inset: 0; background: var(--SmartThemeChatTintColor, #1e1e2d); opacity: 1; border-radius: inherit; z-index: 20000; display: flex; align-items: center; justify-content: center; padding: 16px;">
            <div class="zero-modal-content" style="background: var(--SmartThemeChatTintColor, #1e1e2d); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 10px; width: 100%; max-width: 480px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; color: var(--SmartThemeBodyColor, #ccc); font-family: inherit;">
                <!-- Header -->
                <div style="padding: 14px 16px; border-bottom: 1px solid var(--SmartThemeBorderColor, #444); display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03);">
                    <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-list-check" style="color: var(--SmartThemeQuoteColor);"></i> 批量修改选中条目中的变量 (${selectedItems.length} 个条目)
                    </div>
                    <div id="close-batch-entry-var-modal" class="interactable" style="cursor: pointer; padding: 4px 8px; opacity: 0.7;"><i class="fa-solid fa-xmark"></i></div>
                </div>

                <!-- Body -->
                <div style="padding: 16px; display: flex; flex-direction: column; gap: 14px; font-size: 12px; overflow-y: auto; max-height: 70vh;">
                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: var(--SmartThemeBodyColor);">已选条目 (${selectedItems.length} 个):</label>
                        <div style="display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto; padding: 6px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px;">
                            ${entriesListHtml}
                        </div>
                    </div>

                    <!-- Macro Type Change -->
                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: var(--SmartThemeBodyColor);">1. 批量修改选中条目中的宏语法类型:</label>
                        <select id="zero-batch-entry-type-select" class="interactable" style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px; box-sizing: border-box;">
                            <option value="keep" selected>保持原语法类型 (不变动 set / add / get)</option>
                            <option value="set">统一转换为 set (赋值/设置，例: {{setvar::变量名::...}})</option>
                            <option value="add">统一转换为 add (累加/追加，例: {{addvar::变量名::...}})</option>
                            <option value="get">统一转换为 get (读取，例: {{getvar::变量名}})</option>
                        </select>
                    </div>

                    <!-- Variable Rename -->
                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 6px; color: var(--SmartThemeBodyColor);">2. 批量重命名变量 (留空则不更名):</label>
                        <input type="text" id="zero-batch-entry-var-name-input" class="interactable" value="${sameVarName ? escapeHtml(defaultVarName) : ''}" placeholder="${sameVarName ? '输入新的变量名...' : '多选不同变量时，输入新统一变量名...'}" style="width: 100%; padding: 8px 10px; background: rgba(0,0,0,0.15); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px; box-sizing: border-box;">
                    </div>
                </div>

                <!-- Footer -->
                <div style="padding: 12px 16px; border-top: 1px solid var(--SmartThemeBorderColor, #444); display: flex; justify-content: flex-end; gap: 10px; background: rgba(0,0,0,0.1);">
                    <button id="cancel-batch-entry-var-btn" class="interactable" title="取消" style="padding: 6px 14px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 6px; color: inherit; cursor: pointer; font-size: 12px;"><i class="fa-solid fa-xmark"></i></button>
                    <button id="confirm-batch-entry-var-btn" class="interactable" title="应用修改" style="padding: 6px 14px; background: var(--SmartThemeQuoteColor, #7b8cde); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px;"><i class="fa-solid fa-check"></i></button>
                </div>
            </div>
        </div>
    `;

    const $container = $('#zero-preset-manager').length ? $('#zero-preset-manager') : ($('#zero-preset-dialog').length ? $('#zero-preset-dialog') : $('body'));
    if ($container.css('position') === 'static') {
        $container.css('position', 'relative');
    }
    $container.append(modalHtml);
    const $modal = $('#zero-batch-entry-var-modal');
    const closeModal = () => $modal.remove();

    $modal.find('#close-batch-entry-var-modal, #cancel-batch-entry-var-btn').on('click', closeModal);

    $modal.find('#confirm-batch-entry-var-btn').on('click', async () => {
        const targetType = $modal.find('#zero-batch-entry-type-select').val();
        const newVarInput = $modal.find('#zero-batch-entry-var-name-input').val().trim();

        if (targetType === 'keep' && !newVarInput) {
            toastr.info('未做任何修改');
            return;
        }

        try {
            const pm = SillyTavern.getContext().getPresetManager('openai');
            if (!pm) throw new Error('无法获取预设管理器');
            const presetObj = pm.getCompletionPresetByName(presetName);
            if (!presetObj || !Array.isArray(presetObj.prompts)) throw new Error('未找到对应预设条目');

            const escapeRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            let modifiedEntriesCount = 0;

            HistoryManager.record();

            selectedItems.forEach(item => {
                const targetPrompt = presetObj.prompts.find(p => (p.name || p.identifier) === item.entryName);
                if (!targetPrompt || !targetPrompt.content) return;

                const oldVar = item.varName;
                const newVar = newVarInput || oldVar;

                const regex = new RegExp(`(\\{\\{)(set|setglobal|add|addglobal|get|getglobal)(var::)${escapeRegExp(oldVar)}(::[\\s\\S]*?|\\}\\})`, 'gi');

                let modified = false;
                targetPrompt.content = targetPrompt.content.replace(regex, (match, p1, p2, p3, p4) => {
                    modified = true;
                    let newType = p2;
                    if (targetType === 'set') {
                        newType = p2.includes('global') ? 'setglobal' : 'set';
                    } else if (targetType === 'add') {
                        newType = p2.includes('global') ? 'addglobal' : 'add';
                    } else if (targetType === 'get') {
                        newType = p2.includes('global') ? 'getglobal' : 'get';
                    }

                    if (targetType === 'get' || newType.startsWith('get')) {
                        return `{{${newType}var::${newVar}}}`;
                    }

                    let tail = p4;
                    if (p4 === '}}') tail = '::}}';
                    return `{{${newType}var::${newVar}${tail}}`;
                });

                if (modified) modifiedEntriesCount++;
            });

            if (modifiedEntriesCount > 0) {
                const isActive = pm.getSelectedPresetName() === presetName;
                await savePresetWithoutRegexToast(pm, presetName, presetObj, { skipUpdate: !isActive });

                toastr.success(`已成功修改 ${modifiedEntriesCount} 个指定条目中的变量语法`);
                closeModal();
                window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName } }));
                if (typeof callback === 'function') callback({ modifiedEntriesCount });
            } else {
                toastr.info('选中的条目中未匹配到可修改的变量');
                closeModal();
            }
        } catch (err) {
            console.error('[Zero] Batch edit entry variables failed:', err);
            toastr.error('修改失败: ' + err.message);
        }
    });
}

export function showStepByStepReplaceModal({ matches, searchVal, replaceVal, presetName, callback }) {
    if (!Array.isArray(matches) || matches.length === 0) {
        toastr.info('未找到任何匹配项');
        return;
    }

    $('#zero-replace-confirm-modal').remove();

    let currentIndex = 0;
    let replacedCount = 0;
    let skippedCount = 0;

    const modalHtml = `
        <div id="zero-replace-confirm-modal" class="zero-modal-overlay" style="position: absolute; inset: 0; background: var(--SmartThemeChatTintColor, #1e1e2d); opacity: 1; border-radius: inherit; z-index: 20000; display: flex; align-items: center; justify-content: center; padding: 16px;">
            <div class="zero-modal-content" style="background: var(--SmartThemeChatTintColor, #1e1e2d); border: 1px solid var(--SmartThemeBorderColor, #444); border-radius: 10px; width: 100%; max-width: 540px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; color: var(--SmartThemeBodyColor, #ccc); font-family: inherit;">
                <!-- Header -->
                <div style="padding: 14px 16px; border-bottom: 1px solid var(--SmartThemeBorderColor, #444); display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03);">
                    <div style="font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 8px;">
                        <i class="fa-solid fa-rotate" style="color: var(--SmartThemeQuoteColor);"></i> 逐个确认替换
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div id="confirm-step-progress" style="font-size: 11px; opacity: 0.85; font-weight: bold; background: rgba(255,255,255,0.08); padding: 3px 10px; border-radius: 10px;">
                            1 / ${matches.length}
                        </div>
                        <div id="close-step-replace-modal" class="interactable" style="cursor: pointer; padding: 4px 8px; opacity: 0.7;"><i class="fa-solid fa-xmark"></i></div>
                    </div>
                </div>

                <!-- Body -->
                <div style="padding: 16px; display: flex; flex-direction: column; gap: 12px; font-size: 12px; overflow-y: auto; max-height: 60vh;">
                    <div>
                        <span style="opacity: 0.7;">当前条目：</span>
                        <strong id="step-entry-name" style="font-size: 13px; color: var(--SmartThemeBodyColor);"></strong>
                    </div>

                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 4px; color: var(--SmartThemeEmColor);">替换前文本:</label>
                        <div id="step-before-snippet" style="padding: 8px 10px; background: rgba(0,0,0,0.25); border: 1px dashed rgba(255, 100, 100, 0.4); border-radius: 6px; font-family: monospace; font-size: 11px; line-height: 1.4; word-break: break-all; white-space: pre-wrap;"></div>
                    </div>

                    <div>
                        <label style="font-weight: bold; display: block; margin-bottom: 4px; color: var(--zero-success-color, #44cc77);">替换后预览:</label>
                        <div id="step-after-snippet" style="padding: 8px 10px; background: rgba(0,0,0,0.25); border: 1px dashed rgba(100, 220, 120, 0.4); border-radius: 6px; font-family: monospace; font-size: 11px; line-height: 1.4; word-break: break-all; white-space: pre-wrap;"></div>
                    </div>
                </div>

                <!-- Footer Actions -->
                <div style="padding: 12px 16px; border-top: 1px solid var(--SmartThemeBorderColor, #444); display: flex; align-items: center; justify-content: space-between; gap: 8px; background: rgba(0,0,0,0.1); flex-wrap: wrap;">
                    <button id="step-btn-all" class="interactable" title="剩余全部替换" style="padding: 6px 12px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; color: inherit; cursor: pointer; font-size: 11px;"><i class="fa-solid fa-angles-right"></i></button>
                    <div style="display: flex; gap: 8px;">
                        <button id="step-btn-skip" class="interactable" title="跳过当前匹配项" style="padding: 6px 14px; background: rgba(255,255,255,0.08); border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; color: inherit; cursor: pointer; font-size: 12px;"><i class="fa-solid fa-forward"></i></button>
                        <button id="step-btn-replace" class="interactable" title="替换当前匹配项" style="padding: 6px 16px; background: var(--SmartThemeQuoteColor); border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 12px;"><i class="fa-solid fa-check"></i></button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const $container = $('#zero-preset-manager').length ? $('#zero-preset-manager') : ($('#zero-preset-dialog').length ? $('#zero-preset-dialog') : $('body'));
    if ($container.css('position') === 'static') {
        $container.css('position', 'relative');
    }
    $container.append(modalHtml);
    const $modal = $('#zero-replace-confirm-modal');

    const updateStepView = () => {
        if (currentIndex >= matches.length) {
            finishProcess();
            return;
        }

        const item = matches[currentIndex];
        $modal.find('#confirm-step-progress').text(`${currentIndex + 1} / ${matches.length}`);
        $modal.find('#step-entry-name').text(item.entryName);

        const beforeHtml = escapeHtml(item.snippetBefore) +
            `<span style="background: rgba(255, 60, 60, 0.35); color: #ff9999; font-weight: bold; border-radius: 2px; padding: 0 2px;">${escapeHtml(item.matchText)}</span>` +
            escapeHtml(item.snippetAfter);

        const afterHtml = escapeHtml(item.snippetBefore) +
            `<span style="background: rgba(40, 200, 100, 0.35); color: #77ffbb; font-weight: bold; border-radius: 2px; padding: 0 2px;">${escapeHtml(item.replacementText)}</span>` +
            escapeHtml(item.snippetAfter);

        $modal.find('#step-before-snippet').html(beforeHtml);
        $modal.find('#step-after-snippet').html(afterHtml);
    };

    const finishProcess = async () => {
        $modal.remove();
        if (typeof callback === 'function') {
            await callback({ replacedCount, skippedCount });
        }
    };

    $modal.find('#close-step-replace-modal').on('click', finishProcess);

    $modal.find('#step-btn-replace').on('click', () => {
        const item = matches[currentIndex];
        const delta = item.doReplace();

        // Adjust matchIndex for remaining matches in the same prompt
        for (let i = currentIndex + 1; i < matches.length; i++) {
            if (matches[i].promptObj === item.promptObj) {
                matches[i].matchIndex += delta;
            }
        }

        replacedCount++;
        currentIndex++;
        updateStepView();
    });

    $modal.find('#step-btn-skip').on('click', () => {
        skippedCount++;
        currentIndex++;
        updateStepView();
    });

    $modal.find('#step-btn-all').on('click', () => {
        while (currentIndex < matches.length) {
            const item = matches[currentIndex];
            const delta = item.doReplace();
            for (let i = currentIndex + 1; i < matches.length; i++) {
                if (matches[i].promptObj === item.promptObj) {
                    matches[i].matchIndex += delta;
                }
            }
            replacedCount++;
            currentIndex++;
        }
        updateStepView();
    });

    updateStepView();
}


