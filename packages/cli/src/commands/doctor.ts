import { execa } from 'execa';
import { runSandboxDoctor } from '@forge/safety';
import { detectShellEnvironment } from '@forge/core';

export interface DoctorCheckItem {
  readonly category: string;
  readonly name: string;
  readonly passed: boolean;
  readonly value: string;
  readonly details?: string | undefined;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheckItem[];
  readonly allPassed: boolean;
}

export async function runEnhancedDoctor(
  options: {
    ollamaUrl?: string | undefined;
    configuredMcpCount?: number | undefined;
  } = {},
): Promise<DoctorReport> {
  const checks: DoctorCheckItem[] = [];

  // 1. Node.js Version Check
  const nodeVersion = process.versions.node;
  const majorNode = parseInt(nodeVersion.split('.')[0] ?? '0', 10);
  const nodePassed = majorNode >= 20;
  checks.push({
    category: 'Runtime',
    name: 'Node.js Version',
    passed: nodePassed,
    value: `v${nodeVersion}`,
    details: nodePassed
      ? 'Node 20+ required for ES modules and modern APIs'
      : 'Upgrade to Node 20 or 22',
  });

  // 2. OS & Shell Detection
  const shellInfo = detectShellEnvironment();
  checks.push({
    category: 'Operating System',
    name: 'OS & Active Shell',
    passed: true,
    value: `${shellInfo.platform} (${shellInfo.shellType} via ${shellInfo.shellExecutable})`,
    details: shellInfo.isWindows
      ? 'First-class Windows native mode detected (ConPTY / CRLF)'
      : 'POSIX platform',
  });

  // 3. Git Availability
  try {
    const gitRes = await execa('git', ['--version']);
    checks.push({
      category: 'Version Control',
      name: 'Git Binary',
      passed: true,
      value: String(gitRes.stdout).trim(),
    });
  } catch {
    checks.push({
      category: 'Version Control',
      name: 'Git Binary',
      passed: false,
      value: 'Not found',
      details: 'Git is required for checkpoints, time-travel, and worktree isolation',
    });
  }

  // 4. Compilers & Toolchains
  const toolchains = [
    { name: 'TypeScript (tsc)', cmd: 'tsc', args: ['--version'] },
    { name: 'Python', cmd: 'python3', args: ['--version'] },
    { name: 'Rust (rustc)', cmd: 'rustc', args: ['--version'] },
    { name: 'Go (go)', cmd: 'go', args: ['version'] },
  ];

  for (const tc of toolchains) {
    try {
      const res = await execa(tc.cmd, tc.args);
      checks.push({
        category: 'Toolchains',
        name: tc.name,
        passed: true,
        value: String(res.stdout).trim().split('\n')[0] ?? 'Installed',
      });
    } catch {
      checks.push({
        category: 'Toolchains',
        name: tc.name,
        passed: false,
        value: 'Optional / Not found in PATH',
      });
    }
  }

  // 5. Local Ollama Server
  const ollamaEndpoint =
    options.ollamaUrl ?? process.env['OLLAMA_HOST'] ?? 'http://127.0.0.1:11434';
  try {
    const res = await fetch(`${ollamaEndpoint}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const modelNames =
        data.models
          ?.map((m) => m.name)
          .slice(0, 3)
          .join(', ') || 'No local models pulled';
      checks.push({
        category: 'Local LLM',
        name: 'Ollama Server',
        passed: true,
        value: `Online (${ollamaEndpoint})`,
        details: `Available models: ${modelNames}`,
      });
    } else {
      checks.push({
        category: 'Local LLM',
        name: 'Ollama Server',
        passed: false,
        value: `HTTP ${res.status}`,
        details: 'Ollama returned non-200 status',
      });
    }
  } catch {
    checks.push({
      category: 'Local LLM',
      name: 'Ollama Server',
      passed: false,
      value: 'Offline / Unreachable',
      details: 'Start with `ollama serve` for local zero-cost model execution',
    });
  }

  // 6. Sandbox Diagnostics
  const sandboxReport = runSandboxDoctor();
  checks.push({
    category: 'Safety & Sandbox',
    name: 'Isolation Engine',
    passed: true,
    value: `${sandboxReport.activeBackend} (Kernel Sandboxed: ${sandboxReport.isOsSandboxed ? 'YES' : 'NO'})`,
    details: sandboxReport.message,
  });

  // 7. MCP Servers
  const mcpCount = options.configuredMcpCount ?? 0;
  checks.push({
    category: 'Extensibility',
    name: 'Model Context Protocol (MCP)',
    passed: true,
    value: `${mcpCount} configured server(s)`,
    details: 'Stdio and HTTP MCP transports active with policy gate enforcement',
  });

  const allPassed = checks
    .filter((c) => c.category === 'Runtime' || c.category === 'Version Control')
    .every((c) => c.passed);

  return { checks, allPassed };
}
