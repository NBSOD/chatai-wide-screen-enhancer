// ==UserScript==
// @name         AI 宽屏优化
// @namespace    https://github.com/NBSOD/chatai-wide-screen-enhancer
// @author       NBSOD
// @version      1.1.3
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
           原先的 width:100% 会把宽表格压扁换行，和横向滚动的目标互相打架。
           也不要给表格加 auto 外边距：宽表格下 auto 会两侧溢出，
           左半部分连滚都滚不回来（左右各裁一块，看着就是"不居中"） */
        .ds-virtual-list-items table {
            min-width: 100% !important;
            width: max-content !important;
            max-width: none !important;
            table-layout: auto !important;
        }
        /* 表格的祖先链：任何一层都不要被内容撑宽。
           中间层只要是 flex/grid 项，它的自动最小尺寸（min-width:auto）就会被表格顶大，
           整块溢出列宽，最后被更外层裁掉 —— 表现就是「后面的文字被裁剪」 */
        .ds-virtual-list-items :has(table) {
            min-width: 0 !important;
            max-width: 100% !important;
        }
        /* 表格的直接父元素 = 横向滚动视口。
           必须排在上一条之后：同特异性靠后者生效，得把 overflow 抢回来。
           align-self / justify-self 只为抵消外层「居中」——被居中的超宽元素
           会向两侧溢出，左边那半同样滚不到。
           .ai-table-wrap 是 JS 打的同一份标记：不依赖 :has 的支持，
           也顺便修掉虚拟列表复用节点带来的残留滚动位置 */
        .ds-virtual-list-items :has(> table),
        .ds-virtual-list-items .ai-table-wrap {
            width: 100% !important;
            min-width: 0 !important;
            max-width: 100% !important;
            align-self: stretch !important;
            justify-self: stretch !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            overscroll-behavior-x: contain !important;
            scrollbar-width: thin;
        }
        /* 让「还能横向滚动」这件事可见：滚动条被藏起来时，
           超宽表格看上去就只是被裁掉了。display:block 是为了盖掉站内的隐藏规则 */
        .ds-virtual-list-items :has(> table)::-webkit-scrollbar,
        .ds-virtual-list-items .ai-table-wrap::-webkit-scrollbar {
            display: block !important;
            height: 8px !important;
        }
        .ds-virtual-list-items :has(> table)::-webkit-scrollbar-thumb,
        .ds-virtual-list-items .ai-table-wrap::-webkit-scrollbar-thumb {
            background: rgba(128,128,128,0.45) !important;
            border-radius: 4px !important;
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
     * 表格滚动容器
     * ------------------------------------------------------------------ */

    const TABLE_WRAP_CLASS = 'ai-table-wrap';

    // 表格内部的父元素（td/th/tr 等），不能当滚动容器
    const TABLE_INNER = /^(TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|COLGROUP|COL)$/;

    /**
     * 给表格的直接父元素打上横向滚动容器的标记，并把残留的横向滚动位置归零。
     *
     * 样式里已经用 :has(> table) 覆盖了；这里再标一次，是为了在 :has 不被支持的
     * 浏览器上也能生效 —— 这类选择器一旦静默失效，表格就只是「被裁掉」，
     * 光看页面很难发现是哪条规则没起作用。
     *
     * 顺带把 scrollLeft 归零只是兜底：实测把节点 remove 再 append，
     * Chromium 会把 scrollLeft 重置回 0，所以虚拟列表复用通常不需要这一手；
     * 留着是为了防「就地换掉表格内容」这类不搬迁节点的重渲染路径。
     */
    function markTableWrappers(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        // 快速排除：整棵子树里没有表格就不必往下走
        if (root.tagName !== 'TABLE' && !root.querySelector('table')) return;

        const check = (table) => {
            const wrap = table.parentElement;
            if (!wrap || wrap === document.body) return;
            if (TABLE_INNER.test(wrap.tagName)) return; // 嵌套表格：别动表格内部

            if (!wrap.classList.contains(TABLE_WRAP_CLASS)) {
                wrap.classList.add(TABLE_WRAP_CLASS);
            }
            // 兜底：万一旧滚动位置留了下来，表格会停在中间，两边都看不全
            if (wrap.scrollLeft) wrap.scrollLeft = 0;
        };

        if (root.tagName === 'TABLE') check(root);
        root.querySelectorAll('table').forEach(check);
    }

    /* ------------------------------------------------------------------ *
     * 折叠深度思考
     * ------------------------------------------------------------------ */

    const _releaseHandlers = new WeakMap(); // container -> 标题栏 click 处理器
    let _collapseTimer = null;
    let _selfClick = false;                 // 标记脚本自己触发的 click
    const _lastClick = new WeakMap();       // container -> 上次由脚本点击的时间戳
    const CLICK_COOLDOWN = 800;             // 冷却，杜绝「点击 → 重渲染 → 再点击」反馈环

    // 折叠时的滚动保持（见 toggleKeepingScroll）
    const BOTTOM_SLACK = 100;               // px，判定「是否停在最新内容处」的容差
    const ANCHOR_RESTORE_MS = 600;          // 折叠后多久恢复滚动锚定
    let _scroller = null;                   // 缓存的消息滚动容器
    let _anchorGuardTimer = null;

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

    /* ------------------------------------------------------------------ *
     * 折叠时的滚动保持
     *
     * DeepSeek 用虚拟列表承载消息。折叠「深度思考」会让该区块瞬间变矮，
     * 而浏览器默认的滚动锚定会把这段高度差当成「锚点上方的内容变了」，
     * 主动把 scrollTop 往回拉 —— 表现就是发送后页面自己往上缩一节，
     * 得手动往下拉才能看到刚发的内容和回复。
     *
     * 只在被折叠的元素上写 overflow-anchor:none 是不够的：浏览器挑中的锚点
     * 往往是它下方正在流式输出的正文，那个元素照样会被位移、照样触发补偿。
     * 所以这里直接关掉滚动容器的锚定，并按「折叠前是否停在最新内容处」修回：
     *   - 停在底部 → 钉回底部（把人留在最新内容处）
     *   - 在读历史 → 保持折叠区底边在视口中的位置不变（下方正文不跳）
     * 修正是幂等的（用内容坐标反解目标 scrollTop），折叠动画或后续重渲染
     * 期间重复调用也不会把页面越推越远。
     * ------------------------------------------------------------------ */

    function isScrollable(el) {
        if (!el || el.nodeType !== 1) return false;
        let v;
        try {
            v = getComputedStyle(el).overflowY;
        } catch (e) {
            return false;
        }
        return v === 'auto' || v === 'scroll' || v === 'overlay';
    }

    /** 定位承载消息列表的滚动容器（缓存；节点脱离文档时自动重新解析） */
    function getScroller(from) {
        if (_scroller && _scroller.isConnected) return _scroller;

        const start = (from && from.nodeType === 1)
            ? from
            : document.querySelector('.ds-virtual-list-items');
        let firstScrollable = null;

        // 优先取真正溢出、能滚动的祖先，避免选中一个 overflow:auto 却滚不动的中间层
        for (let p = start && start.parentElement; p; p = p.parentElement) {
            if (!isScrollable(p)) continue;
            if (!firstScrollable) firstScrollable = p;
            if (p.scrollHeight > p.clientHeight + 1) {
                _scroller = p;
                return p;
            }
        }

        _scroller = firstScrollable || document.scrollingElement || document.documentElement;
        return _scroller;
    }

    function isNearBottom(scroller) {
        if (!scroller) return false;
        return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= BOTTOM_SLACK;
    }

    /** 折叠 / 展开一次，并把滚动位置修回来；返回是否真的点到了折叠按钮 */
    function toggleKeepingScroll(container, header) {
        const scroller = getScroller(container);
        const stick = isNearBottom(scroller);
        const targetBottom = container.getBoundingClientRect().bottom;

        if (scroller) {
            // 先关锚定：否则我们修好之后，浏览器会再按自己的判断拉走一次
            scroller.style.overflowAnchor = 'none';
            clearTimeout(_anchorGuardTimer);
        }

        if (!clickToggle(container, header)) {
            if (scroller) scroller.style.overflowAnchor = '';
            return false;
        }

        const settle = () => {
            if (!scroller || !scroller.isConnected || !container.isConnected) return;

            if (stick) {
                // 停在最新内容处：钉回底部。折叠后内容继续变矮时，
                // 浏览器会自动按新的滚动上限夹紧，不会悬在半空
                scroller.scrollTop = scroller.scrollHeight;
                return;
            }

            // 容器底边在内容坐标里的位置不随折叠改变，用它反解目标 scrollTop
            const contentBottom = scroller.scrollTop + container.getBoundingClientRect().bottom;
            const want = contentBottom - targetBottom;
            if (want !== scroller.scrollTop) scroller.scrollTop = want;
        };

        settle();
        requestAnimationFrame(settle);
        requestAnimationFrame(() => requestAnimationFrame(settle));

        if (scroller) {
            _anchorGuardTimer = setTimeout(() => {
                if (scroller.isConnected) scroller.style.overflowAnchor = '';
            }, ANCHOR_RESTORE_MS);
        }
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
                toggleKeepingScroll(container, header);
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
                toggleKeepingScroll(container, header);
                return;
            }

            // 布局也判断不出来时，才退回自维护标记
            if (container.dataset.aiCollapsed === '1') return;
            toggleKeepingScroll(container, header);
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
                toggleKeepingScroll(container, header);
            }

            clearFlags(container);
        });
    }

    function observeDOM() {
        const observer = new MutationObserver((mutations) => {
            const seen = new WeakSet(); // 单批次内去重，避免重复扫描同一子树
            let found = false;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1 || seen.has(node)) continue;
                    seen.add(node);
                    // 表格滚动容器与折叠开关无关，始终补齐
                    if (IS_DS) markTableWrappers(node);
                    // 包含已标记的复用节点：虚拟列表把节点搬到新消息上时也要重新判定
                    if (CONFIG.collapseThinking && IS_DS && hideThinkingEarly(node)) found = true;
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

        if (IS_DS) markTableWrappers(document.body); // 已渲染出来的表格先标一遍

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