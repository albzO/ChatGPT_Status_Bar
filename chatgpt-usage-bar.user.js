// ==UserScript==
// @name         ChatGPT Usage in Profile Row
// @namespace    https://chatgpt.com/
// @version      5.0.0
// @description  在 ChatGPT 左下角账户栏显示剩余 Usage，并提供按需刷新提示
// @match        https://chatgpt.com/*
// @match        https://www.chatgpt.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    /*
     * 安全边界
     *
     * - 只请求 chatgpt.com 同源接口
     * - Access Token / Account ID 只存在于函数局部变量
     * - 不写入 localStorage / sessionStorage / IndexedDB
     * - 默认不输出调试日志
     * - UI 只使用静态模板，动态内容统一通过 textContent / style 写入
     *
     * 注意
     *
     * - /api/auth/session 和 /backend-api/wham/usage 都是内部接口
     * - 页面 DOM selector 也可能随 ChatGPT 更新而变化
     * - 后续失效时优先检查 SELECTOR 和 API_PATH
     */

    // =========================================================
    // 1. 可维护配置
    // =========================================================

    const CONFIG = Object.freeze({
        debug: false,

        hoverHoldMs: 2_000,
        hoverCooldownMs: 60_000,

        resumeThresholdMs: 5 * 60_000,
        generationEndDelayMs: 2_000,
        completionMinAgeMs: 15_000,

        generationCheckMs: 750,
        mountRetryMs: 500,
        requestTimeoutMs: 10_000
    });

    const API_PATH = Object.freeze({
        session: '/api/auth/session',
        usage: '/backend-api/wham/usage'
    });

    const SELECTOR = Object.freeze({
        profileMenuButton: 'button[aria-label="Open profile menu"]',
        stopButton: 'button[aria-label="Stop"]'
    });

    const UI = Object.freeze({
        rootId: 'az-chatgpt-usage',
        styleId: 'az-chatgpt-usage-style'
    });

    // =========================================================
    // 2. Runtime State
    // =========================================================

    const state = {
        usage: null,

        request: {
            running: false,
            lastSuccessAt: 0,
            lastCompletionAt: 0
        },

        generation: {
            wasGenerating: false,
            endTimer: null
        },

        hover: {
            boundRow: null,
            isHovered: false,
            chargeTimer: null,
            cooldownUntil: 0,
            cooldownFrame: null
        },

        dom: {
            observerScheduled: false,
            activated: false
        }
    };

    // =========================================================
    // 3. Debug
    // =========================================================

    function debugLog(...args) {
        if (CONFIG.debug) {
            console.debug('[ChatGPT Usage]', ...args);
        }
    }

    function debugError(context, error) {
        if (CONFIG.debug) {
            console.error(`[ChatGPT Usage] ${context}`, error);
        }
    }

    // =========================================================
    // 4. 通用工具
    // =========================================================

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function toFiniteNumber(value, fallback = null) {
        const number = Number(value);
        return Number.isFinite(number) ? number : fallback;
    }

    function findFirstProperty(object, names, depth = 0) {
        if (!object || typeof object !== 'object' || depth > 8) {
            return null;
        }

        for (const name of names) {
            if (object[name] !== undefined && object[name] !== null) {
                return object[name];
            }
        }

        for (const value of Object.values(object)) {
            if (!value || typeof value !== 'object') {
                continue;
            }

            const result = findFirstProperty(value, names, depth + 1);

            if (result !== null) {
                return result;
            }
        }

        return null;
    }

    function decodeJwtPayload(token) {
        try {
            const encodedPayload = token.split('.')[1];

            if (!encodedPayload) {
                return null;
            }

            const normalized = encodedPayload
                .replace(/-/g, '+')
                .replace(/_/g, '/');

            const padded =
                normalized +
                '='.repeat((4 - (normalized.length % 4)) % 4);

            const decoded = atob(padded)
                .split('')
                .map(char =>
                    `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`
                )
                .join('');

            return JSON.parse(decodeURIComponent(decoded));
        } catch {
            return null;
        }
    }

    async function fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();

        const timer = setTimeout(
            () => controller.abort(),
            CONFIG.requestTimeoutMs
        );

        try {
            return await fetch(url, {
                credentials: 'include',
                cache: 'no-store',
                ...options,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timer);
        }
    }

    // =========================================================
    // 5. Auth
    // =========================================================

    async function getAuthContext() {
        const response = await fetchWithTimeout(API_PATH.session);

        if (!response.ok) {
            throw new Error(`Session request failed: ${response.status}`);
        }

        const session = await response.json();

        const token = findFirstProperty(session, [
            'accessToken',
            'access_token'
        ]);

        if (!token || typeof token !== 'string') {
            throw new Error('Session access token unavailable');
        }

        let accountId = findFirstProperty(session, [
            'chatgpt_account_id',
            'chatgptAccountId',
            'account_id',
            'accountId'
        ]);

        if (!accountId) {
            const jwtPayload = decodeJwtPayload(token);

            accountId = findFirstProperty(jwtPayload, [
                'chatgpt_account_id',
                'chatgptAccountId',
                'account_id',
                'accountId'
            ]);
        }

        /*
         * 不缓存 token / accountId
         *
         * 它们只用于当前一次 Usage 请求
         */
        return {
            token,
            accountId: accountId || null
        };
    }

    // =========================================================
    // 6. Usage API
    // =========================================================

    async function fetchUsagePayload() {
        const { token, accountId } = await getAuthContext();

        const headers = {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`
        };

        /*
         * 已知 Account ID 时直接附加
         * 避免先 401/403 再重试造成额外请求
         */
        if (accountId) {
            headers['ChatGPT-Account-Id'] = accountId;
        }

        const response = await fetchWithTimeout(API_PATH.usage, {
            method: 'GET',
            headers
        });

        if (!response.ok) {
            throw new Error(`Usage request failed: ${response.status}`);
        }

        return response.json();
    }

    // =========================================================
    // 7. Usage 数据
    // =========================================================

    function parseUsageWindow(rawWindow) {
        if (!rawWindow) {
            return null;
        }

        const usedPercent = toFiniteNumber(rawWindow.used_percent);
        const windowSeconds = toFiniteNumber(
            rawWindow.limit_window_seconds,
            0
        );
        const resetAt = toFiniteNumber(rawWindow.reset_at, 0);

        /*
         * used_percent 缺失时不伪造 100% remaining
         */
        if (usedPercent === null) {
            return null;
        }

        const used = clamp(usedPercent, 0, 100);

        return {
            used,
            remaining: clamp(100 - used, 0, 100),
            seconds: Math.max(0, windowSeconds),
            resetAt: Math.max(0, resetAt)
        };
    }

    function parseUsagePayload(payload) {
        const rateLimit =
            payload?.rate_limit ??
            payload?.rate_limits ??
            {};

        return [
            parseUsageWindow(rateLimit.primary_window),
            parseUsageWindow(rateLimit.secondary_window)
        ]
            .filter(Boolean)
            .sort((a, b) => a.seconds - b.seconds);
    }

    function formatWindowLabel(seconds) {
        if (!seconds) {
            return '--';
        }

        const hours = seconds / 3600;

        if (hours >= 4 && hours <= 6) {
            return '5h';
        }

        if (hours >= 150 && hours <= 180) {
            return '7d';
        }

        if (hours >= 20 && hours <= 28) {
            return '24h';
        }

        if (hours >= 24) {
            return `${Math.round(hours / 24)}d`;
        }

        return `${Math.round(hours)}h`;
    }

    function formatResetCountdown(timestamp) {
        if (!timestamp) {
            return '';
        }

        let seconds =
            timestamp -
            Math.floor(Date.now() / 1000);

        if (seconds <= 0) {
            return 'resetting';
        }

        const days = Math.floor(seconds / 86_400);
        seconds %= 86_400;

        const hours = Math.floor(seconds / 3_600);
        seconds %= 3_600;

        const minutes = Math.floor(seconds / 60);

        if (days > 0) {
            return `${days}d ${hours}h`;
        }

        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }

        return `${minutes}m`;
    }

    // =========================================================
    // 8. ChatGPT DOM
    // =========================================================

    function isVisible(element) {
        if (!element) {
            return false;
        }

        const rect = element.getBoundingClientRect();

        return rect.width > 0 && rect.height > 0;
    }

    function findProfileMenuButton() {
        return Array
            .from(document.querySelectorAll(SELECTOR.profileMenuButton))
            .find(isVisible) ?? null;
    }

    function findProfileAccountRow() {
        return findProfileMenuButton()?.parentElement ?? null;
    }

    function findProfileVisualRow() {
        const accountRow = findProfileAccountRow();

        if (!accountRow) {
            return null;
        }

        const button = accountRow.querySelector(
            `:scope > ${SELECTOR.profileMenuButton}`
        );

        const contentWrapper = button?.nextElementSibling;
        const visualRow = contentWrapper?.firstElementChild;

        if (!visualRow || !isVisible(visualRow)) {
            return null;
        }

        const height = visualRow.getBoundingClientRect().height;
        const hasAvatar = Boolean(visualRow.querySelector('img'));

        if (!hasAvatar || height < 30 || height > 60) {
            return null;
        }

        return visualRow;
    }

    function isGenerating() {
        return Array
            .from(document.querySelectorAll(SELECTOR.stopButton))
            .some(isVisible);
    }

    // =========================================================
    // 9. UI Style
    // =========================================================

    function injectStyles() {
        if (document.getElementById(UI.styleId)) {
            return;
        }

        const style = document.createElement('style');

        style.id = UI.styleId;

        style.textContent = `
#${UI.rootId} {
    margin-left: auto;
    width: 138px;
    min-width: 138px;
    padding-left: 6px;

    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 7px;

    flex: 0 0 auto;
    color: inherit;
    pointer-events: none;
    user-select: none;
}

/* ---------- Refresh Ring ---------- */

#${UI.rootId} .az-refresh-ring {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;

    display: flex;
    align-items: center;
    justify-content: center;

    color: inherit;
}

