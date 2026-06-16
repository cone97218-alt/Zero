/**
 * Zero Checker Extension
 * Handles XML tag validation and Variable consistency checks for presets.
 */

import { PresetManager } from '../qr-snapshot/state.js';
import { getPresetPrompts, escapeHtml } from './utils.js';

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

            // {{setvar::name:: }} or {{setglobalvar::name:: }}
            const initRegex = /\{\{set(?:global)?var::([^:]+)::[ ]*\}\}/g;
            // {{setvar::name::content}} or {{setglobalvar::name::content}}
            const setRegex = /\{\{set(?:global)?var::([^:]+)::([^}]+)\}\}/g;
            // {{getvar::name}} or {{getglobalvar::name}}
            const getRegex = /\{\{get(?:global)?var::([^:]+)\}\}/g;

            let match;
            while ((match = initRegex.exec(content)) !== null) {
                const name = match[1].trim();
                if (!varMap.has(name)) varMap.set(name, { init: [], set: [], get: [] });
                varMap.get(name).init.push({ entry: p, name: entryName });
            }

            // Reset regex or use matchAll
            const setMatches = content.matchAll(/\{\{set(?:global)?var::([^:]+)::([^}]+)\}\}/g);
            for (const m of setMatches) {
                const name = m[1].trim();
                const value = m[2].trim();
                if (value === '') continue; // Already caught by init if it was " "
                if (!varMap.has(name)) varMap.set(name, { init: [], set: [], get: [] });
                varMap.get(name).set.push({ entry: p, name: entryName, value });
            }

            const getMatches = content.matchAll(/\{\{get(?:global)?var::([^:]+)\}\}/g);
            for (const m of getMatches) {
                const name = m[1].trim();
                if (!varMap.has(name)) varMap.set(name, { init: [], set: [], get: [] });
                varMap.get(name).get.push({ entry: p, name: entryName });
            }
        });

        // Analyze variables
        for (const [name, data] of varMap.entries()) {
            const hasInit = data.init.length > 0;
            const hasSet = data.set.length > 0;
            const hasGet = data.get.length > 0;

            const isProblem = !hasInit || !hasSet || !hasGet || data.init.length > 1;

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
                            <input type="text" id="check-xml-exemptions" placeholder="user, char, ..." style="flex: 1; padding: 6px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: 11px;">
                            <button id="save-xml-exemptions" class="interactable" style="padding: 4px 10px; background: var(--SmartThemeQuoteColor); border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 11px;">保存</button>
                        </div>
                    </div>
                </div>
                <div id="xml-issues-list"></div>
            </div>

            <div id="check-sub-vars" class="check-sub-content" style="display: none;">
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; padding: 4px;">
                    <div class="var-filter-btn" data-filter="problem" style="padding: 4px 12px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.05); color: inherit; border: 1px solid rgba(255,255,255,0.1);">问题变量</div>
                    <div class="var-filter-btn" data-filter="correct" style="padding: 4px 12px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.05); color: inherit; border: 1px solid rgba(255,255,255,0.1);">正确变量</div>
                    <div class="var-filter-btn" data-filter="all" style="padding: 4px 12px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.05); color: inherit; border: 1px solid rgba(255,255,255,0.1);">全部变量</div>
                </div>
                <div id="vars-list-container"></div>
            </div>

            <div id="check-sub-all-entries" class="check-sub-content" style="display: none;">
                <div style="margin-bottom: 10px;">
                    <input type="text" id="check-entry-search" placeholder="搜索条目名称或内容..." style="width: 100%; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px;">
                </div>
                <div id="check-entry-list"></div>
            </div>
        `;

        $container.append(summaryHtml);

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

            results.prompts.forEach((p, idx) => {
                const name = p.name || p.identifier || `Entry ${idx + 1}`;
                const content = p.content || '';

                const nameMatch = name.toLowerCase().includes(lowerFilter);
                const contentMatch = content.toLowerCase().includes(lowerFilter);

                if (filter && !nameMatch && !contentMatch) return;

                const row = $(`
                    <div class="check-entry-row" style="display: flex; flex-direction: column; gap: 4px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 6px; font-size: 13px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHtml(name)}</span>
                            <button class="entry-edit-btn interactable" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; color: inherit; cursor: pointer; padding: 4px 8px; font-size: 11px;"><i class="fa-solid fa-pencil"></i> 修改</button>
                        </div>
                        ${filter && contentMatch ? `
                            <div style="font-size: 11px; opacity: 0.6; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px; border-left: 2px solid var(--SmartThemeQuoteColor);">
                                ...${this.highlightMatch(content, filter)}...
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
        const statusHtml = `
            <div style="display: flex; gap: 4px; margin-top: 6px;">
                <span style="font-size: 10px; padding: 2px 5px; border-radius: 3px; background: ${v.hasInit ? '#44aa44' : '#aa4444'}; color: white; opacity: ${v.hasInit ? '1' : '0.5'}">初始化 ${v.initCount > 1 ? `(${v.initCount}!)` : ''}</span>
                <span style="font-size: 10px; padding: 2px 5px; border-radius: 3px; background: ${v.hasSet ? '#44aa44' : '#aa4444'}; color: white; opacity: ${v.hasSet ? '1' : '0.5'}">内容设置 (${v.setCount})</span>
                <span style="font-size: 10px; padding: 2px 5px; border-radius: 3px; background: ${v.hasGet ? '#44aa44' : '#aa4444'}; color: white; opacity: ${v.hasGet ? '1' : '0.5'}">变量读取 (${v.getCount})</span>
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
                    <input type="text" class="var-inject-search" placeholder="搜索条目名称或内容以注入变量..." style="width: 100%; padding: 6px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: 11px; margin-bottom: 6px;">
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
    },

    highlightMatch(text, filter) {
        const idx = text.toLowerCase().indexOf(filter.toLowerCase());
        if (idx === -1) return escapeHtml(text.substring(0, 50));

        const start = Math.max(0, idx - 20);
        const end = Math.min(text.length, idx + filter.length + 30);
        const snippet = text.substring(start, end);

        const escaped = escapeHtml(snippet);
        const regex = new RegExp(`(${this.escapeRegExp(filter)})`, 'gi');
        return escaped.replace(regex, '<span style="color: var(--SmartThemeQuoteColor); font-weight: bold;">$1</span>');
    },

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
};
