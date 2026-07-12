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
