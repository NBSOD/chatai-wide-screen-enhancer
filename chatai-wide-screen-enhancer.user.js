// ==UserScript==
// @name         AI 宽屏优化
// @namespace    https://github.com/NBSOD/chatai-wide-screen-enhancer
// @author       NBSOD
// @version      1.1.1
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
        // 归一化：个别管理器可能把布尔值存成字符串 'false'（truthy），这里显式比对
        collapseThinking: readSetting('collapseThinking', true) !== false,
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
        /* 表格不锁死 100%：窄表格铺满，宽表格按内容撑开（配合下方滚动容器）
           原先的 width:100% 会把宽表格压扁换行，和横向滚动的目标互相打架 */
        .ds-virtual-list-items table {
            min-width: 100% !important;
            width: max-content !important;
            max-width: none !important;
            table-layout: auto !important;
        }
        /* 宽表格横向滚动（纯 CSS，无需改写 React 的 DOM）
           收窄到对话区，避免影响 DeepSeek 自身 UI 里的表格 */
        .ds-virtual-list-items div:has(> table) {
            overflow-x: auto !important;
            max-width: 100% !important;
        }
    `;

    const TABLE_CSS = `
        /* 收窄到对话区：原先的全局 table 选择器会影响 DeepSeek 自身 UI 的表格 */
        .ds-virtual-list-items table,
        .ds-markdown table, .md-content table {
            border-collapse: collapse !important;
            margin: 1em 0 !important;
        }
        /* 中性灰 + 透明度：在浅色和深色主题下都能正常显示，
           不再依赖 prefers-color-scheme（站内主题和系统主题并不一致） */
        .ds-virtual-list-items th, .ds-virtual-list-items td,
        .ds-markdown th, .ds-markdown td,
        .md-content th, .md-content td {
            padding: 8px 12px !important;
            border: 1px solid rgba(128,128,128,0.35) !important;
            text-align: left !important;
            vertical-align: top !important;
        }
        .ds-virtual-list-items th,
        .ds-markdown th, .md-content th {
            background: rgba(128,128,128,0.12) !important;
            font-weight: 600 !important;
        }
        .ds-virtual-list-items tr:nth-child(even),
        .ds-markdown tr:nth-child(even), .md-content tr:nth-child(even) {
            background: rgba(128,128,128,0.06) !important;
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
    const _lastClick = new WeakMap();       // container -> 上次由脚本点击的时间戳
    const CLICK_COOLDOWN = 800;             // 冷却，杜绝「点击 → 重渲染 → 再点击」反馈环

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

    /**
     * 无 aria-expanded 时的兜底：用布局判断内容区是否已经收起。
     * 返回 'collapsed' / 'expanded' / 'unknown'。
     * 之所以不能只信自维护的 data-ai-collapsed 标记：虚拟列表会复用 DOM 节点，
     * 标记会跟着被回收的节点跑到另一条消息上，导致新消息永远不会被折叠。
     */
    function probeCollapsed(container) {
        const body = container.children[1];
        if (!body) return 'unknown';

        let cs;
        try {
            cs = getComputedStyle(body);
        } catch (e) {
            return 'unknown';
        }
        if (cs.display === 'none' || cs.visibility === 'hidden') return 'collapsed';
        if (cs.maxHeight !== 'none' && parseFloat(cs.maxHeight) === 0) return 'collapsed';
        if (cs.height !== 'auto' && parseFloat(cs.height) === 0 && cs.overflow !== 'visible') {
            return 'collapsed';
        }

        try {
            const h = body.getBoundingClientRect().height;
            if (h > 1) return 'expanded';
            if (h === 0) return 'collapsed';
        } catch (e) { /* 忽略，落到 unknown */ }
        return 'unknown';
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
            // 用户手动接管，连冷却状态一起复位
            _lastClick.delete(container);
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
        _lastClick.set(container, Date.now());
        container.dataset.aiCollapsed = '1';
        bindRelease(container, header);
        return true;
    }

    /**
     * 尽早给思考容器打标记。
     * 特征：首个子元素的直接子级含 .ds-icon，且标题是含「思考」的短标签
     * （已思考 / 思考中 / 已思考（用时 12 秒））。
     * 返回是否「发现」思考容器——包括已经标记过的：节点被虚拟列表回收后重新插入时，
     * 只有让调用方认为命中，collapseDeepThink 才会被调度，否则复用节点会漏折叠。
     */
    function hideThinkingEarly(root) {
        if (!root || typeof root.querySelector !== 'function') return false;
        // 快速排除：整棵子树里连一个图标都没有，不可能是思考容器
        if (!root.querySelector('.ds-icon')) return false;

        let found = false;

        const check = (el) => {
            if (el.children.length < 2) return;
            // 输入框的「深度思考 / 智能搜索」切换按钮，不能碰
            if (el.classList.contains('ds-toggle-button')) return;
            // 输入区域（含输入控件 / 可编辑元素）不碰
            if (el.querySelector('textarea, input, [contenteditable="true"]')) return;

            const first = el.children[0];
            // .ds-icon 必须是直接子级，避免误伤弹窗（弹窗的图标在按钮里）
            if (!first.querySelector || !first.querySelector(':scope > .ds-icon')) return;

            // 标题应当是短标签，而不是含「思考」字样的长段落
            // （原实现只做 includes('思考')，任何带图标又提到「思考」的容器都会中招）
            const label = (first.textContent || '').trim();
            if (!label.includes('思考') || label.length > 30) return;

            found = true;
            // 已经标记过：可能只是节点被复用，仍需让调用方重新判定一次状态
            if (el.hasAttribute('data-ai-hide-think')) return;

            el.setAttribute('data-ai-hide-think', '1');
            el.style.overflowAnchor = 'none';
        };

        if (root.tagName === 'DIV') check(root);
        root.querySelectorAll('div').forEach(check);
        return found;
    }

    function collapseDeepThink() {
        if (!CONFIG.collapseThinking || !IS_DS) return;

        // 清理历史版本误标在输入框切换按钮上的残留
        document.querySelectorAll('.ds-toggle-button[data-ai-hide-think]').forEach(el => {
            el.removeAttribute('data-ai-hide-think');
            el.removeAttribute('data-ai-collapsed');
            delete el.dataset.aiCollapsed;
        });

        const now = Date.now();

        document.querySelectorAll('[data-ai-hide-think]').forEach(container => {
            if (container.classList.contains('ds-toggle-button')) return;

            const header = container.children[0];
            if (!header) return;

            // 冷却：脚本刚点过就不再点，避免「点击 → 重渲染 → 再点击」的反馈环
            if (now - (_lastClick.get(container) || 0) < CLICK_COOLDOWN) return;

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

            // 无 aria-expanded：优先看布局。这样被虚拟列表回收、标记已经错位的节点
            // 也能按真实状态重新折叠，而不是被过期的 data-ai-collapsed 骗过去
            const probed = probeCollapsed(container);
            if (probed === 'collapsed') {
                container.dataset.aiCollapsed = '1';
                return;
            }
            if (probed === 'expanded') {
                clickToggle(container, header);
                return;
            }

            // 布局也判断不出来时，才退回自维护标记
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
        // 一并清掉冷却：teardown 刚点过（展开），紧接着就要能重新折叠，
        // 否则「重置折叠状态」「关→开开关」会被 800ms 冷却挡住，区块停在展开态
        _lastClick.delete(container);

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
            let found = false;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1 || seen.has(node)) continue;
                    seen.add(node);
                    // 包含已标记的复用节点：虚拟列表把节点搬到新消息上时也要重新判定
                    if (hideThinkingEarly(node)) found = true;
                }
            }

            // 没有发现思考容器就不必跑后续流程
            if (!found) return;
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
        let registrationStale = false;

        function updateMenu() {
            // 若管理器不支持注销菜单项（GM_registerMenuCommand 拿不到 id），就只注册一次：
            // 否则每切换一次开关都会多出一个菜单项
            if (registrationStale) return;
            if (ids.some(id => id === null || id === undefined)) {
                registrationStale = true;
                return;
            }

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
        injectStyles();

        if (CONFIG.collapseThinking && IS_DS) {
            hideThinkingEarly(document.body);
            setTimeout(collapseDeepThink, 800);
        }

        observeDOM();
        registerMenuCommands();

        // 选择器自检：类名是 DeepSeek 的内部实现，改名后脚本会「静默失效」
        // （页面看起来正常，只是不再生效），这里给一句明确的提示
        setTimeout(() => {
            if (!document.querySelector('.ds-virtual-list-items')) {
                console.warn('[AI 宽屏优化] 未找到 .ds-virtual-list-items，宽屏/表格样式可能已失效（DeepSeek 可能改了类名）');
            }
        }, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();