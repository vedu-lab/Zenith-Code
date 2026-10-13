#!/usr/bin/env node

import { runCli } from '../dist/index.js';

runCli().catch((err) => {
  console.error('Zenith Code CLI fatal error:', err);
  process.exit(1);
});
