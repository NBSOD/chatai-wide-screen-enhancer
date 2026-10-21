// ==UserScript==
// @name         AI 宽屏优化
// @namespace    https://github.com/NBSOD/chatai-wide-screen-enhancer
// @author       NBSOD
// @version      1.1.0
// @description  DeepSeek 网页端宽屏 + 表格显示优化 + 自动折叠深度思考
// @match        *://chat.deepseek.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-end
// @license      MIT
// @noframes
// @homepageURL  https://github.com/NBSOD/chatai-wide-screen-enhancer
// @supportURL   https://github.com/NBSOD/chatai-wide-screen-enhancer/issues
// @updateURL    https://raw.githubusercontent.com/NBSOD/chatai-wide-screen-enhancer/main/chatai-wide-screen-enhancer.user.js
// @downloadURL  https://raw.githubusercontent.com/NBSOD/chatai-wide-screen-enhancer/main/chatai-wide-screen-enhancer.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        collapseThinking: readSetting('collapseThinking', true),
    };

    function readSetting(key, fallback) {
        try {
            const v = GM_getValue(key, fallback);
            return v === undefined ? fallback : v;
        } catch (e) {
            return fallback;
        }
    }

    function writeSetting(key, value) {
        try {
            GM_setValue(key, value);
        } catch (e) { /* 脚本管理器不支持时忽略 */ }
    }

    function unregisterMenu(id) {
        if (id === null || id === undefined) return;
        try {
            GM_unregisterMenuCommand(id);
        } catch (e) { /* 部分管理器未实现，忽略 */ }
    }

    const IS_DS = location.hostname.includes('deepseek');

    /* ------------------------------------------------------------------ *
     * 样式
     * ------------------------------------------------------------------ */

    // 宽屏：只作用于对话区，输入框 / 侧边栏不受影响
    const WIDE_CSS = `
        .ds-virtual-list-items {
            padding-left: 24px !important;
            padding-right: 24px !important;
        }
        .ds-markdown, .md-content,
        .ds-virtual-list-items [class*="markdown"] {
            max-width: 100% !important;
            width: 100% !important;
        }
        .ds-markdown table, .md-content table,
        .ds-virtual-list-items [class*="markdown"] table {
            width: 100% !important;
            table-layout: auto !important;
        }
        /* 宽表格横向滚动（纯 CSS，无需改写 React 的 DOM） */
        div:has(> table) {
            overflow-x: auto !important;
            max-width: 100% !important;
        }
    `;

    const TABLE_CSS = `
        table {
            width: 100% !important;
            table-layout: auto !important;
            border-collapse: collapse !important;
            margin: 1em 0 !important;
        }
        table th, table td {
            padding: 8px 12px !important;
            border: 1px solid #ccc !important;
            text-align: left !important;
            vertical-align: top !important;
        }
        table th {
            background: rgba(0,0,0,0.04) !important;
            font-weight: 600 !important;
        }
        table tr:nth-child(even) {
            background: rgba(0,0,0,0.02) !important;
        }
        @media (prefers-color-scheme: dark) {
            table th, table td {
                border-color: #444 !important;
            }
            table th {
                background: rgba(255,255,255,0.06) !important;
            }
            table tr:nth-child(even) {
                background: rgba(255,255,255,0.02) !important;
            }
        }
    `;

    // 折叠期间关闭滚动锚定，避免浏览器补偿布局位移导致页面跳动
    const COLLAPSE_CSS = `
        [data-ai-hide-think] {
            overflow-anchor: none !important;
        }
    `;

    function injectStyles() {
        const css = [TABLE_CSS, WIDE_CSS];
        if (CONFIG.collapseThinking && IS_DS) css.push(COLLAPSE_CSS);

        const old = document.getElementById('ai-wide-enhancer-style');
        if (old) old.remove();

        const style = document.createElement('style');
        style.id = 'ai-wide-enhancer-style';
        style.textContent = css.join('\n');
        document.head.appendChild(style);
    }

    /* ------------------------------------------------------------------ *
     * 折叠深度思考
     * ------------------------------------------------------------------ */

    const _releaseHandlers = new WeakMap(); // container -> 标题栏 click 处理器
    let _collapseTimer = null;
    let _selfClick = false;                 // 标记脚本自己触发的 click

    /** 定位标题栏末尾的 chevron 折叠按钮 */
    function findToggleButton(header) {
        if (!header) return null;

        const icons = header.querySelectorAll(':scope > .ds-icon');
        if (icons.length) return icons[icons.length - 1];

        if (header.matches('button, [role="button"]')) return header;
        return header.querySelector('button, [role="button"]');
    }

    /**
     * 读取当前展开状态。
     * 若页面暴露 aria-expanded 则返回 true/false（权威值，不受虚拟列表节点复用影响），
     * 否则返回 null，调用方回退到自维护的标记。
     */
    function readExpanded(container) {
        const header = container.children[0];
        if (!header) return null;

        for (const el of [header, findToggleButton(header)]) {
            if (!el || typeof el.getAttribute !== 'function') continue;
            const v = el.getAttribute('aria-expanded');
            if (v === 'true') return true;
            if (v === 'false') return false;
        }
        return null;
    }

    /** 用户点了标题栏（无论文字还是箭头）就交还控制权，避免和用户互相拉扯 */
    function bindRelease(container, header) {
        if (_releaseHandlers.has(container)) return;

        const handler = () => {
            if (_selfClick) return; // 脚本自己触发的折叠不算用户操作
            container.removeAttribute('data-ai-hide-think');
            container.removeAttribute('data-ai-collapsed');
            delete container.dataset.aiCollapsed;
            container.style.overflowAnchor = '';
            header.removeEventListener('click', handler);
            _releaseHandlers.delete(container);
        };

        _releaseHandlers.set(container, handler);
        header.addEventListener('click', handler);
    }

    function clickToggle(container, header) {
        const btn = findToggleButton(header);
        if (!btn) return false;

        container.style.overflowAnchor = 'none';
        _selfClick = true;
        try {
            btn.click();
        } finally {
            _selfClick = false;
        }
        container.dataset.aiCollapsed = '1';
        bindRelease(container, header);
        return true;
    }

    /**
     * 尽早给思考容器打标记。
     * 特征：首个子元素的直接子级含 .ds-icon，且文本含「思考」（已思考 / 思考中）。
     * 返回是否标记了新容器。
     */
    function hideThinkingEarly(root) {
        if (!root || typeof root.querySelector !== 'function') return false;
        // 快速排除：整棵子树里连一个图标都没有，不可能是思考容器
        if (!root.querySelector('.ds-icon')) return false;

        let marked = false;

        const check = (el) => {
            if (el.children.length < 2) return;
            if (el.hasAttribute('data-ai-hide-think')) return;
            // 输入框的「深度思考 / 智能搜索」切换按钮，不能碰
            if (el.classList.contains('ds-toggle-button')) return;

            const first = el.children[0];
            // .ds-icon 必须是直接子级，避免误伤弹窗（弹窗的图标在按钮里）
            if (!first.querySelector || !first.querySelector(':scope > .ds-icon')) return;

            if (!(first.textContent || '').includes('思考')) return;

            el.setAttribute('data-ai-hide-think', '1');
            el.style.overflowAnchor = 'none';
            marked = true;
        };

        if (root.tagName === 'DIV') check(root);
        root.querySelectorAll('div').forEach(check);
        return marked;
    }

    function collapseDeepThink() {
        if (!CONFIG.collapseThinking || !IS_DS) return;

        // 清理历史版本误标在输入框切换按钮上的残留
        document.querySelectorAll('.ds-toggle-button[data-ai-hide-think]').forEach(el => {
            el.removeAttribute('data-ai-hide-think');
            el.removeAttribute('data-ai-collapsed');
            delete el.dataset.aiCollapsed;
        });

        document.querySelectorAll('[data-ai-hide-think]').forEach(container => {
            if (container.classList.contains('ds-toggle-button')) return;

            const header = container.children[0];
            if (!header) return;

            const expanded = readExpanded(container);

            // 权威状态：明确展开就折叠（节点被复用也能正确处理）
            if (expanded === true) {
                clickToggle(container, header);
                return;
            }
            // 权威状态：明确已折叠，只补标记，不重复点击
            if (expanded === false) {
                container.dataset.aiCollapsed = '1';
                return;
            }
            // 无权威状态时退回自维护标记
            if (container.dataset.aiCollapsed === '1') return;
            clickToggle(container, header);
        });
    }

    /** 清掉容器上的全部标记与事件绑定 */
    function clearFlags(container) {
        const header = container.children[0];

        container.removeAttribute('data-ai-hide-think');
        container.removeAttribute('data-ai-collapsed');
        delete container.dataset.aiCollapsed;
        container.style.overflowAnchor = '';

        if (!header) return;
        const handler = _releaseHandlers.get(container);
        if (handler) {
            header.removeEventListener('click', handler);
            _releaseHandlers.delete(container);
        }
    }

    /** 关闭折叠功能：展开此前由我们折叠的区块，并清掉全部标记 */
    function teardownThinking() {
        const nodes = new Set([
            ...document.querySelectorAll('[data-ai-hide-think]'),
            ...document.querySelectorAll('[data-ai-collapsed]'),
        ]);

        nodes.forEach(container => {
            // 输入框切换按钮永远不处理（仅清理旧版本误标的残留）
            if (container.classList.contains('ds-toggle-button')) {
                clearFlags(container);
                return;
            }

            const wasCollapsed = container.dataset.aiCollapsed === '1';
            const header = container.children[0];

            // 把之前由我们折叠的重新展开（先读状态，再清标记）
            if (wasCollapsed && header && readExpanded(container) !== true) {
                clickToggle(container, header);
            }

            clearFlags(container);
        });
    }

    function observeDOM() {
        const observer = new MutationObserver((mutations) => {
            if (!CONFIG.collapseThinking || !IS_DS) return;

            const seen = new WeakSet(); // 单批次内去重，避免重复扫描同一子树
            let marked = false;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1 || seen.has(node)) continue;
                    seen.add(node);
                    if (hideThinkingEarly(node)) marked = true;
                }
            }

            // 没有任何新思考容器就不必跑后续流程
            if (!marked) return;
            clearTimeout(_collapseTimer);
            _collapseTimer = setTimeout(collapseDeepThink, 200);
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    /* ------------------------------------------------------------------ *
     * 脚本管理器菜单
     * ------------------------------------------------------------------ */

    function registerMenuCommands() {
        let ids = [];

        function updateMenu() {
            ids.forEach(unregisterMenu);
            ids = [];

            ids.push(GM_registerMenuCommand(
                `🧠 折叠深度思考 ${CONFIG.collapseThinking ? '✅' : '❌'}`,
                () => {
                    CONFIG.collapseThinking = !CONFIG.collapseThinking;
                    writeSetting('collapseThinking', CONFIG.collapseThinking);
                    refreshStyles();
                    updateMenu();
                }
            ));

            if (CONFIG.collapseThinking && IS_DS) {
                ids.push(GM_registerMenuCommand('🔄 重置折叠状态', () => {
                    teardownThinking();
                    hideThinkingEarly(document.body);
                    setTimeout(collapseDeepThink, 300);
                }));
            }
        }

        updateMenu();
    }

    /* ------------------------------------------------------------------ *
     * 启动
     * ------------------------------------------------------------------ */

    function refreshStyles() {
        injectStyles();

        if (CONFIG.collapseThinking && IS_DS) {
            hideThinkingEarly(document.body); // 重新标记（仅在切换开关时执行一次）
            setTimeout(collapseDeepThink, 300);
        } else {
            teardownThinking();
        }
    }

    function init() {
        console.log('[AI 宽屏优化] 平台:', IS_DS ? 'deepseek' : 'unknown');
        injectStyles();

        if (CONFIG.collapseThinking && IS_DS) {
            hideThinkingEarly(document.body);
            setTimeout(collapseDeepThink, 800);
        }

        observeDOM();
        registerMenuCommands();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();