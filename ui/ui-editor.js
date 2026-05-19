import { escapeHtml } from './ui-utils.js';
import { Checker } from './ui-checker.js';

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

    const editHtml = `
        <div id="zero-quick-editor" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: var(--SmartThemeBlurTintColor, rgba(0,0,0,0.8)); backdrop-filter: blur(5px); z-index: 20001; display: flex; flex-direction: column; padding: 20px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; color: var(--SmartThemeBodyColor);">
                <span style="font-weight: bold; font-size: 16px;">正在编辑: ${itemName}</span>
                <div id="close-quick-editor" class="interactable" style="cursor: pointer; padding: 8px; font-size: 20px;"><i class="fa-solid fa-xmark"></i></div>
            </div>
            <textarea id="quick-edit-content" spellcheck="false" autocomplete="off" style="flex: 1; background: var(--SmartThemeChatTintColor, rgba(255,255,255,0.05)); border: 1px solid var(--SmartThemeBorderColor); color: var(--SmartThemeBodyColor); padding: 20px; border-radius: 12px; font-family: 'Consolas', 'Monaco', monospace; font-size: 15px; resize: none; outline: none; line-height: 1.6; box-shadow: inset 0 2px 10px rgba(0,0,0,0.2);">${escapeHtml(prompt.content)}</textarea>
            
            <div id="quick-phrases-section" style="margin-top: 15px;">
                <div id="toggle-phrases" style="font-size: 11px; opacity: 0.6; cursor: pointer; padding: 5px 0; display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-bolt"></i> 快捷短语 <i class="fa-solid fa-chevron-right"></i>
                </div>
                <div id="phrases-container" style="display: none; padding-top: 8px;">
                    <div style="display: flex; justify-content: flex-end; gap: 12px; margin-bottom: 8px; padding-right: 4px;">
                        <span id="btn-phrase-edit" class="interactable" title="新增/修改短语" style="font-size: 14px; opacity: 0.6; cursor: pointer;"><i class="fa-solid fa-square-plus"></i></span>
                        <span id="btn-phrase-delete-mode" class="interactable" title="删除模式" style="font-size: 14px; opacity: 0.6; cursor: pointer;"><i class="fa-solid fa-trash-can"></i></span>
                    </div>
                    
                    <div id="phrases-list" style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px;"></div>
                    
                    <div id="phrase-edit-panel" style="display: none; flex-direction: column; gap: 6px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 10px; border: 1px dashed rgba(255,255,255,0.1);">
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

            <div style="margin-top: 20px; display: flex; gap: 12px;">
                <button id="save-quick-edit" class="interactable" style="flex: 1; padding: 14px; background: var(--SmartThemeQuoteColor); color: white; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 16px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">保存并刷新</button>
            </div>
        </div>
    `;
    
    $('body').append(editHtml);
    $('#close-quick-editor').on('click', () => $('#zero-quick-editor').remove());
    
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
            toastr.info('请填写标题和内容');
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

    $('#save-quick-edit').on('click', async () => {
        const newContent = $('#quick-edit-content').val();
        prompt.content = newContent;
        
        try {
            const isActive = pm.getSelectedPresetName() === presetName;
            await pm.savePreset(presetName, preset, { skipUpdate: !isActive });
            
            toastr.success('已保存修改');
            $('#zero-quick-editor').remove();
            
            if ($('#zero-tab-check').is(':visible')) {
                Checker.render('check-results-container', presetName);
            }
            window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName, itemName } }));
        } catch (e) {
            toastr.error('保存失败');
        }
    });
}
