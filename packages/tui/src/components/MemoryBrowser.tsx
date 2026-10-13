import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';
import { MemoryEntry } from '@forge/state';

export interface MemoryBrowserProps {
  readonly memories: readonly MemoryEntry[];
  readonly onDelete?: ((id: string) => void) | undefined;
  readonly onTogglePin?: ((id: string) => void) | undefined;
  readonly onClose: () => void;
}

export const MemoryBrowser: React.FC<MemoryBrowserProps> = ({
  memories,
  onDelete,
  onTogglePin,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [filterQuery, _setFilterQuery] = useState<string>('');
  const [showStaleOnly, setShowStaleOnly] = useState<boolean>(false);

  const filtered = memories.filter((m) => {
    if (showStaleOnly && m.status !== 'stale') return false;
    if (filterQuery.trim().length > 0) {
      return (
        m.statement.toLowerCase().includes(filterQuery.toLowerCase()) ||
        m.source.toLowerCase().includes(filterQuery.toLowerCase())
      );
    }
    return true;
  });

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
      return;
    }

    if (input === 's' || input === 'S') {
      setShowStaleOnly((prev) => !prev);
      return;
    }

    if (input === 'p' || input === 'P') {
      const selected = filtered[selectedIndex];
      if (selected && onTogglePin) {
        onTogglePin(selected.id);
      }
      return;
    }

    if (key.delete || input === 'd' || input === 'D') {
      const selected = filtered[selectedIndex];
      if (selected && onDelete) {
        onDelete(selected.id);
      }
      return;
    }
  });

  const selectedItem = filtered[selectedIndex];

  return (
    <BorderBox
      flexDirection="column"
      borderStyle="double"
      borderColor="magenta"
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <ColoredText bold color="magenta">
          🧠 PROJECT MEMORY BROWSER ({filtered.length}/{memories.length})
        </ColoredText>
        <Text dimColor>[Esc] Close</Text>
      </Box>

      {/* Filter status */}
      <Box gap={2} marginBottom={1}>
        <Text dimColor>Filter: </Text>
        <Text>
          [S] Stale Only:{' '}
          <ColoredText bold color={showStaleOnly ? 'yellow' : undefined}>
            {showStaleOnly ? 'ON' : 'OFF'}
          </ColoredText>
        </Text>
      </Box>

      {/* List */}
      {filtered.length === 0 ? (
        <Box marginY={1}>
          <Text dimColor>No memories match filter.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {filtered.map((item, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <Box key={item.id} gap={1}>
                <ColoredText color={isSelected ? 'green' : undefined}>
                  {isSelected ? '►' : ' '}
                </ColoredText>
                {item.status === 'stale' ? (
                  <ColoredText bold color="red">
                    [STALE]
                  </ColoredText>
                ) : (
                  <ColoredText bold color="green">
                    [ACTIVE]
                  </ColoredText>
                )}
                <Text dimColor>[{item.source}]</Text>
                <Text bold={isSelected}>{item.statement}</Text>
                <Text dimColor>({Math.round(item.confidence * 100)}%)</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Detailed view of selected item */}
      {selectedItem ? (
        <BorderBox
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginTop={1}
        >
          <Text dimColor>ID: {selectedItem.id}</Text>
          <Text>Statement: {selectedItem.statement}</Text>
          {selectedItem.evidence ? <Text dimColor>Evidence: {selectedItem.evidence}</Text> : null}
          <Text dimColor>
            Scope: {selectedItem.scope} | Confidence: {selectedItem.confidence} | Created:{' '}
            {new Date(selectedItem.createdAt).toLocaleString()}
          </Text>
        </BorderBox>
      ) : null}

      {/* Key hints */}
      <Box marginTop={1}>
        <Text dimColor>
          [↑/↓] Navigate • [P] Pin/Unpin • [D/Del] Delete memory • [S] Toggle stale filter
        </Text>
      </Box>
    </BorderBox>
  );
};
