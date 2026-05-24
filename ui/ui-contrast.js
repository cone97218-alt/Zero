import { getPresetPrompts, escapeHtml } from './ui-utils.js';
import { openQuickEditor } from './ui-editor.js';
import { GroupManager } from '../qr-state.js';

function getPromptGroupName(presetName, identifier) {
    if (!presetName || !identifier) return '未分组';
    const groups = GroupManager.get(presetName);
    const group = groups.find(g => g.ids.includes(identifier));
    return group ? group.name : '未分组';
}

function hasPromptDifference(pA, pB, nameA, nameB) {
    if (!pA || !pB) return false;
    const contentDiff = (pA.content || '') !== (pB.content || '');
    const nameDiff = (pA.name || '') !== (pB.name || '');
    const roleDiff = (pA.role || 'system') !== (pB.role || 'system');
    const posDiff = (pA.injection_position ?? 0) !== (pB.injection_position ?? 0);
    const depthDiff = (pA.injection_depth ?? 4) !== (pB.injection_depth ?? 4);
    const orderDiff = (pA.injection_order ?? 100) !== (pB.injection_order ?? 100);
    const forbidDiff = (pA.forbid_overrides ?? false) !== (pB.forbid_overrides ?? false);
    
    const groupA = getPromptGroupName(nameA, pA.identifier);
    const groupB = getPromptGroupName(nameB, pB.identifier);
    const groupDiff = groupA !== groupB;
    
    return contentDiff || nameDiff || roleDiff || posDiff || depthDiff || orderDiff || forbidDiff || groupDiff;
}

function getPropValues(p, presetName) {
    if (!p) return {
        name: '--',
        group: '--',
        role: '--',
        position: '--',
        depth: '--',
        order: '--',
        forbid: '--'
    };
    return {
        name: p.name || p.identifier || '未命名',
        group: getPromptGroupName(presetName, p.identifier),
        role: p.role || 'system',
        position: p.injection_position === 1 ? 'Absolute (绝对)' : 'Relative (相对)',
        depth: String(p.injection_depth ?? 4),
        order: String(p.injection_order ?? 100),
        forbid: p.forbid_overrides ? '是' : '否'
    };
}


export async function showManualLinksManager() {
    const nameA = $('#contrast-preset-a').val();
    const nameB = $('#contrast-preset-b').val();
    const links = JSON.parse(localStorage.getItem('zero_manual_links') || '{}');
    const key = `${nameA}::${nameB}`;
    const pairLinks = links[key] || {};
    
    if (Object.keys(pairLinks).length === 0) {
        toastr.info('当前预设组合无手动匹配记录');
        return;
    }

    const promptsA = await getPresetPrompts(nameA);
    const promptsB = await getPresetPrompts(nameB);

    const rows = Object.entries(pairLinks).map(([idA, idB]) => {
        const pA = promptsA.find(p => p.identifier === idA);
        const pB = promptsB.find(p => p.identifier === idB);
        const nameA_str = pA ? (pA.name || pA.identifier) : idA;
        const nameB_str = pB ? (pB.name || pB.identifier) : idB;
        return `
            <div style="display: flex; align-items: center; gap: 10px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px; margin-bottom: 4px; font-size: 12px;">
                <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameA_str}</div>
                <i class="fa-solid fa-arrow-right" style="opacity: 0.3;"></i>
                <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nameB_str}</div>
                <div class="delete-link interactable" data-ida="${idA}" style="cursor: pointer; opacity: 0.5; padding: 4px;"><i class="fa-solid fa-xmark"></i></div>
            </div>
        `;
    }).join('');

    const html = `
        <div id="links-manager-modal" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.85); z-index: 20000; display: flex; align-items: center; justify-content: center; padding: 20px;">
            <div style="background: var(--SmartThemeBlurTintColor); padding: 24px; border-radius: 16px; width: 100%; max-width: 360px; border: 1px solid var(--SmartThemeBorderColor); display: flex; flex-direction: column; max-height: 80vh;">
                <div style="font-weight: bold; margin-bottom: 4px; font-size: 16px;">手动匹配管理</div>
                <div style="font-size: 11px; opacity: 0.6; margin-bottom: 16px;">${nameA} ⟷ ${nameB}</div>
                
                <div style="flex: 1; overflow-y: auto; margin-bottom: 20px; min-height: 100px;">
                    ${rows}
                </div>
                
                <div style="display: flex; gap: 10px;">
                    <button id="clear-all-links" class="interactable" style="flex: 1; padding: 10px; border: none; border-radius: 8px; background: rgba(255,100,100,0.1); color: #ff5555; cursor: pointer; font-size: 13px;">清空全部</button>
                    <button id="close-links-manager" class="interactable" style="flex: 1; padding: 10px; border: none; border-radius: 8px; background: rgba(255,255,255,0.1); color: inherit; cursor: pointer; font-size: 13px;">关闭</button>
                </div>
            </div>
        </div>
    `;

    $('body').append(html);

    $('.delete-link').on('click', function() {
        const idA = $(this).data('ida');
        delete pairLinks[idA];
        if (Object.keys(pairLinks).length === 0) delete links[key];
        else links[key] = pairLinks;
        localStorage.setItem('zero_manual_links', JSON.stringify(links));
        $(this).closest('div').remove();
        if (Object.keys(pairLinks).length === 0) $('#links-manager-modal').remove();
        performAutoMatch();
    });

    $('#clear-all-links').on('click', () => {
        if (confirm('确定清空当前这对预设的所有手动匹配吗？')) {
            delete links[key];
            localStorage.setItem('zero_manual_links', JSON.stringify(links));
            $('#links-manager-modal').remove();
            toastr.success('已清空记录');
            performAutoMatch();
        }
    });

    $('#close-links-manager').on('click', () => $('#links-manager-modal').remove());
}

