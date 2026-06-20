/**
 * Zero Preset Manager - Search Utilities
 * Centralized logic for fuzzy matching and matching text highlighting.
 */

/**
 * Escapes special characters for RegExp construction.
 * @param {string} string 
 * @returns {string}
 */
export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a prompt matches a query by name and/or content.
 * Used in ui.js (Camera popup menu & Editor tab).
 * @param {object} prompt 
 * @param {string} query 
 * @param {boolean} scopeName 
 * @param {boolean} scopeContent 
 * @returns {boolean}
 */
export function matchPrompt(prompt, query, scopeName = true, scopeContent = true) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    const matchesName = scopeName && (prompt.name || prompt.identifier || '').toLowerCase().includes(q);
    const matchesContent = scopeContent && (prompt.content || prompt.prompt || '').toLowerCase().includes(q);
    return matchesName || matchesContent;
}

/**
 * Checks if a prompt matches a query based on selected stitcher filters.
 * Used in preset-manager/stitch.js.
 * @param {object} p 
 * @param {string} queryLower 
 * @param {string[]} activeFilters 
 * @returns {boolean}
 */
export function matchStitch(p, queryLower, activeFilters = []) {
    if (!queryLower) return true;
    const name = activeFilters.includes('name') ? (p.name || p.identifier || '').toLowerCase() : '';
    const content = activeFilters.includes('content') ? (p.content || '').toLowerCase() : '';
    const note = activeFilters.includes('note') ? (p.fav_note || '').toLowerCase() : '';
    const origin = activeFilters.includes('origin') ? (p.fav_origin_preset || '').toLowerCase() : '';
    return (name && name.includes(queryLower)) || 
           (content && content.includes(queryLower)) || 
           (note && note.includes(queryLower)) || 
           (origin && origin.includes(queryLower));
}

/**
 * Checks if a name or content matches a query.
 * Used in preset-manager/checker.js.
 * @param {string} name 
 * @param {string} content 
 * @param {string} query 
 * @returns {boolean}
 */
export function matchSimple(name, content, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    const nameMatch = (name || '').toLowerCase().includes(q);
    const contentMatch = (content || '').toLowerCase().includes(q);
    return nameMatch || contentMatch;
}

/**
 * Highlights matches within a given text block by wrapping with HTML mark tag.
 * Used in preset-manager/stitch.js.
 * @param {string} text 
 * @param {string} query 
 * @param {boolean} isActive 
 * @returns {string}
 */
export function highlightText(text, query, isActive = true) {
    const safeText = escapeHtml(text || '');
    if (!query || !isActive) return safeText;
    const escapedQuery = escapeRegExp(query);
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    return safeText.replace(regex, '<mark style="background: var(--SmartThemeQuoteColor); color: white; border-radius: 2px; padding: 0 2px; font-weight: bold;">$1</mark>');
}

/**
 * Highlights matches and returns a snippet of the text containing the match.
 * Used in preset-manager/checker.js.
 * @param {string} text 
 * @param {string} filter 
 * @returns {string}
 */
export function highlightMatchSnippet(text, filter) {
    const idx = text.toLowerCase().indexOf(filter.toLowerCase());
    if (idx === -1) return escapeHtml(text.substring(0, 50));

    const start = Math.max(0, idx - 20);
    const end = Math.min(text.length, idx + filter.length + 30);
    const snippet = text.substring(start, end);

    const escaped = escapeHtml(snippet);
    const regex = new RegExp(`(${escapeRegExp(filter)})`, 'gi');
    return escaped.replace(regex, '<span style="color: var(--SmartThemeQuoteColor); font-weight: bold;">$1</span>');
}

/**
 * Helper to escape HTML characters.
 * @param {string} text 
 * @returns {string}
 */
function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}
