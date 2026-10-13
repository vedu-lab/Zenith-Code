# forge

> Open-source, model-agnostic terminal AI coding agent (like Claude Code), safe by default, with first-class Windows, macOS, Linux, and CI support.

## Overview

`forge` is an autonomous coding agent designed for local terminal workflows. It combines pluggable model backends (cloud providers & local models) with a rigorous capability security model, structured audit logs, reversible checkpoints, and an interactive Ink-based terminal user interface.

## Monorepo Architecture

```
forge/
├── packages/
│   ├── core/      # Agent loop, LLM providers, tool orchestrator, typed event bus (NO UI imports)
│   ├── safety/    # Policy engine, capabilities, sandboxing, audit log
│   ├── state/     # Checkpoints, memory, sessions, usage ledger, SQLite indexing
│   ├── tui/       # Ink-based terminal UI and interactive widgets
│   ├── vscode/    # VS Code extension and autocomplete server
│   ├── cli/       # Executable entry point wiring core, safety, state, and TUI
│   └── bench/     # Benchmark runner and eval harness
```

## Tech Stack

- **Runtime**: Node.js 20+ / 22+
- **Language**: TypeScript (strict mode, zero `any`)
- **Package Manager**: pnpm workspaces
- **Testing**: Vitest
- **Linting & Formatting**: ESLint (flat config) & Prettier
- **Data Validation**: Zod
- **Process Execution**: Execa
- **Database / Persistence**: SQLite via `better-sqlite3`
- **Terminal UI**: Ink + React

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0

### Installation

```bash
pnpm install
```

### Common Commands

```bash
# Build all packages
pnpm build

# Type check all packages
pnpm typecheck

# Run unit & integration tests
pnpm test

# Lint codebase
pnpm lint

# Format code
pnpm format
```

## Contributing & Rules

See [AGENTS.md](./AGENTS.md) for strict project rules, architectural constraints, error handling guidelines, and contribution conventions.
