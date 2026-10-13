import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';
import { Checkpoint } from '@forge/state';

export interface RewindPickerProps {
  readonly checkpoints: readonly Checkpoint[];
  readonly onRewind: (checkpointId: string, scope: 'code' | 'conversation' | 'both') => void;
  readonly onBranch?: ((checkpointId: string, branchName: string) => void) | undefined;
  readonly onClose: () => void;
}

export const RewindPicker: React.FC<RewindPickerProps> = ({
  checkpoints,
  onRewind,
  onBranch,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [scope, setScope] = useState<'code' | 'conversation' | 'both'>('both');

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : checkpoints.length - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < checkpoints.length - 1 ? prev + 1 : 0));
      return;
    }

    if (input === '1') {
      setScope('code');
      return;
    }
    if (input === '2') {
      setScope('conversation');
      return;
    }
    if (input === '3') {
      setScope('both');
      return;
    }

    if (input === 'b' || input === 'B') {
      const selected = checkpoints[selectedIndex];
      if (selected && onBranch) {
        onBranch(selected.id, `branch-${Date.now()}`);
      }
      return;
    }

    if (key.return) {
      const selected = checkpoints[selectedIndex];
      if (selected) {
        onRewind(selected.id, scope);
      }
    }
  });

  return (
    <BorderBox
      flexDirection="column"
      borderStyle="double"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <ColoredText bold color="cyan">
          ⏪ CHECKPOINTS & TIME-TRAVEL (ESC-ESC)
        </ColoredText>
        <Text dimColor>[Esc] Close</Text>
      </Box>

      {/* Scope selector */}
      <Box gap={2} marginBottom={1}>
        <Text dimColor>Scope: </Text>
        <ColoredText bold={scope === 'both'} color={scope === 'both' ? 'green' : undefined}>
          [3] Both
        </ColoredText>
        <ColoredText bold={scope === 'code'} color={scope === 'code' ? 'green' : undefined}>
          [1] Code only
        </ColoredText>
        <ColoredText
          bold={scope === 'conversation'}
          color={scope === 'conversation' ? 'green' : undefined}
        >
          [2] Conversation only
        </ColoredText>
      </Box>

      {/* Checkpoints tree list */}
      {checkpoints.length === 0 ? (
        <Box marginY={1}>
          <Text dimColor>No checkpoints recorded yet.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginY={0}>
          {checkpoints.map((cp, idx) => {
            const isSelected = idx === selectedIndex;
            const timeStr = new Date(cp.timestamp).toLocaleTimeString();
            const filesCount = cp.code?.files?.length ?? 0;

            return (
              <Box key={cp.id} gap={1}>
                <ColoredText color={isSelected ? 'green' : undefined}>
                  {isSelected ? '►' : ' '}
                </ColoredText>
                <ColoredText bold={isSelected} color={isSelected ? 'cyan' : undefined}>
                  [{cp.id.slice(0, 8)}]
                </ColoredText>
                <Text bold={isSelected}>{cp.description || 'Checkpoint'}</Text>
                <Text dimColor>
                  ({filesCount} files, {timeStr})
                </Text>
                {cp.branch !== 'main' ? (
                  <ColoredText color="yellow">⎇ {cp.branch}</ColoredText>
                ) : null}
              </Box>
            );
          })}
        </Box>
      )}

      {/* Help footer */}
      <BorderBox marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text dimColor>
          [↑/↓] Select checkpoint • [1/2/3] Toggle scope • [Enter] Rewind • [B] Create branch
        </Text>
      </BorderBox>
    </BorderBox>
  );
};
