/**
 * Zero Extension Desktop Window & Layout Manager
 * Handles floating window drag & drop, resizable edges, docked panel resizing,
 * window modes (fullscreen/floating/docked_right/docked_left), header control toggles,
 * position/size persistence, and minimize badge.
 */

import { UiStateManager } from '../qr-snapshot/state.js';
import { FloatingBall } from './floating-ball.js';

const DEFAULT_WINDOW_STATE = {
    mode: 'fullscreen', // 'fullscreen', 'floating', 'docked_right', 'docked_left'
    floating: {
        top: '8vh',
        left: '12vw',
        width: '880px',
        height: '680px'
    },
    dockedWidth: '450px',
    isMinimized: false,
    showWinModeBtn: true,
    showWinResetBtn: true,
    showWinMinimizeBtn: true,
    showHistoryBtns: true
};

export const WindowManager = {
    getSettings() {
        const state = UiStateManager.get();
        if (!state.windowState) {
            state.windowState = JSON.parse(JSON.stringify(DEFAULT_WINDOW_STATE));
        }
        return state.windowState;
    },

    saveSettings(changes) {
        const current = this.getSettings();
        Object.assign(current, changes);
        UiStateManager.save({ windowState: current });
        this.applyWindowMode();
    },

    /**
     * Apply active window mode styles to panel and modal
     */
    applyWindowMode() {
        const settings = this.getSettings();
        const mode = settings.mode || 'fullscreen';
        const fp = settings.floating || DEFAULT_WINDOW_STATE.floating;
        const panel = document.getElementById('zero-preset-manager-panel');
        if (settings.isMinimized) {
            FloatingBall.show('preset', () => this.restore());
        } else {
            FloatingBall.hide('preset');
        }

        if (!panel) return;

        if (settings.isMinimized) {
            panel.style.display = 'none';
            return;
        }

        // Toggle Header Buttons visibility based on settings
        const showWinModeBtn = settings.showWinModeBtn !== false;
        const showWinResetBtn = settings.showWinResetBtn !== false;
        const showWinMinimizeBtn = settings.showWinMinimizeBtn !== false;
        const showHistoryBtns = settings.showHistoryBtns !== false;

        const modeBtn = document.getElementById('zero-window-mode-btn');
        const resetBtn = document.getElementById('zero-window-reset-btn');
        const minBtn = document.getElementById('zero-window-minimize-btn');
        const undoBtn = document.getElementById('zero-history-undo');
        const redoBtn = document.getElementById('zero-history-redo');

        if (modeBtn) modeBtn.style.display = showWinModeBtn ? 'flex' : 'none';
        if (resetBtn) resetBtn.style.display = showWinResetBtn ? 'flex' : 'none';
        if (minBtn) minBtn.style.display = showWinMinimizeBtn ? 'flex' : 'none';
        if (undoBtn) undoBtn.style.display = showHistoryBtns ? 'flex' : 'none';
        if (redoBtn) redoBtn.style.display = showHistoryBtns ? 'flex' : 'none';

        // Update mode toggle button icon title
        if (modeBtn) {
            const icons = {
                fullscreen: '<i class="fa-solid fa-expand"></i>',
                floating: '<i class="fa-solid fa-window-restore"></i>',
                docked_right: '<i class="fa-solid fa-table-columns"></i>',
                docked_left: '<i class="fa-solid fa-table-columns fa-flip-horizontal"></i>'
            };
            modeBtn.innerHTML = icons[mode] || '<i class="fa-solid fa-expand"></i>';
        }

        // Reset classes
        panel.classList.remove('zero-window-fullscreen', 'zero-window-floating', 'zero-window-docked-right', 'zero-window-docked-left');

        if (mode === 'floating') {
            panel.classList.add('zero-window-floating');
            panel.style.top = fp.top || '8vh';
            panel.style.left = fp.left || '12vw';
            panel.style.right = 'auto';
            panel.style.width = fp.width || '880px';
            panel.style.height = fp.height || '680px';
            panel.style.maxWidth = '98vw';
            panel.style.maxHeight = '98vh';
            panel.style.borderRadius = '12px';
            panel.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.6)';
            panel.style.resize = 'both';
        } else if (mode === 'docked_right') {
            panel.classList.add('zero-window-docked-right');
            panel.style.top = '0';
            panel.style.left = 'auto';
            panel.style.right = '0';
            panel.style.width = settings.dockedWidth || '450px';
            panel.style.height = '100vh';
            panel.style.maxWidth = '85vw';
            panel.style.maxHeight = '100vh';
            panel.style.borderRadius = '0';
            panel.style.boxShadow = '-4px 0 20px rgba(0, 0, 0, 0.4)';
            panel.style.resize = 'none';
        } else if (mode === 'docked_left') {
            panel.classList.add('zero-window-docked-left');
            panel.style.top = '0';
            panel.style.left = '0';
            panel.style.right = 'auto';
            panel.style.width = settings.dockedWidth || '450px';
            panel.style.height = '100vh';
            panel.style.maxWidth = '85vw';
            panel.style.maxHeight = '100vh';
            panel.style.borderRadius = '0';
            panel.style.boxShadow = '4px 0 20px rgba(0, 0, 0, 0.4)';
            panel.style.resize = 'none';
        } else {
            // Fullscreen
            panel.classList.add('zero-window-fullscreen');
            panel.style.top = '0';
            panel.style.left = '0';
            panel.style.right = 'auto';
            panel.style.width = '100vw';
            panel.style.height = '100vh';
            panel.style.maxWidth = '100vw';
            panel.style.maxHeight = '100vh';
            panel.style.borderRadius = '0';
            panel.style.boxShadow = 'none';
            panel.style.resize = 'none';
        }

        this.initDockResizer(panel);
    },

    /**
     * Make element draggable by handle (pointer events supported)
     */
    initDraggable(element, handle) {
        if (!element || !handle || element._zeroDragInit) return;
        element._zeroDragInit = true;

        let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;
        let isDragging = false;

        const onPointerDown = (e) => {
            const settings = this.getSettings();
            if (settings.mode !== 'floating') return; // Dragging only in floating window mode
            // Exclude direct clicks on buttons, inputs, selects, textareas, links & close button
            if (e.target.closest('button, input, select, textarea, .zero-tab-link, a, #zero-panel-close')) return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = element.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            element.style.transition = 'none';
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
            e.preventDefault();
        };

        let animFrame = null;
        const onPointerMove = (e) => {
            if (!isDragging) return;
            const clientX = e.clientX;
            const clientY = e.clientY;

            if (animFrame) cancelAnimationFrame(animFrame);
            animFrame = requestAnimationFrame(() => {
                const dx = clientX - startX;
                const dy = clientY - startY;

                let newLeft = initialLeft + dx;
                let newTop = initialTop + dy;

                // Constrain within viewport bounds
                const maxLeft = window.innerWidth - 100;
                const maxTop = window.innerHeight - 60;
                newLeft = Math.max(-10, Math.min(newLeft, maxLeft));
                newTop = Math.max(0, Math.min(newTop, maxTop));

                element.style.left = `${newLeft}px`;
                element.style.top = `${newTop}px`;
            });
        };

        const onPointerUp = () => {
            if (!isDragging) return;
            isDragging = false;
            if (animFrame) cancelAnimationFrame(animFrame);
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);

            // Persist new position
            const settings = this.getSettings();
            if (settings.mode === 'floating') {
                const rect = element.getBoundingClientRect();
                this.saveSettings({
                    floating: {
                        ...settings.floating,
                        top: `${rect.top}px`,
                        left: `${rect.left}px`,
                        width: `${rect.width}px`,
                        height: `${rect.height}px`
                    }
                });
            }
        };

        handle.addEventListener('pointerdown', onPointerDown);
    },

    /**
     * Make any dialog/overlay element smoothly draggable and resizable on desktop screens
     */
    makeOverlayDraggable(element, handle, onSavePosCallback) {
        if (!element) return;
        
        // 1. Position Draggable
        if (handle) {
            let isDragging = false;
            let startX = 0, startY = 0;
            let initialLeft = 0, initialTop = 0;

            const onPointerDown = (e) => {
                if (window.innerWidth < 800) return; // Desktop PC only
                if (e.target.closest('button, input, select, textarea, a, .fa-xmark')) return;

                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;

                const rect = element.getBoundingClientRect();
                initialLeft = rect.left;
                initialTop = rect.top;

                element.style.margin = '0';
                element.style.left = `${initialLeft}px`;
                element.style.top = `${initialTop}px`;
                element.style.width = `${Math.round(rect.width)}px`;
                element.style.height = `${Math.round(rect.height)}px`;
                element.style.transition = 'none';
                document.addEventListener('pointermove', onPointerMove);
                document.addEventListener('pointerup', onPointerUp);
                e.preventDefault();
            };

            let animFrame = null;
            const onPointerMove = (e) => {
                if (!isDragging) return;
                const clientX = e.clientX;
                const clientY = e.clientY;

                if (animFrame) cancelAnimationFrame(animFrame);
                animFrame = requestAnimationFrame(() => {
                    const dx = clientX - startX;
                    const dy = clientY - startY;

                    let newLeft = initialLeft + dx;
                    let newTop = initialTop + dy;

                    const maxLeft = window.innerWidth - 80;
                    const maxTop = window.innerHeight - 50;
                    newLeft = Math.max(-10, Math.min(newLeft, maxLeft));
                    newTop = Math.max(0, Math.min(newTop, maxTop));

                    element.style.left = `${newLeft}px`;
                    element.style.top = `${newTop}px`;
                });
            };

            const onPointerUp = () => {
                if (!isDragging) return;
                isDragging = false;
                if (animFrame) cancelAnimationFrame(animFrame);
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
                if (typeof onSavePosCallback === 'function') onSavePosCallback();
            };

            handle.style.cursor = 'move';
            handle.addEventListener('pointerdown', onPointerDown);
        }

        // 2. Add Corner Resizer Handle at Bottom-Right
        if (!element.querySelector('.zero-window-resizer-grip')) {
            const resizer = document.createElement('div');
            resizer.className = 'zero-window-resizer-grip interactable';
            resizer.title = '拖拽调整窗口大小';
            resizer.innerHTML = '<i class="fa-solid fa-up-right-and-down-left-from-center" style="transform: rotate(90deg); font-size: 10px; opacity: 0.6;"></i>';
            resizer.style.cssText = `
                position: absolute;
                right: 3px;
                bottom: 3px;
                width: 18px;
                height: 18px;
                cursor: se-resize;
                z-index: 9999;
                display: flex;
                align-items: center;
                justify-content: center;
                user-select: none;
                background: rgba(255,255,255,0.05);
                border-radius: 4px;
            `;

            let isResizing = false;
            let startX = 0, startY = 0;
            let startWidth = 0, startHeight = 0;

            const onResizeDown = (e) => {
                if (window.innerWidth < 800) return;
                isResizing = true;
                startX = e.clientX;
                startY = e.clientY;

                const rect = element.getBoundingClientRect();
                startWidth = rect.width;
                startHeight = rect.height;

                element.style.margin = '0';
                element.style.left = `${rect.left}px`;
                element.style.top = `${rect.top}px`;
                element.style.transition = 'none';
                document.addEventListener('pointermove', onResizeMove);
                document.addEventListener('pointerup', onResizeUp);
                e.preventDefault();
                e.stopPropagation();
            };

            let resizeAnim = null;
            const onResizeMove = (e) => {
                if (!isResizing) return;
                const clientX = e.clientX;
                const clientY = e.clientY;

                if (resizeAnim) cancelAnimationFrame(resizeAnim);
                resizeAnim = requestAnimationFrame(() => {
                    const dw = clientX - startX;
                    const dh = clientY - startY;

                    const newWidth = Math.max(260, startWidth + dw);
                    const newHeight = Math.max(260, startHeight + dh);

                    element.style.width = `${newWidth}px`;
                    element.style.height = `${newHeight}px`;
                });
            };

            const onResizeUp = () => {
                if (!isResizing) return;
                isResizing = false;
                if (resizeAnim) cancelAnimationFrame(resizeAnim);
                document.removeEventListener('pointermove', onResizeMove);
                document.removeEventListener('pointerup', onResizeUp);
                if (typeof onSavePosCallback === 'function') onSavePosCallback();
            };

            resizer.addEventListener('pointerdown', onResizeDown);
            element.appendChild(resizer);
        }
    },

    /**
     * Custom left/right dock resizer bar logic
     */
    initDockResizer(element, explicitMode, onSaveWidthCallback) {
        if (!element) return;
        const settings = this.getSettings();
        const mode = explicitMode || settings.mode;

        let resizer = element.querySelector('.zero-dock-resizer');
        if (!resizer) {
            resizer = document.createElement('div');
            resizer.className = 'zero-dock-resizer';
            element.appendChild(resizer);
        }

        if (mode !== 'docked_right' && mode !== 'docked_left') {
            resizer.style.display = 'none';
            return;
        }

        resizer.style.display = 'block';
        if (mode === 'docked_right') {
            resizer.style.cssText = `
                position: absolute; top: 0; left: 0; width: 6px; height: 100%;
                cursor: ew-resize; z-index: 10000; background: transparent;
                transition: background 0.15s;
            `;
        } else {
            resizer.style.cssText = `
                position: absolute; top: 0; right: 0; width: 6px; height: 100%;
                cursor: ew-resize; z-index: 10000; background: transparent;
                transition: background 0.15s;
            `;
        }

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        resizer.onmouseenter = () => { resizer.style.background = 'var(--SmartThemeQuoteColor, #4a90e2)'; };
        resizer.onmouseleave = () => { if (!isResizing) resizer.style.background = 'transparent'; };

        resizer.onpointerdown = (e) => {
            isResizing = true;
            startX = e.clientX;
            startWidth = element.offsetWidth;
            resizer.style.background = 'var(--SmartThemeQuoteColor, #4a90e2)';
            element.style.transition = 'none';

            const onMove = (moveEv) => {
                if (!isResizing) return;
                let dx = moveEv.clientX - startX;
                let newWidth = startWidth;
                if (mode === 'docked_right') {
                    newWidth = startWidth - dx;
                } else {
                    newWidth = startWidth + dx;
                }

                newWidth = Math.max(220, Math.min(newWidth, window.innerWidth * 0.85));
                element.style.width = `${newWidth}px`;
            };

            const onUp = () => {
                if (!isResizing) return;
                isResizing = false;
                resizer.style.background = 'transparent';
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);

                const finalWidth = `${element.offsetWidth}px`;
                if (typeof onSaveWidthCallback === 'function') {
                    onSaveWidthCallback(finalWidth);
                } else {
                    this.saveSettings({ dockedWidth: finalWidth });
                }
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            e.preventDefault();
        };
    },

    /**
     * Shared drag-and-click restoration handler for capsule badges
     */
    initCapsuleDraggable(badge, onRestoreCallback) {
        if (!badge || badge._zeroDragBound) return;
        badge._zeroDragBound = true;

        let isDragging = false;
        let startX = 0, startY = 0;
        let initLeft = 0, initTop = 0;

        badge.addEventListener('pointerdown', (e) => {
            isDragging = false;
            startX = e.clientX;
            startY = e.clientY;
            const rect = badge.getBoundingClientRect();
            initLeft = rect.left;
            initTop = rect.top;

            const onMove = (me) => {
                const dx = me.clientX - startX;
                const dy = me.clientY - startY;
                if (!isDragging && Math.hypot(dx, dy) < 4) return;
                isDragging = true;
                badge.style.right = 'auto';
                badge.style.bottom = 'auto';
                badge.style.left = `${Math.max(0, Math.min(initLeft + dx, window.innerWidth - badge.offsetWidth))}px`;
                badge.style.top = `${Math.max(0, Math.min(initTop + dy, window.innerHeight - badge.offsetHeight))}px`;
            };

            const onUp = () => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                if (!isDragging && typeof onRestoreCallback === 'function') {
                    onRestoreCallback();
                }
                setTimeout(() => { isDragging = false; }, 50);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        });

        badge.addEventListener('click', (e) => {
            if (isDragging) {
                e.stopPropagation();
                e.preventDefault();
                return;
            }
            if (typeof onRestoreCallback === 'function') {
                onRestoreCallback();
            }
        });
    },

    /**
     * Minimize window to floating ball
     */
    minimize() {
        const settings = this.getSettings();
        settings.isMinimized = true;
        UiStateManager.save({ windowState: settings });

        FloatingBall.show('preset', () => this.restore());

        const panel = document.getElementById('zero-preset-manager-panel');
        if (panel) panel.style.display = 'none';
    },

    /**
     * Restore window from floating ball
     */
    restore() {
        const settings = this.getSettings();
        settings.isMinimized = false;
        UiStateManager.save({ windowState: settings });

        FloatingBall.hide('preset');

        const panel = document.getElementById('zero-preset-manager-panel');
        if (panel) {
            panel.style.display = 'flex';
            this.applyWindowMode();
        }
    },

    /**
     * Reset window position and dimensions to defaults
     */
    resetPosition() {
        const settings = this.getSettings();
        settings.floating = JSON.parse(JSON.stringify(DEFAULT_WINDOW_STATE.floating));
        settings.dockedWidth = '450px';
        settings.mode = 'floating';
        settings.isMinimized = false;
        this.saveSettings(settings);
    }
};
