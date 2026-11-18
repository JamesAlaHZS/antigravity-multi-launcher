[English](README.md) | [简体中文](README.zh-CN.md)

# Antigravity Multi Launcher（Antigravity & Codex 多开助手）

在 Windows 和 macOS 上同时运行多个相互隔离的 **Google Antigravity（2.0 桌面端 / Antigravity IDE）** 与 **OpenAI Codex / ChatGPT** 桌面配置。每个配置都拥有独立的登录账号、系统凭据域、API Key、自定义网关、模型、应用数据目录与指定历史会话。

> 本项目架构与交互参照 [JqyModi/codex-multi-launcher](https://github.com/JqyModi/codex-multi-launcher) 设计，采用 **Electron + React 19 + TypeScript** 完整开源实现，并深度适配新增了 **Google Antigravity 双形态（2.0 Hub & IDE）多开隔离管理**。

## 它解决什么问题

- **多 Google 账号同时在线**：在不同 Antigravity 窗口登录个人号、工作号或企业号，通过独立的 `--user-data-dir`、`.gemini` 目录与专属系统凭据域（`ANTIGRAVITY_CREDENTIAL_SCOPE`）彻底解决 Windows 凭据管理器 / macOS Keychain 互相覆盖串号的问题。
- **双引擎统一工作台**：一个管理器同时纳管 **Antigravity 2.0**、**Antigravity IDE** 与 **Codex / ChatGPT Desktop**（含 Windows Store `WindowsApps` 沙盒包自动提取缓存）。
- **认证与网关自由切换**：
  - **Antigravity**：支持 `Google 账号独立登录 (OAuth)`、`Gemini 官方 API Key`、`自定义 LLM Gateway / 反代（AGY_LLM_GATEWAY_*）`、独立 HTTP/HTTPS 代理及指定 WSL 发行版绑定。
  - **Codex**：支持 `ChatGPT 账号独立登录`、`OpenAI 官方 API Key`、`第三方 Responses 兼容接口`。
- **配置继承与会话同步**：新建配置或运行中可一键同步默认客户端或其他多开窗口的 **MCP 服务、Skills、Plugins、全局规则** 与 **历史对话记录**，并自动挂载本机 `.ssh` 与 `.gitconfig`，确保隔离实例内的 Git / SSH 远程开发开箱即用。
- **无损迁移已有 Codex 配置**：自动检测本机已有的 `Codex Profile Manager` 配置，一键无损纳管，原目录与历史记录零改动。
- **自定义存储盘与一键跨盘迁移（节省 C 盘空间）**：支持将管理器元数据、Antigravity 多开目录与 Codex 多开目录统一放置在非系统盘（如 `F:\antigravity\profiles`、`F:\CODEX-MULTI\codex-profiles`），并支持将已导入的历史 C 盘配置一键无损迁移到目标盘。

## 核心隔离机制对比

| 隔离维度 | Google Antigravity 引擎 | OpenAI Codex 引擎 |
| --- | --- | --- |
| Electron 实例锁与窗口状态 | 独立 `--user-data-dir`（IDE 额外隔离 `--extensions-dir`） | 独立 `--user-data-dir` + `CODEX_ELECTRON_USER_DATA_PATH` |
| 核心状态与会话目录 | 独立 `HOME` / `USERPROFILE` + `ANTIGRAVITY_GEMINI_DIR` (`~/.antigravity-profiles/<id>/home/.gemini`) | 独立 `CODEX_HOME` (`~/.codex-profiles/<id>/codex-home`) |
| 系统钥匙串 / 凭据隔离 | 独立 `ANTIGRAVITY_CREDENTIAL_SCOPE=agy-profile-<id>`（隔离 `gemini:*` 令牌） | 独立 `auth.json` 与 Chromium Profile Cookie 隔离 |
| 开发工具链保持 | 保留真实 `APPDATA` / `LOCALAPPDATA` 并自动关联 `.ssh`、`.gitconfig` | 继承 `AGENTS.md`、`mcp.json`、`skills`、`plugins` |
| 本地密钥保护 | AES-256-GCM 本地主密钥加密存储，日志与诊断自动脱敏 | AES-256-GCM 本地主密钥加密存储，日志与诊断自动脱敏 |

## 快速开始（本地开发与打包）

### 环境要求

- Node.js >= 20
- Windows 10/11 x64 或 macOS 12+

### 安装与运行

```bash
git clone https://github.com/JamesAlaHZS/antigravity-multi-launcher.git
cd antigravity-multi-launcher
npm install

# 运行类型检查与自动化隔离测试
npm run typecheck
npm test

# 构建并启动桌面应用
npm start
```

### 打包安装包与便携版

```bash
# Windows (生成 NSIS 安装包 + Portable 免安装单文件 exe，输出在 release/ 目录)
npm run dist:win

# macOS (生成 dmg + zip)
npm run dist:mac
```

## 致谢与声明

- 界面交互与 Codex 多开工作流灵感来自 [JqyModi/codex-multi-launcher](https://github.com/JqyModi/codex-multi-launcher)。
- 本项目为独立开源工具，与 Google（Antigravity）及 OpenAI（Codex / ChatGPT）不存在官方隶属或商业合作关系。
- 请勿在 Issue 中公开任何 API Key、OAuth 凭据或私人对话数据；反馈问题时请使用应用内的 **「复制脱敏诊断」** 按钮。
