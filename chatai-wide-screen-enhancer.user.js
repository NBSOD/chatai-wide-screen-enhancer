// ==UserScript==
// @name         AI 宽屏优化
// @namespace    https://github.com/your-username/ai-wide-screen-enhancer
// @version      1.0.0
// @description  Gemini 和 DeepSeek 网页端宽屏 + 表格/代码显示优化
// @match        *://chat.deepseek.com/*
// @match        *://gemini.google.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-end
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        wideMode: GM_getValue('wideMode', true),
        wideTable: GM_getValue('wideTable', true),
        prettyCode: GM_getValue('prettyCode', true),
    };

    const PLATFORM = (() => {
        const host = location.hostname;
        if (host.includes('deepseek')) return 'deepseek';
        if (host.includes('gemini')) return 'gemini';
        return 'unknown';
    })();

    // 平台选择器
    const SELECTORS = {
        deepseek: {
            content: ['.max-w-4xl', '.max-w-3xl', '[class*="max-w-"]', '.ds-markdown', '.md-content'],
            container: ['.d850f6a0', 'main', '.flex-1', '[class*="overflow-auto"]'],
            message: ['[class*="message"]', '[class*="conversation"]', '[class*="ds-chat"]'],
            code: ['pre code', 'pre', '.ds-markdown pre'],
            extraCSS: `
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
        gemini: {
            content: ['.response-container', '.conversation-container', '[class*="max-w-"]'],
            container: ['main', '.conversation-container', '[class*="conversation"]'],
            message: ['.message', '.response-content', '[class*="message"]'],
            code: ['pre code', 'pre', 'code[class*="hljs"]', 'div[class*="code"] code', '[class*="code-block"] code'],
            extraCSS: `
                /* Gemini 代码块：兼容非 <pre> 包裹的结构 */
                pre, [class*="code-block"], [class*="code-container"] {
                    background: #f5f5f5 !important;
                    border: 1px solid #e0e0e0 !important;
                    border-radius: 6px !important;
                    padding: 1em !important;
                    overflow-x: auto !important;
                }
                pre code, [class*="code-block"] code, [class*="code-container"] code {
                    background: transparent !important;
                    color: #1a1a1a !important;
                }
                @media (prefers-color-scheme: dark) {
                    pre, [class*="code-block"], [class*="code-container"] {
                        background: #1e1e1e !important;
                        border-color: #333 !important;
                    }
                    pre code, [class*="code-block"] code, [class*="code-container"] code {
                        color: #e0e0e0 !important;
                    }
                }
            `,
        },
    };

    const S = SELECTORS[PLATFORM] || SELECTORS.deepseek;

    function injectStyles() {
        const css = [];

        if (CONFIG.wideMode) {
            const maxW = 'none';
            css.push(`
                ${S.content.join(',\n')} {
                    max-width: ${maxW} !important;
                    width: 98% !important;
                    margin-left: auto !important;
                    margin-right: auto !important;
                    padding-left: 24px !important;
                    padding-right: 24px !important;
                }
                ${S.container.join(',\n')} {
                    max-width: 100% !important;
                    width: 100% !important;
                }
                ${S.message.join(',\n')} {
                    max-width: ${maxW} !important;
                    width: 98% !important;
                }
                [class*="max-w-"], [class*="max-w\\["] {
                    max-width: ${maxW} !important;
                }
            `);
        }

        if (CONFIG.wideTable) {
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
        }

        if (CONFIG.prettyCode) {
            css.push(`
                ${S.code.join(',\n')} {
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace !important;
                    font-size: 0.9em !important;
                    line-height: 1.5 !important;
                }
                pre, [class*="code-block"], [class*="code-container"] {
                    border-radius: 6px !important;
                    padding: 1em !important;
                    margin: 1em 0 !important;
                    overflow-x: auto !important;
                    max-width: 100% !important;
                    background: #f5f5f5 !important;
                    border: 1px solid #e0e0e0 !important;
                }
                pre code, [class*="code-block"] code, [class*="code-container"] code {
                    background: transparent !important;
                    padding: 0 !important;
                    border: none !important;
                    color: #1a1a1a !important;
                }
                @media (prefers-color-scheme: dark) {
                    pre, [class*="code-block"], [class*="code-container"] {
                        background: #1e1e1e !important;
                        border-color: #333 !important;
                    }
                    pre code, [class*="code-block"] code, [class*="code-container"] code {
                        color: #e0e0e0 !important;
                    }
                }
            `);
        }

        if (S.extraCSS) {
            css.push(S.extraCSS);
        }

        const style = document.createElement('style');
        style.textContent = css.join('\n');
        style.id = 'ai-wide-enhancer-style';
        document.head.appendChild(style);
    }

    function wrapTables() {
        if (!CONFIG.wideTable) return;
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

    function observeDOM() {
        const observer = new MutationObserver(() => {
            wrapTables();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function createPanel() {
        if (document.getElementById('ai-enhancer-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'ai-enhancer-panel';
        panel.className = 'collapsed';
        panel.innerHTML = `
            <div class="head">
                <span class="icon">⚙️</span>
                <span class="title">AI 增强</span>
                <button class="toggle">+</button>
            </div>
            <div class="body">
                <label><span>📐 宽屏</span><input type="checkbox" data-key="wideMode" ${CONFIG.wideMode ? 'checked' : ''}></label>
                <label><span>📊 表格加宽</span><input type="checkbox" data-key="wideTable" ${CONFIG.wideTable ? 'checked' : ''}></label>
                <label><span>💻 代码美化</span><input type="checkbox" data-key="prettyCode" ${CONFIG.prettyCode ? 'checked' : ''}></label>
            </div>
        `;

        const style = document.createElement('style');
        style.textContent = `
            #ai-enhancer-panel {
                position: fixed; bottom: 20px; right: 20px; z-index: 999999;
                background: #fff; border: 1px solid #ddd; border-radius: 10px;
                box-shadow: 0 2px 12px rgba(0,0,0,0.12);
                font: 13px -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
                min-width: 180px; overflow: hidden; user-select: none;
                transition: all 0.2s;
            }
            #ai-enhancer-panel.collapsed {
                width: 40px; height: 40px; border-radius: 50%; min-width: 0;
                display: flex; align-items: center; justify-content: center;
                cursor: pointer;
            }
            #ai-enhancer-panel.collapsed .body, #ai-enhancer-panel.collapsed .title, #ai-enhancer-panel.collapsed .toggle { display: none; }
            #ai-enhancer-panel.collapsed .head { padding: 0; border: none; background: transparent; }
            #ai-enhancer-panel.collapsed .icon { font-size: 20px; }
            #ai-enhancer-panel:not(.collapsed) .icon { display: none; }
            .head {
                display: flex; justify-content: space-between; align-items: center;
                padding: 8px 12px; border-bottom: 1px solid #eee; font-weight: 600;
                cursor: move;
            }
            .title { flex: 1; margin-left: 4px; color: #333; }
            .toggle {
                background: none; border: none; font-size: 16px; cursor: pointer;
                padding: 0 4px; color: #333; line-height: 1;
            }
            .body { padding: 6px 0; }
            .body label {
                display: flex; justify-content: space-between; align-items: center;
                padding: 6px 12px; cursor: pointer; margin: 0;
            }
            .body label:hover { background: rgba(0,0,0,0.04); }
            .body label span { font-size: 13px; color: #333; }
            .body label input[type="checkbox"] {
                width: 16px; height: 16px; cursor: pointer; accent-color: #4f46e5;
            }
            @media (prefers-color-scheme: dark) {
                #ai-enhancer-panel { background: #2a2a2a; border-color: #444; }
                .head { border-color: #444; }
                .title, .toggle, .body label span { color: #e0e0e0; }
                .body label:hover { background: rgba(255,255,255,0.06); }
            }
            @media (max-width: 768px) { #ai-enhancer-panel { bottom: 80px; right: 10px; } }
        `;
        document.head.appendChild(style);

        // 展开/折叠
        panel.addEventListener('click', function (e) {
            if (this.classList.contains('collapsed')) {
                this.classList.remove('collapsed');
                this.querySelector('.toggle').textContent = '−';
            }
        });
        panel.querySelector('.toggle').addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.add('collapsed');
            panel.querySelector('.toggle').textContent = '+';
        });

        // 开关
        panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', function (e) {
                e.stopPropagation();
                CONFIG[this.dataset.key] = this.checked;
                try { GM_setValue(this.dataset.key, this.checked); } catch (e) {}
                refreshStyles();
            });
        });

        // 拖拽
        let dragging = false, sx, sy, ox, oy;
        const header = panel.querySelector('.head');
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.toggle')) return;
            if (panel.classList.contains('collapsed')) return;
            dragging = true;
            sx = e.clientX; sy = e.clientY;
            const r = panel.getBoundingClientRect();
            ox = r.left; oy = r.top;
            panel.style.right = 'auto'; panel.style.bottom = 'auto';
            panel.style.left = ox + 'px'; panel.style.top = oy + 'px';
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            panel.style.left = (ox + e.clientX - sx) + 'px';
            panel.style.top = (oy + e.clientY - sy) + 'px';
        });
        document.addEventListener('mouseup', () => { dragging = false; });

        document.body.appendChild(panel);
    }

    function refreshStyles() {
        const old = document.getElementById('ai-wide-enhancer-style');
        if (old) old.remove();
        injectStyles();
        wrapTables();
    }

    function init() {
        console.log('[AI 宽屏优化] 平台:', PLATFORM);
        injectStyles();
        setTimeout(wrapTables, 500);
        observeDOM();
        createPanel();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
