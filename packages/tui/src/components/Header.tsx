import React from 'react';
import { Box, Text } from 'ink';

export interface HeaderProps {
  readonly version: string;
  readonly model: string;
  readonly sessionTitle?: string;
}

export const Header: React.FC<HeaderProps> = ({ version, model, sessionTitle }) => {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          ⚒ FORGE <Text dimColor>v{version}</Text>
        </Text>
        <Text color="yellow">Model: {model}</Text>
      </Box>
      {sessionTitle ? (
        <Box marginTop={0}>
          <Text dimColor>Session: </Text>
          <Text>{sessionTitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
};
