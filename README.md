[English](README.md) | [简体中文](README.zh-CN.md)

# Antigravity Multi Launcher

Run multiple isolated **Google Antigravity (2.0 Desktop & Antigravity IDE)** and **OpenAI Codex / ChatGPT Desktop** instances simultaneously on Windows and macOS. Each profile maintains its own OAuth account session, OS credential scope, API key, custom gateway, model configuration, skills/MCPs, and conversation history.

> Inspired by [JqyModi/codex-multi-launcher](https://github.com/JqyModi/codex-multi-launcher), built from scratch as a clean open-source **Electron + React 19 + TypeScript** desktop manager with first-class **Google Antigravity** multi-instance management.

## Key Features

- **True Multi-Account Antigravity Isolation**:
  - Dedicated `--user-data-dir` (plus `--extensions-dir` for Antigravity IDE).
  - Dedicated `.gemini` directory (`ANTIGRAVITY_GEMINI_DIR` + scoped `HOME`/`USERPROFILE` while preserving real `APPDATA`/`LOCALAPPDATA` and linking `.ssh` & `.gitconfig`).
  - Dedicated OS Keyring scope via `ANTIGRAVITY_CREDENTIAL_SCOPE=agy-profile-<id>`, preventing Google OAuth logins in one window from overwriting `gemini:antigravity` in Windows Credential Manager or macOS Keychain.
- **Unified Dual-Engine Workspace**:
  - Manage **Antigravity 2.0**, **Antigravity IDE**, and **Codex / ChatGPT Desktop** (including automatic Microsoft Store `WindowsApps` cache extraction on Windows) in one app.
- **Flexible Auth & Custom Gateways**:
  - **Antigravity**: Google Account OAuth Login, Official `GEMINI_API_KEY`, or Custom LLM Gateway (`AGY_LLM_GATEWAY_*`), plus per-profile proxy & WSL distro binding.
  - **Codex**: ChatGPT Account Login, Official `OPENAI_API_KEY`, or Third-Party `responses`-compatible Base URL.
- **One-Click Inheritance & Sync**:
  - Inherit MCP servers, Skills, Plugins, and global rules, or sync conversation history from your default installation or any existing profile.
  - Non-destructively detect and import existing `Codex Profile Manager` profiles in one click.
- **Security by Default**:
  - API keys encrypted locally via **AES-256-GCM** (`0600` master key). Diagnostics and launch logs automatically redact sensitive fields.

## Development & Packaging

```bash
git clone https://github.com/JamesAlaHZS/antigravity-multi-launcher.git
cd antigravity-multi-launcher
npm install

# Typecheck & run automated tests
npm run typecheck
npm test

# Build & launch Electron app
npm start

# Package Windows NSIS installer & Portable .exe (outputs to release/)
npm run dist:win

# Package macOS .dmg & .zip
npm run dist:mac
```

## License

[MIT](LICENSE)
