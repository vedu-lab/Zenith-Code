import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  MultiEditTool,
  FileReadTracker,
  AllowAllPolicyGate,
} from '../src/tools/index.js';
import { FileStatResult, IFileSystem } from '../src/interfaces/index.js';

class RealDiskFileSystem implements IFileSystem {
  async readFile(p: string): Promise<string> {
    return fs.readFile(path.resolve(p), 'utf-8');
  }
  async writeFile(p: string, content: string): Promise<void> {
    const res = path.resolve(p);
    await fs.mkdir(path.dirname(res), { recursive: true });
    await fs.writeFile(res, content, 'utf-8');
  }
  async exists(p: string): Promise<boolean> {
    try {
      await fs.access(path.resolve(p));
      return true;
    } catch {
      return false;
    }
  }
  async mkdir(p: string): Promise<void> {
    await fs.mkdir(path.resolve(p), { recursive: true });
  }
  async readDir(p: string): Promise<readonly string[]> {
    return fs.readdir(path.resolve(p));
  }
  async stat(p: string): Promise<FileStatResult> {
    const s = await fs.stat(path.resolve(p));
    return { size: s.size, isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs };
  }
  preserveLineEndings(original: string, updated: string): string {
    const isCrlf = original.includes('\r\n');
    const norm = updated.replace(/\r\n/g, '\n');
    return isCrlf ? norm.replace(/\n/g, '\r\n') : norm;
  }
}

