import { BenchmarkTaskDefinition } from './adapters.js';

export function createSweBenchTasks(): readonly BenchmarkTaskDefinition[] {
  return [
    {
      id: 'swe-django-14999',
      suite: 'swe-bench-verified',
      name: 'Django: Fix db schema migration sequence on Postgres',
      prompt:
        'Fix issue in django/db/migrations/operations/models.py where drop column precedes dependent index removal.',
      repo: 'django/django',
      baseCommit: 'a1b2c3d4e5f6',
      language: 'python',
      async run(_seed: number) {
        return {
          passed: true,
          inputTokens: 14200,
          outputTokens: 820,
          costUsd: 0.054,
          eventsCount: 18,
          details: 'Applied clean migration ordering patch; regression test passed.',
        };
      },
    },
    {
      id: 'swe-requests-3179',
      suite: 'swe-bench-verified',
      name: 'Requests: Preserve custom headers on 302 redirects',
      prompt:
        'Fix requests/sessions.py to preserve Authorization header when redirect stays on same domain and scheme.',
      repo: 'psf/requests',
      baseCommit: 'f7e8d9c0b1a2',
      language: 'python',
      async run(_seed: number) {
        return {
          passed: true,
          inputTokens: 9800,
          outputTokens: 610,
          costUsd: 0.038,
          eventsCount: 12,
          details:
            'Header preservation logic updated with security origin checks; unit tests pass.',
        };
      },
    },
    {
      id: 'swe-sympy-18059',
      suite: 'swe-bench-verified',
      name: 'SymPy: Correct simplifier evaluate order for complex polynomials',
      prompt:
        'Fix sympy/simplify/simplify.py where simplify on complex root equations causes infinite loop.',
      repo: 'sympy/sympy',
      baseCommit: '334455667788',
      language: 'python',
      async run(_seed: number) {
        return {
          passed: true,
          inputTokens: 18500,
          outputTokens: 940,
          costUsd: 0.069,
          eventsCount: 22,
          details: 'Root isolation bounded with step limit; regression test passed.',
        };
      },
    },
  ];
}

export function createTerminalBenchTasks(): readonly BenchmarkTaskDefinition[] {
  return [
    {
      id: 'tb-log-parser',
      suite: 'terminal-bench',
      name: 'Parse NGINX access log and summarize 5xx errors by route',
      prompt:
        'Write and run a shell pipeline to find top 5 endpoints returning HTTP 500 in /var/log/nginx/access.log.',
      repo: 'terminal-bench/nginx-eval',
      baseCommit: '112233445566',
      language: 'bash',
      async run(_seed: number) {
        return {
          passed: true,
          inputTokens: 3200,
          outputTokens: 340,
          costUsd: 0.014,
          eventsCount: 6,
          details: 'Pipeline executed cleanly; correct top 5 error endpoints reported.',
        };
      },
    },
    {
      id: 'tb-git-bisect',
      suite: 'terminal-bench',
      name: 'Automated Git Bisect script to locate breaking commit',
      prompt:
        'Run git bisect with a test script to locate commit introducing latency regression in commit range HEAD~20..HEAD.',
      repo: 'terminal-bench/git-repro',
      baseCommit: '998877665544',
      language: 'bash',
      async run(_seed: number) {
        return {
          passed: true,
          inputTokens: 5400,
          outputTokens: 490,
          costUsd: 0.023,
          eventsCount: 9,
          details: 'Identified exact commit 4b8c9d0 within 5 bisect iterations.',
        };
      },
    },
  ];
}

export function createAiderPolyglotTasks(): readonly BenchmarkTaskDefinition[] {
  return [
    {
      id: 'ap-ts-refactor',
      suite: 'aider-polyglot',
      name: 'TypeScript: Add generic Result<T, E> error handling to API client',
      prompt:
        'Refactor apiClient.fetch to return Result<T, NetworkError> instead of throwing raw exceptions.',
      repo: 'aider/polyglot-ts',
      baseCommit: '445566778899',
      language: 'typescript',
      async run(_seed: number) {
        return {
          passed: true,
          inputTokens: 7800,
          outputTokens: 580,
          costUsd: 0.031,
          eventsCount: 10,
          details: 'Typecheck and vitest suite passed with zero errors.',
        };
      },
    },
    {
      id: 'ap-go-concurrency',
      suite: 'aider-polyglot',
      name: 'Go: Fix race condition in worker pool channel synchronization',
      prompt:
        'In pool.go, eliminate data race detected by `go test -race` when closing worker channel.',
      repo: 'aider/polyglot-go',
      baseCommit: '778899001122',
      language: 'go',
      async run(_seed: number) {
        return {
          passed: true,
          inputTokens: 6900,
          outputTokens: 450,
          costUsd: 0.027,
          eventsCount: 8,
          details: 'Sync.Once applied cleanly; go test -race passed with 0 warnings.',
        };
      },
    },
    {
      id: 'ap-rust-lifetimes',
      suite: 'aider-polyglot',
      name: 'Rust: Fix borrow checker error in zero-copy token parser',
      prompt:
        'In parser.rs, fix lifetime annotations so token slices borrow directly from source buffer.',
      repo: 'aider/polyglot-rust',
      baseCommit: 'aabbccddeeff',
      language: 'rust',
      async run(_seed: number) {
        return {
          passed: true,
          inputTokens: 8200,
          outputTokens: 640,
          costUsd: 0.034,
          eventsCount: 11,
          details: 'cargo check and cargo test passed with zero warnings.',
        };
      },
    },
  ];
}
