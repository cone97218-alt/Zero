/**
 * Zero Extension Floating Action Ball (纯图标磁吸贴边半隐藏悬浮球)
 * 
 * 特性：
 * 1. 纯圆形精致图标（~42px 毛玻璃质感与强调色微光），完全取代旧版笨重胶囊
 * 2. 跨平台平滑拖拽（桌面端与移动端 Touch/Mouse 高性能捕获，零丢失，智能防误触）
 * 3. 磁吸贴边（Magnetic Edge Snap）：松开后以弹性缓动自动吸附至最近的屏幕左边缘或右边缘
 * 4. 自动折叠半隐藏（Docked Edge Half-Hide）：贴边后自动向屏幕边缘外侧折叠 50%，仅留精致弧形提手，不挡任何界面，触摸/悬停即刻呼出
 * 5. 单球双用与多任务支持：快照面板与预设管理统一收拢，既可独立快速唤醒，也支持双面板迷你展开菜单
 * 6. 用户偏好持久化（自动记录靠拢侧与垂直坐标至 localStorage）
 */

import { UiStateManager } from '../qr-snapshot/state.js';

const BALL_ID = 'zero-floating-ball';
const POS_KEY = 'zero_floating_ball_pos';

class FloatingBallManager {
    constructor() {
        this.ballEl = null;
        this.menuEl = null;
        this.iconEl = null;
        this.badgeEl = null;
        this.activeTargets = new Map(); // key: 'snapshot' | 'preset', value: restoreCallback
        this.isMenuOpen = false;
        this.lastActiveTarget = 'snapshot';

        // Drag & tracking state
        this.isTracking = false;
        this.hasDragged = false;
        this.startX = 0;
        this.startY = 0;
        this.initialLeft = 0;
        this.initialTop = 0;
        this.startTime = 0;

        this.dockSide = 'right'; // 'left' | 'right'
        this.currentTop = 0;
    }

    /**
     * Show ball for a specific minimized target
     * @param {'snapshot' | 'preset'} targetId 
     * @param {Function} restoreCallback 
     */
    show(targetId, restoreCallback) {
        this.activeTargets.set(targetId, restoreCallback);
        this.lastActiveTarget = targetId;
        this.ensureDom();
        this.updateState();
        this.updateAutoHideState();
        this.ballEl.style.display = 'flex';
        this.snapToEdge(false);
    }

    /**
     * Hide ball for a restored target
     * @param {'snapshot' | 'preset'} targetId 
     */
    hide(targetId) {
        this.activeTargets.delete(targetId);
        if (this.activeTargets.size === 0) {
            if (this.ballEl) {
                this.ballEl.style.display = 'none';
                this.closeMenu();
            }
        } else {
            // Other target is still active
            const remainingTarget = Array.from(this.activeTargets.keys())[0];
            this.lastActiveTarget = remainingTarget;
            this.updateState();
            this.updateAutoHideState();
        }
    }

    /**
     * Check if a target is currently minimized in the ball
     */
    has(targetId) {
        return this.activeTargets.has(targetId);
    }

    ensureDom() {
        if (this.ballEl && document.getElementById(BALL_ID)) return;

        // Clean up old legacy badges if present
        document.getElementById('zero-snapshot-minimized-badge')?.remove();
        document.getElementById('zero-minimized-badge')?.remove();

        const ball = document.createElement('div');
        ball.id = BALL_ID;
        ball.className = 'zero-floating-ball interactable';
        ball.innerHTML = `
            <div class="zero-ball-core">
                <i class="fa-solid fa-camera zero-ball-icon"></i>
            </div>
            <div class="zero-ball-badge" style="display: none;">2</div>
            <div class="zero-ball-menu" style="display: none;">
                <div class="zero-ball-menu-item" data-action="snapshot" title="展开快照面板">
                    <i class="fa-solid fa-camera"></i>
                    <span>快照</span>
                </div>
                <div class="zero-ball-menu-item" data-action="preset" title="打开预设管理">
                    <i class="fa-solid fa-list-ul"></i>
                    <span>管理</span>
                </div>
            </div>
        `;

        document.body.appendChild(ball);
        this.ballEl = ball;
        this.iconEl = ball.querySelector('.zero-ball-icon');
        this.menuEl = ball.querySelector('.zero-ball-menu');
        this.badgeEl = ball.querySelector('.zero-ball-badge');

        this.initPosition();
        this.bindEvents();
    }

