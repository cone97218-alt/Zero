/**
 * Zero Checker Extension
 * Handles XML tag validation and Variable consistency checks for presets.
 */

import { PresetManager } from '../qr-snapshot/state.js';
import { getPresetPrompts, escapeHtml } from './utils.js';
import { matchSimple, highlightMatchSnippet } from '../qr-snapshot/search-util.js';

export const Checker = {
    /**
     * Scans a preset for XML and Variable issues.
     * @param {Array} prompts - List of prompt entries.
     */
    performCheck(prompts) {
        const varMap = new Map(); // name -> { init: [], set: [], get: [] }
        const results = {
            xml: [],
            variables: [],
            allVars: [],
            prompts: prompts
        };

        // 1. XML Check (Concatenated for cross-entry validation)
        const fullContent = prompts.map(p => p.content || '').join('\n');
        const xmlErrors = this.validateXml(fullContent);
        if (xmlErrors.length > 0) {
            results.xml = this.mapXmlErrorsToEntries(xmlErrors, prompts);
        }

        prompts.forEach((p, idx) => {
            const content = p.content || '';
            const entryName = p.name || p.identifier || `Entry ${idx + 1}`;

            // Parse variables using a robust stack-based parser to support macro nesting
            const stack = [];
            let i = 0;
            while (i < content.length) {
                if (content.startsWith('{{', i)) {
                    stack.push(i);
                    i += 2;
                } else if (content.startsWith('}}', i)) {
                    if (stack.length > 0) {
                        const startIdx = stack.pop();
                        const endIdx = i + 2;
                        const rawMacro = content.substring(startIdx, endIdx);
                        const inner = rawMacro.substring(2, rawMacro.length - 2);

                        // Tokenize by splitting on '::', respecting nested braces depth
                        const parts = [];
                        let currentPart = '';
                        let braceDepth = 0;
                        let j = 0;
                        while (j < inner.length) {
                            if (inner.startsWith('{{', j)) {
                                braceDepth++;
                                currentPart += '{{';
                                j += 2;
                            } else if (inner.startsWith('}}', j)) {
                                braceDepth--;
                                currentPart += '}}';
                                j += 2;
                            } else if (inner.substring(j, j + 2) === '::' && braceDepth === 0) {
                                parts.push(currentPart);
                                currentPart = '';
                                j += 2;
                            } else {
                                currentPart += inner[j];
                                j++;
                            }
                        }
                        parts.push(currentPart);

                        const macroType = parts[0]?.trim().toLowerCase();
                        if (macroType === 'setvar' || macroType === 'setglobalvar') {
                            const name = parts[1]?.trim();
                            const value = parts.slice(2).join('::');
                            if (name) {
                                if (!varMap.has(name)) varMap.set(name, { init: [], set: [], get: [] });
                                const isInit = !value || value.trim() === '';
                                if (isInit) {
                                    varMap.get(name).init.push({ entry: p, name: entryName });
                                } else {
                                    varMap.get(name).set.push({ entry: p, name: entryName, value: value.trim() });
                                }
                            }
                        } else if (macroType === 'getvar' || macroType === 'getglobalvar') {
                            const name = parts[1]?.trim();
                            if (name) {
                                if (!varMap.has(name)) varMap.set(name, { init: [], set: [], get: [] });
                                varMap.get(name).get.push({ entry: p, name: entryName });
                            }
                        }
                    }
                    i += 2;
                } else {
                    i++;
                }
            }
        });

        // Analyze variables
        for (const [name, data] of varMap.entries()) {
            const hasInit = data.init.length > 0;
            const hasSet = data.set.length > 0;
            const hasGet = data.get.length > 0;

            const isProblem = !hasSet || !hasGet || data.init.length > 1;

            const varResult = {
                name,
                hasInit,
                hasSet,
                hasGet,
                initCount: data.init.length,
                setCount: data.set.length,
                getCount: data.get.length,
                occurrences: data,
                isProblem
            };

            if (isProblem) {
                results.variables.push(varResult);
            }
            results.allVars.push(varResult);
        }

        return results;
    },

    /**
     * Simple XML tag validator.
     */
    validateXml(text) {
        const errors = [];
        const stack = [];

        // Get exemptions from localStorage
        const customExemptions = JSON.parse(localStorage.getItem('zero_xml_exemptions') || '[]');
        const defaultExemptions = ['user', 'char'];
        const exemptions = new Set([...defaultExemptions, ...customExemptions]);

        // Regex to find tags: <tag>, </tag>, <tag />
        const tagRegex = /<(\/?[a-zA-Z0-9_-]+)(\s+[^>]*?)?(\s*\/)?>/g;
        let match;

        while ((match = tagRegex.exec(text)) !== null) {
            const fullTag = match[0];
            const tagName = match[1];
            const isSelfClosing = !!match[3];
            const isClosing = tagName.startsWith('/');
            const cleanName = isClosing ? tagName.substring(1) : tagName;

            if (isSelfClosing || exemptions.has(cleanName)) continue;

            if (isClosing) {
                if (stack.length === 0) {
                    errors.push({ type: 'redundant', tag: fullTag, name: cleanName, index: match.index });
                } else {
                    const last = stack.pop();
                    if (last.name !== cleanName) {
                        errors.push({ type: 'mismatch', tag: fullTag, expected: last.name, name: cleanName, index: match.index });
                    }
                }
            } else {
                stack.push({ name: tagName, tag: fullTag, index: match.index });
            }
        }

        while (stack.length > 0) {
            const unclosed = stack.pop();
            errors.push({ type: 'unclosed', tag: unclosed.tag, name: unclosed.name, index: unclosed.index });
        }

        return errors;
    },

    /**
     * Maps global XML errors back to specific entries.
     */
    mapXmlErrorsToEntries(errors, prompts) {
        const entryResults = [];
        let currentPos = 0;

        errors.forEach(err => {
            let foundEntry = null;
            let runningPos = 0;

            for (const p of prompts) {
                const content = p.content || '';
                if (err.index >= runningPos && err.index < runningPos + content.length + 1) {
                    foundEntry = p;
                    break;
                }
                runningPos += content.length + 1; // +1 for the join('\n')
            }

            if (foundEntry) {
                const entryName = foundEntry.name || foundEntry.identifier;
                let existing = entryResults.find(r => r.name === entryName);
                if (!existing) {
                    existing = { entry: foundEntry, name: entryName, errors: [] };
                    entryResults.push(existing);
                }

                let errMsg = '';
                if (err.type === 'redundant') errMsg = `多余的闭合标签: ${escapeHtml(err.tag)}`;
                else if (err.type === 'mismatch') errMsg = `标签不匹配: 期待 &lt;/${escapeHtml(err.expected)}&gt;, 实际发现 ${escapeHtml(err.tag)}`;
                else if (err.type === 'unclosed') errMsg = `未闭合标签: ${escapeHtml(err.tag)}`;

                existing.errors.push(errMsg);
            }
        });

        return entryResults;
    },

    /**
     * Renders the Self-Check tab content.
     */
    async render(containerId, presetName) {
        const $container = $(`#${containerId}`);
        $container.empty();

        if (!presetName) {
            $container.html('<p style="text-align: center; opacity: 0.5; margin-top: 40px;">请选择一个预设进行自查</p>');
            return;
        }

        $container.html('<p style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> 正在自查...</p>');

        try {
            const prompts = await getPresetPrompts(presetName);
            this._lastPrompts = prompts; // Cache for inject feature
            const results = this.performCheck(prompts);

            this.renderResults($container, results, presetName);
        } catch (e) {
            console.error('[Zero] Check failed:', e);
            $container.html('<p style="text-align: center; color: #ff5555; padding: 20px;">自查失败: ' + e.message + '</p>');
        }
    },

    renderResults($container, results, presetName) {
        $container.empty();

        const xmlCount = results.xml.length;
        const varCount = results.variables.length;

        const summaryHtml = `
            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                <div style="flex: 1; padding: 10px; background: ${xmlCount > 0 ? 'rgba(255,100,100,0.1)' : 'rgba(100,255,100,0.05)'}; border-radius: 8px; text-align: center;">
                    <div style="font-size: 11px; opacity: 0.6;">XML 问题</div>
                    <div style="font-size: 18px; font-weight: bold; color: ${xmlCount > 0 ? '#ff5555' : '#55ff55'}">${xmlCount}</div>
                </div>
                <div style="flex: 1; padding: 10px; background: ${varCount > 0 ? 'rgba(255,150,50,0.1)' : 'rgba(100,255,100,0.05)'}; border-radius: 8px; text-align: center;">
                    <div style="font-size: 11px; opacity: 0.6;">变量问题</div>
                    <div style="font-size: 18px; font-weight: bold; color: ${varCount > 0 ? '#ffaa33' : '#55ff55'}">${varCount}</div>
                </div>
            </div>
            
            <div class="zero-check-tabs" style="display: flex; gap: 4px; margin-bottom: 12px;">
                <div class="zero-check-sub-tab" data-sub="xml" style="flex: 1; padding: 8px; font-size: 12px; text-align: center; background: rgba(255,255,255,0.05); border-radius: 6px; cursor: pointer;">XML 检查</div>
                <div class="zero-check-sub-tab" data-sub="vars" style="flex: 1; padding: 8px; font-size: 12px; text-align: center; background: rgba(255,255,255,0.05); border-radius: 6px; cursor: pointer;">变量自查</div>
                <div class="zero-check-sub-tab" data-sub="all-entries" style="flex: 1; padding: 8px; font-size: 12px; text-align: center; background: rgba(255,255,255,0.05); border-radius: 6px; cursor: pointer;">所有条目</div>
            </div>

            <div id="check-sub-xml" class="check-sub-content" style="display: none;">
                <div style="margin-bottom: 8px;">
                    <div id="toggle-xml-exemptions" style="font-size: 11px; opacity: 0.6; cursor: pointer; padding: 4px 0;"><i class="fa-solid fa-gear"></i> XML 豁免设置 <i class="fa-solid fa-chevron-down"></i></div>
                    <div id="xml-exemptions-panel" style="display: none; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-top: 4px;">
                        <div style="font-size: 10px; opacity: 0.5; margin-bottom: 6px;">豁免标签 (逗号分隔):</div>
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="check-xml-exemptions" placeholder="user, char, ..." style="flex: 1; padding: 4px 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: inherit !important;">
                            <button id="save-xml-exemptions" class="interactable" style="padding: 4px 10px; background: var(--SmartThemeQuoteColor); border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 11px;">保存</button>
                        </div>
                    </div>
                </div>
                <div id="xml-issues-list"></div>
            </div>

            <div id="check-sub-vars" class="check-sub-content" style="display: none;">
                ${localStorage.getItem('zero_hide_var_init_tip') === 'true' ? '' : `
                <div id="check-var-init-tip" style="position: relative; font-size: 11px; line-height: 1.5; padding: 8px 30px 8px 12px; background: rgba(255,170,51,0.05); border: 1px solid rgba(255,170,51,0.3); border-radius: 6px; margin-bottom: 10px; color: var(--SmartThemeBodyColor);">
                    <i class="fa-solid fa-circle-info" style="color: #ffaa33; margin-right: 6px;"></i>
                    <strong>提示：</strong>变量没有初始化（Init）也可以正常使用，但可能会造成<strong>变量内容残留</strong>。例如当你关闭了某个设置变量内容的条目后，因没有初始化条目在最前方执行置空，该变量可能无法被及时清空，后续依然能读取到其残留的旧内容。
                    <i id="close-var-init-tip" class="fa-solid fa-xmark interactable" title="不再提示" style="position: absolute; right: 10px; top: 10px; cursor: pointer; opacity: 0.5; font-size: 12px;"></i>
                </div>
                `}
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; padding: 4px;">
                    <div class="var-filter-btn" data-filter="problem" style="padding: 4px 12px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.05); color: inherit; border: 1px solid rgba(255,255,255,0.1);">问题变量</div>
                    <div class="var-filter-btn" data-filter="correct" style="padding: 4px 12px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.05); color: inherit; border: 1px solid rgba(255,255,255,0.1);">正确变量</div>
                    <div class="var-filter-btn" data-filter="all" style="padding: 4px 12px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.05); color: inherit; border: 1px solid rgba(255,255,255,0.1);">全部变量</div>
                </div>
                <div id="vars-list-container"></div>
            </div>
            <div id="check-sub-all-entries" class="check-sub-content" style="display: none;">
                <div style="margin-bottom: 10px; display: flex; flex-direction: column; gap: 6px;">
                    <input type="text" id="check-entry-search" placeholder="搜索条目名称或内容..." style="width: 100%; padding: 4px 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: inherit !important;">
                    <div style="display: flex; gap: 6px; align-items: center; padding-left: 2px;">
                        <span style="font-size: 11px; opacity: 0.6; margin-right: 4px;">筛选范围:</span>
                        <span class="check-search-filter-badge interactable active" data-filter="name" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">名称</span>
                        <span class="check-search-filter-badge interactable active" data-filter="content" style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--SmartThemeQuoteColor); color: white; cursor: pointer; user-select: none; transition: all 0.15s ease;">内容</span>
                    </div>
                </div>
                <div id="check-entry-list"></div>
            </div>
        `;

        $container.append(summaryHtml);

        // Bind close banner event
        $('#close-var-init-tip').on('click', function() {
            localStorage.setItem('zero_hide_var_init_tip', 'true');
            $('#check-var-init-tip').slideUp(200, function() {
                $(this).remove();
            });
        });

        // --- Render XML Issues ---
        const $xmlList = $('#xml-issues-list');
        const customExemptions = JSON.parse(localStorage.getItem('zero_xml_exemptions') || '[]');
        $('#check-xml-exemptions').val(customExemptions.join(', '));

        $('#toggle-xml-exemptions').on('click', function () {
            const $panel = $('#xml-exemptions-panel');
            $panel.slideToggle(200);
            $(this).find('i.fa-chevron-down, i.fa-chevron-up').toggleClass('fa-chevron-down fa-chevron-up');
        });

        $('#save-xml-exemptions').off('click').on('click', () => {
            const val = $('#check-xml-exemptions').val();
            const list = val.split(',').map(s => s.trim()).filter(s => s !== '');
            localStorage.setItem('zero_xml_exemptions', JSON.stringify(list));
            this.render(containerId, presetName);
        });

        if (results.xml.length === 0) {
            $xmlList.html('<p style="text-align: center; opacity: 0.5; padding: 20px; font-size: 12px;">未发现 XML 标签闭合问题</p>');
        } else {
            results.xml.forEach(issue => {
                const row = $(`
                    <div class="check-issue-row" style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; border-left: 3px solid #ff5555;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-size: 13px; font-weight: bold;">${escapeHtml(issue.name)}</span>
                            <button class="check-edit-btn interactable" style="padding: 4px 8px; background: rgba(255,255,255,0.1); border: none; border-radius: 4px; color: inherit; cursor: pointer; font-size: 11px;">
                                <i class="fa-solid fa-pencil"></i> 修改
                            </button>
                        </div>
                        <div style="font-size: 11px; color: #ff7777; line-height: 1.4;">
                            ${issue.errors.map(err => `<div>• ${err}</div>`).join('')}
                        </div>
                    </div>
                `);
                row.find('.check-edit-btn').on('click', () => this.openEditor(presetName, issue.name));
                $xmlList.append(row);
            });
        }

        // --- Render Variable Content ---
        const $varBox = $('#vars-list-container');
        const renderVariables = (filter = 'problem') => {
            $varBox.empty();
            let varsToShow = [];
            if (filter === 'problem') varsToShow = results.variables;
            else if (filter === 'correct') varsToShow = results.allVars.filter(v => !v.isProblem);
            else varsToShow = results.allVars;

            if (varsToShow.length === 0) {
                $varBox.html(`<p style="text-align: center; opacity: 0.5; padding: 20px; font-size: 12px;">无${filter === 'problem' ? '问题' : (filter === 'correct' ? '正确' : '')}变量</p>`);
            } else {
                varsToShow.sort((a, b) => a.name.localeCompare(b.name)).forEach(v => {
                    $varBox.append(this.buildVariableRow(v, presetName));
                });
            }
        };

        renderVariables($('.var-filter-btn.active').data('filter') || 'problem');

        $('.var-filter-btn').off('click').on('click', function() {
            $('.var-filter-btn').css('background', 'rgba(255,255,255,0.05)').css('color', 'inherit').css('border-color', 'rgba(255,255,255,0.1)');
            $(this).css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white').css('border-color', 'var(--SmartThemeQuoteColor)');
            renderVariables($(this).data('filter'));
            localStorage.setItem('zero_check_var_filter', $(this).data('filter'));
        });

        const lastVarFilter = localStorage.getItem('zero_check_var_filter') || 'problem';
        $(`.var-filter-btn[data-filter="${lastVarFilter}"]`).click();

        // --- Render All Entries ---
        const $entryList = $('#check-entry-list');
        const renderEntries = (filter = '') => {
            $entryList.empty();
            const lowerFilter = filter.toLowerCase();

            const activeFilters = [];
            $('.check-search-filter-badge.active').each(function() {
                activeFilters.push($(this).data('filter'));
            });

            results.prompts.forEach((p, idx) => {
                const name = p.name || p.identifier || `Entry ${idx + 1}`;
                const content = p.content || '';

                const matchesName = activeFilters.includes('name') && name.toLowerCase().includes(lowerFilter);
                const matchesContent = activeFilters.includes('content') && content.toLowerCase().includes(lowerFilter);

                if (filter && !matchesName && !matchesContent) return;

                const contentMatch = filter && matchesContent;

                const row = $(`
                    <div class="check-entry-row" style="display: flex; flex-direction: column; gap: 4px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 6px; font-size: 13px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHtml(name)}</span>
                            <button class="entry-edit-btn interactable" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; color: inherit; cursor: pointer; padding: 4px 8px; font-size: 11px;"><i class="fa-solid fa-pencil"></i> 修改</button>
                        </div>
                        ${contentMatch ? `
                            <div style="font-size: 11px; opacity: 0.6; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px; border-left: 2px solid var(--SmartThemeQuoteColor);">
                                ...${highlightMatchSnippet(content, filter)}...
                            </div>
                        ` : ''}
                    </div>
                `);
                row.find('.entry-edit-btn').on('click', () => this.openEditor(presetName, name));
                $entryList.append(row);
            });
        };

        renderEntries();
        $('#check-entry-search').on('input', function () {
            renderEntries($(this).val());
        });

        $('body').off('click', '.check-search-filter-badge').on('click', '.check-search-filter-badge', function () {
            const activeCount = $('.check-search-filter-badge.active').length;
            if ($(this).hasClass('active') && activeCount === 1) return;

            $(this).toggleClass('active');
            if ($(this).hasClass('active')) {
                $(this).css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white').css('opacity', '1');
            } else {
                $(this).css('background', 'rgba(255,255,255,0.08)').css('color', 'inherit').css('opacity', '0.5');
            }
            renderEntries($('#check-entry-search').val());
        });

        // Event listeners for sub-tabs
        $('.zero-check-sub-tab').on('click', function () {
            const sub = $(this).data('sub');
            $('.zero-check-sub-tab').removeClass('active').css('background', 'rgba(255,255,255,0.05)');
            $(this).addClass('active').css('background', 'rgba(255,255,255,0.1)');
            $('.check-sub-content').hide();
            $(`#check-sub-${sub}`).show();

            localStorage.setItem('zero_check_last_sub_tab', sub);

            // Restore scroll
            const scrollMap = JSON.parse(localStorage.getItem('zero_check_scroll_map') || '{}');
            if (scrollMap[sub]) {
                $('.zero-panel-body').scrollTop(scrollMap[sub]);
            } else {
                $('.zero-panel-body').scrollTop(0);
            }
        });

        // Restore last sub-tab
        const lastSub = localStorage.getItem('zero_check_last_sub_tab') || 'xml';
        $(`.zero-check-sub-tab[data-sub="${lastSub}"]`).click();

        // Save scroll position per tab
        $('.zero-panel-body').off('scroll.checker').on('scroll.checker', function () {
            const currentSub = $('.zero-check-sub-tab.active').data('sub');
            if (currentSub) {
                const scrollMap = JSON.parse(localStorage.getItem('zero_check_scroll_map') || '{}');
                scrollMap[currentSub] = $(this).scrollTop();
                localStorage.setItem('zero_check_scroll_map', JSON.stringify(scrollMap));
            }
        });
    },

    buildVariableRow(v, presetName) {
        const initBg = v.hasInit ? 'var(--SmartThemeQuoteColor)' : 'var(--SmartThemeBorderColor)';
        const initColor = v.hasInit ? 'white' : 'var(--SmartThemeBodyColor)';
        const initOpacity = v.hasInit ? '1' : '0.8';
        const initText = v.hasInit ? `初始化${v.initCount > 1 ? ` (${v.initCount}!)` : ''}` : '初始化 (可选)';

        const setBg = v.hasSet ? '#44aa44' : '#aa4444';
        const setOpacity = v.hasSet ? '1' : '0.8';
        const setText = v.hasSet ? `内容设置 (${v.setCount})` : '未设置内容';

        const getBg = v.hasGet ? '#44aa44' : '#aa4444';
        const getOpacity = v.hasGet ? '1' : '0.8';
        const getText = v.hasGet ? `变量读取 (${v.getCount})` : '未读取';

        const statusHtml = `
            <div style="display: flex; gap: 4px; margin-top: 6px;">
                <span style="font-size: 10px; padding: 2px 5px; border-radius: 3px; background: ${initBg}; color: ${initColor}; opacity: ${initOpacity}">${initText}</span>
                <span style="font-size: 10px; padding: 2px 5px; border-radius: 3px; background: ${setBg}; color: white; opacity: ${setOpacity}">${setText}</span>
                <span style="font-size: 10px; padding: 2px 5px; border-radius: 3px; background: ${getBg}; color: white; opacity: ${getOpacity}">${getText}</span>
            </div>
        `;

        const occurrences = [];
        Object.entries(v.occurrences).forEach(([type, items]) => {
            items.forEach(occ => {
                occurrences.push({ type, ...occ });
            });
        });

        const occHtml = occurrences.map(o => `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.7; margin-top: 4px; padding: 2px 4px; background: rgba(0,0,0,0.1); border-radius: 4px;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">[${o.type.toUpperCase()}] ${escapeHtml(o.name)}</span>
                <button class="occ-edit-btn interactable" data-entry="${escapeHtml(o.name)}" style="background: none; border: none; color: inherit; cursor: pointer; padding: 2px 5px;"><i class="fa-solid fa-pencil"></i></button>
            </div>
        `).join('');

        const row = $(`
            <div class="check-var-row" style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; border-left: 3px solid ${v.isProblem ? '#ffaa33' : '#55ff55'};">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-size: 13px; font-weight: bold; color: ${v.isProblem ? '#ffaa33' : 'inherit'}">${escapeHtml(v.name)}</div>
                    <button class="var-quick-add-btn interactable" title="在其他条目中增加此变量" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; color: inherit; cursor: pointer; padding: 2px 6px; font-size: 10px;"><i class="fa-solid fa-plus"></i> 注入</button>
                </div>
                ${statusHtml}
                <div class="var-occ-list" style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px;">
                    ${occHtml}
                </div>
                <div class="var-inject-panel" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1);">
                    <input type="text" class="var-inject-search" placeholder="搜索条目名称或内容以注入变量..." style="width: 100%; padding: 4px 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: inherit !important; margin-bottom: 6px;">
                    <div class="var-inject-results" style="max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;"></div>
                </div>
            </div>
        `);

        row.find('.occ-edit-btn').on('click', (e) => {
            const entryName = $(e.currentTarget).data('entry');
            this.openEditor(presetName, entryName);
        });

        row.find('.var-quick-add-btn').on('click', () => {
            const $panel = row.find('.var-inject-panel');
            $panel.slideToggle(200);
            if ($panel.is(':visible')) {
                renderInjectList('');
            }
        });

        const renderInjectList = (filter = '') => {
            const $results = row.find('.var-inject-results');
            $results.empty();
            const lowerFilter = filter.toLowerCase();

            const existingEntries = new Set();
            Object.values(v.occurrences).forEach(list => list.forEach(o => existingEntries.add(o.name)));

            this._lastPrompts.forEach(p => {
                const name = p.name || p.identifier;
                if (existingEntries.has(name)) return;
                if (filter && !name.toLowerCase().includes(lowerFilter) && !(p.content || '').toLowerCase().includes(lowerFilter)) return;

                const item = $(`
                    <div class="inject-entry-item interactable" style="padding: 4px 8px; background: rgba(255,255,255,0.03); border-radius: 4px; cursor: pointer; font-size: 11px; display: flex; justify-content: space-between; align-items: center;">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHtml(name)}</span>
                        <i class="fa-solid fa-pencil" style="opacity: 0.5;"></i>
                    </div>
                `);
                item.on('click', () => this.openEditor(presetName, name));
                $results.append(item);
            });

            if ($results.children().length === 0) {
                $results.html('<div style="text-align: center; opacity: 0.5; font-size: 10px; padding: 10px;">未找到可注入的条目</div>');
            }
        };

        row.find('.var-inject-search').on('input', function () {
            renderInjectList($(this).val());
        });

        return row;
    },

    openEditor(presetName, itemName) {
        // We will call the editor from ext-ui.js
        const event = new CustomEvent('zero-open-editor', {
            detail: { presetName, itemName }
        });
        window.dispatchEvent(event);
    }
};
