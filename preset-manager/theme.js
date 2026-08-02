/**
 * Zero Extension Theme & Styling Manager
 * Manages color schemes (Follow ST, Morandi Beige, Morandi Ink, Custom),
 * background transparency, custom background image URL, font family & font size.
 */

import { UiStateManager } from '../qr-snapshot/state.js';

export const BUILTIN_THEMES = {
    follow: {
        id: 'follow',
        name: '跟随酒馆 (默认)',
        isBuiltin: true,
        // Will fallback directly to SillyTavern native CSS variables
    },
    morandi_beige: {
        id: 'morandi_beige',
        name: '莫兰迪米色',
        isBuiltin: true,
        colors: {
            accent: '#967259',
            bg: '#F4F0EA',
            cardBg: '#E8E2D7',
            cardBgLight: '#DFC9C0',
            text: '#3A3632',
            muted: '#78726A',
            border: '#D5CDBF',
            success: '#6E8B74',
            danger: '#B85B56',
            warning: '#C48344',
            info: '#5B7C8D'
        }
    },
    morandi_ink: {
        id: 'morandi_ink',
        name: '莫兰迪墨色',
        isBuiltin: true,
        colors: {
            accent: '#6A8E85',
            bg: '#1C2024',
            cardBg: '#252A30',
            cardBgLight: '#2F353D',
            text: '#E0E4E8',
            muted: '#8B949E',
            border: '#323842',
            success: '#5B8C7A',
            danger: '#C06C66',
            warning: '#C49450',
            info: '#5C829B'
        }
    }
};

const DEFAULT_THEME_STATE = {
    activeTheme: 'follow',        // 'follow', 'morandi_beige', 'morandi_ink', or custom ID
    customThemes: {},             // { themeId: { id, name, colors: {...} } }
    bgOpacity: 1.0,               // 0.1 ~ 1.0 (default 100% opaque)
    bgImageUrl: '',               // image URL string
    fontFamily: 'inherit',        // 'inherit', 'Microsoft YaHei', 'PingFang SC', 'Roboto', 'monospace', or custom string / @import CSS
    fontSize: '14px',             // '12px' ~ '18px'
    // Custom active palette buffer if editing custom theme
    customPalette: {
        accent: '#4a90e2',
        bg: '#181824',
        cardBg: '#252538',
        cardBgLight: '#2e2e46',
        text: '#e0e0e0',
        muted: '#999999',
        border: '#444444',
        success: '#4CAF50',
        danger: '#ff4d4f',
        warning: '#ff8822',
        info: '#2196F3'
    }
};