export async function performAutoMatch() {
    const nameA = $('#contrast-preset-a').val();
    const nameB = $('#contrast-preset-b').val();
    const $list = $('#contrast-list');
    
    if (nameA === nameB && nameA !== '') {
        toastr.info('请选择两个不同的预设进行对比');
        return;
    }
    
    if (!nameA && !nameB) {
        $list.html('<p style="text-align: center; opacity: 0.5; margin-top: 20px;">请至少选择一个预设</p>');
        return;
    }

    $list.html('<p style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> 匹配中...</p>');

    try {
        const promptsA = await getPresetPrompts(nameA);
        const promptsB = await getPresetPrompts(nameB);

        const links = JSON.parse(localStorage.getItem('zero_manual_links') || '{}');
        const keyPair = `${nameA}::${nameB}`;
        const pairLinks = links[keyPair] || {};

        const usedB = new Set();
        const allItems = [];

        const mapBByName = new Map();
        promptsB.forEach(p => {
            const key = (p.name || p.identifier).trim();
            if (!mapBByName.has(key)) mapBByName.set(key, p);
        });

        promptsA.forEach(pA => {
            const idA = pA.identifier;
            let pB = null;
            let type = '';

            if (pairLinks[idA]) {
                const idB = pairLinks[idA];
                pB = promptsB.find(p => p.identifier === idB);
                if (pB) type = 'manual';
            }

            if (!pB) {
                const key = (pA.name || pA.identifier).trim();
                if (mapBByName.has(key)) {
                    pB = mapBByName.get(key);
                    type = 'matched';
                }
            }

            if (pB) {
                usedB.add(pB.identifier);
                mapBByName.delete((pB.name || pB.identifier).trim());
                allItems.push({ idA: pA.identifier, idB: pB.identifier, name: (pA.name || pA.identifier), type: type, a: pA, b: pB });
            } else {
                allItems.push({ idA: pA.identifier, idB: null, name: (pA.name || pA.identifier), type: 'onlyA', a: pA, b: null });
            }
        });

        promptsB.forEach(pB => {
            if (!usedB.has(pB.identifier)) {
                allItems.push({ idA: null, idB: pB.identifier, name: (pB.name || pB.identifier), type: 'onlyB', a: null, b: pB });
            }
        });

        const matched = allItems.filter(i => i.type === 'matched');
        const manualMatched = allItems.filter(i => i.type === 'manual');
        const onlyA = allItems.filter(i => i.type === 'onlyA');
        const onlyB = allItems.filter(i => i.type === 'onlyB');

        const orderedItems = [...matched, ...manualMatched, ...onlyA, ...onlyB];
        window.zero_contrast_allItems = orderedItems;

        renderMatchResults(matched, onlyA, onlyB, orderedItems, manualMatched);
    } catch (e) {
        console.error('[Zero] Auto match failed:', e);
        $list.html('<p style="text-align: center; color: var(--SmartThemeShadowColor);">加载失败，请重试</p>');
    }
}

