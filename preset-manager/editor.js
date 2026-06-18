import { escapeHtml } from './utils.js';
import { Checker } from './checker.js';
import { GroupManager, HistoryManager } from '../qr-snapshot/state.js';

export async function openQuickEditor(presetName, itemName) {
    const pm = SillyTavern.getContext().getPresetManager('openai');
    if (!pm) {
        toastr.error('无法获取预设管理器');
        return;
    }
    const preset = pm.getCompletionPresetByName(presetName);
    if (!preset) return;
    
    const prompt = preset.prompts.find(p => (p.name || p.identifier) === itemName);
    if (!prompt) return;

    const isFavoritePreset = presetName.startsWith('★');
    let favNoteHtml = '';
    if (isFavoritePreset) {
        favNoteHtml = `
            <!-- 收藏备注 -->
            <div style="flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 6px;">
                <label style="font-size: 11px; opacity: 0.7;">收藏备注</label>
                <input type="text" id="edit-prompt-fav-note" class="interactable" style="background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; padding: 6px 10px; border-radius: 6px; font-size: 12px; height: 30px;" value="${escapeHtml(prompt.fav_note || '')}" placeholder="在此输入收藏夹备注...">
            </div>
        `;
    }

    // Fetch groups for Zero Group integration
    const groups = GroupManager.get(presetName);
    const currentGroupId = groups.find(g => g.ids.includes(prompt.identifier))?.id || '';
    const groupsHtml = groups.map(g => `
        <option value="${g.id}" ${g.id === currentGroupId ? 'selected' : ''}>${escapeHtml(g.name)}</option>
    `).join('');

    const editHtml = `
        <div id="zero-quick-editor" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: var(--SmartThemeBlurTintColor, rgba(15,15,15,0.95)); z-index: 20001; display: flex; flex-direction: column; padding: 20px; font-family: var(--mainFontFamily, sans-serif);">
            <!-- Header with Title-style Name Input and Group Select Badge -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; color: var(--SmartThemeBodyColor); gap: 12px;">
                <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                    <!-- Editable Name Title -->
                    <input type="text" id="edit-prompt-name" class="interactable" style="font-weight: bold; font-size: 16px; background: transparent; border: none; border-bottom: 1px dashed var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 4px; outline: none; width: 55%; max-width: 280px; text-overflow: ellipsis;" value="${escapeHtml(prompt.name || '')}" placeholder="条目名称">
                    
                    <!-- Group Icon Dropdown -->
                    <div style="position: relative; display: inline-flex; align-items: center; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; padding: 4px 8px; font-size: 12px; flex-shrink: 0; height: 28px;">
                        <i class="fa-solid fa-folder" style="margin-right: 6px; opacity: 0.8; color: var(--SmartThemeQuoteColor);"></i>
                        <select id="edit-prompt-group" class="interactable" style="background: transparent; border: none; color: inherit; outline: none; cursor: pointer; font-size: 11px; padding: 0 16px 0 4px; -webkit-appearance: none; -moz-appearance: none; appearance: none; height: 20px; line-height: 20px; width: auto; text-overflow: ellipsis;">
                            <option value="" style="background: #1e1e28;">未分组</option>
                            ${groupsHtml}
                        </select>
                        <i class="fa-solid fa-chevron-down" style="position: absolute; right: 8px; pointer-events: none; font-size: 8px; opacity: 0.5;"></i>
                    </div>
                </div>
                <div id="close-quick-editor" class="interactable" style="cursor: pointer; padding: 8px; font-size: 20px; flex-shrink: 0;"><i class="fa-solid fa-xmark"></i></div>
            </div>

            <!-- Top Collapsible Properties Header (Click-to text removed) -->
            <div id="toggle-editor-params" class="interactable" style="cursor: pointer; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; font-size: 13px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; user-select: none; color: var(--SmartThemeBodyColor);">
                <span><i class="fa-solid fa-sliders" style="margin-right: 6px;"></i> 条目属性设置</span>
                <i class="chevron fa-solid fa-chevron-right" style="transition: transform 0.2s ease;"></i>
            </div>

            <!-- Top Collapsible Properties Box -->
            <div id="editor-params-container" style="display: none; padding: 14px; background: rgba(255,255,255,0.01); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; margin-bottom: 12px; flex-direction: column; gap: 12px; color: var(--SmartThemeBodyColor);">
                <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center;">
                    <!-- Role -->
                    <div style="width: 110px; display: flex; flex-direction: column; gap: 6px;">
                        <label style="font-size: 11px; opacity: 0.7;">身份/角色</label>
                        <select id="edit-prompt-role" class="interactable" style="background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; padding: 6px 10px; border-radius: 6px; font-size: 12px; height: 30px;">
                            <option value="system" ${prompt.role === 'system' ? 'selected' : ''}>System</option>
                            <option value="user" ${prompt.role === 'user' ? 'selected' : ''}>User</option>
                            <option value="assistant" ${prompt.role === 'assistant' ? 'selected' : ''}>Assistant</option>
                        </select>
                    </div>
                    <!-- Injection Position -->
                    <div style="width: 150px; display: flex; flex-direction: column; gap: 6px;">
                        <label style="font-size: 11px; opacity: 0.7;">插入位置</label>
                        <select id="edit-prompt-position" class="interactable" style="background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; padding: 6px 10px; border-radius: 6px; font-size: 12px; height: 30px;">
                            <option value="0" ${prompt.injection_position === 0 ? 'selected' : ''}>Relative (相对)</option>
                            <option value="1" ${prompt.injection_position === 1 ? 'selected' : ''}>Absolute (绝对)</option>
                        </select>
                    </div>
                    <!-- Injection Depth -->
                    <div id="edit-depth-container" style="width: 80px; display: ${prompt.injection_position === 1 ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
                        <label style="font-size: 11px; opacity: 0.7;">插入深度</label>
                        <input type="number" id="edit-prompt-depth" class="interactable" style="background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; padding: 6px 10px; border-radius: 6px; font-size: 12px;" value="${prompt.injection_depth ?? 4}">
                    </div>
                    <!-- Injection Order -->
                    <div id="edit-order-container" style="width: 80px; display: ${prompt.injection_position === 1 ? 'flex' : 'none'}; flex-direction: column; gap: 6px;">
                        <label style="font-size: 11px; opacity: 0.7;">插入顺序</label>
                        <input type="number" id="edit-prompt-order" class="interactable" style="background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; padding: 6px 10px; border-radius: 6px; font-size: 12px;" value="${prompt.injection_order ?? 100}">
                    </div>
                    <!-- Forbid Overrides -->
                    <div style="display: flex; align-items: center; gap: 8px; margin-top: 18px; padding-bottom: 2px;">
                        <input type="checkbox" id="edit-prompt-forbid-overrides" class="interactable" ${prompt.forbid_overrides ? 'checked' : ''} style="cursor: pointer; width: 14px; height: 14px;">
                        <label for="edit-prompt-forbid-overrides" style="font-size: 12px; cursor: pointer; user-select: none; opacity: 0.8;">禁止覆盖</label>
                    </div>
                    ${favNoteHtml}
                </div>
            </div>

            <!-- Content Area (Main Focus) -->
            <div style="flex: 1; display: flex; flex-direction: column; gap: 10px; overflow: hidden;">
                <textarea id="quick-edit-content" class="zero-quick-textarea" spellcheck="false" autocomplete="off" style="flex: 1; background: var(--SmartThemeChatTintColor, rgba(255,255,255,0.05)); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 20px; border-radius: 12px; font-family: 'Consolas', 'Monaco', monospace; font-size: 15px; resize: none; outline: none; line-height: 1.6; box-shadow: inset 0 2px 10px rgba(0,0,0,0.2);">${escapeHtml(prompt.content)}</textarea>
                
                <!-- Quick Phrases Section -->
                <div id="quick-phrases-section" style="background: rgba(255,255,255,0.01); border: 1px solid var(--SmartThemeBorderColor); border-radius: 12px; padding: 12px; flex-shrink: 0;">
                    <div id="toggle-phrases" style="font-size: 11px; opacity: 0.6; cursor: pointer; display: flex; align-items: center; gap: 6px; color: var(--SmartThemeBodyColor);">
                        <i class="fa-solid fa-bolt"></i> 快捷短语 <i class="fa-solid fa-chevron-right"></i>
                    </div>
                    <div id="phrases-container" style="display: none; padding-top: 8px;">
                        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-bottom: 8px; padding-right: 4px;">
                            <span id="btn-phrase-edit" class="interactable" title="新增/修改短语" style="font-size: 14px; opacity: 0.6; cursor: pointer; color: var(--SmartThemeBodyColor);"><i class="fa-solid fa-square-plus"></i></span>
                            <span id="btn-phrase-delete-mode" class="interactable" title="删除模式" style="font-size: 14px; opacity: 0.6; cursor: pointer; color: var(--SmartThemeBodyColor);"><i class="fa-solid fa-trash-can"></i></span>
                        </div>
                        
                        <div id="phrases-list" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;"></div>
                        
                        <div id="phrase-edit-panel" style="display: none; flex-direction: column; gap: 6px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 10px; border: 1px dashed rgba(255,255,255,0.1); color: var(--SmartThemeBodyColor);">
                            <div style="font-size: 10px; opacity: 0.5; margin-bottom: 2px;" id="edit-panel-title">新增短语</div>
                            <div style="display: flex; gap: 6px;">
                                <input type="text" id="new-phrase-title" placeholder="标签标题" style="flex: 1; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; padding: 4px 10px; border-radius: 4px; font-size: 11px;">
                                <input type="text" id="new-phrase-content" placeholder="注入内容" style="flex: 2; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; padding: 4px 10px; border-radius: 4px; font-size: 11px;">
                            </div>
                            <div style="display: flex; gap: 6px;">
                                <button id="add-phrase-btn" class="interactable" style="flex: 1; background: var(--SmartThemeQuoteColor); border: none; color: white; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 11px;">确定</button>
                                <button id="cancel-phrase-edit" class="interactable" style="padding: 6px 12px; background: rgba(255,255,255,0.1); border: none; color: inherit; border-radius: 4px; cursor: pointer; font-size: 11px;">取消</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Save Action Button -->
            <div style="margin-top: 15px; display: flex; gap: 12px; flex-shrink: 0;">
                <button id="save-quick-edit" class="interactable" style="flex: 3; padding: 10px; background: var(--SmartThemeQuoteColor); color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">保存并刷新</button>
                <button id="fav-quick-edit" class="interactable" style="flex: 1; padding: 10px; background: rgba(255, 255, 255, 0.05); color: var(--SmartThemeQuoteColor); border: 1px solid var(--SmartThemeQuoteColor); border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; gap: 6px;"><i class="fa-solid fa-star"></i> 收藏</button>
            </div>
        </div>
    `;
    
    const originalBodyOverflow = $('body').css('overflow');
    const originalHtmlOverflow = $('html').css('overflow');
    
    $('body').css('overflow', 'hidden');
    $('html').css('overflow', 'hidden');
    
    const closeEditor = () => {
        $('body').css('overflow', originalBodyOverflow || '');
        $('html').css('overflow', originalHtmlOverflow || '');
        $('#zero-quick-editor').remove();
    };

    $('body').append(editHtml);
    $('#close-quick-editor').on('click', closeEditor);
    
    // --- Auto-resizing Group select width helper ---
    const adjustSelectWidth = ($select) => {
        const text = $select.find('option:selected').text();
        const $span = $('<span>').text(text).css({
            font: $select.css('font'),
            'font-size': $select.css('font-size'),
            'font-family': $select.css('font-family'),
            'font-weight': $select.css('font-weight'),
            visibility: 'hidden',
            position: 'absolute',
            'white-space': 'nowrap'
        });
        $('body').append($span);
        const width = $span.width();
        $span.remove();
        // Set width with padding for the dropdown chevron
        $select.css('width', (width + 24) + 'px');
    };

    // Initialize Group select width on open
    const $groupSelect = $('#edit-prompt-group');
    adjustSelectWidth($groupSelect);

    // Adjust width dynamically when selecting a different group
    $groupSelect.on('change', function() {
        adjustSelectWidth($(this));
    });
    
    // --- Collapsible Toggle Logic (Guiding text removed) ---
    $('#toggle-editor-params').on('click', function() {
        const $container = $('#editor-params-container');
        const $chevron = $(this).find('.chevron');
        const isVisible = $container.is(':visible');
        
        if (isVisible) {
            $container.slideUp(200);
            $chevron.css('transform', 'rotate(0deg)');
        } else {
            $container.slideDown(200);
            $chevron.css('transform', 'rotate(90deg)');
        }
    });

    // --- Position Type Toggle Logic ---
    $('#edit-prompt-position').on('change', function() {
        const val = $(this).val();
        if (val === '1') {
            $('#edit-depth-container, #edit-order-container').css('display', 'flex');
        } else {
            $('#edit-depth-container, #edit-order-container').css('display', 'none');
        }
    });

    // --- Quick Phrases Logic ---
    const seedPhrases = [
        { title: '{{setvar::变量名:: }}', content: '{{setvar:::: }}', offset: 10 },
        { title: '{{setvar::变量名::内容}}', content: '{{setvar::::}}', offset: 10 },
        { title: '{{getvar::变量名}}', content: '{{getvar::}}', offset: 10 },
        { title: '{{setglobalvar::变量名:: }}', content: '{{setglobalvar:::: }}', offset: 16 },
        { title: '{{setglobalvar::变量名::内容}}', content: '{{setglobalvar::::}}', offset: 16 },
        { title: '{{getglobalvar::变量名}}', content: '{{getglobalvar::}}', offset: 16 }
    ];
    
    let isDeleteMode = false;
    let editingIndex = null;
    
    const renderPhrases = () => {
        let phrases = JSON.parse(localStorage.getItem('zero_quick_phrases_v2'));
        if (!phrases) {
            phrases = seedPhrases;
            localStorage.setItem('zero_quick_phrases_v2', JSON.stringify(phrases));
        }

        const $list = $('#phrases-list');
        $list.empty();
        
        const isEditPanelOpen = $('#phrase-edit-panel').is(':visible');
        phrases.forEach((p, idx) => {
            const isEditing = editingIndex === idx;
            const tag = $(`
                <div class="phrase-tag interactable" style="padding: 4px 12px; background: ${isDeleteMode ? 'rgba(255,0,0,0.1)' : (isEditing ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)')}; border: 1px solid ${isDeleteMode ? 'rgba(255,0,0,0.3)' : (isEditing ? 'var(--SmartThemeQuoteColor)' : 'rgba(255,255,255,0.1)')}; border-radius: 14px; font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                    <span title="${escapeHtml(p.content)}">${escapeHtml(p.title)}</span>
                    ${isDeleteMode ? '<i class="fa-solid fa-circle-xmark" style="color: #ff5555; font-size: 10px;"></i>' : (isEditPanelOpen ? '<i class="fa-solid fa-pencil" style="opacity: 0.4; font-size: 9px;"></i>' : '')}
                </div>
            `);
            
            const handleTrigger = (e) => {
                if (isDeleteMode) {
                    phrases.splice(idx, 1);
                    localStorage.setItem('zero_quick_phrases_v2', JSON.stringify(phrases));
                    renderPhrases();
                } else if (isEditPanelOpen) {
                    editingIndex = idx;
                    $('#new-phrase-title').val(p.title);
                    $('#new-phrase-content').val(p.content);
                    $('#edit-panel-title').text('修改短语');
                    $('#add-phrase-btn').text('保存修改');
                    renderPhrases();
                } else {
                    if (e) e.preventDefault();
                    insertAtCursor(p.content, p.offset);
                }
            };

            tag.on('mousedown touchstart', (e) => {
                if (!isDeleteMode && !isEditPanelOpen) {
                    handleTrigger(e);
                }
            });

            tag.on('click', (e) => {
                if (isDeleteMode || isEditPanelOpen) {
                    handleTrigger(e);
                }
            });
            
            $list.append(tag);
        });
        
        $('#btn-phrase-delete-mode')
            .css('color', isDeleteMode ? '#ff5555' : 'inherit')
            .css('opacity', isDeleteMode ? '1' : '0.6')
            .find('i').attr('class', `fa-solid fa-${isDeleteMode ? 'check' : 'trash-can'}`);
    };

    const insertAtCursor = (text, offset = null) => {
        const textarea = document.getElementById('quick-edit-content');
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentVal = textarea.value;
        
        const pos = (start !== null) ? start : currentVal.length;
        const posEnd = (end !== null) ? end : currentVal.length;

        textarea.value = currentVal.substring(0, pos) + text + currentVal.substring(posEnd);
        
        const newPos = (offset !== null) ? pos + offset : pos + text.length;
        
        textarea.focus();
        if (textarea.setSelectionRange) {
            textarea.setSelectionRange(newPos, newPos);
        } else {
            textarea.selectionStart = textarea.selectionEnd = newPos;
        }
    };

    $('#toggle-phrases').on('click', function() {
        $('#phrases-container').slideToggle(200);
        $(this).find('i.fa-chevron-right, i.fa-chevron-down').toggleClass('fa-chevron-right fa-chevron-down');
    });

    $('#btn-phrase-edit').on('click', () => {
        const isOpen = $('#phrase-edit-panel').is(':visible');
        if (isOpen) {
            $('#phrase-edit-panel').slideUp(200);
            editingIndex = null;
        } else {
            $('#phrase-edit-panel').slideDown(200);
            editingIndex = null;
            $('#new-phrase-title').val('');
            $('#new-phrase-content').val('');
            $('#edit-panel-title').text('新增短语');
            $('#add-phrase-btn').text('确定');
        }
        isDeleteMode = false;
        renderPhrases();
    });

    $('#cancel-phrase-edit').on('click', () => {
        $('#phrase-edit-panel').slideUp(200);
    });

    $('#btn-phrase-delete-mode').on('click', () => {
        isDeleteMode = !isDeleteMode;
        if (isDeleteMode) $('#phrase-edit-panel').slideUp(200);
        renderPhrases();
    });

    $('#add-phrase-btn').on('click', () => {
        const title = $('#new-phrase-title').val().trim();
        const content = $('#new-phrase-content').val().trim();
        if (!title || !content) {
            toastr.info('请填写标题 and 内容');
            return;
        }
        const phrases = JSON.parse(localStorage.getItem('zero_quick_phrases_v2') || '[]');
        if (editingIndex !== null) {
            phrases[editingIndex] = { title, content, offset: content.length };
        } else {
            phrases.push({ title, content, offset: content.length });
        }
        localStorage.setItem('zero_quick_phrases_v2', JSON.stringify(phrases));
        $('#new-phrase-title').val('');
        $('#new-phrase-content').val('');
        $('#phrase-edit-panel').slideUp(200);
        renderPhrases();
    });

    renderPhrases();

    // --- Favorite Handler ---
    $('#fav-quick-edit').on('click', async () => {
        const currentItem = {
            ...prompt,
            name: $('#edit-prompt-name').val().trim(),
            role: $('#edit-prompt-role').val(),
            injection_position: Number($('#edit-prompt-position').val()),
            injection_depth: Number($('#edit-prompt-depth').val()),
            injection_order: Number($('#edit-prompt-order').val()),
            forbid_overrides: $('#edit-prompt-forbid-overrides').is(':checked'),
            content: $('#quick-edit-content').val()
        };
        const { showCollectModal } = await import('./utils.js');
        await showCollectModal(currentItem, presetName);
    });

    // --- Save Handler ---
    $('#save-quick-edit').on('click', async () => {
        const name = $('#edit-prompt-name').val().trim();
        const role = $('#edit-prompt-role').val();
        const selectedGroupId = $('#edit-prompt-group').val();
        const position = Number($('#edit-prompt-position').val());
        const depth = Number($('#edit-prompt-depth').val());
        const order = Number($('#edit-prompt-order').val());
        const forbidOverrides = $('#edit-prompt-forbid-overrides').is(':checked');
        const newContent = $('#quick-edit-content').val();
        
        if (!name) {
            toastr.error('条目名称不能为空');
            return;
        }

        // Apply changes to the prompt object
        HistoryManager.record();
        prompt.name = name;
        prompt.role = role;
        prompt.injection_position = position;
        prompt.injection_depth = depth;
        prompt.injection_order = order;
        prompt.forbid_overrides = forbidOverrides;
        prompt.content = newContent;

        if (isFavoritePreset) {
            const newFavNote = $('#edit-prompt-fav-note').val().trim();
            if (newFavNote) {
                prompt.fav_note = newFavNote;
            } else {
                delete prompt.fav_note;
            }
        }
        
        try {
            // Update Zero Group mapping
            if (selectedGroupId) {
                GroupManager.assign(presetName, selectedGroupId, [prompt.identifier]);
            } else {
                GroupManager.unassign(presetName, prompt.identifier);
            }

            const isActive = pm.getSelectedPresetName() === presetName;
            await pm.savePreset(presetName, preset, { skipUpdate: !isActive });
            
            closeEditor();
            
            // Trigger refresh of the currently active tab in Zero panel
            if ($('#zero-tab-check').is(':visible')) {
                Checker.render('check-results-container', presetName);
            } else if ($('#zero-tab-stitch').is(':visible')) {
                const { renderStitchList } = await import('./stitch.js');
                await renderStitchList();
            } else if ($('#zero-tab-contrast').is(':visible')) {
                if ($('#comparison-overlay').is(':visible')) {
                    // Details overlay is open, it will refresh itself via the event listener
                } else {
                    const { performAutoMatch } = await import('./contrast.js');
                    await performAutoMatch();
                }
            } else if ($('#zero-tab-manage').is(':visible')) {
                const { renderManageTab } = await import('./manage.js');
                await renderManageTab();
            }
            
            window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName, itemName: name } }));
        } catch (e) {
            console.error('[Zero] Save failed:', e);
            toastr.error('保存失败');
        }
    });
}
