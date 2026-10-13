import { AutocompleteServer } from './server.js';
import { WorkspaceIndex } from '@forge/state';

export interface ExtensionContext {
  readonly workspaceRoot: string;
}

export interface ExtensionInstance {
  readonly server: AutocompleteServer;
  readonly deactivate: () => Promise<void>;
}

export function activate(context: ExtensionContext): ExtensionInstance {
  const index = new WorkspaceIndex(context.workspaceRoot);
  const server = new AutocompleteServer(index);

  return {
    server,
    deactivate: async () => {
      // Clean up language server connections
    },
  };
}
