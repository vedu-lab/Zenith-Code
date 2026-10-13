import React from 'react';
import { Box, Text } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';

export interface MarkdownViewProps {
  readonly content: string;
}

interface Block {
  readonly type: 'code' | 'text';
  readonly language?: string | undefined;
  readonly content: string;
}

export function parseMarkdownBlocks(markdown: string): readonly Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split('\n');
  let inCode = false;
  let codeLang = '';
  let codeLines: string[] = [];
  let textLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        blocks.push({
          type: 'code',
          language: codeLang || undefined,
          content: codeLines.join('\n'),
        });
        codeLines = [];
        codeLang = '';
        inCode = false;
      } else {
        if (textLines.length > 0) {
          blocks.push({
            type: 'text',
            content: textLines.join('\n'),
          });
          textLines = [];
        }
        codeLang = line.slice(3).trim();
        inCode = true;
      }
    } else if (inCode) {
      codeLines.push(line);
    } else {
      textLines.push(line);
    }
  }

  if (inCode && codeLines.length > 0) {
    blocks.push({
      type: 'code',
      language: codeLang || undefined,
      content: codeLines.join('\n'),
    });
  } else if (textLines.length > 0) {
    blocks.push({
      type: 'text',
      content: textLines.join('\n'),
    });
  }

  return blocks;
}

export function renderHighlightedCodeLine(line: string, index: number): React.ReactNode {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
    return (
      <Box key={`code-line-${index}`}>
        <Text dimColor>{String(index + 1).padStart(3, ' ')} | </Text>
        <ColoredText dimColor color="gray">
          {line}
        </ColoredText>
      </Box>
    );
  }

  const parts = line.split(
    /(\b(?:const|let|var|function|return|import|export|from|class|interface|type|async|await|if|else|for|while|new|try|catch)\b|"[^"]*"|'[^']*'|`[^`]*`)/g,
  );

  return (
    <Box key={`code-line-${index}`}>
      <Text dimColor>{String(index + 1).padStart(3, ' ')} | </Text>
      {parts.map((part, pIdx) => {
        if (
          /^(const|let|var|function|return|import|export|from|class|interface|type|async|await|if|else|for|while|new|try|catch)$/.test(
            part,
          )
        ) {
          return (
            <ColoredText key={pIdx} bold color="magenta">
              {part}
            </ColoredText>
          );
        }
        if (/^(".*"|'.*'|`.*`)$/.test(part)) {
          return (
            <ColoredText key={pIdx} color="green">
              {part}
            </ColoredText>
          );
        }
        return <Text key={pIdx}>{part}</Text>;
      })}
    </Box>
  );
}

export const MarkdownView: React.FC<MarkdownViewProps> = ({ content }) => {
  const blocks = parseMarkdownBlocks(content);

  return (
    <Box flexDirection="column">
      {blocks.map((block, bIdx) => {
        if (block.type === 'code') {
          const codeLines = block.content.split('\n');
          return (
            <BorderBox
              key={`block-${bIdx}`}
              flexDirection="column"
              borderStyle="round"
              borderColor="cyan"
              paddingX={1}
              marginY={1}
            >
              {block.language ? (
                <Box justifyContent="flex-end">
                  <ColoredText dimColor bold color="cyan">
                    [{block.language}]
                  </ColoredText>
                </Box>
              ) : null}
              {codeLines.map((line, lIdx) => renderHighlightedCodeLine(line, lIdx))}
            </BorderBox>
          );
        }

        const textLines = block.content.split('\n');
        return (
          <Box key={`block-${bIdx}`} flexDirection="column" marginY={0}>
            {textLines.map((line, lIdx) => {
              if (line.startsWith('# ')) {
                return (
                  <ColoredText key={lIdx} bold color="cyan">
                    {line.slice(2)}
                  </ColoredText>
                );
              }
              if (line.startsWith('## ') || line.startsWith('### ')) {
                return (
                  <Text key={lIdx} bold>
                    {line.replace(/^#+\s*/, '')}
                  </Text>
                );
              }
              if (line.startsWith('- ') || line.startsWith('* ')) {
                return (
                  <Box key={lIdx} paddingLeft={1}>
                    <ColoredText color="yellow">• </ColoredText>
                    <Text>{line.slice(2)}</Text>
                  </Box>
                );
              }
              return (
                <Box key={lIdx}>
                  <Text>{line}</Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
};
