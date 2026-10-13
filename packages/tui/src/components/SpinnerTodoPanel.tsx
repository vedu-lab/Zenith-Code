import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';
import { TuiTodo } from '../types.js';

export interface SpinnerTodoPanelProps {
  readonly isRunning: boolean;
  readonly elapsedSeconds?: number | undefined;
  readonly tokenCount?: number | undefined;
  readonly todos: readonly TuiTodo[];
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const STATUS_VERBS = [
  'Thinking...',
  'Analyzing context...',
  'Formulating plan...',
  'Executing tools...',
  'Reading files...',
  'Synthesizing changes...',
];

export const SpinnerTodoPanel: React.FC<SpinnerTodoPanelProps> = ({
  isRunning,
  elapsedSeconds: initialElapsed = 0,
  tokenCount = 0,
  todos,
}) => {
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [verbIndex, setVerbIndex] = useState<number>(0);
  const [elapsed, setElapsed] = useState<number>(initialElapsed);

  useEffect(() => {
    if (!isRunning) return;

    const spinnerTimer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    const elapsedTimer = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);

    const verbTimer = setInterval(() => {
      setVerbIndex((prev) => (prev + 1) % STATUS_VERBS.length);
    }, 2500);

    return () => {
      clearInterval(spinnerTimer);
      clearInterval(elapsedTimer);
      clearInterval(verbTimer);
    };
  }, [isRunning]);

  const currentVerb = STATUS_VERBS[verbIndex] ?? 'Thinking...';
  const spinnerChar = isRunning ? (SPINNER_FRAMES[frameIndex] ?? '⠋') : '✔';

  return (
    <Box flexDirection="column" marginY={1}>
      {isRunning ? (
        <Box gap={2} marginBottom={todos.length > 0 ? 1 : 0}>
          <ColoredText bold color="cyan">
            {spinnerChar} {currentVerb}
          </ColoredText>
          <Text dimColor>({elapsed}s)</Text>
          {tokenCount > 0 ? <Text dimColor>• {tokenCount.toLocaleString()} tokens</Text> : null}
        </Box>
      ) : null}

      {todos.length > 0 ? (
        <BorderBox flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
          <Text bold dimColor>
            TASKS:
          </Text>
          {todos.map((todo) => {
            if (todo.status === 'completed') {
              return (
                <Box key={todo.id} gap={1}>
                  <ColoredText bold color="green">
                    ✓
                  </ColoredText>
                  <Text dimColor strikethrough>
                    {todo.content}
                  </Text>
                </Box>
              );
            }

            if (todo.status === 'in_progress') {
              return (
                <Box key={todo.id} gap={1}>
                  <ColoredText bold color="yellow">
                    ▶
                  </ColoredText>
                  <ColoredText bold color="yellow">
                    {todo.content}
                  </ColoredText>
                </Box>
              );
            }

            return (
              <Box key={todo.id} gap={1}>
                <Text dimColor>○</Text>
                <Text>{todo.content}</Text>
              </Box>
            );
          })}
        </BorderBox>
      ) : null}
    </Box>
  );
};
