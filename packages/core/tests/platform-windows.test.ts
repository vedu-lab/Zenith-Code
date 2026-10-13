import { describe, it, expect } from 'vitest';
import {
  detectShellEnvironment,
  detectLineEnding,
  preserveLineEnding,
  normalizePlatformPath,
  arePathsEqual,
  getPlatformPromptContext,
} from '../src/platform/index.js';

describe('Windows First-Class & Platform Support', () => {
  describe('detectShellEnvironment', () => {
    it('detects PowerShell on Windows when PSModulePath is set', () => {
      const env = {
        PSModulePath: 'C:\\Program Files\\PowerShell\\Modules',
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      };
      const info = detectShellEnvironment(env, 'win32');

      expect(info.isWindows).toBe(true);
      expect(info.platform).toBe('win32');
      expect(info.shellType).toBe('powershell');
      expect(info.defaultLineEnding).toBe('\r\n');
      expect(info.pathSeparator).toBe('\\');
    });

    it('detects cmd.exe on Windows when COMSPEC is cmd and no PowerShell env exists', () => {
      const env = {
        COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
      };
      const info = detectShellEnvironment(env, 'win32');

      expect(info.isWindows).toBe(true);
      expect(info.shellType).toBe('cmd');
    });

    it('detects bash when running under MSYSTEM / Git Bash on Windows', () => {
      const env = {
        MSYSTEM: 'MINGW64',
        SHELL: 'C:\\Program Files\\Git\\bin\\bash.exe',
      };
      const info = detectShellEnvironment(env, 'win32');

      expect(info.isWindows).toBe(true);
      expect(info.shellType).toBe('bash');
    });

    it('detects POSIX shell on linux and macOS', () => {
      const infoLinux = detectShellEnvironment({ SHELL: '/bin/bash' }, 'linux');
      expect(infoLinux.isWindows).toBe(false);
      expect(infoLinux.shellType).toBe('bash');
      expect(infoLinux.defaultLineEnding).toBe('\n');

      const infoMac = detectShellEnvironment({ SHELL: '/bin/zsh' }, 'darwin');
      expect(infoMac.isWindows).toBe(false);
      expect(infoMac.shellType).toBe('zsh');
    });
  });

  describe('Line Endings: detectLineEnding & preserveLineEnding', () => {
    it('accurately distinguishes CRLF and LF files', () => {
      const crlfContent = 'line 1\r\nline 2\r\nline 3\r\n';
      const lfContent = 'line 1\nline 2\nline 3\n';

      expect(detectLineEnding(crlfContent)).toBe('\r\n');
      expect(detectLineEnding(lfContent)).toBe('\n');
    });

    it('preserves existing CRLF endings when modifying text', () => {
      const incomingText = 'new line 1\nnew line 2\n';
      const preserved = preserveLineEnding(incomingText, '\r\n');

      expect(preserved).toBe('new line 1\r\nnew line 2\r\n');
      expect(preserveLineEnding(preserved, '\n')).toBe('new line 1\nnew line 2\n');
    });
  });

  describe('Path Normalization & Comparisons', () => {
    it('normalizes drive letters to uppercase and slashes to backslashes on Windows', () => {
      const raw = 'c:/users/developer/project/src/index.ts';
      const normalized = normalizePlatformPath(raw, true);

      expect(normalized).toBe('C:\\users\\developer\\project\\src\\index.ts');
    });

    it('handles extended-length Windows paths (\\\\?\\)', () => {
      const longPath = '\\\\?\\C:\\VeryLongPath\\Project\\File.txt';
      const normalized = normalizePlatformPath(longPath, true);

      expect(normalized).toBe('C:\\VeryLongPath\\Project\\File.txt');
    });

    it('performs case-insensitive path equality on Windows and case-sensitive on POSIX', () => {
      const p1 = 'C:\\Project\\App.ts';
      const p2 = 'c:\\project\\app.ts';

      expect(arePathsEqual(p1, p2, true)).toBe(true);
      expect(arePathsEqual('/project/app.ts', '/Project/app.ts', false)).toBe(false);
    });
  });

  describe('getPlatformPromptContext', () => {
    it('includes Windows and PowerShell instructions for Windows hosts', () => {
      const info = detectShellEnvironment({ PSModulePath: 'C:\\PS' }, 'win32');
      const prompt = getPlatformPromptContext(info);

      expect(prompt).toContain('Windows Native (POWERSHELL)');
      expect(prompt).toContain('PowerShell cmdlets');
      expect(prompt).toContain('CRLF');
    });
  });
});
