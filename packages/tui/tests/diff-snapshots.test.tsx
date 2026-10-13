import { describe, it, expect } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { DiffViewer, parseUnifiedDiff } from '../src/index.js';

describe('Diff Snapshot Tests', () => {
  it('parses unified diff chunks with line numbers accurately', () => {
    const diff = [
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,4 +1,5 @@',
      ' import express from "express";',
      '-const port = 3000;',
      '+const port = process.env.PORT || 3000;',
      '+const app = express();',
      ' export default app;',
    ].join('\n');

    const parsed = parseUnifiedDiff(diff);
    expect(parsed).toMatchInlineSnapshot(`
      [
        {
          "newLineNo": null,
          "oldLineNo": null,
          "text": "--- a/src/app.ts",
          "type": "header",
        },
        {
          "newLineNo": null,
          "oldLineNo": null,
          "text": "+++ b/src/app.ts",
          "type": "header",
        },
        {
          "newLineNo": null,
          "oldLineNo": null,
          "text": "@@ -1,4 +1,5 @@",
          "type": "header",
        },
        {
          "newLineNo": 1,
          "oldLineNo": 1,
          "text": "import express from "express";",
          "type": "context",
        },
        {
          "newLineNo": null,
          "oldLineNo": 2,
          "text": "const port = 3000;",
          "type": "delete",
        },
        {
          "newLineNo": 2,
          "oldLineNo": null,
          "text": "const port = process.env.PORT || 3000;",
          "type": "add",
        },
        {
          "newLineNo": 3,
          "oldLineNo": null,
          "text": "const app = express();",
          "type": "add",
        },
        {
          "newLineNo": 4,
          "oldLineNo": 3,
          "text": "export default app;",
          "type": "context",
        },
      ]
    `);
  });

  it('renders line-numbered diff view matching snapshot', () => {
    const sampleDiff = [
      '@@ -5,3 +5,3 @@',
      ' function calculateTotal() {',
      '-  return 100;',
      '+  return 150;',
      ' }',
    ].join('\n');

    const { lastFrame } = render(<DiffViewer diffText={sampleDiff} filePath="src/billing.ts" />);
    expect(lastFrame()).toMatchInlineSnapshot(`
      "
      ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
      │ Diff: src/billing.ts                                                                             │
      │                                                                                                  │
      │ @@ -5,3 +5,3 @@                                                                                  │
      │    5    5   function calculateTotal() {                                                          │
      │    6      -   return 100;                                                                        │
      │         6 +   return 150;                                                                        │
      │    7    7   }                                                                                    │
      └──────────────────────────────────────────────────────────────────────────────────────────────────┘
      "
    `);
  });
});