export function renderMatchResults(matched, onlyA, onlyB, allItems, manualMatched = []) {
    const $list = $('#contrast-list');
    $list.empty();

    const subNavHtml = `
        <div class="zero-sub-tabs" style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
            <div class="zero-sub-tab active" data-sub="matched" style="flex: 1; min-width: 70px; padding: 6px; font-size: 11px; text-align: center; background: rgba(255,255,255,0.1); border-radius: 4px; cursor: pointer;">匹配项目 (${matched.length})</div>
            <div class="zero-sub-tab" data-sub="manual" style="flex: 1; min-width: 70px; padding: 6px; font-size: 11px; text-align: center; background: rgba(255,255,255,0.05); border-radius: 4px; cursor: pointer;">关联项目 (${manualMatched.length})</div>
            <div class="zero-sub-tab" data-sub="onlyA" style="flex: 1; min-width: 70px; padding: 6px; font-size: 11px; text-align: center; background: rgba(255,255,255,0.05); border-radius: 4px; cursor: pointer;">仅 A 有 (${onlyA.length})</div>
            <div class="zero-sub-tab" data-sub="onlyB" style="flex: 1; min-width: 70px; padding: 6px; font-size: 11px; text-align: center; background: rgba(255,255,255,0.05); border-radius: 4px; cursor: pointer;">仅 B 有 (${onlyB.length})</div>
        </div>
        <div id="sub-content-matched" class="zero-sub-content"></div>
        <div id="sub-content-manual" class="zero-sub-content" style="display: none;"></div>
        <div id="sub-content-onlyA" class="zero-sub-content" style="display: none;"></div>
        <div id="sub-content-onlyB" class="zero-sub-content" style="display: none;"></div>
    `;
    $list.append(subNavHtml);

    const buildRow = (item) => {
        const name = item.name;
        const type = item.type;
        let status = '';
        let color = '';
        let actions = '';
        
        if (type === 'matched' || type === 'manual') {
            const nameA = $('#contrast-preset-a').val();
            const nameB = $('#contrast-preset-b').val();
            const hasChange = hasPromptDifference(item.a, item.b, nameA, nameB);
            status = hasChange ? '已修改' : '无变动';
            color = hasChange ? 'var(--SmartThemeQuoteColor)' : 'inherit';
            if (type === 'manual') {
                actions = `<button class="zero-icon-btn unlink-trigger" data-ida="${item.idA}" title="取消关联" style="font-size: 12px; opacity: 0.6; padding: 4px; background: none; border: none; color: inherit; cursor: pointer;"><i class="fa-solid fa-link-slash"></i></button>`;
            }
        } else if (type === 'onlyA') {
            status = '仅 A 有';
            color = 'var(--SmartThemeShadowColor)';
        } else if (type === 'onlyB') {
            status = '仅 B 有';
            color = 'var(--SmartThemeQuoteColor)';
        }

        return `
            <div class="contrast-row interactable" data-index="${allItems.indexOf(item)}" data-type="${type}" style="
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 12px;
                background: rgba(255,255,255,0.03);
                border-radius: 6px;
                font-size: 13px;
                cursor: pointer;
                margin-bottom: 4px;
            ">
                <input type="checkbox" checked style="flex-shrink: 0;" onclick="event.stopPropagation()">
                <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(name)}</div>
                <div style="font-size: 11px; color: ${color}; opacity: 0.8;">${status}</div>
                ${actions}
            </div>
        `;
    };

    matched.forEach(m => $('#sub-content-matched').append(buildRow(m)));
    manualMatched.forEach(m => $('#sub-content-manual').append(buildRow(m)));
    onlyA.forEach(a => $('#sub-content-onlyA').append(buildRow(a)));
    onlyB.forEach(b => $('#sub-content-onlyB').append(buildRow(b)));

    if (matched.length === 0) $('#sub-content-matched').html('<div style="text-align:center; padding:20px; opacity:0.5; font-size:12px;">无自动匹配项</div>');
    if (manualMatched.length === 0) $('#sub-content-manual').html('<div style="text-align:center; padding:20px; opacity:0.5; font-size:12px;">无手动关联项</div>');

    $list.off('click', '.contrast-row').on('click', '.contrast-row', function(e) {
        const $unlinkBtn = $(e.target).closest('.unlink-trigger');
        if ($unlinkBtn.length) {
            e.stopPropagation();
            const idA = $unlinkBtn.data('ida');
            const nameA = $('#contrast-preset-a').val();
            const nameB = $('#contrast-preset-b').val();
            const links = JSON.parse(localStorage.getItem('zero_manual_links') || '{}');
            const key = `${nameA}::${nameB}`;
            if (links[key]) {
                delete links[key][idA];
                if (Object.keys(links[key]).length === 0) delete links[key];
                localStorage.setItem('zero_manual_links', JSON.stringify(links));
                performAutoMatch();
                toastr.success('已取消关联');
            }
            return;
        }

        showComparisonDetail(parseInt($(this).data('index')), window.zero_contrast_allItems);
    });

    $('.zero-sub-tab').on('click', function() {
        const sub = $(this).data('sub');
        localStorage.setItem('zero_last_sub_tab', sub);
        $('.zero-sub-tab').removeClass('active').css('background', 'rgba(255,255,255,0.05)');
        $(this).addClass('active').css('background', 'rgba(255,255,255,0.1)');
        $('.zero-sub-content').hide();
        $(`#sub-content-${sub}`).show();
    });

    const lastSub = localStorage.getItem('zero_last_sub_tab') || 'matched';
    const $targetSub = $(`.zero-sub-tab[data-sub="${lastSub}"]`);
    if ($targetSub.length) {
        $targetSub.click();
    } else {
        $('.zero-sub-tab[data-sub="matched"]').click();
    }
}

export async function startComparison() {
    const selectedItems = $('.contrast-row').filter(function() {
        return $(this).find('input[type="checkbox"]').is(':checked');
    }).map(function() { 
        return { index: parseInt($(this).data('index')) }; 
    }).get();

    if (selectedItems.length === 0) {
        toastr.info('请选择要对比的条目');
        return;
    }

    showComparisonDetail(selectedItems[0].index, window.zero_contrast_allItems);
}

let activeRefresh = null;