    initPosition() {
        const saved = this.loadPosition();
        const vh = window.innerHeight;
        const bh = 42;

        this.dockSide = saved?.side || 'right';
        let top = saved?.top ?? Math.round(vh * 0.65);
        top = Math.max(20, Math.min(top, vh - bh - 20));
        this.currentTop = top;

        this.ballEl.style.top = `${top}px`;
        if (this.dockSide === 'right') {
            this.ballEl.style.left = 'auto';
            this.ballEl.style.right = '0px';
            this.ballEl.classList.remove('docked-left');
            this.ballEl.classList.add('docked-right');
        } else {
            this.ballEl.style.left = '0px';
            this.ballEl.style.right = 'auto';
            this.ballEl.classList.remove('docked-right');
            this.ballEl.classList.add('docked-left');
        }
        this.updateAutoHideState();
    }

    loadPosition() {
        try {
            const raw = localStorage.getItem(POS_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            const side = parsed.side || (typeof parsed.x === 'number' && parsed.x < window.innerWidth / 2 ? 'left' : 'right');
            const top = typeof parsed.top === 'number' ? parsed.top : (typeof parsed.y === 'number' ? parsed.y : null);
            return { side, top };
        } catch (e) {
            return null;
        }
    }

    savePosition(side, top) {
        try {
            localStorage.setItem(POS_KEY, JSON.stringify({ side, top: Math.round(top) }));
        } catch (e) {}
    }

    updateState() {
        if (!this.ballEl) return;
        const count = this.activeTargets.size;

        if (count >= 2) {
            if (this.badgeEl) this.badgeEl.style.display = 'flex';
            if (this.iconEl) this.iconEl.className = 'fa-solid fa-layer-group zero-ball-icon';
            this.ballEl.setAttribute('title', 'Zero 悬浮球 (点击展开快捷菜单)');
        } else if (this.activeTargets.has('preset')) {
            if (this.badgeEl) this.badgeEl.style.display = 'none';
            if (this.iconEl) this.iconEl.className = 'fa-solid fa-list-ul zero-ball-icon';
            this.ballEl.setAttribute('title', '预设管理 (点击唤醒)');
        } else {
            if (this.badgeEl) this.badgeEl.style.display = 'none';
            if (this.iconEl) this.iconEl.className = 'fa-solid fa-camera zero-ball-icon';
            this.ballEl.setAttribute('title', '快照面板 (点击唤醒)');
        }
    }

    updateAutoHideState() {
        if (!this.ballEl) return;
        const state = UiStateManager.get();
        if (state.enableBallAutoHide === false) {
            this.ballEl.classList.add('no-autohide');
        } else {
            this.ballEl.classList.remove('no-autohide');
        }
    }

    bindEvents() {
        const ball = this.ballEl;

        const onStart = (e) => {
            if (e.target.closest('.zero-ball-menu-item')) return;
            if (e.type === 'mousedown' && e.button !== 0) return;

            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            this.startX = clientX;
            this.startY = clientY;
            this.startTime = Date.now();
            this.hasDragged = false;
            this.isTracking = true;

            const rect = ball.getBoundingClientRect();
            this.initialLeft = rect.left;
            this.initialTop = rect.top;

            document.addEventListener('mousemove', onMove, { passive: false });
            document.addEventListener('mouseup', onEnd, { capture: true });
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onEnd, { capture: true });
            document.addEventListener('touchcancel', onEnd, { capture: true });
        };

        const onMove = (e) => {
            if (!this.isTracking) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;

            const deltaX = clientX - this.startX;
            const deltaY = clientY - this.startY;

            if (!this.hasDragged && Math.hypot(deltaX, deltaY) > 6) {
                this.hasDragged = true;
                this.closeMenu();
                ball.classList.remove('docked-left', 'docked-right');
                ball.classList.add('is-dragging');
            }

            if (this.hasDragged) {
                if (e.cancelable) e.preventDefault();

                const vw = window.innerWidth;
                const vh = window.innerHeight;
                const bw = ball.offsetWidth || 42;
                const bh = ball.offsetHeight || 42;

                const newLeft = Math.max(0, Math.min(vw - bw, this.initialLeft + deltaX));
                const newTop = Math.max(20, Math.min(vh - bh - 20, this.initialTop + deltaY));

                ball.style.left = `${newLeft}px`;
                ball.style.right = 'auto';
                ball.style.top = `${newTop}px`;
            }
        };

        const onEnd = (e) => {
            if (!this.isTracking) return;
            this.isTracking = false;

            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd, { capture: true });
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd, { capture: true });
            document.removeEventListener('touchcancel', onEnd, { capture: true });

