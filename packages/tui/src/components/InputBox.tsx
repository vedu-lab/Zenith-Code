import React, { useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';

export interface InputBoxProps {
  readonly onSubmit: (value: string) => void;
  readonly onInterrupt?: (() => void) | undefined;
  readonly onOpenRewindPicker?: (() => void) | undefined;
  readonly fileCandidates?: readonly string[] | undefined;
  readonly slashCommands?: readonly string[] | undefined;
  readonly disabled?: boolean | undefined;
}

const DEFAULT_COMMANDS = [
  '/help',
  '/clear',
  '/compact',
  '/model',
  '/cost',
  '/permissions',
  '/sandbox',
  '/memory',
  '/checkpoints',
  '/rewind',
  '/branch',
  '/resume',
  '/handoff',
  '/doctor',
  '/exit',
];

export const InputBox: React.FC<InputBoxProps> = ({
  onSubmit,
  onInterrupt,
  onOpenRewindPicker,
  fileCandidates = [],
  slashCommands = DEFAULT_COMMANDS,
  disabled = false,
}) => {
  const [value, setValue] = useState<string>('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);
  const [savedDraft, setSavedDraft] = useState<string>('');

  const lastEscTimeRef = useRef<number>(0);

  let ghostText = '';
  if (value.startsWith('/') && !value.includes(' ')) {
    const matchedCmd = slashCommands.find((c) => c.startsWith(value) && c !== value);
    if (matchedCmd) {
      ghostText = matchedCmd.slice(value.length);
    }
  }

  const atMatch = /@([a-zA-Z0-9_./-]*)$/.exec(value);
  const atPrefix = atMatch ? (atMatch[1] ?? '') : null;
  const filteredFiles =
    atPrefix !== null
      ? fileCandidates.filter((f) => f.toLowerCase().includes(atPrefix.toLowerCase())).slice(0, 5)
      : [];

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.escape) {
        const now = Date.now();
        if (now - lastEscTimeRef.current < 450) {
          lastEscTimeRef.current = 0;
          onOpenRewindPicker?.();
          return;
        }
        lastEscTimeRef.current = now;
        onInterrupt?.();
        return;
      }

      if (key.tab) {
        if (filteredFiles.length > 0 && atPrefix !== null) {
          const firstFile = filteredFiles[0];
          if (firstFile) {
            const newValue = value.slice(0, value.length - atPrefix.length) + firstFile + ' ';
            setValue(newValue);
            return;
          }
        }
        if (ghostText) {
          setValue((prev) => prev + ghostText + ' ');
          return;
        }
        return;
      }

      if (key.return) {
        if (key.shift || key.ctrl) {
          setValue((prev) => prev + '\n');
          return;
        }

        const trimmed = value.trim();
        if (trimmed.length > 0) {
          setHistory((prev) => [...prev, trimmed]);
          setHistoryIdx(-1);
          setSavedDraft('');
          setValue('');
          onSubmit(trimmed);
        }
        return;
      }

      if (key.upArrow && !value.includes('\n')) {
        if (history.length > 0) {
          if (historyIdx === -1) {
            setSavedDraft(value);
            const newIdx = history.length - 1;
            setHistoryIdx(newIdx);
            setValue(history[newIdx] ?? '');
          } else if (historyIdx > 0) {
            const newIdx = historyIdx - 1;
            setHistoryIdx(newIdx);
            setValue(history[newIdx] ?? '');
          }
        }
        return;
      }

      if (key.downArrow && !value.includes('\n')) {
        if (historyIdx !== -1) {
          if (historyIdx < history.length - 1) {
            const newIdx = historyIdx + 1;
            setHistoryIdx(newIdx);
            setValue(history[newIdx] ?? '');
          } else {
            setHistoryIdx(-1);
            setValue(savedDraft);
          }
        }
        return;
      }

      if (key.backspace || key.delete) {
        setValue((prev) => prev.slice(0, -1));
        return;
      }

      if (input && !key.ctrl && !key.meta) {
        setValue((prev) => prev + input);
      }
    },
    { isActive: !disabled },
  );

  return (
    <Box flexDirection="column" marginY={1}>
      {filteredFiles.length > 0 && atPrefix !== null ? (
        <BorderBox
          flexDirection="column"
          borderStyle="single"
          borderColor="cyan"
          paddingX={1}
          marginBottom={0}
        >
          <Text dimColor>Files (press Tab to complete):</Text>
          {filteredFiles.map((file, idx) => (
            <ColoredText key={file} color={idx === 0 ? 'green' : undefined}>
              {idx === 0 ? '► ' : '  '}@{file}
            </ColoredText>
          ))}
        </BorderBox>
      ) : null}

      <BorderBox borderStyle="round" borderColor={disabled ? 'gray' : 'cyan'} paddingX={1}>
        <ColoredText bold color="green">
          ❯{' '}
        </ColoredText>
        <Text>{value}</Text>
        {ghostText ? (
          <ColoredText dimColor color="gray">
            {ghostText}
          </ColoredText>
        ) : null}
        {!disabled ? <ColoredText color="cyan">▌</ColoredText> : null}
      </BorderBox>
    </Box>
  );
};
