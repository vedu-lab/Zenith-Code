# Contributing to Zenith Code

Thank you for contributing to Zenith Code! This project adheres to strict engineering standards to ensure high reliability, zero silent state mutations, and safety by default.

---

## 1. Prerequisites & Monorepo Setup

- **Node.js**: `20.x` or `22.x` (check with `node -v`)
- **pnpm**: `9.x` or `10.x` (check with `pnpm -v`)
- **Git**: `>= 2.30`

Clone and install dependencies:

```bash
git clone https://github.com/zenith-code/zenith.git
cd zenith
pnpm install
```

---

## 2. Core Engineering Rules

Every pull request must honor the core rules from [AGENTS.md](./AGENTS.md):

1. **Strict TypeScript (No `any`)**:
   - Zero `any` policy is enforced across all packages (`@typescript-eslint/no-explicit-any: error`).
   - Use `unknown`, generics, or Zod schemas for untyped inputs.
   - Respect `exactOptionalPropertyTypes: true`. Do not pass `{ prop: undefined }`; omit keys or use conditional objects.

2. **Package Boundaries**:
   - `@forge/core` must have **ZERO UI IMPORTS (EVER)**. No direct console, Ink, or UI rendering dependencies.
   - Core domain logic must never hardcode filesystem, process spawners, or system clocks. Always inject `IFileSystem`, `IProcessRunner`, and `IClock`.

3. **Observable State Transitions**:
   - All state modifications **must** emit strongly typed events over `@forge/core/events`. Nothing mutates state silently.

4. **Cross-Platform Paths**:
   - Always use `node:path` utilities (`path.join`, `path.resolve`, `path.normalize`).
   - Never use raw slash concatenations like `dir + '/' + file`.
   - Preserve existing file line endings (`\n` vs `\r\n`).

---

## 3. Verification & Commit Discipline

Before opening a pull request, run all verification steps:

```bash
# 1. Typecheck all packages
pnpm typecheck

# 2. Lint and format checks
pnpm lint
pnpm format:check

# 3. Full Vitest test suite
pnpm test
```

Follow **Conventional Commits**:

- `feat: add stdio and http mcp transports`
- `fix: preserve crlf line endings on windows edit`
- `test: verify deterministic replay drift detection`
- `refactor: cache compiled glob regexes in policy engine`
- `docs: update security and benchmark reports`
