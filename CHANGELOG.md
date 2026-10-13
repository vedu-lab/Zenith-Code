# Changelog

All notable changes to the Forge project are documented in this file following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and [Conventional Commits](https://www.conventionalcommits.org/).

## [0.1.0] - 2026-10-13

### Highlights

- Initial release of **Forge**, an open-source, model-agnostic terminal AI coding agent inspired by Claude Code.
- Strict security by default: Capability-based permissions, OS sandboxing (Landlock, Seatbelt, Windows Job Objects), tamper-evident SHA-256 audit log.
- First-class cross-platform support across Linux, macOS, and native Windows (without WSL).
- SQLite-backed checkpoint trees and byte-identical time travel using shadow git.

### Packages

- **`@forge/core`**:
  - Typed central event bus (`CoreEventBus`) with sync and async subscribers.
  - Multi-provider layer (Anthropic, OpenAI, Gemini, OpenAI-compatible, Ollama) with streaming, prompt caching, and retries with jitter.
  - Core tools with Zod validation: `read_file`, `write_file`, `edit_file`, `multi_edit`, `bash`, `list_dir`, `grep`, `todo_write`.
  - Done Gate and empirical verification loops to detect fake completions.
  - Uncertainty signaling and empirical evidence tagging.
  - Plan-first execution and real-time drift detection.
  - Parallel sub-agents running in isolated git worktrees with Reviewer Agent scoring.
  - Complete MCP client supporting `stdio` and `http` transports, allowlist enforcement, and prompt injection sanitization.
  - Windows native platform detection, ConPTY runner, and CRLF preservation.
  - Headless CI engine with deterministic exit codes (0, 1, 2, 3, 4) and artifacts generation (`transcript.jsonl`, `usage.json`, `diff.patch`).
  - Deterministic session replay engine with `--live-tools` drift comparison.

- **`@forge/safety`**:
  - Central Policy Engine evaluating `fs`, `shell`, `net`, and `mcp` intents against rules (`allow`, `ask`, `deny`).
  - Capability token manager with time and use-count expiration.
  - Native OS sandboxes: Landlock + seccomp (Linux), Seatbelt (macOS), and Job Objects (Windows).
  - Secret redactor scanning for API keys, private keys, and passwords.
  - Hash-chained audit logger with offline tampering verification (`forge audit verify`).

- **`@forge/state`**:
  - Shadow git checkpoint repository with byte-identical rewind/branch capabilities.
  - Project memory store in readable `.forge/memory/*.md` with SQLite full-text index.
  - Usage ledger and budget enforcer tracking token counts and USD costs.
  - Incremental code search indexer.

- **`@forge/tui`**:
  - Interactive Ink terminal UI with streaming Markdown, diff viewer, and rotating status spinner.
  - Permission approval prompts showing exact red/green diffs.
  - Interactive `/checkpoints`, `/memory`, `/permissions`, and `/doctor` screens.
  - Multi-agent parallel execution dashboard with real-time budget and test status.
  - Interactive `TimelineViewer` for session scrubbing during replay.

- **`@forge/vscode`**:
  - Autocomplete Language Server with sub-300ms p50 latency and instant keystroke cancellation.

- **`@forge/bench`**:
  - Automated evaluation harness for SWE-bench Verified, Terminal-Bench, and Aider Polyglot.
  - Trust and anti-hallucination trap suite verifying zero false-success claims.

- **`@forge/cli`**:
  - CLI binary commands: `forge run`, `forge replay`, `forge doctor`, `forge caps`, `forge audit`, `forge init`, `forge usage`.
  - Enhanced system diagnostics reporting Node, OS, Git, Compilers, Ollama, and Sandboxes.
  - Packaging manifests for WinGet (`Forge.Forge`), Homebrew (`Formula/forge.rb`), and Docker.
