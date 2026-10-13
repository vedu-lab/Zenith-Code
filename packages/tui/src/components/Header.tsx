import React from 'react';
import { Box, Text } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';
import { PolicyMode } from '@forge/safety';

export interface HeaderProps {
  readonly name?: string | undefined;
  readonly version?: string | undefined;
  readonly model: string;
  readonly cwd: string;
  readonly mode: PolicyMode;
  readonly sessionTitle?: string | undefined;
}

export const Header: React.FC<HeaderProps> = ({
  name = '⚒ FORGE',
  version = '0.1.0',
  model,
  cwd,
  mode,
  sessionTitle,
}) => {
  const getModeColor = (): string => {
    switch (mode) {
      case 'bypass':
        return 'red';
      case 'plan':
        return 'cyan';
      case 'acceptEdits':
        return 'yellow';
      case 'default':
      default:
        return 'green';
    }
  };

  return (
    <BorderBox flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <ColoredText bold color="cyan">
          {name} <Text dimColor>v{version}</Text>
        </ColoredText>
        <Box gap={2}>
          <Text>
            <Text dimColor>mode: </Text>
            <ColoredText bold color={getModeColor()}>
              [{mode.toUpperCase()}]
            </ColoredText>
          </Text>
          <ColoredText color="yellow">model: {model}</ColoredText>
        </Box>
      </Box>

      <Box justifyContent="space-between" marginTop={0}>
        <Text dimColor>cwd: {cwd}</Text>
        {sessionTitle ? <Text dimColor>session: {sessionTitle}</Text> : null}
      </Box>
    </BorderBox>
  );
};
