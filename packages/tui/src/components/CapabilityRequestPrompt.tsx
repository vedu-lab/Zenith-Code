import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';
import { CapabilityDecision } from '../types.js';

export interface CapabilityRequestPromptProps {
  readonly resourcePattern: string;
  readonly action: string;
  readonly durationMs: number;
  readonly scope: 'task' | 'session';
  readonly onDecide: (decision: CapabilityDecision) => void;
}

export const CapabilityRequestPrompt: React.FC<CapabilityRequestPromptProps> = ({
  resourcePattern,
  action,
  durationMs,
  scope,
  onDecide,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const choices: Array<{ label: string; decision: CapabilityDecision }> = [
    { label: '[1] Grant for task', decision: 'grant_task' },
    { label: '[2] Grant once', decision: 'grant' },
    { label: '[3] Deny', decision: 'deny' },
  ];

  useInput((input, key) => {
    if (input === '1' || input === 't' || input === 'T') {
      onDecide('grant_task');
    } else if (input === '2' || input === 'g' || input === 'G') {
      onDecide('grant');
    } else if (input === '3' || input === 'd' || input === 'D') {
      onDecide('deny');
    } else if (key.leftArrow || key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : choices.length - 1));
    } else if (key.rightArrow || key.downArrow) {
      setSelectedIndex((prev) => (prev < choices.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const choice = choices[selectedIndex];
      if (choice) {
        onDecide(choice.decision);
      }
    }
  });

  const durationSec = Math.round(durationMs / 1000);

  return (
    <BorderBox
      flexDirection="column"
      borderStyle="double"
      borderColor="magenta"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={1}>
        <ColoredText bold color="magenta">
          🔑 CAPABILITY TOKEN REQUEST
        </ColoredText>
      </Box>

      <Box flexDirection="column" gap={0} marginY={1}>
        <Text>
          <Text dimColor>Resource pattern: </Text>
          <ColoredText bold color="cyan">
            {resourcePattern}
          </ColoredText>
        </Text>
        <Text>
          <Text dimColor>Action: </Text>
          <ColoredText bold color="yellow">
            {action}
          </ColoredText>
        </Text>
        <Text>
          <Text dimColor>Scope: </Text>
          <Text>{scope}</Text>
        </Text>
        <Text>
          <Text dimColor>Duration: </Text>
          <Text>{durationSec}s</Text>
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Authorize this capability?</Text>
        <Box gap={2} marginTop={1}>
          {choices.map((c, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <Box key={c.label}>
                <ColoredText bold={isSelected} color={isSelected ? 'green' : 'gray'}>
                  {isSelected ? '► ' : '  '}
                  {c.label}
                </ColoredText>
              </Box>
            );
          })}
        </Box>
      </Box>
    </BorderBox>
  );
};
