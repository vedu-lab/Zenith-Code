import { describe, it, expect } from 'vitest';
import {
  countTokens,
  isOverThreshold,
  SemanticChunker,
  MapReduceSummarizer,
  ContextCompactor,
} from '../src/context/index.js';

describe('Context Management & Semantic Chunking Subsystem', () => {
  it('accurately counts tokens and detects 60% and 80% threshold limits', () => {
    const text = 'const greeting = "Hello, world!";\nconsole.log(greeting);';
    const tokens = countTokens(text);
    expect(tokens).toBeGreaterThan(5);

    expect(isOverThreshold(61000, 100000, 60)).toBe(true);
    expect(isOverThreshold(59000, 100000, 60)).toBe(false);
    expect(isOverThreshold(81000, 100000, 80)).toBe(true);
  });

  it('chunks documents by headings, code by top-level declarations, and logs by overlapping groups', () => {
    const chunker = new SemanticChunker({ targetChunkTokens: 20 });

    // Doc chunking
    const doc = `# Section 1\nLine 1\nLine 2\nLine 3\n# Section 2\nLine 4\nLine 5\nLine 6`;
    const docChunks = chunker.chunk(doc, 'doc');
    expect(docChunks.length).toBeGreaterThan(0);
    expect(docChunks[0]?.type).toBe('doc');

    // Code chunking
    const code = `export class UserService {\n  findUser() {}\n}\n\nexport function helper() {\n  return 42;\n}`;
    const codeChunks = chunker.chunk(code, 'code', 'typescript');
    expect(codeChunks.length).toBeGreaterThan(0);
    expect(codeChunks[0]?.type).toBe('code');

    // Log chunking
    const logs = Array.from({ length: 150 }, (_, i) => `2026-01-01 [INFO] Step ${i}`).join('\n');
    const logChunks = chunker.chunk(logs, 'log');
    expect(logChunks.length).toBeGreaterThan(1);
    expect(logChunks[0]?.type).toBe('log');
  });

  it('splits and summarizes a massive ~500k-token input via map-reduce with chunk IDs', async () => {
    // Generate large content (~500,000 tokens):
    // 500,000 tokens * ~3.6 chars/token ≈ 1.8 MB
    const paragraph =
      'The quick brown fox jumps over the lazy dog in software testing and validation cycles. '.repeat(
        10,
      );
    const totalParas = 1500;
    const largeContent = Array.from(
      { length: totalParas },
      (_, i) => `## Section ${i + 1}\n${paragraph}`,
    ).join('\n\n');

    const tokenEstimate = countTokens(largeContent);
    // Verify large input size (> 100k tokens)
    expect(tokenEstimate).toBeGreaterThan(100000);

    const chunker = new SemanticChunker({ targetChunkTokens: 2000, maxChunkTokens: 4000 });
    const chunks = chunker.chunk(largeContent, 'doc');

    expect(chunks.length).toBeGreaterThan(20);

    const summarizer = new MapReduceSummarizer();
    const result = await summarizer.summarize(chunks);

    expect(result.chunks.length).toBe(chunks.length);
    expect(result.brief).toBeDefined();
    // Verify reduction ratio
    expect(result.reductionRatio).toBeGreaterThan(0.5);
    // Verify chunk IDs are tracked in brief for retrieval
    expect(result.brief).toContain('[chunk-doc-1]');
    expect(result.brief).toContain('[chunk-doc-2]');
  });

  it('auto-compacts old turns at 80% window threshold preserving recent turns', () => {
    const compactor = new ContextCompactor();
    const turns = [
      { role: 'user' as const, content: 'Initial user prompt' },
      { role: 'assistant' as const, content: 'Step 1 response' },
      { role: 'tool' as const, content: 'Tool execution result 1' },
      { role: 'assistant' as const, content: 'Step 2 response' },
      { role: 'tool' as const, content: 'Tool execution result 2' },
      { role: 'assistant' as const, content: 'Step 3 response' },
      { role: 'user' as const, content: 'Latest follow-up query' },
    ];

    // With low maxWindow, triggers 80% threshold
    const result = compactor.compactTurns(turns, 40, 80, 2);
    expect(result.compacted).toBe(true);
    expect(result.turns.length).toBeLessThan(turns.length);
    expect(result.turns[1]?.content).toContain('[Context Compaction:');
    // Recent turns preserved
    expect(result.turns[result.turns.length - 1]?.content).toBe('Latest follow-up query');
  });

  it('truncates oversized tool outputs with markers and retrieval hints', () => {
    const compactor = new ContextCompactor();
    const hugeOutput = 'A'.repeat(50000);

    const res = compactor.truncateToolOutput(
      hugeOutput,
      1000,
      'Check detailed log in .forge/audit.jsonl',
    );
    expect(res.truncated).toBe(true);
    expect(res.text).toContain(
      '... [TRUNCATED 49000 bytes. Check detailed log in .forge/audit.jsonl] ...',
    );
    expect(res.text.startsWith('AAAA')).toBe(true);
    expect(res.text.endsWith('AAAA')).toBe(true);
  });
});
