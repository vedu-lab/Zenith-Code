import React from 'react';
import { Box, Text } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';
import { TuiMessage, TuiToolCall } from '../types.js';
import { MarkdownView } from './MarkdownView.js';
import { ToolCallItem } from './ToolCallItem.js';

export interface MessageListProps {
  readonly messages: readonly TuiMessage[];
  readonly streamingText?: string | undefined;
  readonly toolCalls?: readonly TuiToolCall[] | undefined;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingText,
  toolCalls = [],
}) => {
  return (
    <Box flexDirection="column" paddingY={1}>
      {messages.map((msg) => {
        if (msg.role === 'user') {
          return (
            <Box key={msg.id} flexDirection="column" marginY={1}>
              <Box gap={1}>
                <ColoredText bold color="green">
                  ❯
                </ColoredText>
                <Text bold>{msg.content}</Text>
              </Box>
            </Box>
          );
        }

        if (msg.role === 'error') {
          return (
            <BorderBox key={msg.id} borderStyle="single" borderColor="red" paddingX={1} marginY={1}>
              <ColoredText color="red">{msg.content}</ColoredText>
            </BorderBox>
          );
        }

        if (msg.role === 'system') {
          return (
            <Box key={msg.id} marginY={0}>
              <Text dimColor>[system] {msg.content}</Text>
            </Box>
          );
        }

        return (
          <Box key={msg.id} flexDirection="column" marginY={1}>
            <MarkdownView content={msg.content} />
          </Box>
        );
      })}

      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <Box flexDirection="column" marginY={1}>
          {toolCalls.map((tc) => (
            <ToolCallItem key={tc.callId} toolCall={tc} />
          ))}
        </Box>
      )}

      {/* Live streaming delta */}
      {streamingText && streamingText.length > 0 ? (
        <Box flexDirection="column" marginY={1}>
          <MarkdownView content={streamingText} />
          <ColoredText color="cyan">▌</ColoredText>
        </Box>
      ) : null}
    </Box>
  );
};
