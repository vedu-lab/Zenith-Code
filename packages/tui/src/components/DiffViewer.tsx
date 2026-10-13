import React from 'react';
import { Box, Text } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';

export interface DiffViewerProps {
  readonly diffText: string;
  readonly filePath?: string | undefined;
  readonly maxLines?: number | undefined;
}

interface ParsedDiffLine {
  readonly type: 'add' | 'delete' | 'context' | 'header';
  readonly oldLineNo: number | null;
  readonly newLineNo: number | null;
  readonly text: string;
}

export function parseUnifiedDiff(diffText: string): readonly ParsedDiffLine[] {
  const rawLines = diffText.split('\n');
  const result: ParsedDiffLine[] = [];

  let oldCounter = 1;
  let newCounter = 1;

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match && match[1] && match[2]) {
        oldCounter = parseInt(match[1], 10);
        newCounter = parseInt(match[2], 10);
      }
      result.push({
        type: 'header',
        oldLineNo: null,
        newLineNo: null,
        text: line,
      });
    } else if (line.startsWith('+++') || line.startsWith('---')) {
      result.push({
        type: 'header',
        oldLineNo: null,
        newLineNo: null,
        text: line,
      });
    } else if (line.startsWith('+')) {
      result.push({
        type: 'add',
        oldLineNo: null,
        newLineNo: newCounter,
        text: line.substring(1),
      });
      newCounter++;
    } else if (line.startsWith('-')) {
      result.push({
        type: 'delete',
        oldLineNo: oldCounter,
        newLineNo: null,
        text: line.substring(1),
      });
      oldCounter++;
    } else {
      const content = line.startsWith(' ') ? line.substring(1) : line;
      result.push({
        type: 'context',
        oldLineNo: oldCounter,
        newLineNo: newCounter,
        text: content,
      });
      oldCounter++;
      newCounter++;
    }
  }

  return result;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ diffText, filePath, maxLines = 50 }) => {
  const lines = parseUnifiedDiff(diffText).slice(0, maxLines);

  return (
    <BorderBox
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      marginY={1}
    >
      {filePath ? (
        <Box marginBottom={1}>
          <ColoredText bold color="cyan">
            Diff: {filePath}
          </ColoredText>
        </Box>
      ) : null}

      {lines.map((l, index) => {
        if (l.type === 'header') {
          return (
            <Box key={`diff-hdr-${index}`}>
              <ColoredText dimColor color="cyan">
                {l.text}
              </ColoredText>
            </Box>
          );
        }

        const oldNoStr = l.oldLineNo !== null ? String(l.oldLineNo).padStart(4, ' ') : '    ';
        const newNoStr = l.newLineNo !== null ? String(l.newLineNo).padStart(4, ' ') : '    ';

        if (l.type === 'add') {
          return (
            <Box key={`diff-add-${index}`}>
              <Text dimColor>{oldNoStr} </Text>
              <Text dimColor>{newNoStr} </Text>
              <ColoredText bold color="green">
                + {l.text}
              </ColoredText>
            </Box>
          );
        }

        if (l.type === 'delete') {
          return (
            <Box key={`diff-del-${index}`}>
              <Text dimColor>{oldNoStr} </Text>
              <Text dimColor>{newNoStr} </Text>
              <ColoredText bold color="red">
                - {l.text}
              </ColoredText>
            </Box>
          );
        }

        return (
          <Box key={`diff-ctx-${index}`}>
            <Text dimColor>{oldNoStr} </Text>
            <Text dimColor>{newNoStr} </Text>
            <Text dimColor> {l.text}</Text>
          </Box>
        );
      })}
      {lines.length < diffText.split('\n').length ? (
        <Text dimColor>... (more diff lines truncated)</Text>
      ) : null}
    </BorderBox>
  );
};
