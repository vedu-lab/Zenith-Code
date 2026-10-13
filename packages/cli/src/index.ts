export * from './io/filesystem.js';
export * from './io/process-runner.js';
export * from './bootstrap.js';

import { bootstrapApp } from './bootstrap.js';

export async function runCli(): Promise<void> {
  const container = bootstrapApp();
  const session = await container.sessionManager.createSession('Interactive Terminal Session');
  const result = await container.agentLoop.runStep(
    1,
    [{ role: 'user', content: 'Initialize Forge workspace' }],
    { sessionId: session.id },
  );

  // eslint-disable-next-line no-console
  console.log(`Forge initialized session ${session.id}. Status completed: ${result.completed}`);
}
