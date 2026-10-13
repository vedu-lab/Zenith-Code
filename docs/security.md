# Forge Security Model & Sandbox Disclosure

Security and deterministic governance are founding principles of Forge. This document provides an honest, transparent assessment of our security architecture, policy engine, and the precise operating system sandbox boundaries across Linux, macOS, and Windows.

---

## 1. Threat Model & Principles

Forge operates as an autonomous agent executing file edits, command execution, and MCP calls directly on the user's workstation or CI runner. We assume:

1. **Model Outputs Are Untrusted**: Models may hallucinate, fall victim to prompt injections, or attempt unwarranted modifications.
2. **External Data Is Untrusted**: File contents, tool outputs, pull request comments, and MCP tool descriptions may contain malicious directives.
3. **No Silent State Changes**: Every action must formulate a typed intent, pass policy validation, and append to a hash-chained audit ledger.

---

## 2. Operating System Sandbox Backends & Known Limits

Forge implements OS-native sandboxing to restrict child processes spawned by tools. However, each operating system presents real-world isolation boundaries:

### Linux: Landlock + Seccomp / Bubblewrap

- **Mechanisms**:
  - Unprivileged Landlock LSM rules restrict filesystem reads/writes strictly to project root and `/tmp`.
  - Seccomp-BPF filters restrict dangerous system calls (`ptrace`, `reboot`, raw socket manipulation).
  - Bubblewrap (`bwrap`) provides user namespace isolation where available.
- **Strengths**: True kernel-enforced sandboxing that does not require root or daemon privileges.
- **Limits**:
  - Landlock requires Linux Kernel 5.13+. Older kernels or minimal containers fall back to seccomp filtering only.
  - Network namespace restrictions require unprivileged user namespaces (`kernel.unprivileged_userns_clone = 1`), which are disabled by default on some hardened enterprise distributions.

### macOS: Seatbelt (`sandbox-exec`)

- **Mechanisms**:
  - Custom TinyScheme profile restricts write operations strictly to the workspace root and `$TMPDIR`.
  - Blocks access to `~/.ssh`, `~/Library/Keychains`, and system directories.
- **Strengths**: Native, lightweight process restriction without requiring kernel extensions.
- **Limits**:
  - `sandbox-exec` is a private, deprecated Apple API. While stable and ubiquitous across macOS 12-15, Apple could restrict it in future major releases.
  - Fine-grained per-domain network filtering cannot be enforced by Seatbelt alone; network requests rely on Forge's application-level Policy Gate.

### Windows: Restricted Tokens & Job Objects

- **Mechanisms**:
  - Windows Job Objects constrain CPU time, active process trees, and physical memory caps.
  - Process creation drops elevated privileges (Restricted Token with disabled SIDs).
- **Strengths**: Native execution without requiring WSL2, Docker, or administrator privileges.
- **Limits**:
  - Win32 Job Objects do not provide a native kernel filesystem sandbox equivalent to Linux Landlock without AppContainer packaging or full Hyper-V virtualization.
  - Filesystem path write protection on Windows relies primarily on the Forge Policy Engine and capability tokens.

---

## 3. Policy Engine & Capability Token Architecture

Before any filesystem write, command execution, network request, or MCP tool call occurs:

1. **Intent Formulation**: The tool formulates a `ToolActionIntent` specifying `actionType`, `target`, and parameters.
2. **Rule Matching**: Rules configured across Org > User > Project > Session are evaluated:
   - Pattern examples: `fs.write(src/**)`, `shell(npm test)`, `net(api.github.com)`, `mcp(github:*)`.
   - Priority: `deny` rules always beat `allow` rules.
3. **Capability Tokens**: Expiring, task-scoped cryptographic tokens grant permission.
   - Revoked on task end, checkpoint rewind, or timeout.
   - Inspect active tokens with `forge caps list` and revoke with `forge caps revoke <id>`.

---

## 4. Prompt Injection & MCP Isolation

Forge treats third-party MCP servers and external files as untrusted:

- **`PromptInjectionGuard`**: Detects instruction override patterns (`Ignore previous instructions`), system prompt impersonation (`<|im_start|>system`), and privilege escalation directives.
- **`McpSanitizer`**: Strips adversarial tokens from MCP tool descriptions and isolates MCP output in `[UNTRUSTED_MCP_OUTPUT]` data boundaries.

---

## 5. Tamper-Evident Audit Ledger

Every action is hashed and cryptographically linked in `.forge/audit.jsonl`:

- Each entry includes `entryHash = SHA-256(prevHash + timestamp + actor + intent + result)`.
- Users can verify audit trail integrity anytime:
  ```bash
  forge audit verify .forge/audit.jsonl
  ```
  If any entry has been deleted, reordered, or edited, the verification immediately detects and pinpoints the tampering.
