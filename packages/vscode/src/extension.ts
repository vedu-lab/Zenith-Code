import { WorkspaceIndex } from '@forge/state';
import { CoreEventBus, IEventBus } from '@forge/core';
import { AutocompleteServer, MockFimProvider } from './server.js';
import { ForgeInlineCompletionProvider } from './provider.js';
import { AgentSidePanelController } from './side-panel.js';
import { IFimProvider } from './types.js';

export interface ExtensionContext {
  readonly workspaceRoot: string;
  readonly eventBus?: IEventBus | undefined;
  readonly fimProvider?: IFimProvider | undefined;
}

export interface ExtensionInstance {
  readonly server: AutocompleteServer;
  readonly provider: ForgeInlineCompletionProvider;
  readonly sidePanel: AgentSidePanelController;
  readonly eventBus: IEventBus;
  readonly deactivate: () => Promise<void>;
}

export function activate(context: ExtensionContext): ExtensionInstance {
  const index = new WorkspaceIndex(context.workspaceRoot);
  const eventBus = context.eventBus ?? new CoreEventBus();
  const fimProvider = context.fimProvider ?? new MockFimProvider();

  const server = new AutocompleteServer(index, { provider: fimProvider });
  const provider = new ForgeInlineCompletionProvider(server);
  const sidePanel = new AgentSidePanelController(eventBus);

  return {
    server,
    provider,
    sidePanel,
    eventBus,
    deactivate: async () => {
      sidePanel.dispose();
      server.clearCache();
    },
  };
}