#${UI.rootId} .az-refresh-ring svg {
    width: 18px;
    height: 18px;
    overflow: visible;
    transform: rotate(-90deg);
}

/* 默认完全隐藏 */

#${UI.rootId} .az-ring-track {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    opacity: 0;
}

#${UI.rootId} .az-ring-progress {
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;

    stroke-dasharray: 100;
    stroke-dashoffset: 100;

    opacity: 0;
    transition: opacity 150ms ease;
}

/* Hover 2 秒 */

#${UI.rootId} .az-refresh-ring.charging .az-ring-progress {
    opacity: .78;
}

/* 60 秒 cooldown：颜色与结束前的浅色状态一致 */

#${UI.rootId} .az-refresh-ring.cooldown .az-ring-progress {
    opacity: .10;
}

/* ---------- Usage Meter ---------- */

#${UI.rootId} .az-meter {
    width: 112px;

    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 5px;
}

#${UI.rootId} .az-usage-row {
    display: grid;
    grid-template-columns: 17px minmax(38px, 1fr) 29px;
    align-items: center;
    gap: 4px;

    height: 11px;
    line-height: 1;
}

#${UI.rootId} .az-label {
    font-size: 9px;
    font-weight: 500;
    text-align: left;
    white-space: nowrap;
    opacity: .55;
}