export async function showComparisonDetail(index, allItems) {
    if (activeRefresh) {
        window.removeEventListener('zero-content-updated', activeRefresh);
        activeRefresh = null;
    }

    if (!allItems || index < 0 || index >= allItems.length) {
        console.error('[Zero] Invalid comparison index:', index);
        return;
    }
    const item = allItems[index];
    let currentIdA = item.idA || null;
    let currentIdB = item.idB || null;

    const nameA = $('#contrast-preset-a').val();
    const nameB = $('#contrast-preset-b').val();
    
    let promptsA = await getPresetPrompts(nameA);
    let promptsB = await getPresetPrompts(nameB);

    activeRefresh = async (e) => {
        promptsA = await getPresetPrompts(nameA);
        promptsB = await getPresetPrompts(nameB);
        renderDetailContent();
    };
    window.addEventListener('zero-content-updated', activeRefresh);

    function getLink(idA) {
        const links = JSON.parse(localStorage.getItem('zero_manual_links') || '{}');
        const key = `${nameA}::${nameB}`;
        return links[key] ? links[key][idA] : null;
    }

    function isLinked(idA, idB) {
        if (!idA || !idB) return false;
        if (getLink(idA) === idB) return true;
        const pA = promptsA.find(p => p.identifier === idA);
        const pB = promptsB.find(p => p.identifier === idB);
        if (pA && pB && (pA.name || pA.identifier) === (pB.name || pB.identifier)) return true;
        return false;
    }

    const optionsA_html = `<option value="">-- 无 --</option>` + promptsA.map(p => `<option value="${p.identifier}">${escapeHtml(p.name || p.identifier)}</option>`).join('');
    const optionsB_html = `<option value="">-- 无 --</option>` + promptsB.map(p => `<option value="${p.identifier}">${escapeHtml(p.name || p.identifier)}</option>`).join('');

    const diffHtml = (textTarget, textSource) => {
        if (!textTarget) return '';
        if (!textSource) return escapeHtml(textTarget);
        
        const linesT = textTarget.split('\n');
        const linesS = new Set(textSource.split('\n'));
        let html = '';
        
        for (let i = 0; i < linesT.length; i++) {
            const line = linesT[i];
            const isDifferent = !linesS.has(line);
            if (isDifferent) {
                html += `<div style="color: #ff5555;">${escapeHtml(line)}</div>`;
            } else {
                html += `<div>${escapeHtml(line)}</div>`;
            }
        }
        return html;
    };

    const detailHtml = `
        <div id="comparison-overlay" style="
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: var(--SmartThemeBlurTintColor, #171717);
            z-index: 10000; display: flex; flex-direction: column;
            padding-top: env(safe-area-inset-top);
        ">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid var(--SmartThemeBorderColor);">
                <div style="display: flex; align-items: center; flex: 1; min-width: 0; gap: 8px;">
                    <select id="comp-item-selector-a" class="interactable" style="flex: 1; min-width: 0; padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: 14px;">
                        ${optionsA_html}
                    </select>
                    <button id="comp-link-btn" class="interactable" title="关联" style="flex-shrink: 0; padding: 6px; background: none; border: none; color: inherit; cursor: pointer; opacity: 0.5; font-size: 16px;">
                        <i class="fa-solid fa-link-slash"></i>
                    </button>
                    <select id="comp-item-selector-b" class="interactable" style="flex: 1; min-width: 0; padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid var(--SmartThemeBorderColor); color: inherit; border-radius: 4px; font-size: 14px;">
                        ${optionsB_html}
                    </select>
                </div>
                <div id="close-comparison" class="interactable" style="cursor: pointer; padding: 8px; margin-left: 8px;"><i class="fa-solid fa-xmark"></i></div>
            </div>
            
            <div id="comp-content-area" style="flex: 1; overflow-y: auto; overflow-x: hidden; padding: 12px; display: flex; flex-direction: column;">
            </div>
            
            <div style="padding: 12px; border-top: 1px solid var(--SmartThemeBorderColor); display: flex; gap: 10px; background: rgba(0,0,0,0.1);">
                <button id="prev-comp" class="interactable" style="flex: 1; padding: 12px; border: none; border-radius: 6px; background: rgba(255,255,255,0.08); color: inherit;" ${index <= 0 ? 'disabled style="opacity:0.3"' : ''}><i class="fa-solid fa-chevron-left"></i> 上一个</button>
                <button id="next-comp" class="interactable" style="flex: 1; padding: 12px; border: none; border-radius: 6px; background: rgba(255,255,255,0.08); color: inherit;" ${index >= allItems.length - 1 ? 'disabled style="opacity:0.3"' : ''}>下一个 <i class="fa-solid fa-chevron-right"></i></button>
            </div>
        </div>
    `;

    $('#comparison-overlay').remove(); 
    $('body').append(detailHtml);

    function renderDetailContent() {
        try {
            const findById = (list, id) => list.find(p => String(p.identifier) === String(id) || (!p.identifier && !id) || (p.identifier === id));
            
            const pA = findById(promptsA, currentIdA);
            const pB = findById(promptsB, currentIdB);
            const linked = isLinked(currentIdA, currentIdB);

            $('#comp-item-selector-a').val(currentIdA || '');
            $('#comp-item-selector-b').val(currentIdB || '');

            const $linkBtn = $('#comp-link-btn');
            $linkBtn.find('i').removeClass('fa-link fa-link-slash').addClass(linked ? 'fa-link' : 'fa-link-slash');
            $linkBtn.css('color', linked ? 'var(--SmartThemeQuoteColor)' : 'inherit');
            $linkBtn.css('opacity', linked ? '1' : '0.5');
            $linkBtn.attr('title', linked ? '取消关联' : '建立关联');

            const isMatched = pA && pB;
            let contentHtml = '';

            if (pA || pB) {
                const propsA = getPropValues(pA, nameA);
                const propsB = getPropValues(pB, nameB);

                const isNameDiff = pA && pB && (propsA.name !== propsB.name);
                const isGroupDiff = pA && pB && (propsA.group !== propsB.group);
                const isRoleDiff = pA && pB && (propsA.role !== propsB.role);
                const isPosDiff = pA && pB && (propsA.position !== propsB.position);
                const isDepthDiff = pA && pB && (propsA.depth !== propsB.depth);
                const isOrderDiff = pA && pB && (propsA.order !== propsB.order);
                const isForbidDiff = pA && pB && (propsA.forbid !== propsB.forbid);

                const rowStyle = (isDiff) => isDiff ? 'background: rgba(255, 100, 100, 0.08);' : 'border-bottom: 1px solid rgba(255,255,255,0.02);';
                const cellStyle = (isDiff) => isDiff ? 'color: var(--SmartThemeQuoteColor, #ff5555); font-weight: bold;' : '';
                
                const hasOtherDiff = pA && pB && (isRoleDiff || isPosDiff || isDepthDiff || isOrderDiff || isForbidDiff);
                const headerColor = hasOtherDiff ? 'color: var(--SmartThemeQuoteColor, #ff5555); font-weight: bold;' : 'color: var(--SmartThemeBodyColor);';

                contentHtml += `
                    <!-- Collapsible Bar Header -->
                    <div id="toggle-comp-params" class="interactable" style="cursor: pointer; padding: 6px 12px; background: rgba(255,255,255,0.03); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; font-size: 12px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; user-select: none; ${headerColor} flex-shrink: 0;">
                        <span><i class="fa-solid fa-sliders" style="margin-right: 6px;"></i> 属性对比</span>
                        <i class="chevron fa-solid fa-chevron-right" style="transition: transform 0.2s ease;"></i>
                    </div>

                    <!-- Collapsible Bar Content -->
                    <div id="comp-params-container" style="display: none; background: rgba(255,255,255,0.01); border: 1px solid var(--SmartThemeBorderColor); border-radius: 8px; padding: 10px; margin-bottom: 16px; flex-shrink: 0; font-family: var(--mainFontFamily, sans-serif);">
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <!-- Header -->
                            <div style="display: flex; align-items: center; padding: 6px 8px; font-weight: bold; opacity: 0.6; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.08); color: var(--SmartThemeBodyColor);">
                                <div style="width: 100px; flex-shrink: 0;">属性</div>
                                <div style="flex: 1; min-width: 0; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">预设 A: ${escapeHtml(nameA)}</div>
                                <div style="flex: 1; min-width: 0; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; margin-left: 10px;">预设 B: ${escapeHtml(nameB)}</div>
                            </div>
                            
                            <!-- Name Row -->
                            <div style="display: flex; align-items: center; padding: 6px 8px; ${rowStyle(isNameDiff)}">
                                <div style="width: 100px; flex-shrink: 0; font-size: 12px; opacity: 0.7; color: var(--SmartThemeBodyColor);">条目名称</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isNameDiff)}" title="${escapeHtml(propsA.name)}">${escapeHtml(propsA.name)}</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 10px; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isNameDiff)}" title="${escapeHtml(propsB.name)}">${escapeHtml(propsB.name)}</div>
                            </div>

                            <!-- Group Row -->
                            <div style="display: flex; align-items: center; padding: 6px 8px; ${rowStyle(isGroupDiff)}">
                                <div style="width: 100px; flex-shrink: 0; font-size: 12px; opacity: 0.7; color: var(--SmartThemeBodyColor);">所属分组</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isGroupDiff)}" title="${escapeHtml(propsA.group)}">${escapeHtml(propsA.group)}</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 10px; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isGroupDiff)}" title="${escapeHtml(propsB.group)}">${escapeHtml(propsB.group)}</div>
                            </div>

                            <!-- Role Row -->
                            <div style="display: flex; align-items: center; padding: 6px 8px; ${rowStyle(isRoleDiff)}">
                                <div style="width: 100px; flex-shrink: 0; font-size: 12px; opacity: 0.7; color: var(--SmartThemeBodyColor);">身份角色</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isRoleDiff)}" title="${escapeHtml(propsA.role)}">${escapeHtml(propsA.role)}</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 10px; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isRoleDiff)}" title="${escapeHtml(propsB.role)}">${escapeHtml(propsB.role)}</div>
                            </div>

                            <!-- Position Row -->
                            <div style="display: flex; align-items: center; padding: 6px 8px; ${rowStyle(isPosDiff)}">
                                <div style="width: 100px; flex-shrink: 0; font-size: 12px; opacity: 0.7; color: var(--SmartThemeBodyColor);">插入位置</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isPosDiff)}" title="${escapeHtml(propsA.position)}">${escapeHtml(propsA.position)}</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 10px; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isPosDiff)}" title="${escapeHtml(propsB.position)}">${escapeHtml(propsB.position)}</div>
                            </div>

                            <!-- Depth Row -->
                            <div style="display: flex; align-items: center; padding: 6px 8px; ${rowStyle(isDepthDiff)}">
                                <div style="width: 100px; flex-shrink: 0; font-size: 12px; opacity: 0.7; color: var(--SmartThemeBodyColor);">插入深度</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isDepthDiff)}" title="${escapeHtml(propsA.depth)}">${escapeHtml(propsA.depth)}</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 10px; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isDepthDiff)}" title="${escapeHtml(propsB.depth)}">${escapeHtml(propsB.depth)}</div>
                            </div>

                            <!-- Order Row -->
                            <div style="display: flex; align-items: center; padding: 6px 8px; ${rowStyle(isOrderDiff)}">
                                <div style="width: 100px; flex-shrink: 0; font-size: 12px; opacity: 0.7; color: var(--SmartThemeBodyColor);">插入顺序</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isOrderDiff)}" title="${escapeHtml(propsA.order)}">${escapeHtml(propsA.order)}</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 10px; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isOrderDiff)}" title="${escapeHtml(propsB.order)}">${escapeHtml(propsB.order)}</div>
                            </div>

                            <!-- Forbid Overrides Row -->
                            <div style="display: flex; align-items: center; padding: 6px 8px; ${rowStyle(isForbidDiff)}">
                                <div style="width: 100px; flex-shrink: 0; font-size: 12px; opacity: 0.7; color: var(--SmartThemeBodyColor);">禁止覆盖</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isForbidDiff)}" title="${escapeHtml(propsA.forbid)}">${escapeHtml(propsA.forbid)}</div>
                                <div style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-left: 10px; font-size: 12px; color: var(--SmartThemeBodyColor); ${cellStyle(isForbidDiff)}" title="${escapeHtml(propsB.forbid)}">${escapeHtml(propsB.forbid)}</div>
                            </div>
                        </div>
                    </div>
                `;
            }

            if (pA) {
                const nameStr = escapeHtml(pA.name || pA.identifier || '未命名');
                contentHtml += `
                    <div class="comp-box" style="display: flex; flex-direction: column; flex-shrink: 0;">
                        <div style="font-size: 11px; opacity: 0.5; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                            <span>${isMatched ? `源预设 (A): ${nameA}` : `预设 A 独有`}</span>
                             <div style="display: flex; gap: 8px;">
                                ${isMatched ? `<button class="zero-overwrite-btn interactable" data-direction="b-to-a" title="用 B 覆盖 A" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; padding: 4px 8px; color: inherit; cursor: pointer;"><i class="fa-solid fa-file-import"></i></button>` : ''}
                                ${typeof window.translate === 'function' && pA.content ? `<button class="zero-trans-btn interactable" data-target="a" data-original="${escapeHtml(pA.content)}" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; padding: 4px 8px; color: inherit; cursor: pointer;" title="翻译内容"><i class="fa-solid fa-language"></i></button>` : ''}
                                <button class="zero-edit-btn interactable" data-preset="${nameA}" data-item="${nameStr}" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; padding: 4px 8px; color: inherit; cursor: pointer;" title="修改"><i class="fa-solid fa-pencil"></i></button>
                                <button class="zero-copy-btn interactable" data-text="${escapeHtml(pA.content)}" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; padding: 4px 8px; color: inherit; cursor: pointer;" title="复制"><i class="fa-solid fa-copy"></i></button>
                            </div>
                        </div>
                        <div id="comp-text-a" style="overflow-x: hidden; word-break: break-word; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; font-family: monospace;">
                            ${isMatched ? diffHtml(pA.content || '', pB ? pB.content : '') : escapeHtml(pA.content || '(空)')}
                        </div>
                    </div>`;
            }
            if (pB) {
                const nameStr = escapeHtml(pB.name || pB.identifier || '未命名');
                contentHtml += `
                    <div class="comp-box" style="display: flex; flex-direction: column; flex-shrink: 0; margin-top: 16px;">
                        <div style="font-size: 11px; opacity: 0.5; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                            <span>目标预设 (B): ${nameB}</span>
                             <div style="display: flex; gap: 8px;">
                                ${isMatched ? `<button class="zero-overwrite-btn interactable" data-direction="a-to-b" title="用 A 覆盖 B" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; padding: 4px 8px; color: inherit; cursor: pointer;"><i class="fa-solid fa-file-import"></i></button>` : ''}
                                ${typeof window.translate === 'function' && pB.content ? `<button class="zero-trans-btn interactable" data-target="b" data-original="${escapeHtml(pB.content)}" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; padding: 4px 8px; color: inherit; cursor: pointer;" title="翻译内容"><i class="fa-solid fa-language"></i></button>` : ''}
                                <button class="zero-edit-btn interactable" data-preset="${nameB}" data-item="${nameStr}" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; padding: 4px 8px; color: inherit; cursor: pointer;" title="修改"><i class="fa-solid fa-pencil"></i></button>
                                <button class="zero-copy-btn interactable" data-text="${escapeHtml(pB.content)}" style="background: rgba(255,255,255,0.1); border: none; border-radius: 4px; padding: 4px 8px; color: inherit; cursor: pointer;" title="复制"><i class="fa-solid fa-copy"></i></button>
                            </div>
                        </div>
                        <div id="comp-text-b" style="overflow-x: hidden; word-break: break-word; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; font-family: monospace;">
                            ${isMatched ? diffHtml(pB.content || '', pA ? pA.content : '') : escapeHtml(pB.content || '(空)')}
                        </div>
                    </div>`;
            }
            if (!pA && !pB) {
                contentHtml = '<div style="text-align: center; opacity: 0.5; padding: 40px;">未选择或未找到有效条目</div>';
            }
            $('#comp-content-area').html(contentHtml);
        } catch (err) {
            console.error('[Zero] renderDetailContent failed:', err);
            $('#comp-content-area').html(`<div style="padding: 20px; color: #ff5555;">渲染失败: ${err.message}</div>`);
        }
    }

    renderDetailContent();

    $('#close-comparison').on('click', () => {
        if (activeRefresh) {
            window.removeEventListener('zero-content-updated', activeRefresh);
            activeRefresh = null;
        }
        $('#comparison-overlay').remove();
        performAutoMatch();
    });

    $('#comparison-overlay').on('click', '#toggle-comp-params', function() {
        const $container = $('#comp-params-container');
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

    $('#comp-item-selector-a').on('change', function() {
        const val = $(this).val();
        currentIdA = val || null;
        
        let linkedBId = null;
        if (currentIdA) {
            const manualLink = getLink(currentIdA);
            if (manualLink) {
                linkedBId = manualLink;
            } else {
                const pA = promptsA.find(p => p.identifier === currentIdA);
                if (pA) {
                    const pB = promptsB.find(p => (p.name || p.identifier) === (pA.name || pA.identifier));
                    if (pB && !getLink(currentIdA)) linkedBId = pB.identifier;
                }
            }
            if (linkedBId) currentIdB = linkedBId;
        }
        renderDetailContent();
    });

    $('#comp-item-selector-b').on('change', function() {
        const val = $(this).val();
        currentIdB = val || null;
        
        let linkedAId = null;
        if (currentIdB) {
            const links = JSON.parse(localStorage.getItem('zero_manual_links') || '{}');
            const key = `${nameA}::${nameB}`;
            const pairLinks = links[key] || {};
            for (const [aId, bId] of Object.entries(pairLinks)) {
                if (bId === currentIdB) {
                    linkedAId = aId;
                    break;
                }
            }
            if (!linkedAId) {
                const pB = promptsB.find(p => p.identifier === currentIdB);
                if (pB) {
                    const pA = promptsA.find(p => (p.name || p.identifier) === (pB.name || pB.identifier));
                    if (pA) linkedAId = pA.identifier;
                }
            }
            if (linkedAId) currentIdA = linkedAId;
        }
        renderDetailContent();
    });

    $('#comp-link-btn').on('click', function() {
        if (!currentIdA || !currentIdB) {
            toastr.info('请先在两边选择有效的条目');
            return;
        }
        
        const links = JSON.parse(localStorage.getItem('zero_manual_links') || '{}');
        const key = `${nameA}::${nameB}`;
        
        if (isLinked(currentIdA, currentIdB)) {
            if (links[key] && links[key][currentIdA] === currentIdB) {
                delete links[key][currentIdA];
                if (Object.keys(links[key]).length === 0) delete links[key];
                localStorage.setItem('zero_manual_links', JSON.stringify(links));
            }
        } else {
            if (!links[key]) links[key] = {};
            links[key][currentIdA] = currentIdB;
            localStorage.setItem('zero_manual_links', JSON.stringify(links));
        }
        if (typeof performAutoMatch === 'function') performAutoMatch();
        renderDetailContent();
    });
    
    $('#comparison-overlay').on('click', '.zero-copy-btn', function() {
        const text = $(this).data('text');
        navigator.clipboard.writeText(text).then(() => {
            const $btn = $(this);
            const oldHtml = $btn.html();
            $btn.html('<i class="fa-solid fa-check"></i>').css('color', '#8aff8a');
            setTimeout(() => $btn.html(oldHtml).css('color', 'inherit'), 1000);
        });
    });

    $('#comparison-overlay').on('click', '.zero-trans-btn', async function() {
        const $btn = $(this);
        if ($btn.hasClass('processing')) return;

        const target = $btn.data('target');
        const originalText = $btn.data('original');
        const $textField = $(`#comp-text-${target}`);
        
        if ($btn.hasClass('showing-trans')) {
            renderDetailContent(); 
            return;
        }

        $btn.addClass('processing');
        const $icon = $btn.find('i');
        const oldClass = $icon.attr('class');
        $icon.attr('class', 'fa-solid fa-spinner fa-spin');

        try {
            const result = await window.translate(originalText);
            if (result) {
                $textField.text(result);
                $btn.addClass('showing-trans');
                $btn.attr('title', '显示原文');
                $btn.css('opacity', '1');
                $btn.css('color', 'var(--SmartThemeQuoteColor)');
            }
        } catch (e) {
            console.error('[Zero] Translation failed:', e);
            toastr.error('翻译失败');
        } finally {
            $icon.attr('class', oldClass);
            $btn.removeClass('processing');
        }
    });

    $('#comparison-overlay').on('click', '.zero-edit-btn', async function() {
        const presetName = $(this).data('preset');
        const itemName = $(this).data('item');
        openQuickEditor(presetName, itemName);
    });

    $('#comparison-overlay').on('click', '.zero-overwrite-btn', async function() {
        const direction = $(this).data('direction');
        const isBToA = direction === 'b-to-a';
        
        const srcPreset = isBToA ? nameB : nameA;
        const tgtPreset = isBToA ? nameA : nameB;
        
        const srcId = isBToA ? currentIdB : currentIdA;
        const tgtId = isBToA ? currentIdA : currentIdB;

        const pm = SillyTavern.getContext().getPresetManager('openai');
        
        const srcPresetObj = pm.getCompletionPresetByName(srcPreset);
        const tgtPresetObj = pm.getCompletionPresetByName(tgtPreset);
        if (!srcPresetObj || !tgtPresetObj) return;

        const srcPrompt = srcPresetObj.prompts.find(p => p.identifier === srcId);
        const tgtPrompt = tgtPresetObj.prompts.find(p => p.identifier === tgtId);

        if (!srcPrompt || !tgtPrompt) {
            toastr.error('无法定位源或目标条目');
            return;
        }

        if (confirm(`确认要将此项的所有设置与内容替换为另一侧的内容吗？`)) {
            // Overwrite all properties
            tgtPrompt.content = srcPrompt.content;
            tgtPrompt.name = srcPrompt.name;
            tgtPrompt.role = srcPrompt.role;
            tgtPrompt.injection_position = srcPrompt.injection_position;
            tgtPrompt.injection_depth = srcPrompt.injection_depth;
            tgtPrompt.injection_order = srcPrompt.injection_order;
            tgtPrompt.forbid_overrides = srcPrompt.forbid_overrides;

            try {
                // Sync group
                const srcGroups = GroupManager.get(srcPreset);
                const srcGroup = srcGroups.find(g => g.ids.includes(srcId));
                if (srcGroup) {
                    const tgtGroups = GroupManager.get(tgtPreset);
                    let tgtGroup = tgtGroups.find(g => g.name === srcGroup.name);
                    if (!tgtGroup) {
                        tgtGroup = GroupManager.create(tgtPreset, srcGroup.name);
                    }
                    GroupManager.assign(tgtPreset, tgtGroup.id, [tgtId]);
                } else {
                    GroupManager.unassign(tgtPreset, tgtId);
                }

                const isActive = pm.getSelectedPresetName() === tgtPreset;
                await pm.savePreset(tgtPreset, tgtPresetObj, { skipUpdate: !isActive });
                
                toastr.success('同步成功');
                
                // Update local loaded prompts data
                const localTgtPrompts = isBToA ? promptsA : promptsB;
                const p = localTgtPrompts.find(x => x.identifier === tgtId);
                if (p) {
                    p.content = srcPrompt.content;
                    p.name = srcPrompt.name;
                    p.role = srcPrompt.role;
                    p.injection_position = srcPrompt.injection_position;
                    p.injection_depth = srcPrompt.injection_depth;
                    p.injection_order = srcPrompt.injection_order;
                    p.forbid_overrides = srcPrompt.forbid_overrides;
                }
                
                renderDetailContent();
            } catch (e) {
                console.error('[Zero] Overwrite failed:', e);
                toastr.error('保存失败');
            }
        }
    });

    $('#prev-comp').on('click', () => {
        let currentIndex = allItems.findIndex(i => String(i.idA) === String(currentIdA) && String(i.idB) === String(currentIdB));
        if (currentIndex === -1) currentIndex = index;
        if (currentIndex > 0) showComparisonDetail(currentIndex - 1, allItems);
    });

    $('#next-comp').on('click', () => {
        let currentIndex = allItems.findIndex(i => String(i.idA) === String(currentIdA) && String(i.idB) === String(currentIdB));
        if (currentIndex === -1) currentIndex = index;
        if (currentIndex < allItems.length - 1) showComparisonDetail(currentIndex + 1, allItems);
    });
}

export function pruneManualLinks(currentPresets) {
    const links = JSON.parse(localStorage.getItem('zero_manual_links') || '{}');
    let changed = false;
    for (const key of Object.keys(links)) {
        const [pA, pB] = key.split('::');
        if (!currentPresets.includes(pA) || !currentPresets.includes(pB)) {
            delete links[key];
            changed = true;
        }
    }
    if (changed) localStorage.setItem('zero_manual_links', JSON.stringify(links));
}
