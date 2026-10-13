<!-- Generated from AGENTS.md. DO NOT EDIT DIRECTLY. -->

# AGENTS.md — Agent & Developer Operating Instructions

## Project Overview

- **Name**: Zenith Code (cli: `zenith` / `forge`)
- **Description**: An open-source, model-agnostic (cloud + local) terminal AI coding agent.
- **Foundational Principles**:
  - **Safe by default**: Sandboxed execution, capability-based permissions, explicit approval policies, and structured audit logs.
  - **First-class cross-platform support**: Windows, macOS, Linux, and headless CI environments are first-class targets.
  - **Deterministic & observable**: Zero silent state mutations; event-driven state transitions with typed event bus.
  - **Model-agnostic**: Pluggable provider architecture supporting local LLMs (Ollama, llama.cpp, vLLM) and cloud APIs (Anthropic, OpenAI, Google, etc.).

---

## Workspace & Package Boundaries

This repository is organized as a pnpm monorepo. Respect strict package boundaries and architectural separation at all times:

| Package         | Path              | Responsibility                                                                 | Boundary Constraints                                                              |
| --------------- | ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `@forge/core`   | `packages/core`   | Agent loop, LLM providers, tool orchestrator, prompt builders, typed event bus | **ZERO UI IMPORTS (EVER)**. No direct console, Ink, or UI rendering dependencies. |
| `@forge/safety` | `packages/safety` | Policy engine, capability security model, sandbox adapters, audit logging      | Evaluates tool intents against policy before execution.                           |
| `@forge/state`  | `packages/state`  | Session management, checkpoints, undo/rewind, memory, usage ledger, indexing   | Subscribes to events; SQLite persistence.                                         |
| `@forge/tui`    | `packages/tui`    | Ink-based Terminal UI, components, rendering, interactive prompts              | Consumes core/state via events & interfaces.                                      |
| `@forge/vscode` | `packages/vscode` | VS Code extension and autocomplete language server                             | Consumes core engine and interfaces.                                              |
| `@forge/cli`    | `packages/cli`    | Primary binary entry point wiring core, safety, state, and TUI                 | Bootstraps configuration and dependencies.                                        |
| `@forge/bench`  | `packages/bench`  | Benchmark harness, evals, golden dataset runner, metrics collection            | Automated regression testing and model evals.                                     |

---

## Core Engineering Rules

### 1. Type Safety & Dependency Injection

- **No `any`**: Strict TypeScript is enforced across all packages (`@typescript-eslint/no-explicit-any: error`). Use `unknown`, generics, or Zod schemas for untyped inputs.
- **Small pure functions**: Prefer pure functions for deterministic business logic, transformations, and validators.
- **Dependency Injection**: Never hardcode LLM network calls, filesystem operations, system clocks, or process spawners into core domain logic. Inject abstractions:
  - `FileSystem` (e.g. `IFileSystem`)
  - `ProcessRunner` (e.g. `IProcessRunner`)
  - `Clock` (e.g. `IClock`)
  - `LlmClient` (e.g. `ILlmProvider`)

### 2. Test-Driven Verification & CI Matrix

- Every module must ship with automated unit or integration tests (`vitest`).
- No feature is complete until:
  - `pnpm typecheck` passes with zero errors.
  - `pnpm lint` passes with zero warnings/errors.
  - `pnpm test` passes across Node 20 and Node 22 on Ubuntu, macOS, and Windows.

### 3. Observable State & Typed Event Bus

- All state modifications **must** emit strongly typed events over the central event bus (`@forge/core/events`).
- Subsystems (checkpoints, audit logs, TUI views, analytics) subscribe to these events.
- **Rule**: Nothing mutates state silently. Every transition must have a corresponding event with timestamp, actor, and payload.

### 4. Policy Engine Gatekeeper

- Tools must **never** execute direct filesystem writes, deletions, network requests, or shell commands autonomously.
- Every tool action must formulate an intent payload, pass through `@forge/safety` policy validation, and obtain authorization before calling underlying drivers.

### 5. Structured Error Handling

- Never swallow exceptions or catch errors with empty handlers.
- Throw structured domain errors extending `ForgeError` with defined enum error codes (e.g., `ErrorCode.POLICY_VIOLATION`, `ErrorCode.TOOL_EXECUTION_FAILED`).
- Attach context, causes (`error.cause`), and remediation guidance where appropriate.

### 6. Cross-Platform Paths & Encoding

- **Always** use `node:path` utilities (`path.join`, `path.resolve`, `path.normalize`). Never use raw slash concatenations like `dir + '/' + file`.
- Respect Windows backslashes vs POSIX slashes.
- Preserve the existing file line endings (`\n` vs `\r\n`) when modifying files.
- Default to UTF-8 encoding across all filesystem interactions.

### 7. Secret Zero & Configuration Safety

- Never commit secrets, API keys, credentials, or tokens.
- Load configuration strictly from environment variables or explicitly designated user configuration files (e.g., `~/.forge/config.json`).
- Exclude all credential files, local SQLite databases, logs, and secret dumps from version control via `.gitignore`.

### 8. Incremental Development & Commit Discipline

- Work in small, atomic, bisectable commits following Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`).
- At the end of each milestone:
  - Summarize what was built.
  - Document what is currently untested.
  - Highlight known gaps, technical debt, and next steps.
