import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';
import { PermissionDecision } from '../types.js';
import { DiffViewer } from './DiffViewer.js';

export interface PermissionPromptProps {
  readonly toolName: string;
  readonly command?: string | undefined;
  readonly filePath?: string | undefined;
  readonly diff?: string | undefined;
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
  readonly onDecide: (decision: PermissionDecision, feedback?: string) => void;
}

export const PermissionPrompt: React.FC<PermissionPromptProps> = ({
  toolName,
  command,
  filePath,
  diff,
  parameters,
  onDecide,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isEnteringFeedback, setIsEnteringFeedback] = useState<boolean>(false);
  const [feedbackText, setFeedbackText] = useState<string>('');

  const choices: Array<{ label: string; decision: PermissionDecision }> = [
    { label: '[1] Yes', decision: 'allow_once' },
    { label: '[2] Yes for this task', decision: 'allow_task' },
    { label: '[3] No, tell the agent what to do instead', decision: 'deny' },
  ];

  useInput((input, key) => {
    if (isEnteringFeedback) {
      if (key.return) {
        onDecide('deny', feedbackText.trim() || undefined);
        return;
      }
      if (key.backspace || key.delete) {
        setFeedbackText((prev) => prev.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setFeedbackText((prev) => prev + input);
      }
      return;
    }

    if (input === '1' || input === 'y' || input === 'Y') {
      onDecide('allow_once');
    } else if (input === '2' || input === 't' || input === 'T') {
      onDecide('allow_task');
    } else if (input === '3' || input === 'n' || input === 'N') {
      setIsEnteringFeedback(true);
    } else if (key.leftArrow || key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : choices.length - 1));
    } else if (key.rightArrow || key.downArrow) {
      setSelectedIndex((prev) => (prev < choices.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const choice = choices[selectedIndex];
      if (choice) {
        if (choice.decision === 'deny') {
          setIsEnteringFeedback(true);
        } else {
          onDecide(choice.decision);
        }
      }
    }
  });

  return (
    <BorderBox
      flexDirection="column"
      borderStyle="double"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={1}>
        <ColoredText bold color="yellow">
          ⚠ PERMISSION REQUIRED:{' '}
        </ColoredText>
        <Text bold>{toolName}</Text>
      </Box>

      {command ? (
        <Box flexDirection="column" marginY={1}>
          <Text dimColor>Command to execute:</Text>
          <BorderBox borderStyle="single" borderColor="gray" paddingX={1}>
            <ColoredText bold color="cyan">
              $ {command}
            </ColoredText>
          </BorderBox>
        </Box>
      ) : null}

      {diff ? (
        <Box flexDirection="column" marginY={1}>
          <Text dimColor>Proposed file changes:</Text>
          <DiffViewer diffText={diff} filePath={filePath} maxLines={30} />
        </Box>
      ) : null}

      {!command && !diff && parameters ? (
        <Box flexDirection="column" marginY={1}>
          <Text dimColor>Parameters:</Text>
          <Text>{JSON.stringify(parameters, null, 2)}</Text>
        </Box>
      ) : null}

      {isEnteringFeedback ? (
        <Box flexDirection="column" marginTop={1}>
          <ColoredText bold color="yellow">
            Enter feedback/alternative instruction for the agent (press Enter to send):
          </ColoredText>
          <BorderBox borderStyle="single" paddingX={1}>
            <ColoredText color="cyan">{'> '}</ColoredText>
            <Text>{feedbackText}</Text>
            <Text dimColor>_</Text>
          </BorderBox>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Select an action (use arrows/1-3/y/t/n, Enter to confirm):</Text>
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
      )}
    </BorderBox>
  );
};
