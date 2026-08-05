/**
 * Zero Checker Extension
 * Handles XML tag validation and Variable consistency checks for presets.
 */

import { PresetManager, HistoryManager, getStringSimilarity } from '../qr-snapshot/state.js';
import { getPresetPrompts, escapeHtml, savePresetWithoutRegexToast, showVariableRenameModal, showBatchVariableEditModal, showBatchEntryVariableEditModal, showStepByStepReplaceModal } from './utils.js';

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

            // 1. 扫描所有 getvar / getglobalvar 宏（包括嵌套在其他宏内部的读取）
            const getRegex = /\{\{get(?:global)?var::([^{}:\s]+)/gi;
            let match;
            while ((match = getRegex.exec(content)) !== null) {
                const name = match[1].trim();
                if (name) {
                    if (!varMap.has(name)) varMap.set(name, { init: [], set: [], add: [], get: [] });
                    varMap.get(name).get.push({ entry: p, name: entryName });
                }
            }

            // 2. 扫描所有 setvar / setglobalvar 宏（包括包含嵌套值的设置/初始化）
            const setRegex = /\{\{set(?:global)?var::([^{}:\s]+)::/gi;
            while ((match = setRegex.exec(content)) !== null) {
                const name = match[1].trim();
                if (!name) continue;

                const startIndex = match.index + match[0].length;
                let depth = 1;
                let endIndex = startIndex;
                let value = '';

                for (let i = startIndex; i < content.length - 1; i++) {
                    if (content[i] === '{' && content[i + 1] === '{') {
                        depth++;
                        i++;
                    } else if (content[i] === '}' && content[i + 1] === '}') {
                        depth--;
                        if (depth === 0) {
                            endIndex = i;
                            value = content.substring(startIndex, endIndex);
                            break;
                        }
                        i++;
                    }
                }

                if (!varMap.has(name)) varMap.set(name, { init: [], set: [], add: [], get: [] });

                if (depth === 0 && value.trim() === '') {
                    varMap.get(name).init.push({ entry: p, name: entryName });
                } else {
                    varMap.get(name).set.push({ entry: p, name: entryName, value: value.trim() || '...' });
                }
            }

            // 3. 扫描所有 addvar / addglobalvar 宏（累加/追加操作）
            const addRegex = /\{\{add(?:global)?var::([^{}:\s]+)::/gi;
            while ((match = addRegex.exec(content)) !== null) {
                const name = match[1].trim();
                if (!name) continue;

                const startIndex = match.index + match[0].length;
                let depth = 1;
                let endIndex = startIndex;
                let value = '';

                for (let i = startIndex; i < content.length - 1; i++) {
                    if (content[i] === '{' && content[i + 1] === '{') {
                        depth++;
                        i++;
                    } else if (content[i] === '}' && content[i + 1] === '}') {
                        depth--;
                        if (depth === 0) {
                            endIndex = i;
                            value = content.substring(startIndex, endIndex);
                            break;
                        }
                        i++;
                    }
                }

                if (!varMap.has(name)) varMap.set(name, { init: [], set: [], add: [], get: [] });
                varMap.get(name).add.push({ entry: p, name: entryName, value: value.trim() || '...' });
            }
        });

        // Analyze variables
        for (const [name, data] of varMap.entries()) {
            const hasInit = data.init.length > 0;
            const hasSet = data.set.length > 0;
            const hasAdd = data.add.length > 0;
            const hasGet = data.get.length > 0;

            // Check if variable is global
            let isGlobal = false;
            prompts.forEach(p => {
                const c = p.content || '';
                if (c.includes(`setglobalvar::${name}`) || c.includes(`getglobalvar::${name}`) || c.includes(`addglobalvar::${name}`)) {
                    isGlobal = true;
                }
            });

            const treatUninitAsProblem = localStorage.getItem('zero_check_treat_uninit_as_problem') === 'true';
            // Variable lifecycle is setvar -> addvar -> getvar. Must have setvar or init baseline, and getvar.
            const isProblem = (treatUninitAsProblem && !hasInit) || (!hasSet && !hasInit) || !hasGet || data.init.length > 1;

            const varResult = {
                name,
                hasInit,
                hasSet,
                hasAdd,
                hasGet,
                isGlobal,
                initCount: data.init.length,
                setCount: data.set.length,
                addCount: data.add.length,
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
                    existing = { entry: foundEntry, name: entryName, identifier: foundEntry.identifier, errors: [] };
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

    getScrollTop($container) {
        if (!$container || $container.length === 0) return 0;
        const top1 = $container.scrollTop() || 0;
        const top2 = $container.parent() ? ($container.parent().scrollTop() || 0) : 0;
        const top3 = $('#zero-tab-check').length ? ($('#zero-tab-check').scrollTop() || 0) : 0;
        const top4 = $('.zero-panel-body').length ? ($('.zero-panel-body').scrollTop() || 0) : 0;
        return Math.max(top1, top2, top3, top4);
    },

    setScrollTop($container, top) {
        const val = Math.max(0, top || 0);
        requestAnimationFrame(() => {
            if ($container && $container.length) $container.scrollTop(val);
            if ($container && $container.parent().length) $container.parent().scrollTop(val);
            if ($('#zero-tab-check').length) $('#zero-tab-check').scrollTop(val);
            if ($('.zero-panel-body').length) $('.zero-panel-body').scrollTop(val);
        });
    },

    /**
     * Renders the Self-Check tab content.
     */
    async render(containerId, presetName) {
        this.containerId = containerId;
        this.presetName = presetName;
        const $container = $(`#${containerId}`);

        // 记录重新渲染前的当前滚动高度
        const currentSub = $('.zero-check-sub-tab.active').data('sub') || localStorage.getItem('zero_check_last_sub_tab') || 'xml';
        const currentScroll = this.getScrollTop($container);
        if (currentScroll > 0) {
            const scrollMap = JSON.parse(localStorage.getItem('zero_check_scroll_map') || '{}');
            scrollMap[currentSub] = currentScroll;
            localStorage.setItem('zero_check_scroll_map', JSON.stringify(scrollMap));
        }

        if (!presetName) {
            $container.empty().html('<p style="text-align: center; opacity: 0.5; margin-top: 40px;">请选择一个预设进行自查</p>');
            return;
        }

        $container.empty().html('<p style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> 正在自查...</p>');

        try {
            const prompts = await getPresetPrompts(presetName);
            this._lastPrompts = prompts; // Cache for inject feature
            const results = this.performCheck(prompts);

            this.renderResults($container, results, presetName);
        } catch (e) {
            console.error('[Zero] Check failed:', e);
            $container.html('<p style="text-align: center; color: var(--SmartThemeQuoteColor); padding: 20px;">自查失败: ' + e.message + '</p>');
        }
    },

    renderResults($container, results, presetName) {
        $container.empty();

        const xmlCount = results.xml.length;
        const varCount = results.variables.length;

        const summaryHtml = `
            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                <div style="flex: 1; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; text-align: center; border: 1px solid var(--SmartThemeBorderColor);">
                    <div style="font-size: 11px; opacity: 0.6; color: var(--SmartThemeBodyColor);">XML 问题</div>
                    <div id="check-xml-count-val" style="font-size: 18px; font-weight: bold; color: ${xmlCount > 0 ? 'var(--SmartThemeQuoteColor)' : 'var(--SmartThemeBodyColor)'}">${xmlCount}</div>
                </div>
                <div style="flex: 1; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; text-align: center; border: 1px solid var(--SmartThemeBorderColor);">
                    <div style="font-size: 11px; opacity: 0.6; color: var(--SmartThemeBodyColor);">变量问题</div>
                    <div id="check-var-count-val" style="font-size: 18px; font-weight: bold; color: ${varCount > 0 ? 'var(--SmartThemeQuoteColor)' : 'var(--SmartThemeBodyColor)'}">${varCount}</div>
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
                <div style="margin-bottom: 8px;">
                    <div id="toggle-var-settings" style="font-size: 11px; opacity: 0.6; cursor: pointer; padding: 4px 0;"><i class="fa-solid fa-gear"></i> 变量检测与宏设置 <i class="fa-solid fa-chevron-down"></i></div>
                    <div id="var-settings-panel" style="display: none; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-top: 4px; font-size: 11px; flex-direction: column; gap: 6px;">
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
                            <input type="checkbox" id="check-enable-global-vars" class="interactable" style="cursor: pointer;" ${localStorage.getItem('zero_enable_global_vars') === 'true' ? 'checked' : ''}>
                            <span>开启全局变量宏支持 (globalvar: setglobalvar / addglobalvar / getglobalvar)</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none;">
                            <input type="checkbox" id="check-treat-uninit-as-problem" class="interactable" style="cursor: pointer;" ${localStorage.getItem('zero_check_treat_uninit_as_problem') === 'true' ? 'checked' : ''}>
                            <span>未初始化的变量标记为问题</span>
                        </label>
                    </div>
                </div>
                ${localStorage.getItem('zero_hide_var_init_tip') === 'true' ? '' : `
                <div id="check-var-init-tip" style="position: relative; font-size: 11px; line-height: 1.5; padding: 8px 30px 8px 12px; background: rgba(255,255,255,0.04); border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; margin-bottom: 10px; color: var(--SmartThemeBodyColor);">
                    <i class="fa-solid fa-circle-info" style="color: var(--SmartThemeQuoteColor); margin-right: 6px;"></i>
                    <strong>提示：</strong>变量没有初始化（Init）也可以正常使用，但可能会造成<strong>变量内容残留</strong>。例如当你关闭了某个设置变量内容的条目后，因没有初始化条目在最前方执行置空，该变量可能无法被及时清空，后续依然能读取到其残留的旧内容。
                    <i id="close-var-init-tip" class="fa-solid fa-xmark interactable" title="不再提示" style="position: absolute; right: 10px; top: 10px; cursor: pointer; opacity: 0.5; font-size: 12px;"></i>
                </div>
                `}
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; padding: 4px; align-items: center; width: 100%;">
                    <div class="var-filter-btn" data-filter="problem" style="padding: 4px 12px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.05); color: inherit; border: 1px solid var(--SmartThemeBorderColor);">问题变量</div>
                    <div class="var-filter-btn" data-filter="correct" style="padding: 4px 12px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.05); color: inherit; border: 1px solid var(--SmartThemeBorderColor);">正确变量</div>
                    <div class="var-filter-btn" data-filter="all" style="padding: 4px 12px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.05); color: inherit; border: 1px solid var(--SmartThemeBorderColor);">全部变量</div>
                    <button id="check-toggle-batch-var-mode" class="interactable" title="批量管理" style="padding: 4px 10px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.06); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); display: inline-flex; align-items: center; justify-content: center; height: 26px;">
                        <i class="fa-solid fa-list-check"></i>
                    </button>
                    <button id="check-batch-auto-inject-vars" class="interactable" title="一键自动注入所有缺失变量" style="padding: 4px 10px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.06); color: var(--SmartThemeQuoteColor); border: 1px solid var(--SmartThemeBorderColor); display: inline-flex; align-items: center; justify-content: center; height: 26px;">
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                    </button>
                    <button id="check-toggle-log-btn" class="interactable" title="查看/折叠自动化操作日志" style="padding: 4px 10px; font-size: 11px; border-radius: 14px; cursor: pointer; background: rgba(255,255,255,0.06); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); display: inline-flex; align-items: center; justify-content: center; height: 26px;">
                        <i class="fa-solid fa-clock-rotate-left"></i>
                    </button>
                </div>

                <!-- 批量选框操作栏 (默认隐藏) -->
                <div id="check-var-batch-bar" style="display: none; align-items: center; gap: 10px; margin-bottom: 10px; padding: 6px 10px; background: rgba(255,255,255,0.04); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; font-size: 11px;">
                    <label style="display: inline-flex; align-items: center; gap: 4px; cursor: pointer; user-select: none; color: var(--SmartThemeBodyColor);" title="全选/取消全选">
                        <input type="checkbox" id="check-var-select-all" class="interactable" style="cursor: pointer; accent-color: var(--SmartThemeQuoteColor);">
                        <i class="fa-solid fa-check-double"></i>
                    </label>
                    <button id="check-batch-edit-selected-vars" class="interactable" title="批量修改选中条目中引用的变量" style="display: none; padding: 4px 10px; font-size: 11px; border-radius: 14px; cursor: pointer; background: var(--SmartThemeQuoteColor); color: white; border: none; font-weight: bold; align-items: center; gap: 4px; height: 24px;">
                        <i class="fa-solid fa-pen-to-square"></i> (<span id="selected-var-count">0</span>)
                    </button>
                </div>

                <!-- 自动化操作日志面板 -->
                <div id="check-var-log-panel" style="display: none; width: 100%; margin-bottom: 12px; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; font-size: 11px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; opacity: 0.85; font-weight: bold; border-bottom: 1px dashed var(--SmartThemeBorderColor); padding-bottom: 4px; color: var(--SmartThemeBodyColor);">
                        <span><i class="fa-solid fa-clock-rotate-left" style="color: var(--SmartThemeQuoteColor); margin-right: 4px;"></i> 自动化操作日志</span>
                        <button id="clear-var-log-btn" class="interactable" title="清空操作日志" style="background: none; border: none; color: var(--SmartThemeEmColor); cursor: pointer; padding: 2px 6px; font-size: 11px;"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                    <div id="var-log-entries-list" style="max-height: 150px; overflow-y: auto;"></div>
                </div>

                <div id="vars-list-container"></div>
            </div>

            <div id="check-sub-all-entries" class="check-sub-content" style="display: none;">
                <div style="margin-bottom: 10px; display: flex; gap: 8px; align-items: center;">
                    <input type="text" id="check-entry-search" placeholder="搜索条目名称或内容..." style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 6px; font-size: 12px;">
                    <button id="check-toggle-entry-replace-panel" class="interactable" title="批量查找与替换" style="padding: 7px 12px; font-size: 11px; border-radius: 6px; cursor: pointer; background: rgba(255,255,255,0.06); color: var(--SmartThemeBodyColor); border: 1px solid var(--SmartThemeBorderColor); display: flex; align-items: center; gap: 6px; white-space: nowrap; height: 34px;">
                        <i class="fa-solid fa-magnifying-glass-arrow-right"></i> <i class="fa-solid fa-chevron-down"></i>
                    </button>
                </div>

                <!-- 批量查找替换面板 (默认折叠) -->
                <div id="check-entry-replace-panel" style="display: none; padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; margin-bottom: 12px; font-size: 12px;">
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <div style="flex: 1; min-width: 160px;">
                                <label style="font-weight: bold; display: block; margin-bottom: 4px;">查找文本:</label>
                                <input type="text" id="check-replace-search-input" class="interactable" placeholder="要查找的字符/正则..." style="width: 100%; padding: 6px 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                            </div>
                            <div style="flex: 1; min-width: 160px;">
                                <label style="font-weight: bold; display: block; margin-bottom: 4px;">替换为:</label>
                                <input type="text" id="check-replace-target-input" class="interactable" placeholder="替换后的新字符..." style="width: 100%; padding: 6px 10px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                            </div>
                        </div>

                        <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 11px;">
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; user-select: none;">
                                <input type="checkbox" id="check-replace-use-regex" class="interactable" style="cursor: pointer;">
                                <span>使用正则表达式 (Regex)</span>
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; user-select: none;" title="区分大小写">
                                <input type="checkbox" id="check-replace-match-case" class="interactable" style="cursor: pointer;">
                                <span>区分大小写 (Match Case)</span>
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; user-select: none;" title="仅在包含上方搜索框结果的条目中查找替换">
                                <input type="checkbox" id="check-replace-only-search-results" class="interactable" style="cursor: pointer;">
                                <span>仅作用于搜索筛选出的条目</span>
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; user-select: none;" title="仅在下方勾选选中的条目中查找替换">
                                <input type="checkbox" id="check-replace-only-checked-entries" class="interactable" style="cursor: pointer; accent-color: var(--SmartThemeQuoteColor);">
                                <span>仅作用于勾选条目 (<span id="checked-entry-count">0</span>)</span>
                            </label>
                            <label style="cursor: pointer; display: flex; align-items: center; gap: 4px; user-select: none;" title="全选/取消全选当前显示的条目">
                                <input type="checkbox" id="check-entry-select-all" class="interactable" style="cursor: pointer; accent-color: var(--SmartThemeQuoteColor);">
                                <span>全选列表</span>
                            </label>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px;">
                            <button id="check-execute-step-replace" class="interactable" title="逐个确认替换" style="padding: 6px 14px; font-size: 12px; font-weight: bold; border-radius: 6px; cursor: pointer; background: var(--SmartThemeQuoteColor); color: white; border: none; display: inline-flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-rotate"></i>
                            </button>
                            <button id="check-execute-batch-replace" class="interactable" title="全部一键替换" style="padding: 6px 14px; font-size: 12px; border-radius: 6px; cursor: pointer; background: rgba(255,255,255,0.08); color: inherit; border: 1px solid var(--SmartThemeBorderColor); display: inline-flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-bolt"></i>
                            </button>
                        </div>
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

        // Bind Var Settings Panel Events
        $('#toggle-var-settings').on('click', function () {
            const $panel = $('#var-settings-panel');
            $panel.slideToggle(200);
            $(this).find('i.fa-chevron-down, i.fa-chevron-up').toggleClass('fa-chevron-down fa-chevron-up');
        });

        $('#check-enable-global-vars').off('change').on('change', (e) => {
            const val = $(e.target).is(':checked') ? 'true' : 'false';
            localStorage.setItem('zero_enable_global_vars', val);
            window.dispatchEvent(new CustomEvent('zero-global-vars-setting-changed'));
            this.refreshResultsInPlace(presetName);
        });

        $('#check-treat-uninit-as-problem').off('change').on('change', (e) => {
            const val = $(e.target).is(':checked') ? 'true' : 'false';
            localStorage.setItem('zero_check_treat_uninit_as_problem', val);
            this.refreshResultsInPlace(presetName);
        });

        let _isBatchVarMode = false;

        const updateBatchBtnState = () => {
            const count = $('.occ-item-checkbox:checked').length;
            $('#selected-var-count').text(count);
            if (count > 0) {
                $('#check-batch-edit-selected-vars').css('display', 'inline-flex');
            } else {
                $('#check-batch-edit-selected-vars').hide();
            }
        };

        $('body').off('click', '#check-toggle-batch-var-mode').on('click', '#check-toggle-batch-var-mode', function() {
            _isBatchVarMode = !_isBatchVarMode;
            const $btn = $(this);
            const $batchBar = $('#check-var-batch-bar');
            const $checkboxes = $('.occ-item-checkbox');

            if (_isBatchVarMode) {
                $btn.css({
                    background: 'var(--SmartThemeQuoteColor)',
                    color: '#fff',
                    borderColor: 'var(--SmartThemeQuoteColor)'
                });
                $batchBar.css('display', 'flex');
                $checkboxes.show();
            } else {
                $btn.css({
                    background: 'rgba(255,255,255,0.06)',
                    color: 'var(--SmartThemeBodyColor)',
                    borderColor: 'var(--SmartThemeBorderColor)'
                });
                $batchBar.hide();
                $checkboxes.hide().prop('checked', false);
                $('#check-var-select-all').prop('checked', false);
                updateBatchBtnState();
            }
        });

        $('body').off('change', '.occ-item-checkbox').on('change', '.occ-item-checkbox', function() {
            updateBatchBtnState();
        });

        $('body').off('change', '#check-var-select-all').on('change', '#check-var-select-all', function() {
            const checked = $(this).is(':checked');
            $('.occ-item-checkbox').prop('checked', checked);
            updateBatchBtnState();
        });

        $('body').off('click', '#check-batch-edit-selected-vars').on('click', '#check-batch-edit-selected-vars', function() {
            const selected = $('.occ-item-checkbox:checked').map((_, el) => ({
                varName: $(el).attr('data-var') || $(el).data('var'),
                entryName: $(el).attr('data-entry') || $(el).data('entry'),
                macroType: $(el).attr('data-macro-type') || $(el).data('macroType') || ''
            })).get();

            if (selected.length === 0) return;
            const targetPreset = $('#check-preset-select').val();
            showBatchEntryVariableEditModal(selected, targetPreset, () => {
                Checker.refreshResultsInPlace(targetPreset);
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
            this.refreshResultsInPlace(presetName);
        });

        if (results.xml.length === 0) {
            $xmlList.html('<p style="text-align: center; opacity: 0.5; padding: 20px; font-size: 12px;">未发现 XML 标签闭合问题</p>');
        } else {
            results.xml.forEach(issue => {
                const row = $(`
                    <div class="check-issue-row" style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; border-left: 3px solid var(--SmartThemeQuoteColor);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-size: 13px; font-weight: bold;">${escapeHtml(issue.name)}</span>
                            <button class="check-edit-btn interactable" title="修改条目" style="padding: 4px 8px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; font-size: 11px;">
                                <i class="fa-solid fa-pencil"></i>
                            </button>
                        </div>
                        <div style="font-size: 11px; color: var(--SmartThemeEmColor); line-height: 1.4;">
                            ${issue.errors.map(err => `<div>• ${err}</div>`).join('')}
                        </div>
                    </div>
                `);
                row.find('.check-edit-btn').on('click', () => this.openEditor(presetName, issue.name, issue.identifier || issue.entry?.identifier));
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
                    $varBox.append(this.buildVariableRow(v, presetName, results.allVars));
                });
            }
        };

        renderVariables($('.var-filter-btn.active').data('filter') || 'problem');

        $('.var-filter-btn').off('click').on('click', function() {
            $('.var-filter-btn').css('background', 'rgba(255,255,255,0.05)').css('color', 'inherit').css('border-color', 'var(--SmartThemeBorderColor)');
            $(this).css('background', 'var(--SmartThemeQuoteColor)').css('color', 'white').css('border-color', 'var(--SmartThemeQuoteColor)');
            renderVariables($(this).data('filter'));
            localStorage.setItem('zero_check_var_filter', $(this).data('filter'));
        });

        $('#check-batch-auto-inject-vars').off('click').on('click', () => {
            this.batchAutoInjectVars(presetName);
        });

        $('#check-toggle-log-btn').off('click').on('click', () => {
            const $panel = $('#check-var-log-panel');
            $panel.slideToggle(200);
            this.renderLogs();
        });

        $('#clear-var-log-btn').off('click').on('click', () => {
            this.clearLogs();
        });

        const lastVarFilter = localStorage.getItem('zero_check_var_filter') || 'problem';
        $(`.var-filter-btn[data-filter="${lastVarFilter}"]`).trigger('click');

        // --- Render All Entries ---
        const $entryList = $('#check-entry-list');
        const selectedEntryNames = new Set();

        const updateCheckedEntryCount = () => {
            const count = selectedEntryNames.size;
            $('#checked-entry-count').text(count);
            if (count > 0) {
                $('#check-replace-only-checked-entries').prop('checked', true);
            }
        };

        const renderEntries = (filter = '') => {
            $entryList.empty();
            const lowerFilter = filter.toLowerCase();

            results.prompts.forEach((p, idx) => {
                const name = p.name || p.identifier || `Entry ${idx + 1}`;
                const content = p.content || '';

                const nameMatch = name.toLowerCase().includes(lowerFilter);
                const contentMatch = content.toLowerCase().includes(lowerFilter);

                if (filter && !nameMatch && !contentMatch) return;

                const isChecked = selectedEntryNames.has(name);

                const row = $(`
                    <div class="check-entry-row" style="display: flex; flex-direction: column; gap: 4px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 6px; font-size: 13px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <label style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden; margin: 0; cursor: pointer; user-select: none;">
                                <input type="checkbox" class="entry-item-checkbox interactable" data-entry="${escapeHtml(name)}" style="cursor: pointer; accent-color: var(--SmartThemeQuoteColor);" ${isChecked ? 'checked' : ''}>
                                <span style="font-weight: bold; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHtml(name)}</span>
                            </label>
                            <button class="entry-edit-btn interactable" title="修改条目" style="padding: 4px 8px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; font-size: 11px;"><i class="fa-solid fa-pencil"></i></button>
                        </div>
                        ${filter && contentMatch ? `
                            <div style="font-size: 11px; opacity: 0.6; padding: 6px; background: rgba(0,0,0,0.2); border-radius: 4px; border-left: 2px solid var(--SmartThemeQuoteColor);">
                                ...${this.highlightMatch(content, filter)}...
                            </div>
                        ` : ''}
                    </div>
                `);
                row.find('.entry-edit-btn').on('click', () => this.openEditor(presetName, name, p.identifier, idx));
                $entryList.append(row);
            });
        };

        renderEntries();

        $('#check-entry-search').on('input', function () {
            renderEntries($(this).val());
        });

        $('body').off('change', '.entry-item-checkbox').on('change', '.entry-item-checkbox', function() {
            const entryName = $(this).attr('data-entry');
            if (!entryName) return;
            if ($(this).is(':checked')) {
                selectedEntryNames.add(entryName);
            } else {
                selectedEntryNames.delete(entryName);
            }
            updateCheckedEntryCount();
        });

        $('body').off('change', '#check-entry-select-all').on('change', '#check-entry-select-all', function() {
            const isChecked = $(this).is(':checked');
            $('.entry-item-checkbox').each(function() {
                $(this).prop('checked', isChecked);
                const entryName = $(this).attr('data-entry');
                if (entryName) {
                    if (isChecked) selectedEntryNames.add(entryName);
                    else selectedEntryNames.delete(entryName);
                }
            });
            updateCheckedEntryCount();
        });

        $('#check-toggle-entry-replace-panel').off('click').on('click', function () {
            const $panel = $('#check-entry-replace-panel');
            $panel.slideToggle(200);
            $(this).find('i.fa-chevron-down, i.fa-chevron-up').toggleClass('fa-chevron-down fa-chevron-up');
        });

        const collectMatches = ({ searchVal, replaceVal, useRegex, matchCase, onlyFiltered, searchFilter, onlyChecked, targetPresetName }) => {
            const pm = SillyTavern.getContext().getPresetManager('openai');
            if (!pm) throw new Error('无法获取预设管理器');
            const presetObj = pm.getCompletionPresetByName(targetPresetName);
            if (!presetObj || !Array.isArray(presetObj.prompts)) throw new Error('未找到对应预设条目');

            let regex;
            if (useRegex) {
                const flags = matchCase ? 'g' : 'gi';
                regex = new RegExp(searchVal, flags);
            } else {
                const escapeRegExp = str => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const flags = matchCase ? 'g' : 'gi';
                regex = new RegExp(escapeRegExp(searchVal), flags);
            }

            const matches = [];
            presetObj.prompts.forEach(p => {
                if (!p.content) return;
                const entryName = p.name || p.identifier || '';

                if (onlyChecked && selectedEntryNames.size > 0) {
                    if (!selectedEntryNames.has(entryName)) return;
                }

                if (onlyFiltered && searchFilter) {
                    const nameLower = entryName.toLowerCase();
                    const contentLower = p.content.toLowerCase();
                    if (!nameLower.includes(searchFilter) && !contentLower.includes(searchFilter)) return;
                }

                const localFlags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
                const localRegex = new RegExp(regex.source, localFlags);
                let m;
                while ((m = localRegex.exec(p.content)) !== null) {
                    const matchIndex = m.index;
                    const matchText = m[0];
                    const replacementText = matchText.replace(regex, replaceVal);

                    const start = Math.max(0, matchIndex - 30);
                    const end = Math.min(p.content.length, matchIndex + matchText.length + 30);

                    const snippetBefore = (start > 0 ? '...' : '') + p.content.substring(start, matchIndex);
                    const snippetAfter = p.content.substring(matchIndex + matchText.length, end) + (end < p.content.length ? '...' : '');

                    matches.push({
                        entryName: entryName || '未命名条目',
                        promptObj: p,
                        matchIndex,
                        matchText,
                        replacementText,
                        snippetBefore,
                        snippetAfter,
                        doReplace: function() {
                            p.content = p.content.substring(0, this.matchIndex) + replacementText + p.content.substring(this.matchIndex + matchText.length);
                            return replacementText.length - matchText.length;
                        }
                    });
                }
            });

            return { pm, presetObj, matches };
        };

        $('#check-execute-step-replace').off('click').on('click', async () => {
            const searchVal = $('#check-replace-search-input').val();
            const replaceVal = $('#check-replace-target-input').val() || '';
            const useRegex = $('#check-replace-use-regex').is(':checked');
            const matchCase = $('#check-replace-match-case').is(':checked');
            const onlyFiltered = $('#check-replace-only-search-results').is(':checked');
            const onlyChecked = $('#check-replace-only-checked-entries').is(':checked');
            const searchFilter = $('#check-entry-search').val().trim().toLowerCase();

            if (!searchVal) {
                toastr.warning('请输入要查找的文本');
                return;
            }

            try {
                const targetPresetName = $('#check-preset-select').val();
                let result;
                try {
                    result = collectMatches({ searchVal, replaceVal, useRegex, matchCase, onlyFiltered, searchFilter, onlyChecked, targetPresetName });
                } catch (e) {
                    toastr.error('正则表达式语法错误: ' + e.message);
                    return;
                }

                const { pm, presetObj, matches } = result;

                if (matches.length === 0) {
                    toastr.info('未匹配到包含该查找文本的条目内容');
                    return;
                }

                HistoryManager.record();

                showStepByStepReplaceModal({
                    matches,
                    searchVal,
                    replaceVal,
                    presetName: targetPresetName,
                    callback: async ({ replacedCount, skippedCount }) => {
                        if (replacedCount > 0) {
                            const isActive = pm.getSelectedPresetName() === targetPresetName;
                            await savePresetWithoutRegexToast(pm, targetPresetName, presetObj, { skipUpdate: !isActive });

                            toastr.success(`逐个确认替换完成：已替换 ${replacedCount} 处 (跳过 ${skippedCount} 处)`);
                            this.addLog('逐个确认替换', `查找 "${searchVal}" 替换为 "${replaceVal}" (替换 ${replacedCount} 处, 跳过 ${skippedCount} 处)`);

                            await this.refreshResultsInPlace(targetPresetName);
                            window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName: targetPresetName } }));
                        } else {
                            toastr.info('已取消，未作任何替换');
                        }
                    }
                });
            } catch (err) {
                console.error('[Zero] Step replace failed:', err);
                toastr.error('执行失败: ' + err.message);
            }
        });

        $('#check-execute-batch-replace').off('click').on('click', async () => {
            const searchVal = $('#check-replace-search-input').val();
            const replaceVal = $('#check-replace-target-input').val() || '';
            const useRegex = $('#check-replace-use-regex').is(':checked');
            const matchCase = $('#check-replace-match-case').is(':checked');
            const onlyFiltered = $('#check-replace-only-search-results').is(':checked');
            const onlyChecked = $('#check-replace-only-checked-entries').is(':checked');
            const searchFilter = $('#check-entry-search').val().trim().toLowerCase();

            if (!searchVal) {
                toastr.warning('请输入要查找的文本');
                return;
            }

            try {
                const targetPresetName = $('#check-preset-select').val();
                let result;
                try {
                    result = collectMatches({ searchVal, replaceVal, useRegex, matchCase, onlyFiltered, searchFilter, onlyChecked, targetPresetName });
                } catch (e) {
                    toastr.error('正则表达式语法错误: ' + e.message);
                    return;
                }

                const { pm, presetObj, matches } = result;

                if (matches.length === 0) {
                    toastr.info('未匹配到包含该查找文本的条目内容');
                    return;
                }

                HistoryManager.record();

                let modifiedEntriesCount = 0;
                let totalReplacementsCount = matches.length;
                const modifiedPromptsSet = new Set();

                matches.forEach(m => {
                    m.doReplace();
                    modifiedPromptsSet.add(m.promptObj);
                });
                modifiedEntriesCount = modifiedPromptsSet.size;

                if (modifiedEntriesCount > 0) {
                    const isActive = pm.getSelectedPresetName() === targetPresetName;
                    await savePresetWithoutRegexToast(pm, targetPresetName, presetObj, { skipUpdate: !isActive });

                    toastr.success(`批量替换完成：在 ${modifiedEntriesCount} 个条目中共替换了 ${totalReplacementsCount} 处`);
                    this.addLog('批量替换文本', `查找 "${searchVal}" 替换为 "${replaceVal}" (${modifiedEntriesCount} 个条目, ${totalReplacementsCount} 处)`);
                    
                    await this.refreshResultsInPlace(targetPresetName);
                    window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName: targetPresetName } }));
                } else {
                    toastr.info('未匹配到包含该查找文本的条目内容');
                }
            } catch (err) {
                console.error('[Zero] Batch replace failed:', err);
                toastr.error('批量替换失败: ' + err.message);
            }
        });

        const self = this;
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
            const targetScroll = scrollMap[sub] || 0;
            self.setScrollTop($container, targetScroll);
        });

        // Restore last sub-tab
        const lastSub = localStorage.getItem('zero_check_last_sub_tab') || 'xml';
        $(`.zero-check-sub-tab[data-sub="${lastSub}"]`).click();

        // Save scroll position per tab across all possible scrolling containers
        const saveScrollHandler = () => {
            const currentSub = $('.zero-check-sub-tab.active').data('sub');
            if (currentSub) {
                const st = this.getScrollTop($container);
                if (st >= 0) {
                    const scrollMap = JSON.parse(localStorage.getItem('zero_check_scroll_map') || '{}');
                    scrollMap[currentSub] = st;
                    localStorage.setItem('zero_check_scroll_map', JSON.stringify(scrollMap));
                }
            }
        };

        $container.off('scroll.checker').on('scroll.checker', saveScrollHandler);
        if ($container.parent().length) $container.parent().off('scroll.checker').on('scroll.checker', saveScrollHandler);
        if ($('#zero-tab-check').length) $('#zero-tab-check').off('scroll.checker').on('scroll.checker', saveScrollHandler);
        if ($('.zero-panel-body').length) $('.zero-panel-body').off('scroll.checker').on('scroll.checker', saveScrollHandler);
    },

    async refreshResultsInPlace(presetName) {
        try {
            const targetPreset = presetName || this.presetName;
            if (!targetPreset) return;
            const containerId = this.containerId || 'check-results-container';
            const $container = $(`#${containerId}`);
            if (!$container.length) return;

            const prompts = await getPresetPrompts(targetPreset);
            this._lastPrompts = prompts;
            const results = this.performCheck(prompts);

            // 1. Update issue counters in header
            const xmlCount = results.xml.length;
            const varCount = results.variables.length;

            $('#check-xml-count-val').text(xmlCount).css('color', xmlCount > 0 ? 'var(--SmartThemeQuoteColor)' : 'var(--SmartThemeBodyColor)');
            $('#check-var-count-val').text(varCount).css('color', varCount > 0 ? 'var(--SmartThemeQuoteColor)' : 'var(--SmartThemeBodyColor)');

            // 2. Update XML issues list in place
            const $xmlList = $('#xml-issues-list');
            if ($xmlList.length) {
                $xmlList.empty();
                if (results.xml.length === 0) {
                    $xmlList.html('<p style="text-align: center; opacity: 0.5; padding: 20px; font-size: 12px;">未发现 XML 标签闭合问题</p>');
                } else {
                    results.xml.forEach(issue => {
                        const row = $(`
                            <div class="check-issue-row" style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; border-left: 3px solid var(--SmartThemeQuoteColor);">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <span style="font-size: 13px; font-weight: bold;">${escapeHtml(issue.name)}</span>
                                    <button class="check-edit-btn interactable" title="修改条目" style="padding: 4px 8px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: inherit; cursor: pointer; font-size: 11px;">
                                        <i class="fa-solid fa-pencil"></i>
                                    </button>
                                </div>
                                <div style="font-size: 11px; color: var(--SmartThemeEmColor); line-height: 1.4;">
                                    ${issue.errors.map(err => `<div>• ${err}</div>`).join('')}
                                </div>
                            </div>
                        `);
                        row.find('.check-edit-btn').on('click', () => this.openEditor(targetPreset, issue.name));
                        $xmlList.append(row);
                    });
                }
            }

            // 3. Update Variable list in place
            const $varBox = $('#vars-list-container');
            if ($varBox.length) {
                const filter = $('.var-filter-btn.active').data('filter') || localStorage.getItem('zero_check_var_filter') || 'problem';
                $varBox.empty();

                let varsToShow = [];
                if (filter === 'problem') varsToShow = results.variables;
                else if (filter === 'correct') varsToShow = results.allVars.filter(v => !v.isProblem);
                else varsToShow = results.allVars;

                if (varsToShow.length === 0) {
                    $varBox.html(`<p style="text-align: center; opacity: 0.5; padding: 20px; font-size: 12px;">无${filter === 'problem' ? '问题' : (filter === 'correct' ? '正确' : '')}变量</p>`);
                } else {
                    varsToShow.sort((a, b) => a.name.localeCompare(b.name)).forEach(v => {
                        $varBox.append(this.buildVariableRow(v, targetPreset, results.allVars));
                    });
                }
            }

            // 4. Update log list if open
            if ($('#check-var-log-panel').is(':visible')) {
                this.renderLogs();
            }
        } catch (e) {
            console.error('[Zero] refreshResultsInPlace failed:', e);
        }
    },

    getLogs() {
        try {
            return JSON.parse(localStorage.getItem('zero_check_op_logs') || '[]');
        } catch (e) {
            return [];
        }
    },

    addLog(action, details) {
        const logs = this.getLogs();
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        logs.unshift({ time: timeStr, action, details });
        if (logs.length > 50) logs.pop();
        localStorage.setItem('zero_check_op_logs', JSON.stringify(logs));
        this.renderLogs();
    },

    clearLogs() {
        localStorage.setItem('zero_check_op_logs', '[]');
        this.renderLogs();
    },

    renderLogs() {
        const $list = $('#var-log-entries-list');
        if ($list.length === 0) return;
        const logs = this.getLogs();
        if (logs.length === 0) {
            $list.html('<div style="text-align: center; opacity: 0.5; padding: 12px; font-size: 11px;">暂无自动化操作日志记录</div>');
            return;
        }
        const html = logs.map(l => `
            <div style="padding: 4px 6px; border-bottom: 1px dashed rgba(255,255,255,0.05); font-size: 11px; display: flex; gap: 6px; align-items: flex-start; color: var(--SmartThemeBodyColor);">
                <span style="opacity: 0.5; flex-shrink: 0; font-family: monospace;">[${escapeHtml(l.time)}]</span>
                <span style="color: var(--SmartThemeQuoteColor); font-weight: bold; flex-shrink: 0;">[${escapeHtml(l.action)}]</span>
                <span style="opacity: 0.9; flex: 1; word-break: break-all;">${escapeHtml(l.details)}</span>
            </div>
        `).join('');
        $list.html(html);
    },

    buildVariableRow(v, presetName, allVars) {
        const treatUninitAsProblem = localStorage.getItem('zero_check_treat_uninit_as_problem') === 'true';

        const isInitProblem = (treatUninitAsProblem && !v.hasInit) || (v.initCount > 1);
        const initBorder = isInitProblem ? '1px solid var(--SmartThemeQuoteColor)' : '1px solid var(--SmartThemeBorderColor)';
        const initColor = isInitProblem ? 'var(--SmartThemeQuoteColor)' : (v.hasInit ? 'var(--SmartThemeBodyColor)' : 'var(--SmartThemeEmColor)');
        const initText = v.hasInit ? `初始化${v.initCount > 1 ? ` (${v.initCount}!)` : ''}` : '未初始化';

        const isSetProblem = !v.hasSet;
        const setBorder = isSetProblem ? '1px solid var(--SmartThemeQuoteColor)' : '1px solid var(--SmartThemeBorderColor)';
        const setColor = isSetProblem ? 'var(--SmartThemeQuoteColor)' : 'var(--SmartThemeBodyColor)';
        const setText = v.hasSet ? `设置 (${v.setCount})` : (v.hasAdd ? '未基准设置' : '未设置');

        const addBorder = '1px solid var(--SmartThemeBorderColor)';
        const addColor = v.hasAdd ? 'var(--SmartThemeBodyColor)' : 'var(--SmartThemeEmColor)';
        const addText = v.hasAdd ? `累加 (${v.addCount})` : '未累加';

        const isGetProblem = !v.hasGet;
        const getBorder = isGetProblem ? '1px solid var(--SmartThemeQuoteColor)' : '1px solid var(--SmartThemeBorderColor)';
        const getColor = isGetProblem ? 'var(--SmartThemeQuoteColor)' : 'var(--SmartThemeBodyColor)';
        const getText = v.hasGet ? `读取 (${v.getCount})` : '未读取';

        const statusHtml = `
            <div style="display: flex; gap: 4px; margin-top: 6px;">
                <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.06); color: ${initColor}; border: ${initBorder}; font-weight: ${isInitProblem ? 'bold' : 'normal'};">${initText}</span>
                <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.06); color: ${setColor}; border: ${setBorder}; font-weight: ${isSetProblem ? 'bold' : 'normal'};">${setText}</span>
                ${v.hasAdd ? `<span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.06); color: ${addColor}; border: ${addBorder};">${addText}</span>` : ''}
                <span style="font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.06); color: ${getColor}; border: ${getBorder}; font-weight: ${isGetProblem ? 'bold' : 'normal'};">${getText}</span>
            </div>
        `;

        // Typo correction check
        let typoHtml = '';
        if (Array.isArray(allVars)) {
            const threshold = parseFloat(localStorage.getItem('zero_check_var_similarity_threshold') || '0.5');
            let bestCand = null;
            let maxSim = 0;
            allVars.forEach(other => {
                if (other.name !== v.name) {
                    const isGetMismatch = !v.hasSet && v.hasGet && (other.hasSet || other.hasInit);
                    const isSetMismatch = !v.hasGet && (v.hasSet || v.hasInit) && other.hasGet;

                    if (isGetMismatch || isSetMismatch) {
                        const sim = this.calculateSimilarity(v.name, other.name);
                        if (sim > maxSim) {
                            maxSim = sim;
                            bestCand = other;
                        }
                    }
                }
            });

            if (bestCand && maxSim >= threshold) {
                const actionTitle = !v.hasSet ? `可更正为 "${escapeHtml(bestCand.name)}"` : `可能对应读取变量 "${escapeHtml(bestCand.name)}"`;
                typoHtml = `
                    <div style="margin-top: 6px; padding: 6px 8px; background: rgba(255,255,255,0.03); border: 1px solid var(--SmartThemeBorderColor); border-radius: 6px; font-size: 11px; display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                        <span style="color: var(--SmartThemeBodyColor);"><i class="fa-solid fa-lightbulb" style="color: var(--SmartThemeQuoteColor); margin-right: 4px;"></i>疑似拼写关联：${actionTitle} <span style="opacity: 0.6;">(相似度 ${(maxSim * 100).toFixed(0)}%)</span></span>
                        <button class="var-replace-btn interactable" data-from="${escapeHtml(v.name)}" data-to="${escapeHtml(bestCand.name)}" title="按拼写建议一键更正变量名" style="background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: var(--SmartThemeQuoteColor); padding: 4px 8px; font-size: 11px; cursor: pointer;"><i class="fa-solid fa-right-left"></i></button>
                    </div>
                `;
            }
        }

        const occurrences = [];
        if (v.occurrences) {
            Object.entries(v.occurrences).forEach(([type, items]) => {
                if (Array.isArray(items)) {
                    items.forEach(occ => {
                        occurrences.push({ type, ...occ });
                    });
                }
            });
        }

        const isBatchActive = $('#check-var-batch-bar').is(':visible');
        const occHtml = occurrences.map(o => `
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.7; margin-top: 4px; padding: 2px 4px; background: rgba(0,0,0,0.1); border-radius: 4px;">
                <input type="checkbox" class="occ-item-checkbox interactable" data-var="${escapeHtml(v.name)}" data-entry="${escapeHtml(o.name)}" data-macro-type="${escapeHtml(o.type)}" style="display: ${isBatchActive ? 'inline-block' : 'none'}; cursor: pointer; accent-color: var(--SmartThemeQuoteColor); margin-right: 6px;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">[${o.type.toUpperCase()}] ${escapeHtml(o.name)}</span>
                <button class="occ-edit-btn interactable" data-entry="${escapeHtml(o.name)}" data-identifier="${escapeHtml(o.entry?.identifier || '')}" title="修改对应条目" style="background: none; border: none; color: inherit; cursor: pointer; padding: 2px 5px;"><i class="fa-solid fa-pencil"></i></button>
            </div>
        `).join('');

        // Prepare entry recommendations for manual initialization modal
        let recommendedPromptIndex = 0;
        let maxSetVarsCount = -1;
        if (this._lastPrompts) {
            this._lastPrompts.forEach((p, idx) => {
                const count = (p.content || '').split('setvar::').length - 1 + ((p.content || '').split('setglobalvar::').length - 1);
                if (count > maxSetVarsCount) {
                    maxSetVarsCount = count;
                    recommendedPromptIndex = idx;
                }
            });
        }

        const promptOptionsHtml = (this._lastPrompts || []).map((p, idx) => {
            const name = p.name || p.identifier || `Entry ${idx + 1}`;
            const isRec = idx === recommendedPromptIndex;
            return `<option value="${idx}" ${isRec ? 'selected' : ''}>${escapeHtml(name)}${isRec ? ' [推荐]' : ''}</option>`;
        }).join('');

        const row = $(`
            <div class="check-var-row" style="padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 8px; border-left: 3px solid ${v.isProblem ? 'var(--SmartThemeQuoteColor)' : 'var(--SmartThemeBorderColor)'};">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <div style="font-size: 13px; font-weight: bold; color: ${v.isProblem ? 'var(--SmartThemeQuoteColor)' : 'inherit'}">${escapeHtml(v.name)}</div>
                        <button class="var-rename-btn interactable" data-name="${escapeHtml(v.name)}" title="重命名此变量" style="background: none; border: none; color: var(--SmartThemeBodyColor); opacity: 0.6; cursor: pointer; padding: 2px 4px; font-size: 11px;"><i class="fa-solid fa-pen-to-square"></i></button>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        ${v.initCount > 1 ? `
                            <button class="var-clean-init-btn interactable" title="清理冗余初始化，仅保留最早条目中的那一个" style="background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: var(--SmartThemeEmColor); cursor: pointer; padding: 4px 8px; font-size: 11px;"><i class="fa-solid fa-trash-can"></i></button>
                        ` : ''}
                        ${!v.hasInit ? `
                            <button class="var-auto-inject-btn interactable" title="一键智能自动注入此变量初始化" style="background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: var(--SmartThemeQuoteColor); cursor: pointer; padding: 4px 8px; font-size: 11px;"><i class="fa-solid fa-bolt"></i></button>
                        ` : ''}
                        <button class="var-quick-add-btn interactable" title="展开变量注入与手动管理面板" style="background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: var(--SmartThemeBodyColor); cursor: pointer; padding: 4px 8px; font-size: 11px;"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
                ${statusHtml}
                ${typoHtml}
                <div class="var-occ-list" style="margin-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 4px;">
                    ${occHtml}
                </div>
                <div class="var-inject-panel" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(255,255,255,0.1);">
                    ${!v.hasInit ? `
                        <div class="var-manual-init-section" style="margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed rgba(255,255,255,0.08);">
                            <div style="font-size: 11px; opacity: 0.8; margin-bottom: 4px; color: var(--SmartThemeBodyColor);"><i class="fa-solid fa-sliders" style="color: var(--SmartThemeQuoteColor); margin-right: 4px;"></i> 手动指定条目初始化此变量：</div>
                            <div style="display: flex; gap: 6px;">
                                <select class="var-init-prompt-select" style="flex: 1; padding: 4px 6px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: 11px; outline: none;">
                                    ${promptOptionsHtml}
                                </select>
                                <button class="var-init-confirm-btn interactable" title="确认初始化" style="padding: 4px 10px; background: var(--SmartThemeQuoteColor); border: none; border-radius: 4px; color: white; cursor: pointer; font-size: 11px; height: 26px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center;"><i class="fa-solid fa-check"></i></button>
                            </div>
                        </div>
                    ` : ''}
                    <input type="text" class="var-inject-search" placeholder="搜索条目名称或内容以注入变量..." style="width: 100%; padding: 6px; background: rgba(0,0,0,0.2); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: 11px; margin-bottom: 6px;">
                    <div class="var-inject-results" style="max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;"></div>
                </div>
            </div>
        `);

        row.find('.occ-edit-btn').on('click', (e) => {
            const entryName = $(e.currentTarget).attr('data-entry') || $(e.currentTarget).data('entry');
            const identifier = $(e.currentTarget).attr('data-identifier') || $(e.currentTarget).data('identifier');
            this.openEditor(presetName, entryName, identifier);
        });

        // Variable Rename Event Handler
        row.find('.var-rename-btn').on('click', async (e) => {
            e.stopPropagation();
            const oldName = $(e.currentTarget).data('name');
            if (!oldName) return;

            showVariableRenameModal(oldName, presetName, async ({ newName, targetType, count }) => {
                this.addLog('变量更名与变型', `将变量 "${oldName}" 重命名为 "${newName}"${targetType !== 'keep' ? `(语法变更为 ${targetType})` : ''} (在 ${count} 个条目中)`);
                await this.refreshResultsInPlace(presetName);
            });
        });

        // Typo replace event handler
        row.find('.var-replace-btn').on('click', async (e) => {
            const fromName = $(e.currentTarget).data('from');
            const toName = $(e.currentTarget).data('to');
            if (!fromName || !toName) return;

            try {
                const pm = SillyTavern.getContext().getPresetManager('openai');
                if (!pm) {
                    toastr.error('无法获取预设管理器');
                    return;
                }
                const preset = pm.getCompletionPresetByName(presetName);
                if (!preset || !Array.isArray(preset.prompts)) return;

                HistoryManager.record();

                let modifiedCount = 0;
                const regex = new RegExp(`(\\{\\{(?:get|set|add)(?:global)?var::)${this.escapeRegExp(fromName)}(::|\\}\\})`, 'g');
                preset.prompts.forEach(p => {
                    if (!p.content) return;
                    if (p.content.match(regex)) {
                        p.content = p.content.replace(regex, `$1${toName}$2`);
                        modifiedCount++;
                    }
                });

                if (modifiedCount > 0) {
                    const isActive = pm.getSelectedPresetName() === presetName;
                    await savePresetWithoutRegexToast(pm, presetName, preset, { skipUpdate: !isActive });

                    this.addLog('拼写更正', `将变量 "${fromName}" 在 ${modifiedCount} 个条目中更正为 "${toName}"`);
                    toastr.success(`已在 ${modifiedCount} 个条目中将变量 "${fromName}" 修正为 "${toName}"`);

                    await this.refreshResultsInPlace(presetName);
                    window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName } }));
                } else {
                    toastr.info('未找到需要替换的变量');
                }
            } catch (err) {
                console.error('[Zero] Replace var failed:', err);
                toastr.error('替换变量失败: ' + err.message);
            }
        });

        // Clean redundant init event handler
        row.find('.var-clean-init-btn').on('click', async () => {
            try {
                const pm = SillyTavern.getContext().getPresetManager('openai');
                if (!pm) {
                    toastr.error('无法获取预设管理器');
                    return;
                }
                const preset = pm.getCompletionPresetByName(presetName);
                if (!preset || !Array.isArray(preset.prompts)) return;

                HistoryManager.record();

                let keptFirst = false;
                let removedCount = 0;
                const escapedName = this.escapeRegExp(v.name);

                preset.prompts.forEach(p => {
                    if (!p.content) return;
                    const findRegex = new RegExp(`\\{\\{(?:setvar|setglobalvar)::${escapedName}::\\s*\\}\\}`, 'g');

                    p.content = p.content.replace(findRegex, (match) => {
                        if (!keptFirst) {
                            keptFirst = true; // 保留最早发现的那一处初始化
                            return match;
                        } else {
                            removedCount++;
                            return ''; // 清理后续所有冗余初始化
                        }
                    });

                    // 清理移除后留下的空行
                    p.content = p.content.replace(/\n\s*\n\s*\n/g, '\n\n');
                });

                if (removedCount > 0) {
                    const isActive = pm.getSelectedPresetName() === presetName;
                    await savePresetWithoutRegexToast(pm, presetName, preset, { skipUpdate: !isActive });

                    this.addLog('清理冗余', `清理变量 "${v.name}" 的 ${removedCount} 处冗余初始化`);
                    toastr.success(`已清理 ${removedCount} 处冗余初始化`);

                    await this.refreshResultsInPlace(presetName);
                    window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName } }));
                } else {
                    toastr.info('未找到可清理的冗余初始化');
                }
            } catch (e) {
                console.error('[Zero] Clean init failed:', e);
                toastr.error('清理失败: ' + e.message);
            }
        });

        if (!v.hasInit) {
            row.find('.var-auto-inject-btn').on('click', async () => {
                try {
                    const pm = SillyTavern.getContext().getPresetManager('openai');
                    if (!pm) {
                        toastr.error('无法获取预设管理器');
                        return;
                    }
                    const preset = pm.getCompletionPresetByName(presetName);
                    if (!preset || !Array.isArray(preset.prompts)) return;

                    const targetPrompt = this.getRecommendedInitPrompt(preset.prompts);
                    if (!targetPrompt) {
                        toastr.error('无法定位目标条目');
                        return;
                    }

                    HistoryManager.record();

                    const newContent = this.getSmartInsertContent(targetPrompt.content || '', v.name, v.isGlobal, true);
                    targetPrompt.content = newContent;

                    const isActive = pm.getSelectedPresetName() === presetName;
                    await savePresetWithoutRegexToast(pm, presetName, preset, { skipUpdate: !isActive });

                    const targetEntryName = targetPrompt.name || targetPrompt.identifier;
                    this.addLog('单变量自动注入', `为变量 "${v.name}" 在条目「${targetEntryName}」中生成初始化宏`);
                    toastr.success(`已在条目 "${targetEntryName}" 中自动注入初始化`);

                    await this.refreshResultsInPlace(presetName);
                    window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName, itemName: targetEntryName } }));
                } catch (e) {
                    console.error('[Zero] Auto inject single var failed:', e);
                    toastr.error('自动注入失败: ' + e.message);
                }
            });
        }

        row.find('.var-init-confirm-btn').on('click', async () => {
            const promptIdx = parseInt(row.find('.var-init-prompt-select').val());
            if (isNaN(promptIdx) || !this._lastPrompts || !this._lastPrompts[promptIdx]) {
                toastr.error('无效的条目选择');
                return;
            }

            const targetP = this._lastPrompts[promptIdx];
            const targetName = targetP.name || targetP.identifier;

            try {
                const pm = SillyTavern.getContext().getPresetManager('openai');
                if (!pm) {
                    toastr.error('无法获取预设管理器');
                    return;
                }
                const preset = pm.getCompletionPresetByName(presetName);
                if (!preset) return;

                const targetPrompt = preset.prompts.find(p => p.identifier === targetP.identifier);
                if (!targetPrompt) {
                    toastr.error('找不到对应条目');
                    return;
                }

                HistoryManager.record();

                const newContent = this.getSmartInsertContent(targetPrompt.content || '', v.name, v.isGlobal, true);
                targetPrompt.content = newContent;

                const isActive = pm.getSelectedPresetName() === presetName;
                await savePresetWithoutRegexToast(pm, presetName, preset, { skipUpdate: !isActive });

                this.addLog('手动初始化', `在条目「${targetName}」中显式为变量 "${v.name}" 注入初始化宏`);
                toastr.success(`已在 "${targetName}" 中初始化变量 ${v.name}`);

                await this.refreshResultsInPlace(presetName);
                window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName, itemName: targetName } }));
            } catch (e) {
                console.error('[Zero] Init var failed:', e);
                toastr.error('初始化失败: ' + e.message);
            }
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
            if (v.occurrences) {
                Object.values(v.occurrences).forEach(list => {
                    if (Array.isArray(list)) list.forEach(o => existingEntries.add(o.name));
                });
            }

            this._lastPrompts.forEach(p => {
                const name = p.name || p.identifier;
                if (existingEntries.has(name)) return;
                if (filter && !name.toLowerCase().includes(lowerFilter) && !(p.content || '').toLowerCase().includes(lowerFilter)) return;

                const item = $(`
                    <div class="inject-entry-item interactable" style="padding: 6px 8px; background: rgba(255,255,255,0.03); border-radius: 4px; font-size: 11px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 8px;">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${escapeHtml(name)}</span>
                        <div style="display: flex; gap: 4px; flex-shrink: 0;">
                            <button class="inject-read-btn interactable" title="智能注入读取宏 (getvar)" style="padding: 4px 8px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: var(--SmartThemeQuoteColor); cursor: pointer; font-size: 11px; font-weight: bold; min-width: 24px; text-align: center;">G</button>
                            <button class="inject-set-btn interactable" title="智能注入设置宏 (setvar)" style="padding: 4px 8px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: var(--SmartThemeEmColor); cursor: pointer; font-size: 11px; font-weight: bold; min-width: 24px; text-align: center;">S</button>
                            <button class="inject-add-btn interactable" title="智能注入累加宏 (addvar)" style="padding: 4px 8px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: var(--SmartThemeQuoteColor); cursor: pointer; font-size: 11px; font-weight: bold; min-width: 24px; text-align: center;">A</button>
                            <button class="inject-edit-btn interactable" title="打开编辑器手动修改" style="padding: 4px 8px; background: rgba(255,255,255,0.06); border: 1px solid var(--SmartThemeBorderColor); border-radius: 4px; color: var(--SmartThemeBodyColor); cursor: pointer; font-size: 11px;"><i class="fa-solid fa-pencil"></i></button>
                        </div>
                    </div>
                `);

                const doInject = async (actionType) => {
                    try {
                        const pm = SillyTavern.getContext().getPresetManager('openai');
                        if (!pm) {
                            toastr.error('无法获取预设管理器');
                            return;
                        }
                        const preset = pm.getCompletionPresetByName(presetName);
                        if (!preset) return;

                        const targetPrompt = preset.prompts.find(pr => pr.identifier === p.identifier);
                        if (!targetPrompt) {
                            toastr.error('无法定位目标条目');
                            return;
                        }

                        HistoryManager.record();

                        const newContent = this.getSmartInsertContent(targetPrompt.content || '', v.name, v.isGlobal, actionType);
                        targetPrompt.content = newContent;

                        const isActive = pm.getSelectedPresetName() === presetName;
                        await savePresetWithoutRegexToast(pm, presetName, preset, { skipUpdate: !isActive });

                        const actionLabel = actionType === 'set' ? '设置' : (actionType === 'add' ? '累加' : '读取');
                        this.addLog('手动宏注入', `在条目「${name}」中成功注入变量 "${v.name}" 的${actionLabel}宏`);
                        toastr.success(`已在条目 "${name}" 中智能注入${actionLabel}宏`);

                        await this.refreshResultsInPlace(presetName);
                        window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName, itemName: name } }));
                    } catch (e) {
                        console.error('[Zero] Auto inject failed:', e);
                        toastr.error('注入失败: ' + e.message);
                    }
                };

                item.find('.inject-read-btn').on('click', (e) => { e.stopPropagation(); doInject('get'); });
                item.find('.inject-set-btn').on('click', (e) => { e.stopPropagation(); doInject('set'); });
                item.find('.inject-add-btn').on('click', (e) => { e.stopPropagation(); doInject('add'); });
                item.find('.inject-edit-btn').on('click', (e) => { e.stopPropagation(); this.openEditor(presetName, name); });
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

    getRecommendedInitPrompt(prompts) {
        if (!Array.isArray(prompts) || prompts.length === 0) return null;

        let recommended = prompts[0];
        let maxInitCount = -1;

        prompts.forEach((p) => {
            const content = p.content || '';
            const matches = content.match(/\{\{(?:setvar|setglobalvar)::[^:]+::\s*\}\}/g);
            const count = matches ? matches.length : 0;
            if (count > maxInitCount) {
                maxInitCount = count;
                recommended = p;
            }
        });

        return recommended;
    },

    getSmartInsertContent(content, varName, isGlobal, actionType) {
        const isSet = actionType === 'set' || actionType === true;
        const isAdd = actionType === 'add';
        const isGet = actionType === 'get' || actionType === false;
        const isWrite = isSet || isAdd;

        const enableGlobal = localStorage.getItem('zero_enable_global_vars') === 'true';
        const showGlobal = enableGlobal && isGlobal;

        let macroType = 'getvar';
        if (showGlobal) {
            macroType = isSet ? 'setglobalvar' : (isAdd ? 'addglobalvar' : 'getglobalvar');
        } else {
            macroType = isSet ? 'setvar' : (isAdd ? 'addvar' : 'getvar');
        }
            
        const macro = isWrite 
            ? `{{${macroType}::${varName}::}}` 
            : `{{${macroType}::${varName}}}`;
            
        if (isWrite) {
            // 1. 尝试插入到最后一个 setvar/setglobalvar/addvar/addglobalvar 的下一行
            const setRegex = /\{\{(?:setvar|setglobalvar|addvar|addglobalvar)::[^}]+\}\}/g;
            let match;
            let lastMatchEnd = -1;
            while ((match = setRegex.exec(content)) !== null) {
                lastMatchEnd = match.index + match[0].length;
            }
            
            if (lastMatchEnd !== -1) {
                const prefix = content.substring(0, lastMatchEnd);
                const suffix = content.substring(lastMatchEnd);
                const needsNewlineBefore = !prefix.endsWith('\n');
                const needsNewlineAfter = !suffix.startsWith('\n');
                
                return prefix + 
                       (needsNewlineBefore ? '\n' : '') + 
                       macro + 
                       (needsNewlineAfter ? '\n' : '') + 
                       suffix;
            }
            
            // 2. 尝试插入到开头的首个 HTML/XML 标签的内部第一行
            const openTagRegex = /^\s*<([a-zA-Z0-9_-]+)(?:\s+[^>]*)?>/;
            const tagMatch = content.match(openTagRegex);
            if (tagMatch) {
                const insertIndex = tagMatch.index + tagMatch[0].length;
                const prefix = content.substring(0, insertIndex);
                const suffix = content.substring(insertIndex);
                const needsNewlineBefore = !prefix.endsWith('\n');
                const needsNewlineAfter = !suffix.startsWith('\n');
                
                return prefix + 
                       (needsNewlineBefore ? '\n' : '') + 
                       macro + 
                       (needsNewlineAfter ? '\n' : '') + 
                       suffix;
            }
            
            // 3. 回退：直接在条目最开头插入
            return macro + (content ? '\n' + content : '');
        } else {
            // 1. 尝试插入到末尾的闭合标签内部（如 </system> 或 </user>）
            const closeTagRegex = /(<\/([a-zA-Z0-9_-]+)>\s*)$/;
            const tagMatch = content.match(closeTagRegex);
            if (tagMatch) {
                const insertIndex = tagMatch.index;
                const prefix = content.substring(0, insertIndex);
                const suffix = content.substring(insertIndex);
                const needsNewlineBefore = !prefix.endsWith('\n');
                const needsNewlineAfter = !suffix.startsWith('\n');
                
                return prefix + 
                       (needsNewlineBefore ? '\n' : '') + 
                       macro + 
                       (needsNewlineAfter ? '\n' : '') + 
                       suffix;
            }
            
            // 2. 回退：直接追加在最末尾
            const needsNewlineBefore = content && !content.endsWith('\n');
            return content + (needsNewlineBefore ? '\n' : '') + macro;
        }
    },

    async batchAutoInjectVars(presetName) {
        try {
            const pm = SillyTavern.getContext().getPresetManager('openai');
            if (!pm) {
                toastr.error('无法获取预设管理器');
                return;
            }
            const preset = pm.getCompletionPresetByName(presetName);
            if (!preset || !Array.isArray(preset.prompts)) return;

            const checkResults = this.performCheck(preset.prompts);
            const uninitVars = checkResults.allVars.filter(v => !v.hasInit);
            if (uninitVars.length === 0) {
                toastr.info('未发现需要自动注入初始化的变量');
                return;
            }

            const targetPrompt = this.getRecommendedInitPrompt(preset.prompts);
            if (!targetPrompt) {
                toastr.error('未找到有效的目标条目');
                return;
            }

            HistoryManager.record();

            let injectedCount = 0;
            uninitVars.forEach(v => {
                targetPrompt.content = this.getSmartInsertContent(targetPrompt.content || '', v.name, v.isGlobal, true);
                injectedCount++;
            });

            const isActive = pm.getSelectedPresetName() === presetName;
            await savePresetWithoutRegexToast(pm, presetName, preset, { skipUpdate: !isActive });

            const targetEntryName = targetPrompt.name || targetPrompt.identifier;
            this.addLog('批量自动注入', `已为 ${injectedCount} 个缺失变量在条目「${targetEntryName}」中智能生成初始化宏`);
            toastr.success(`已为 ${injectedCount} 个变量在条目「${targetEntryName}」中智能自动注入初始化`);

            await this.refreshResultsInPlace(presetName);
            window.dispatchEvent(new CustomEvent('zero-content-updated', { detail: { presetName, itemName: targetPrompt.name || targetPrompt.identifier } }));
        } catch (e) {
            console.error('[Zero] Batch auto inject failed:', e);
            toastr.error('自动注入失败: ' + e.message);
        }
    },

    calculateSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        if (str1 === str2) return 1.0;

        const sim = getStringSimilarity(str1, str2);

        const s1 = str1.toLowerCase();
        const s2 = str2.toLowerCase();
        const len1 = s1.length;
        const len2 = s2.length;

        const track = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(null));
        for (let i = 0; i <= len1; i += 1) track[0][i] = i;
        for (let j = 0; j <= len2; j += 1) track[j][0] = j;
        for (let j = 1; j <= len2; j += 1) {
            for (let i = 1; i <= len1; i += 1) {
                const indicator = s1[i - 1] === s2[j - 1] ? 0 : 1;
                track[j][i] = Math.min(
                    track[j][i - 1] + 1,
                    track[j - 1][i] + 1,
                    track[j - 1][i - 1] + indicator
                );
            }
        }
        const levDist = track[len2][len1];
        const maxLen = Math.max(len1, len2);
        const levSim = maxLen > 0 ? (maxLen - levDist) / maxLen : 0;

        return Math.max(sim, levSim);
    },

    openEditor(presetName, itemName, identifier, itemIndex) {
        // We will call the editor from ext-ui.js
        const event = new CustomEvent('zero-open-editor', {
            detail: { presetName, itemName, identifier, itemIndex }
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
