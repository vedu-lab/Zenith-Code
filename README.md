# Zenith Code

<p align="center">
  <strong>An open-source, model-agnostic terminal AI coding agent inspired by Claude Code.</strong><br>
  <em>Safe by default. First-class Windows, macOS, Linux, and CI support. Deterministic and observable.</em>
</p>

---

## Key Highlights

- **Model-Agnostic (Cloud + Local)**: Pluggable provider architecture supporting Anthropic, OpenAI, Google Gemini, OpenAI-compatible APIs (Groq, DeepSeek, Mistral, xAI, OpenRouter, vLLM, llama.cpp), and local Ollama offline.
- **Safe by Default**: Single policy engine gatekeeper for all filesystem writes, shell commands, network requests, and MCP calls. Capability-based permissions, OS sandboxing (Landlock, Seatbelt, Windows Job Objects), and tamper-evident SHA-256 audit ledger.
- **First-Class Windows Support**: Runs natively without WSL; supports drive letters (`C:\...`), long paths (`\\?\...`), case-insensitive filesystems, CRLF preservation, PowerShell / cmd / bash auto-detection, and ConPTY pseudo-terminals.
- **Deterministic & Observable**: Zero silent state mutations. Every event is emitted over a typed event bus and recorded in SQLite session files and audit logs.
- **Shadow Git Time-Travel**: Non-destructive checkpoint tree using an isolated shadow git repository (`.forge/checkpoints/.git`). Rewind code, conversation, or both with byte-identical restoration.
- **Parallel Multi-Agent Orchestration**: Spin up competing or collaborating sub-agents in isolated git worktrees with total budget caps and automated Reviewer Agent diff scoring.
- **Model Context Protocol (MCP)**: Native stdio and HTTP MCP client with prompt injection sanitization and per-server allowlists.
- **Deterministic Replay**: Step through recorded sessions offline with zero external LLM API calls, or use `--live-tools` on fresh checkouts to detect environmental drift.

---

## Installation

### Via npm / pnpm

```bash
npm install -g @forge/cli
# or
pnpm add -g @forge/cli
```

### Via Homebrew (macOS / Linux)

```bash
brew tap forge-agent/tap
brew install forge
```

### Via WinGet (Windows Native)

```powershell
winget install Forge.Forge
```

### Via Docker

```bash
docker run --rm -it -v $(pwd):/workspace ghcr.io/forge-agent/forge:latest run "Inspect repository"
```

---

## Quick Start

### 1. Interactive Terminal UI

Run Zenith Code in your current project workspace:

```bash
zenith run "Implement JWT refresh tokens in auth/service.ts and add vitest tests"
# or
forge run "Implement JWT refresh tokens in auth/service.ts and add vitest tests"
```

Interactive controls:

- **`Shift+Enter`**: Multiline prompt input.
- **`@file`**: Fuzzy autocomplete file mentions.
- **`Esc`**: Interrupt active tool execution.
- **`Esc-Esc`**: Open the interactive checkpoint rewind picker.
- **Slash Commands**: `/help`, `/clear`, `/compact`, `/model`, `/cost`, `/permissions`, `/sandbox`, `/memory`, `/checkpoints`, `/rewind`, `/branch`, `/doctor`, `/exit`.

### 2. Headless CI Mode

Run automated tasks non-interactively in CI pipelines with deterministic exit codes:

```bash
forge run "Run linter and repair all auto-fixable errors" \
  --headless \
  --json \
  --policy .forge/policy.json \
  --timeout 300000 \
  --output-dir .forge/artifacts/ci
```

**Deterministic Exit Codes**:

- `0`: Success (all steps and verification gates passed).
- `1`: Task / Turn failure (tests failed or model could not resolve issue).
- `2`: Policy violation (action was denied by policy or required non-TTY prompt).
- `3`: Timeout reached.
- `4`: Configuration or system error.

### 3. Deterministic Replay

Replay recorded agent sessions offline:

```bash
# Replay using recorded model deltas and tool results (0 LLM calls, 0 FS mutations)
forge replay sess_1791912000

# Re-run tools on a fresh checkout to detect environment drift
forge replay sess_1791912000 --live-tools
```

### 4. System Diagnostics

Verify host environment, local model availability, compilers, and sandboxes:

```bash
forge doctor
```

### 5. Audit Trail Verification

Verify that your session audit log has not been altered or tampered with:

```bash
forge audit verify .forge/audit.jsonl
```

---

## Configuration

Configuration is loaded hierarchically with strict secret safety:

1. Global configuration: `~/.forge/config.json`
2. Project configuration: `.forge/config.json`
3. Environment variables (`FORGE_*`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_HOST`)
4. CLI flags (`--model`, `--mode`, `--max-turns`)

Example `.forge/config.json`:

```json
{
  "models": {
    "main": "claude-3-5-sonnet",
    "fast": "claude-3-5-haiku",
    "planner": "claude-3-5-sonnet"
  },
  "agent": {
    "maxTurns": 30,
    "temperature": 0
  },
  "tools": {
    "bashTimeoutMs": 30000,
    "maxReadLines": 2000
  }
}
```

---

## Monorepo Layout

| Package             | Path              | Purpose                                                               | Constraints                |
| :------------------ | :---------------- | :-------------------------------------------------------------------- | :------------------------- |
| **`@forge/core`**   | `packages/core`   | Agent loop, LLM providers, tools, event bus, replay engine            | Zero UI imports (ever)     |
| **`@forge/safety`** | `packages/safety` | Policy engine, capability security tokens, OS sandboxes, audit log    | Gatekeeper for all actions |
| **`@forge/state`**  | `packages/state`  | Shadow git checkpoints, project memory, usage ledger, SQLite indexing | Event bus subscriber       |
| **`@forge/tui`**    | `packages/tui`    | Ink-based Terminal UI, diff viewers, timeline scrubber, dashboards    | UI rendering only          |
| **`@forge/vscode`** | `packages/vscode` | VS Code extension and inline autocomplete server                      | Consumes core abstractions |
| **`@forge/cli`**    | `packages/cli`    | Primary binary wiring all subsystems together                         | Bootstrapping & DI         |
| **`@forge/bench`**  | `packages/bench`  | Benchmark harness for SWE-bench, Terminal-Bench, and Aider Polyglot   | Automated regression evals |

---

## Documentation

- [System Architecture](docs/architecture.md)
- [Security Model & OS Sandbox Limits](docs/security.md)
- [Benchmark Results (SWE-bench & Terminal-Bench)](docs/benchmarks.md)
- [Performance & Latency Profile](docs/performance.md)
- [Contributing Guidelines](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)

---

## License

Apache-2.0 © Forge Contributors. See [LICENSE](./LICENSE) for details.
