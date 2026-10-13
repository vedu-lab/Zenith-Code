import fs from 'node:fs';
import path from 'node:path';
import { InitProjectResult } from './types.js';

export interface InitProjectOptions {
  readonly projectRoot?: string | undefined;
  readonly projectName?: string | undefined;
  readonly description?: string | undefined;
}

const DEFAULT_AGENTS_MD = `# AGENTS.md — Agent & Developer Operating Instructions

## Project Overview
- **Name**: forge
- **Description**: Open-source terminal AI coding agent.
- **Rules**: Strict TypeScript, test-driven verification, safe by default, no unswallowed errors.
`;

export async function initProject(options: InitProjectOptions = {}): Promise<InitProjectResult> {
  const root = options.projectRoot ?? process.cwd();
  const agentsPath = path.join(root, 'AGENTS.md');
  const claudePath = path.join(root, 'CLAUDE.md');
  const geminiPath = path.join(root, 'GEMINI.md');

  const generatedFiles: string[] = [];
  const syncedFiles: string[] = [];
  const contradictions: string[] = [];

  // 1. Ensure AGENTS.md exists
  let agentsContent: string;
  if (!fs.existsSync(agentsPath)) {
    agentsContent = DEFAULT_AGENTS_MD;
    fs.writeFileSync(agentsPath, agentsContent, 'utf8');
    generatedFiles.push('AGENTS.md');
  } else {
    agentsContent = fs.readFileSync(agentsPath, 'utf8');
  }

  // 2. Generate / Sync CLAUDE.md and GEMINI.md
  const syncHeader = '<!-- Generated from AGENTS.md. DO NOT EDIT DIRECTLY. -->\n\n';
  const syncedBody = syncHeader + agentsContent;

  fs.writeFileSync(claudePath, syncedBody, 'utf8');
  syncedFiles.push('CLAUDE.md');

  fs.writeFileSync(geminiPath, syncedBody, 'utf8');
  syncedFiles.push('GEMINI.md');

  // 3. Read .cursorrules and copilot-instructions and check for contradictions
  const cursorrulesPath = path.join(root, '.cursorrules');
  const copilotPath = path.join(root, '.github', 'copilot-instructions.md');

  let cursorContent = '';
  let copilotContent = '';

  if (fs.existsSync(cursorrulesPath)) {
    cursorContent = fs.readFileSync(cursorrulesPath, 'utf8');
  }
  if (fs.existsSync(copilotPath)) {
    copilotContent = fs.readFileSync(copilotPath, 'utf8');
  }

  const agentsLower = agentsContent.toLowerCase();

  // Check 1: Package manager contradictions
  const pnpmInAgents = agentsLower.includes('pnpm');
  const npmInCursor =
    cursorContent.toLowerCase().includes('npm ') ||
    cursorContent.toLowerCase().includes('npm install');
  const yarnInCursor = cursorContent.toLowerCase().includes('yarn ');

  if (pnpmInAgents && (npmInCursor || yarnInCursor)) {
    contradictions.push(
      `.cursorrules mentions '${npmInCursor ? 'npm' : 'yarn'}', while AGENTS.md mandates 'pnpm'.`,
    );
  }

  // Check 2: Test framework contradictions
  const vitestInAgents = agentsLower.includes('vitest');
  const jestInCopilot = copilotContent.toLowerCase().includes('jest');
  if (vitestInAgents && jestInCopilot) {
    contradictions.push(
      `.github/copilot-instructions.md mentions 'jest', while AGENTS.md mandates 'vitest'.`,
    );
  }

  // Check 3: Type strictness contradictions
  const strictInAgents = agentsLower.includes('no any') || agentsLower.includes('strict');
  const anyInCursor =
    cursorContent.toLowerCase().includes('allow any') ||
    cursorContent.toLowerCase().includes('any is fine');
  if (strictInAgents && anyInCursor) {
    contradictions.push(`.cursorrules allows 'any', while AGENTS.md forbids 'any'.`);
  }

  return {
    generatedFiles,
    syncedFiles,
    contradictions,
  };
}
