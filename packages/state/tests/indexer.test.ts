import { describe, it, expect } from 'vitest';
import { CodeIndex, extractSymbols, CodeSearchTool } from '../src/indexer/index.js';
import { AllowAllPolicyGate } from '@forge/core';

describe('Code Indexer & Code Search Subsystem', () => {
  it('extracts top-level symbols across TypeScript, Python, Go, and Rust', () => {
    // TypeScript
    const tsCode = `export interface User {}\nexport class UserService {}\nexport function getUser() {}`;
    const tsSymbols = extractSymbols(tsCode, 'user.ts');
    expect(tsSymbols).toHaveLength(3);
    expect(tsSymbols.map((s) => s.name)).toEqual(['User', 'UserService', 'getUser']);

    // Python
    const pyCode = `class OrderModel:\n    pass\n\ndef process_order():\n    pass`;
    const pySymbols = extractSymbols(pyCode, 'order.py');
    expect(pySymbols).toHaveLength(2);
    expect(pySymbols.map((s) => s.name)).toEqual(['OrderModel', 'process_order']);

    // Go
    const goCode = `type Worker struct {}\nfunc StartWorker() {}`;
    const goSymbols = extractSymbols(goCode, 'worker.go');
    expect(goSymbols).toHaveLength(2);
    expect(goSymbols.map((s) => s.name)).toEqual(['Worker', 'StartWorker']);

    // Rust
    const rsCode = `pub struct Engine {}\npub fn run_engine() {}`;
    const rsSymbols = extractSymbols(rsCode, 'engine.rs');
    expect(rsSymbols).toHaveLength(2);
    expect(rsSymbols.map((s) => s.name)).toEqual(['Engine', 'run_engine']);
  });

  it('updates index incrementally, skipping re-parsing when file hash is unchanged', () => {
    const index = new CodeIndex();
    const contentA = 'export function calculateTotal() { return 100; }';

    const res1 = index.updateFile('calc.ts', contentA);
    expect(res1.updated).toBe(true);
    expect(res1.symbolsCount).toBe(1);

    // Call updateFile with same content: hash matches -> skip parsing!
    const res2 = index.updateFile('calc.ts', contentA);
    expect(res2.updated).toBe(false);
    expect(res2.symbolsCount).toBe(1);

    // Call updateFile with modified content
    const contentB = `${contentA}\nexport function calculateTax() { return 10; }`;
    const res3 = index.updateFile('calc.ts', contentB);
    expect(res3.updated).toBe(true);
    expect(res3.symbolsCount).toBe(2);
  });

  it('generates a compact repo map of all indexed files and symbols', () => {
    const index = new CodeIndex();
    index.updateFile('src/auth.ts', 'export class AuthManager {}\nexport function login() {}');
    index.updateFile('src/db.ts', 'export interface Database {}');

    const repoMap = index.generateRepoMap();
    expect(repoMap.indexedFilesCount).toBe(2);
    expect(repoMap.symbolsCount).toBe(3);
    expect(repoMap.compactText).toContain('src/auth.ts:');
    expect(repoMap.compactText).toContain('AuthManager');
    expect(repoMap.compactText).toContain('Database');
  });

  it('CodeSearchTool formulates read intents and executes searches through the policy gate', async () => {
    const index = new CodeIndex();
    index.updateFile(
      'services/payment.ts',
      'export class StripeGateway {}\nexport function chargeCustomer() {}',
    );

    const tool = new CodeSearchTool(index, new AllowAllPolicyGate());

    // Intent verification
    const intent = (
      tool as unknown as { createIntent: (input: { query: string }) => unknown }
    ).createIntent({ query: 'charge' }) as {
      toolName: string;
      actionType: string;
      target: string;
    };
    expect(intent.toolName).toBe('code_search');
    expect(intent.actionType).toBe('fs:read');
    expect(intent.target).toBe('charge');

    // Execution
    const output = await tool.execute({ query: 'charge' });
    expect(output).toContain('services/payment.ts:');
    expect(output).toContain('chargeCustomer');
  });
});