#${UI.rootId} .az-percent {
    font-size: 9px;
    font-weight: 600;
    text-align: right;
    white-space: nowrap;

    opacity: .82;
    font-variant-numeric: tabular-nums;
}

#${UI.rootId} .az-track-wrap {
    position: relative;
    width: 100%;
    height: 4px;
}

#${UI.rootId} .az-track-bg {
    position: absolute;
    inset: 0;

    border-radius: 999px;
    background: currentColor;
    opacity: .14;
}

#${UI.rootId} .az-fill {
    position: absolute;
    inset: 0 auto 0 0;

    border-radius: 999px;
    background: currentColor;
    opacity: .68;

    transition: width 220ms ease;
}

#${UI.rootId}.loading .az-meter {
    opacity: .48;
}

#${UI.rootId}.error .az-meter {
    opacity: .40;
}
`;

        document.head.appendChild(style);
    }

    // =========================================================
    // 10. UI Create / Mount
    // =========================================================

    function createUsageElement() {
        const root = document.createElement('div');

        root.id = UI.rootId;
        root.className = 'loading';

        /*
         * 模板全部为静态字符串
         * 不插入服务器返回值
         */
        root.innerHTML = `
<div
    class="az-refresh-ring"
    title="Hover 2 seconds to refresh Usage"
