# chatai-wide-screen-enhancer

DeepSeek 网页端宽屏 + 表格显示优化 + 自动折叠深度思考

## 功能

- 📐 **宽屏模式** — 将聊天内容撑满屏幕，告别窄版
- 📊 **表格加宽** — 表格自适应宽度，斑马纹 + 暗色适配
- 🧠 **自动折叠深度思考** — DeepSeek 思考过程自动收起，只看最终回复

## 安装

需要浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)，然后打开下方的脚本链接安装：

[👉 安装脚本](https://github.com/NBSOD/chatai-wide-screen-enhancer/raw/main/chatai-wide-screen-enhancer.user.js)

## 变更

| 版本 | 内容 |
|------|------|
| 1.0.8 | 修复滚动历史记录时自动下滑问题；移除 Gemini 支持，仅对 DeepSeek 生效 |
| 1.0.7 | 重写自动折叠逻辑，不再依赖"已思考"文本，直接从 DOM 结构判断
| 1.0.3 | 新增自动折叠深度思考功能 |
| 1.0.2 | 移除代码美化（Gemini 兼容问题） |
| 1.0.1 | 修复 Gemini 代码块颜色问题 |
| 1.0.0 | 初始版本 |