export const ThemeManager = {
    getSettings() {
        const state = UiStateManager.get();
        if (!state.themeState) {
            state.themeState = JSON.parse(JSON.stringify(DEFAULT_THEME_STATE));
        }
        return state.themeState;
    },

    saveSettings(changes) {
        const current = this.getSettings();
        Object.assign(current, changes);
        UiStateManager.save({ themeState: current });
        this.applyTheme();
    },

    getThemeConfig(themeId) {
        const settings = this.getSettings();
        if (!themeId) themeId = settings.activeTheme || 'follow';

        if (BUILTIN_THEMES[themeId]) {
            return BUILTIN_THEMES[themeId];
        }
        if (settings.customThemes && settings.customThemes[themeId]) {
            return settings.customThemes[themeId];
        }
        return BUILTIN_THEMES.follow;
    },

    saveCustomTheme(name, colors) {
        const settings = this.getSettings();
        if (!settings.customThemes) settings.customThemes = {};
        const id = 'custom_' + Date.now();
        const newTheme = {
            id,
            name: name || '自定义配色',
            isBuiltin: false,
            colors: { ...colors }
        };
        settings.customThemes[id] = newTheme;
        settings.activeTheme = id;
        this.saveSettings({ customThemes: settings.customThemes, activeTheme: id });
        return newTheme;
    },

    deleteCustomTheme(themeId) {
        const settings = this.getSettings();
        if (settings.customThemes && settings.customThemes[themeId]) {
            delete settings.customThemes[themeId];
            if (settings.activeTheme === themeId) {
                settings.activeTheme = 'follow';
            }
            this.saveSettings({ customThemes: settings.customThemes, activeTheme: settings.activeTheme });
            return true;
        }
        return false;
    },

    /**
     * Convert Hex color to RGBA with specific alpha
     */
    hexToRgba(hex, alpha = 1) {
        if (!hex) return `rgba(20,20,30,${alpha})`;
        let c = hex.replace('#', '');
        if (c.length === 3) {
            c = c.split('').map(x => x + x).join('');
        }
        if (c.length !== 6) return hex;
        const num = parseInt(c, 16);
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    },

    /**
     * Smart parser for custom font input (supports @import url(...), stylesheet URLs, font-family declarations & raw font names)
     */
    parseCustomFont(fontInput) {
        if (!fontInput || typeof fontInput !== 'string') {
            return { imports: [], fontFamily: '', fontWeight: '' };
        }
        const raw = fontInput.trim();
        const imports = [];
        let fontFamily = '';
        let fontWeight = '';

        // 1. Extract @import statements
        const importMatches = raw.match(/@import\s+(?:url\(['"]?([^'"]+)['"]?\)|['"]([^'"]+)['"])[^;]*;/gi);
        if (importMatches) {
            importMatches.forEach(m => imports.push(m.trim()));
        } else {
            // Check if raw text contains direct https:// URL
            const urlMatch = raw.match(/https?:\/\/[^\s"'\)]+\.css[^\s"'\)]*/i);
            if (urlMatch) {
                imports.push(`@import url("${urlMatch[0]}");`);
            }
        }

        // 2. Extract font-family
        const familyMatch = raw.match(/font-family\s*:\s*['"]?([^;'"]+)['"]?/i);
        if (familyMatch) {
            fontFamily = familyMatch[1].trim();
        } else {
            // Clean up @import and CSS syntax to deduce font family name
            let clean = raw.replace(/@import\s+[^;]+;/gi, '').replace(/https?:\/\/[^\s"'\)]+/gi, '').replace(/[\{\}\(\)]/g, '').trim();
            const bodyFontMatch = clean.match(/body\s*\{[^}]*font-family\s*:\s*['"]?([^;'"]+)['"]?/i);
            if (bodyFontMatch) {
                fontFamily = bodyFontMatch[1].trim();
            } else {
                clean = clean.replace(/body|font-weight\s*:[^;]+|normal|bold|;/gi, '').trim();
                if (clean) fontFamily = clean;
            }
        }

        // 3. Extract font-weight
        const weightMatch = raw.match(/font-weight\s*:\s*([^;\}]+)/i);
        if (weightMatch) {
            fontWeight = weightMatch[1].trim();
        }

        return { imports, fontFamily, fontWeight };
    },

    /**
     * Apply active theme styles by injecting/updating <style id="zero-custom-theme-styles">
     */
    applyTheme() {
        const settings = this.getSettings();
        const activeId = settings.activeTheme || 'follow';
        const themeConfig = this.getThemeConfig(activeId);

        let styleEl = document.getElementById('zero-custom-theme-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'zero-custom-theme-styles';
            document.head.appendChild(styleEl);
        }

        const opacity = settings.bgOpacity !== undefined ? settings.bgOpacity : 1.0;
        const bgUrl = (settings.bgImageUrl || '').trim();
        const fontInput = settings.fontFamily || 'inherit';
        const fontSize = settings.fontSize || '14px';

        // Base Selector for Zero extension elements (targeted without heavy attribute wildcards)
        const scope = `.zero-overlay, .zero-modal, .zero-modal-card, .zero-confirm, .zero-preview-box, .zero-multiselect-bar, #zero-preset-manager-panel, #zero-quick-editor, #comparison-overlay, #move-modal, #links-manager-modal, #standalone-regex-manager-modal, #zero-contrast-summary-modal, #zero-op-log-modal`;
        const modalTargets = `.zero-modal, .zero-modal-card, #zero-preset-manager-panel, #comparison-overlay, #zero-quick-editor, #links-manager-modal, #standalone-regex-manager-modal, #zero-contrast-summary-modal, #move-modal, #zero-op-log-modal`;

        let css = '';

        // 1. Parse & Inject Custom Web Fonts (@import url(...), font-family & font-weight)
        const { imports, fontFamily, fontWeight } = this.parseCustomFont(fontInput);

        // Put @import statements at the very top of <style>
        if (imports.length > 0) {
            css += imports.join('\n') + '\n';
        }

        if (fontInput !== 'inherit' && fontFamily) {
            const fontRule = fontFamily.includes(',') || fontFamily.includes('"') || fontFamily.includes("'")
                ? fontFamily
                : `'${fontFamily.replace(/'/g, "\\'")}', system-ui, -apple-system, sans-serif`;

            css += `
            ${scope} {
                font-family: ${fontRule} !important;
                ${fontWeight ? `font-weight: ${fontWeight} !important;` : ''}
            }
            ${scope} i, ${scope} [class*="fa-"], ${scope} .fa, ${scope} .fas, ${scope} .far, ${scope} .fab {
                font-family: "Font Awesome 6 Free", "Font Awesome 6 Brands", "Font Awesome 5 Free", FontAwesome, sans-serif !important;
            }
            `;
        }

        // Apply font-size to text containers cleanly
        css += `
        ${scope} {
            font-size: ${fontSize};
        }
        #zero-preset-manager-panel {
            max-width: 100vw !important;
            max-height: 100vh !important;
            box-sizing: border-box !important;
        }
        .zero-modal {
            box-sizing: border-box !important;
        }
        `;

        // 2. Color & Opacity Rules
        if (activeId === 'follow') {
            // FOLLOW SILLY TAVERN (Default)
            const followBgRgba = `rgb(from var(--SmartThemeBlurTintColor-Original, var(--SmartThemeBlurTintColor, rgba(20,20,30,0.95))) r g b / ${opacity})`;
            css += `
            ${scope} {
                --zero-bg-color: ${followBgRgba};
                --zero-card-bg: var(--SmartThemeChatTintColor, rgba(255,255,255,0.04));
                --zero-card-bg-light: color-mix(in srgb, var(--SmartThemeBodyColor, #fff) 6%, transparent);
                --zero-text-color: var(--SmartThemeBodyColor, #e0e0e0);
                --zero-muted-color: var(--SmartThemeEmColor, #999999);
                --zero-accent-color: var(--SmartThemeQuoteColor, #4a90e2);
                --zero-border-color: var(--SmartThemeBorderColor, #555555);
                --zero-success-color: #4CAF50;
                --zero-danger-color: #ff4d4f;
                --zero-warning-color: #ff8822;
                --zero-info-color: #2196F3;
                --zero-overlay-bg: rgba(0, 0, 0, 0.55);
                --SmartThemeBlurTintColor: ${followBgRgba} !important;
            }
            ${modalTargets} {
                background-color: ${followBgRgba} !important;
            }
            `;
        } else {
            // CUSTOM / MORANDI THEMES
            const colors = themeConfig.colors || settings.customPalette || DEFAULT_THEME_STATE.customPalette;
            const bgRgba = this.hexToRgba(colors.bg, opacity);

            css += `
            ${scope} {
                --zero-bg-color: ${bgRgba};
                --zero-card-bg: ${colors.cardBg};
                --zero-card-bg-light: ${colors.cardBgLight || this.hexToRgba(colors.text, 0.08)};
                --zero-text-color: ${colors.text};
                --zero-muted-color: ${colors.muted};
                --zero-accent-color: ${colors.accent};
                --zero-border-color: ${colors.border};
                --zero-success-color: ${colors.success || '#4CAF50'};
                --zero-danger-color: ${colors.danger || '#ff4d4f'};
                --zero-warning-color: ${colors.warning || '#ff8822'};
                --zero-info-color: ${colors.info || '#2196F3'};
                --zero-overlay-bg: ${this.hexToRgba('#000000', 0.6)};

                /* Override SillyTavern variable fallbacks for child elements */
                --SmartThemeBlurTintColor: ${bgRgba} !important;
                --SmartThemeChatTintColor: ${colors.cardBg} !important;
                --SmartThemeBodyColor: ${colors.text} !important;
                --SmartThemeEmColor: ${colors.muted} !important;
                --SmartThemeQuoteColor: ${colors.accent} !important;
                --SmartThemeBorderColor: ${colors.border} !important;
                color: ${colors.text};
            }

            ${modalTargets} {
                background: ${bgRgba} !important;
                border-color: ${colors.border} !important;
                color: ${colors.text} !important;
            }
            `;
        }

        // 3. Custom Background Image handling
        if (bgUrl) {
            css += `
            ${modalTargets} {
                background-image: linear-gradient(rgba(0, 0, 0, ${0.4 * opacity}), rgba(0, 0, 0, ${0.6 * opacity})), url('${bgUrl.replace(/'/g, "\\'")}') !important;
                background-size: cover !important;
                background-position: center !important;
                background-repeat: no-repeat !important;
            }
            `;
        }

        if (styleEl.textContent !== css) {
            styleEl.textContent = css;
        }
    }
};
