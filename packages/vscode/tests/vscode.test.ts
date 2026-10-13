import { describe, it, expect } from 'vitest';
import { WorkspaceIndex } from '@forge/state';
import { AutocompleteServer, activate } from '../src/index.js';

describe('VS Code Package', () => {
  it('should return completion items from workspace index', async () => {
    const index = new WorkspaceIndex('/workspace');
    index.addFile('src/auth.ts', 200, ['loginUser', 'logoutUser']);

    const server = new AutocompleteServer(index);
    const completions = await server.getCompletions({
      filePath: 'src/main.ts',
      prefix: 'login',
      line: 10,
      character: 5,
    });

    expect(completions).toHaveLength(1);
    expect(completions[0]?.label).toBe('loginUser');
  });

  it('should activate extension and expose autocomplete server', () => {
    const instance = activate({ workspaceRoot: '/workspace' });
    expect(instance.server).toBeDefined();
    expect(instance.deactivate).toBeDefined();
  });
});
