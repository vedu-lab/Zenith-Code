import React from 'react';
import { Box, Text } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';
import { PolicyMode } from '@forge/safety';

export interface FooterProps {
  readonly mode: PolicyMode;
  readonly liveCost: number;
  readonly contextUsagePercent: number;
  readonly activeCapabilitiesCount: number;
  readonly keyHints?: string | undefined;
}

export const Footer: React.FC<FooterProps> = ({
  mode,
  liveCost,
  contextUsagePercent,
  activeCapabilitiesCount,
  keyHints = '[Enter] Send  [Shift+Enter] Multiline  [@] File  [Esc] Interrupt  [Esc-Esc] Rewind  [/] Commands',
}) => {
  const formattedCost = `$${liveCost.toFixed(4)}`;
  const contextColor =
    contextUsagePercent > 80 ? 'red' : contextUsagePercent > 60 ? 'yellow' : 'blue';

  return (
    <BorderBox flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box justifyContent="space-between">
        <Box gap={2}>
          <Text>
            <Text dimColor>Mode: </Text>
            <ColoredText bold color="cyan">
              {mode}
            </ColoredText>
          </Text>
          <Text>
            <Text dimColor>Cost: </Text>
            <ColoredText bold color="green">
              {formattedCost}
            </ColoredText>
          </Text>
          <Text>
            <Text dimColor>Context: </Text>
            <ColoredText bold color={contextColor}>
              {contextUsagePercent}%
            </ColoredText>
          </Text>
          <Text>
            <Text dimColor>Caps: </Text>
            <ColoredText color="magenta">{activeCapabilitiesCount} active</ColoredText>
          </Text>
        </Box>
      </Box>

      <Box marginTop={0}>
        <Text dimColor>{keyHints}</Text>
      </Box>
    </BorderBox>
  );
};