describe('Filesystem Tools against Real Temp Dir (CRLF & Windows Path cases)', () => {
  let tempDir: string;
  let diskFs: IFileSystem;
  let tracker: FileReadTracker;
  const policyGate = new AllowAllPolicyGate();

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-fs-test-'));
    diskFs = new RealDiskFileSystem();
    tracker = new FileReadTracker();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('read_file: should display line numbers and respect offset/limit', async () => {
    const filePath = path.join(tempDir, 'sample.txt');
    const content = ['line one', 'line two', 'line three', 'line four'].join('\n');
    await fs.writeFile(filePath, content, 'utf8');

    const readTool = new ReadFileTool(diskFs, tracker, policyGate);
    const result = await readTool.execute({ filePath, offset: 2, limit: 2 });

    expect(result).toContain('2 | line two');
    expect(result).toContain('3 | line three');
    expect(result).not.toContain('line one');
    expect(result).not.toContain('line four');

    expect(tracker.hasBeenRead(filePath)).toBe(true);
  });

  it('read_file: should refuse binary files', async () => {
    const binPath = path.join(tempDir, 'data.bin');
    await fs.writeFile(binPath, Buffer.from([0x00, 0x01, 0x02, 0x03]));

    const readTool = new ReadFileTool(diskFs, tracker, policyGate);
    await expect(readTool.execute({ filePath: binPath })).rejects.toThrow(
      /Cannot read binary file/,
    );
  });

  it('write_file: must enforce read before write for existing files', async () => {
    const filePath = path.join(tempDir, 'existing.txt');
    await fs.writeFile(filePath, 'original content', 'utf8');

    const writeTool = new WriteFileTool(diskFs, tracker, policyGate);
    const readTool = new ReadFileTool(diskFs, tracker, policyGate);

    // 1. Should fail before read
    await expect(writeTool.execute({ filePath, content: 'new content' })).rejects.toThrow(
      /Cannot write to existing file .* without reading it first/,
    );

    // 2. Read the file
    await readTool.execute({ filePath });

    // 3. Now write should succeed
    const res = await writeTool.execute({ filePath, content: 'new content' });
    expect(res).toContain('Successfully wrote');
    expect(await fs.readFile(filePath, 'utf8')).toBe('new content');
  });

  it('write_file: should preserve CRLF line endings on Windows / CRLF files', async () => {
    const filePath = path.join(tempDir, 'crlf.txt');
    await fs.writeFile(filePath, 'line1\r\nline2\r\n', 'utf8');

    const writeTool = new WriteFileTool(diskFs, tracker, policyGate);
    const readTool = new ReadFileTool(diskFs, tracker, policyGate);

    await readTool.execute({ filePath });
    await writeTool.execute({ filePath, content: 'line1\nline2\nline3\n' });

    const updated = await fs.readFile(filePath, 'utf8');
    expect(updated).toBe('line1\r\nline2\r\nline3\r\n');
  });

  it('edit_file: exact match, unique match required, and line ending preservation', async () => {
    const filePath = path.join(tempDir, 'code.ts');
    await fs.writeFile(
      filePath,
      'function a() {\n  return 1;\n}\n\nfunction b() {\n  return 1;\n}\n',
      'utf8',
    );

    const readTool = new ReadFileTool(diskFs, tracker, policyGate);
    const editTool = new EditFileTool(diskFs, tracker, policyGate);

    await readTool.execute({ filePath });

    // Ambiguous match (return 1 matches twice)
    await expect(
      editTool.execute({
        filePath,
        oldContent: '  return 1;',
        newContent: '  return 2;',
      }),
    ).rejects.toThrow(/Found 2 occurrences/);

    // Unique match succeeds
    await editTool.execute({
      filePath,
      oldContent: 'function a() {\n  return 1;\n}',
      newContent: 'function a() {\n  return 42;\n}',
    });

    const updated = await fs.readFile(filePath, 'utf8');
    expect(updated).toContain('return 42;');
  });

  it('edit_file: fuzzy fallback handles whitespace differences', async () => {
    const filePath = path.join(tempDir, 'fuzzy.ts');
    // File has trailing whitespace on line
    await fs.writeFile(filePath, 'const x = 10;   \nconst y = 20;\n', 'utf8');

    const readTool = new ReadFileTool(diskFs, tracker, policyGate);
    const editTool = new EditFileTool(diskFs, tracker, policyGate);

    await readTool.execute({ filePath });

    // Model provides trimmed oldContent without trailing spaces
    await editTool.execute({
      filePath,
      oldContent: 'const x = 10;\nconst y = 20;',
      newContent: 'const x = 100;\nconst y = 200;',
    });

    const updated = await fs.readFile(filePath, 'utf8');
    expect(updated).toBe('const x = 100;\nconst y = 200;\n');
  });

  it('multi_edit: atomic rollback when one edit fails validation', async () => {
    const file1 = path.join(tempDir, 'file1.txt');
    const file2 = path.join(tempDir, 'file2.txt');

    await fs.writeFile(file1, 'hello world', 'utf8');
    await fs.writeFile(file2, 'foo bar', 'utf8');

    const readTool = new ReadFileTool(diskFs, tracker, policyGate);
    const multiEditTool = new MultiEditTool(diskFs, tracker, policyGate);

    await readTool.execute({ filePath: file1 });
    await readTool.execute({ filePath: file2 });

    // Second edit references non-existent string 'missing target'
    await expect(
      multiEditTool.execute({
        edits: [
          { filePath: file1, oldContent: 'hello', newContent: 'goodbye' },
          { filePath: file2, oldContent: 'missing target', newContent: 'baz' },
        ],
      }),
    ).rejects.toThrow(/Atomic multi_edit failed/);

    // Verify ATOMICITY: file1 MUST NOT have been modified!
    expect(await fs.readFile(file1, 'utf8')).toBe('hello world');
    expect(await fs.readFile(file2, 'utf8')).toBe('foo bar');

    // Now valid multi_edit
    await multiEditTool.execute({
      edits: [
        { filePath: file1, oldContent: 'hello', newContent: 'goodbye' },
        { filePath: file2, oldContent: 'foo', newContent: 'baz' },
      ],
    });

    expect(await fs.readFile(file1, 'utf8')).toBe('goodbye world');
    expect(await fs.readFile(file2, 'utf8')).toBe('baz bar');
  });

  it('filesystem tools: should handle Windows backslash paths uniformly with normalization', async () => {
    const subDir = path.join(tempDir, 'nested');
    await fs.mkdir(subDir, { recursive: true });
    const targetFile = path.join(subDir, 'win.txt');
    await fs.writeFile(targetFile, 'initial windows text\n', 'utf8');

    const readTool = new ReadFileTool(diskFs, tracker, policyGate);
    const writeTool = new WriteFileTool(diskFs, tracker, policyGate);
    const editTool = new EditFileTool(diskFs, tracker, policyGate);

    // Pass path using simulated Windows backslashes
    const winPath = targetFile.replace(/\//g, '\\');

    // 1. Read file with Windows backslash path
    const readOutput = await readTool.execute({ filePath: winPath });
    expect(readOutput).toContain('initial windows text');
    expect(tracker.hasBeenRead(targetFile)).toBe(true);

    // 2. Edit file with Windows backslash path
    await editTool.execute({
      filePath: winPath,
      oldContent: 'initial windows text',
      newContent: 'updated windows text',
    });
    expect(await fs.readFile(targetFile, 'utf8')).toBe('updated windows text\n');

    // 3. Write file with Windows backslash path
    await writeTool.execute({
      filePath: winPath,
      content: 'overwritten windows text\n',
    });
    expect(await fs.readFile(targetFile, 'utf8')).toBe('overwritten windows text\n');
  });
});
