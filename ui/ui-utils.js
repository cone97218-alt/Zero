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