>
    <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle
            class="az-ring-track"
            cx="10"
            cy="10"
            r="7.5"
            pathLength="100"
        ></circle>

        <circle
            class="az-ring-progress"
            cx="10"
            cy="10"
            r="7.5"
            pathLength="100"
        ></circle>
    </svg>
</div>

<div class="az-meter">
    <div class="az-usage-row">
        <span class="az-label">5h</span>

        <div class="az-track-wrap">
            <div class="az-track-bg"></div>
            <div class="az-fill" style="width: 0%"></div>
        </div>

        <span class="az-percent">--</span>
    </div>

    <div class="az-usage-row">
        <span class="az-label">7d</span>

        <div class="az-track-wrap">
            <div class="az-track-bg"></div>
            <div class="az-fill" style="width: 0%"></div>
        </div>

        <span class="az-percent">--</span>
    </div>
</div>
`;

        return root;
    }

    function ensureMounted() {
        injectStyles();

        const visualRow = findProfileVisualRow();

        if (!visualRow) {
            return {
                root: null,
                created: false
            };
        }

        const existingRoot = visualRow.querySelector(
            `:scope > #${UI.rootId}`
        );

        if (existingRoot) {
            return {
                root: existingRoot,
                created: false
            };
        }

        const root = createUsageElement();

        visualRow.appendChild(root);
        syncRingState(root);

        return {
            root,
            created: true
        };
    }

    // =========================================================
    // 11. Usage Render
    // =========================================================

    function renderUsageWindow(row, windowData) {
        const label = row.querySelector('.az-label');
        const percent = row.querySelector('.az-percent');
        const fill = row.querySelector('.az-fill');

        if (!label || !percent || !fill) {
            return;
        }

        if (!windowData) {
            label.textContent = '--';
            percent.textContent = '--';
            fill.style.width = '0%';
            row.removeAttribute('title');
            return;
        }

        const remaining = Math.round(windowData.remaining);

        label.textContent = formatWindowLabel(windowData.seconds);
        percent.textContent = `${remaining}%`;
        fill.style.width = `${remaining}%`;

        const countdown = formatResetCountdown(windowData.resetAt);

        row.title = countdown
            ? `剩余 ${remaining}% · ${countdown} 后重置`
            : `剩余 ${remaining}%`;
    }

    function renderUsage(root = null) {
        const mountedRoot =
            root ??
            ensureMounted().root;

        if (!mountedRoot || !state.usage) {
            return false;
        }

        mountedRoot.classList.remove('loading', 'error');

        const rows = mountedRoot.querySelectorAll('.az-usage-row');

        renderUsageWindow(rows[0], state.usage[0]);
        renderUsageWindow(rows[1], state.usage[1]);

        return true;
    }

    function setUiLoading(isLoading) {
        const root = ensureMounted().root;

        if (!root) {
            return;
        }

        root.classList.toggle('loading', isLoading);
    }

    function setUiError() {
        const root = ensureMounted().root;

        if (!root) {
            return;
        }

        root.classList.remove('loading');
        root.classList.add('error');

        /*
         * 不把原始错误、token 或 account id 写进 DOM
         */
        root.title = 'Usage unavailable';
    }

    // =========================================================
    // 12. Refresh Policy
    // =========================================================

    async function refreshUsage(reason = 'manual') {
        if (state.request.running) {
            debugLog('skip request: already running', reason);
            return false;
        }

        state.request.running = true;
        setUiLoading(true);

        try {
            const payload = await fetchUsagePayload();
            const parsedUsage = parseUsagePayload(payload);

            if (parsedUsage.length === 0) {
                throw new Error('No valid usage windows');
            }

            state.usage = parsedUsage;
            state.request.lastSuccessAt = Date.now();

            if (reason === 'completion') {
                state.request.lastCompletionAt =
                    state.request.lastSuccessAt;
            }

            renderUsage();

            debugLog('usage refreshed', reason);

            return true;
        } catch (error) {
            debugError(`refresh failed: ${reason}`, error);
            setUiError();

            return false;
        } finally {
            state.request.running = false;
        }
    }

    function smartRefresh(
        reason,
        minimumAgeMs,
        referenceTime = state.request.lastSuccessAt
    ) {
        if (
            referenceTime &&
            Date.now() - referenceTime < minimumAgeMs
        ) {
            debugLog('skip request: fresh enough', reason);
            return false;
        }

        void refreshUsage(reason);

        return true;
    }

    // =========================================================
    // 13. Refresh Ring
    // =========================================================

    function getRingElements(root = null) {
        const mountedRoot =
            root ??
            document.getElementById(UI.rootId);

        if (!mountedRoot) {
            return {
                ring: null,
                progress: null
            };
        }

        return {
            ring: mountedRoot.querySelector('.az-refresh-ring'),
            progress: mountedRoot.querySelector('.az-ring-progress')
        };
    }

    function setRingOffset(value, root = null) {
        const { progress } = getRingElements(root);

        if (!progress) {
            return;
        }

        progress.style.strokeDashoffset = String(
            clamp(value, 0, 100)
        );
    }

    function startHoverCharge() {
        const hoverState = state.hover;

        if (Date.now() < hoverState.cooldownUntil) {
            return;
        }

        if (hoverState.chargeTimer) {
            return;
        }

        const { ring, progress } = getRingElements();

        if (!ring || !progress) {
            return;
        }

        ring.classList.remove('cooldown');
        ring.classList.add('charging');

        progress.style.transition = 'none';
        setRingOffset(100);

        /*
         * 强制提交起始帧
         */
        progress.getBoundingClientRect();

        progress.style.transition =
            `stroke-dashoffset ${CONFIG.hoverHoldMs}ms linear`;

        setRingOffset(0);

        hoverState.chargeTimer = setTimeout(() => {
            hoverState.chargeTimer = null;

            if (!hoverState.isHovered) {
                resetHoverCharge();
                return;
            }

            /*
             * 先进入 cooldown
             *
             * 即使本次请求失败也避免短时间连续重试
             */
            startHoverCooldown();

            void refreshUsage('profile-hover');
        }, CONFIG.hoverHoldMs);
    }

    function resetHoverCharge() {
        const hoverState = state.hover;

        if (hoverState.chargeTimer) {
            clearTimeout(hoverState.chargeTimer);
            hoverState.chargeTimer = null;
        }

        if (Date.now() < hoverState.cooldownUntil) {
            return;
        }

        const { ring, progress } = getRingElements();

        if (!ring || !progress) {
            return;
        }

        ring.classList.remove('charging', 'cooldown');

        progress.style.transition =
            'stroke-dashoffset 160ms ease';

        setRingOffset(100);
    }

    function startHoverCooldown() {
        const hoverState = state.hover;

        if (hoverState.chargeTimer) {
            clearTimeout(hoverState.chargeTimer);
            hoverState.chargeTimer = null;
        }

        hoverState.cooldownUntil =
            Date.now() +
            CONFIG.hoverCooldownMs;

        const { ring, progress } = getRingElements();

        if (ring && progress) {
            ring.classList.remove('charging');
            ring.classList.add('cooldown');

            progress.style.transition = 'none';
            setRingOffset(0);
        }

        if (hoverState.cooldownFrame) {
            cancelAnimationFrame(hoverState.cooldownFrame);
        }

        updateCooldownRing();
    }

    function updateCooldownRing() {
        const hoverState = state.hover;

        const remaining =
            hoverState.cooldownUntil -
            Date.now();

        const { ring, progress } = getRingElements();

        if (remaining <= 0) {
            hoverState.cooldownUntil = 0;
            hoverState.cooldownFrame = null;

            if (ring && progress) {
                ring.classList.remove('cooldown', 'charging');

                /*
                 * cooldown 结束后完全隐藏
                 */
                progress.style.transition =
                    'stroke-dashoffset 180ms ease';

                setRingOffset(100);

                ring.title =
                    'Hover 2 seconds to refresh Usage';
            }

            return;
        }

        const ratio = clamp(
            remaining / CONFIG.hoverCooldownMs,
            0,
            1
        );

        const offset = 100 * (1 - ratio);

        if (ring && progress) {
            ring.classList.remove('charging');
            ring.classList.add('cooldown');

            progress.style.transition = 'none';
            setRingOffset(offset);

            ring.title =
                `Hover refresh cooldown: ${Math.ceil(remaining / 1000)}s`;
        }

        hoverState.cooldownFrame =
            requestAnimationFrame(updateCooldownRing);
    }

    function syncRingState(root = null) {
        const hoverState = state.hover;
        const { ring, progress } = getRingElements(root);

        if (!ring || !progress) {
            return;
        }

        const remaining =
            hoverState.cooldownUntil -
            Date.now();

        if (remaining > 0) {
            ring.classList.remove('charging');
            ring.classList.add('cooldown');

            progress.style.transition = 'none';

            setRingOffset(
                100 * (
                    1 -
                    clamp(
                        remaining / CONFIG.hoverCooldownMs,
                        0,
                        1
                    )
                ),
                root
            );

            return;
        }

        if (!hoverState.chargeTimer) {
            ring.classList.remove('charging', 'cooldown');
            progress.style.transition = 'none';

            setRingOffset(100, root);
        }
    }

    function bindProfileHover() {
        const row = findProfileAccountRow();

        if (!row || state.hover.boundRow === row) {
            return;
        }

        state.hover.boundRow = row;

        row.addEventListener('mouseenter', () => {
            state.hover.isHovered = true;
            startHoverCharge();
        });

        row.addEventListener('mouseleave', () => {
            state.hover.isHovered = false;

            if (Date.now() >= state.hover.cooldownUntil) {
                resetHoverCharge();
            }
        });
    }

    // =========================================================
    // 14. Generation Watch
    // =========================================================

    function checkGenerationState() {
        const generating = isGenerating();
        const generationState = state.generation;

        /*
         * idle -> generating
         */
        if (generating && !generationState.wasGenerating) {
            generationState.wasGenerating = true;

            if (generationState.endTimer) {
                clearTimeout(generationState.endTimer);
                generationState.endTimer = null;
            }

            debugLog('generation started');
            return;
        }

        /*
         * generating -> idle
         */
        if (!generating && generationState.wasGenerating) {
            generationState.wasGenerating = false;

            if (generationState.endTimer) {
                clearTimeout(generationState.endTimer);
            }

            generationState.endTimer = setTimeout(() => {
                generationState.endTimer = null;

                /*
                 * Stop 按钮重新出现
                 * 说明只是中间阶段暂停
                 */
                if (isGenerating()) {
                    generationState.wasGenerating = true;
                    return;
                }

                debugLog('generation completed');

                smartRefresh(
                    'completion',
                    CONFIG.completionMinAgeMs,
                    state.request.lastCompletionAt
                );
            }, CONFIG.generationEndDelayMs);
        }
    }

    // =========================================================
    // 15. Page Resume
    // =========================================================

    function handleVisibilityChange() {
        if (document.visibilityState !== 'visible') {
            return;
        }

        smartRefresh(
            'resume',
            CONFIG.resumeThresholdMs
        );
    }

    // =========================================================
    // 16. SPA DOM Watch
    // =========================================================

    function handleDomMutation() {
        if (state.dom.observerScheduled) {
            return;
        }

        state.dom.observerScheduled = true;

        requestAnimationFrame(() => {
            state.dom.observerScheduled = false;

            const mount = ensureMounted();

            /*
             * 只有节点被重新创建时才重新 render
             *
             * 避免 render 自己触发 MutationObserver
             * 再进入 render loop
             */
            if (mount.created && state.usage) {
                renderUsage(mount.root);
            }

            if (mount.created) {
                syncRingState(mount.root);
            }

            bindProfileHover();
            activateOnceMounted();
        });
    }

    const observer = new MutationObserver(handleDomMutation);

    // =========================================================
    // 17. Init
    // =========================================================

    function activateOnceMounted() {
        if (state.dom.activated) {
            return;
        }

        const mount = ensureMounted();

        if (!mount.root) {
            return;
        }

        state.dom.activated = true;

        bindProfileHover();
        syncRingState(mount.root);

        state.generation.wasGenerating =
            isGenerating();

        void refreshUsage('initial');
    }

    function start() {
        injectStyles();

        document.addEventListener(
            'visibilitychange',
            handleVisibilityChange
        );

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setInterval(
            checkGenerationState,
            CONFIG.generationCheckMs
        );

        /*
         * 初始 Sidebar 可能晚于 userscript 出现
         *
         * 这个 retry 只负责首次 mount
         * 后续 SPA 重建由 MutationObserver 负责
         */
        const mountTimer = setInterval(() => {
            activateOnceMounted();

            if (state.dom.activated) {
                clearInterval(mountTimer);
            }
        }, CONFIG.mountRetryMs);

        activateOnceMounted();
    }

    start();
})();