            const duration = Date.now() - this.startTime;
            ball.classList.remove('is-dragging');

            if (!this.hasDragged || duration < 220) {
                // Click or tap
                if (e.cancelable) e.preventDefault();
                e.stopPropagation();
                this.handleClick(e);
                return;
            }

            // Dragged -> snap to nearest edge
            this.snapToEdge(true);
        };

        ball.addEventListener('mousedown', onStart);
        ball.addEventListener('touchstart', onStart, { passive: true });

        // Menu click handling
        this.menuEl.addEventListener('click', (e) => {
            const item = e.target.closest('.zero-ball-menu-item');
            if (item) {
                e.stopPropagation();
                const action = item.dataset.action;
                this.triggerAction(action);
            }
        });

        // Close menu on click outside
        document.addEventListener('pointerdown', (e) => {
            if (this.isMenuOpen && !ball.contains(e.target)) {
                this.closeMenu();
            }
        });

        // Window resize keeps ball on edge
        window.addEventListener('resize', () => {
            if (this.ballEl && this.ballEl.style.display !== 'none') {
                this.snapToEdge(false);
            }
        });
    }

    snapToEdge(animate = true) {
        const ball = this.ballEl;
        if (!ball) return;

        const rect = ball.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const bw = ball.offsetWidth || 42;
        const bh = ball.offsetHeight || 42;

        const centerX = rect.left + bw / 2;
        const snapToRight = centerX >= vw / 2;
        this.dockSide = snapToRight ? 'right' : 'left';

        const finalTop = Math.max(20, Math.min(vh - bh - 20, rect.top));
        this.currentTop = finalTop;
        this.savePosition(this.dockSide, finalTop);

        if (animate) {
            const targetLeft = snapToRight ? vw - bw : 0;
            ball.style.transition = 'left 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), top 0.22s cubic-bezier(0.2, 0.9, 0.3, 1), transform 0.22s ease, opacity 0.22s ease';
            ball.style.left = `${targetLeft}px`;
            ball.style.right = 'auto';
            ball.style.top = `${finalTop}px`;

            setTimeout(() => {
                if (!ball) return;
                ball.style.transition = '';
                if (this.dockSide === 'right') {
                    ball.style.left = 'auto';
                    ball.style.right = '0px';
                    ball.classList.remove('docked-left');
                    ball.classList.add('docked-right');
                } else {
                    ball.style.left = '0px';
                    ball.style.right = 'auto';
                    ball.classList.remove('docked-right');
                    ball.classList.add('docked-left');
                }
                this.updateAutoHideState();
            }, 220);
        } else {
            ball.style.transition = 'none';
            ball.style.top = `${finalTop}px`;
            if (this.dockSide === 'right') {
                ball.style.left = 'auto';
                ball.style.right = '0px';
                ball.classList.remove('docked-left');
                ball.classList.add('docked-right');
            } else {
                ball.style.left = '0px';
                ball.style.right = 'auto';
                ball.classList.remove('docked-right');
                ball.classList.add('docked-left');
            }
            this.updateAutoHideState();
        }
    }

    handleClick(e) {
        if (e && e.target && e.target.closest('.zero-ball-menu-item')) return;

        const count = this.activeTargets.size;
        if (count >= 2) {
            // Multiple minimized targets -> toggle mini popup menu
            if (this.isMenuOpen) {
                this.closeMenu();
            } else {
                this.openMenu();
            }
        } else {
            // Single target -> direct restore
            const targetId = this.lastActiveTarget || (this.activeTargets.has('preset') ? 'preset' : 'snapshot');
            this.triggerAction(targetId);
        }
    }

    triggerAction(targetId) {
        this.closeMenu();
        const callback = this.activeTargets.get(targetId);
        if (typeof callback === 'function') {
            callback();
        } else {
            // Fallback: restore via direct module calls
            if (targetId === 'snapshot') {
                import('../qr-snapshot/ui.js').then(m => m.restoreSnapshotUI()).catch(() => {});
            } else {
                import('./window.js').then(m => m.WindowManager.restore()).catch(() => {});
            }
        }
        this.hide(targetId);
    }

    openMenu() {
        if (!this.menuEl) return;
        this.isMenuOpen = true;
        this.menuEl.style.display = 'flex';
        this.ballEl.classList.add('menu-open');
    }

    closeMenu() {
        if (!this.menuEl) return;
        this.isMenuOpen = false;
        this.menuEl.style.display = 'none';
        if (this.ballEl) this.ballEl.classList.remove('menu-open');
    }
}

export const FloatingBall = new FloatingBallManager();
