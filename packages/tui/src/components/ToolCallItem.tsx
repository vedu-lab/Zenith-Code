import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';
import { TuiToolCall } from '../types.js';

export interface ToolCallItemProps {
  readonly toolCall: TuiToolCall;
  readonly defaultExpanded?: boolean | undefined;
}

export function formatCompactToolName(
  toolName: string,
  params: Readonly<Record<string, unknown>>,
): string {
  let target = '';

  if (typeof params['filePath'] === 'string') {
    target = params['filePath'];
  } else if (typeof params['path'] === 'string') {
    target = params['path'];
  } else if (typeof params['command'] === 'string') {
    target = params['command'];
  } else if (typeof params['pattern'] === 'string') {
    target = `"${params['pattern']}"`;
  } else if (typeof params['query'] === 'string') {
    target = `"${params['query']}"`;
  } else if (Array.isArray(params['edits'])) {
    target = `${params['edits'].length} edits`;
  } else {
    const firstKey = Object.keys(params)[0];
    if (firstKey && typeof params[firstKey] === 'string') {
      target = String(params[firstKey]);
    }
  }

  const cleanName = toolName.replace(/_file$/, '').replace(/^[a-z]/, (c) => c.toUpperCase());

  if (target.length > 36) {
    target = '...' + target.slice(-33);
  }

  return target ? `${cleanName}(${target})` : cleanName;
}

export const ToolCallItem: React.FC<ToolCallItemProps> = ({
  toolCall,
  defaultExpanded = false,
}) => {
  const [expanded, _setExpanded] = useState<boolean>(defaultExpanded);
  const compactLabel = formatCompactToolName(toolCall.toolName, toolCall.parameters);

  const getStatusIcon = (): { icon: string; color: string } => {
    switch (toolCall.status) {
      case 'running':
        return { icon: '●', color: 'yellow' };
      case 'success':
        return { icon: '✔', color: 'green' };
      case 'failure':
        return { icon: '✖', color: 'red' };
      case 'pending':
      default:
        return { icon: '○', color: 'gray' };
    }
  };

  const { icon, color } = getStatusIcon();

  return (
    <Box flexDirection="column" marginY={0}>
      <Box justifyContent="space-between">
        <Box gap={1}>
          <ColoredText bold color={color}>
            {icon}
          </ColoredText>
          <Text bold>{compactLabel}</Text>
          {toolCall.durationMs !== undefined ? (
            <Text dimColor>({toolCall.durationMs}ms)</Text>
          ) : null}
        </Box>
        {toolCall.status === 'failure' && toolCall.error ? (
          <ColoredText dimColor color="red">
            failed
          </ColoredText>
        ) : null}
      </Box>

      {expanded && (
        <BorderBox
          flexDirection="column"
          paddingLeft={2}
          borderStyle="single"
          borderColor="gray"
          marginY={1}
        >
          <Text dimColor>Parameters: {JSON.stringify(toolCall.parameters)}</Text>
          {toolCall.error ? <ColoredText color="red">Error: {toolCall.error}</ColoredText> : null}
          {toolCall.output !== undefined ? (
            <Text dimColor>
              Output:{' '}
              {typeof toolCall.output === 'string'
                ? toolCall.output.slice(0, 300)
                : JSON.stringify(toolCall.output).slice(0, 300)}
            </Text>
          ) : null}
        </BorderBox>
      )}
    </Box>
  );
};
