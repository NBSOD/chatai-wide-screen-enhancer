// ==UserScript==
// @name         AI 宽屏优化
// @namespace    https://github.com/NBSOD/chatai-wide-screen-enhancer
// @author       deepseek-v4-flash
// @version      1.0.16
// @description  DeepSeek 网页端宽屏 + 表格显示优化 + 自动折叠深度思考
// @match        *://chat.deepseek.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        collapseThinking: GM_getValue('collapseThinking', true),
    };

    const PLATFORM = (() => {
        const host = location.hostname;
        if (host.includes('deepseek')) return 'deepseek';
        return 'unknown';
    })();

    // 平台选择器
    const SELECTORS = {
        deepseek: {
            extraCSS: `
                .ds-virtual-list-items {
                    padding-left: 24px !important;
                    padding-right: 24px !important;
                }
                .ds-markdown, .md-content, [class*="markdown"] {
                    max-width: 100% !important;
                    width: 100% !important;
                }
                .ds-markdown table, .md-content table, [class*="markdown"] table {
                    width: 100% !important;
                    table-layout: auto !important;
                }
                div:has(> table) {
                    overflow-x: auto !important;
                    max-width: 100% !important;
                }
            `,
        },
    };

    const S = SELECTORS[PLATFORM] || SELECTORS.deepseek;

    function injectStyles() {
        const css = [];

        if (CONFIG.collapseThinking && PLATFORM === 'deepseek') {
            css.push(`
                /* 预先隐藏思考内容，用户点击标题栏时释放 */
                [data-ai-hide-think] {
                    overflow-anchor: none !important;
                }
                [data-ai-hide-think] > div:last-child {
                    display: none !important;
                }
            `);
        }

        css.push(`
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
            `);

        if (S.extraCSS) {
            css.push(S.extraCSS);
        }

        const style = document.createElement('style');
        style.textContent = css.join('\n');
        style.id = 'ai-wide-enhancer-style';
        document.head.appendChild(style);
    }

    function wrapTables() {
        document.querySelectorAll('table').forEach(t => {
            if (t.parentElement?.classList.contains('ai-table-wrapper')) return;
            const p = t.parentElement;
            if (p && (getComputedStyle(p).overflow === 'auto' || getComputedStyle(p).overflow === 'scroll')) return;
            if (t.closest('[class*="overflow"]')) return;
            const w = document.createElement('div');
            w.className = 'ai-table-wrapper';
            w.style.cssText = 'overflow-x: auto; max-width: 100%; margin: 1em 0;';
            t.parentNode.insertBefore(w, t);
            w.appendChild(t);
        });
    }

    let _collapseTimer = null;

    function observeDOM() {
        const observer = new MutationObserver((mutations) => {
            wrapTables();
            if (CONFIG.collapseThinking && PLATFORM === 'deepseek') {
                clearTimeout(_collapseTimer);

                // 在新增节点中尽早捕获思考容器（不等"已思考"文本）
                for (const mutation of mutations) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === 1) {
                            hideThinkingEarly(node);
                        }
                    }
                }

                _collapseTimer = setTimeout(collapseDeepThink, 200);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function hideThinkingEarly(root) {
        // 特征：思考容器标题栏包含"思考"文字 + .ds-icon
        const check = (el) => {
            if (el.children.length >= 2 && !el.hasAttribute('data-ai-hide-think')) {
                // 跳过 ds-toggle-button（输入框的"深度思考/智能搜索"切换按钮）
                if (el.classList.contains('ds-toggle-button')) return;

                const first = el.children[0];
                // 必须 .ds-icon 是直接子元素，防止误杀弹窗（弹窗的 .ds-icon 在按钮里）
                if (first.querySelector && first.querySelector(':scope > .ds-icon')) {
                    // 检查标题栏是否包含"思考"文字（已思考/思考中），排除输入框切换按钮
                    const text = first.textContent || '';
                    if (text.includes('思考')) {
                        el.setAttribute('data-ai-hide-think', '1');
                        el.style.overflowAnchor = 'none';
                    }
                }
            }
        };

        if (root.tagName === 'DIV') check(root);
        if (root.querySelectorAll) {
            root.querySelectorAll('div').forEach(check);
        }
    }

    function collapseDeepThink() {
        if (!CONFIG.collapseThinking || PLATFORM !== 'deepseek') return;

        // 清理之前误伤的 toggle 按钮（刷新已标错的 data-ai-hide-think）
        document.querySelectorAll('.ds-toggle-button[data-ai-hide-think]').forEach(el => {
            el.removeAttribute('data-ai-hide-think');
            el.removeAttribute('data-ai-collapsed');
            delete el.dataset.aiCollapsed;
        });

        // 对已标记的容器，点击 chevron 折叠 + 添加点击释放
        document.querySelectorAll('[data-ai-hide-think]').forEach(container => {
            if (container.dataset?.aiCollapsed === '1') return;

            // 跳过 ds-toggle-button（安全兜底）
            if (container.classList.contains('ds-toggle-button')) return;

            // 防止浏览器滚动锚定补偿布局偏移
            container.style.overflowAnchor = 'none';

            const header = container.children[0];
            if (!header) return;

            const icons = header.querySelectorAll(':scope > .ds-icon');
            const toggleBtn = icons[icons.length - 1];
            if (toggleBtn) {
                toggleBtn.click();
                container.dataset.aiCollapsed = '1';
                header.dataset.aiCollapsed = '1';
            }

            // 点击标题栏释放 CSS 隐藏
            header.addEventListener('click', function release(e) {
                if (e.target.closest('.ds-icon')) return;
                container.removeAttribute('data-ai-hide-think');
                header.removeEventListener('click', release);
            }, { once: true });
        });
    }

    function registerMenuCommands() {
        let menuId = null;

        function updateMenu() {
            if (menuId !== null) GM_unregisterMenuCommand(menuId);

            const label = `🧠 折叠深度思考 ${CONFIG.collapseThinking ? '✅' : '❌'}`;
            menuId = GM_registerMenuCommand(label, () => {
                CONFIG.collapseThinking = !CONFIG.collapseThinking;
                GM_setValue('collapseThinking', CONFIG.collapseThinking);
                refreshStyles();
                updateMenu();
            });
        }

        updateMenu();
    }

    function refreshStyles() {
        const old = document.getElementById('ai-wide-enhancer-style');
        if (old) old.remove();
        injectStyles();
        wrapTables();
        if (CONFIG.collapseThinking && PLATFORM === 'deepseek') {
            setTimeout(collapseDeepThink, 300);
        }
    }

    function init() {
        console.log('[AI 宽屏优化] 平台:', PLATFORM);
        injectStyles();
        setTimeout(wrapTables, 500);
        if (CONFIG.collapseThinking && PLATFORM === 'deepseek') {
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
