import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ColoredText, BorderBox } from '../theme.js';
import { PlanPreviewData } from '../types.js';

export interface PlanPreviewProps {
  readonly plan: PlanPreviewData;
  readonly onApprove: () => void;
  readonly onEdit?: (() => void) | undefined;
  readonly onChangeModel?: ((newModel: string) => void) | undefined;
  readonly onSetBudgets?: ((budgets: { maxCost?: number; maxTurns?: number }) => void) | undefined;
  readonly onCancel: () => void;
}

export const PlanPreview: React.FC<PlanPreviewProps> = ({
  plan,
  onApprove,
  onEdit,
  onChangeModel,
  onSetBudgets,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const actions = [
    { label: '[1] Approve & Run', key: '1', fn: () => onApprove() },
    { label: '[2] Edit Plan', key: '2', fn: () => onEdit?.() },
    { label: '[3] Change Model', key: '3', fn: () => onChangeModel?.('claude-3-5-sonnet') },
    {
      label: '[4] Set Budgets',
      key: '4',
      fn: () => onSetBudgets?.({ maxCost: 1.0, maxTurns: 20 }),
    },
    { label: '[Esc] Close', key: 'esc', fn: () => onCancel() },
  ];

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (input === '1') actions[0]?.fn();
    else if (input === '2') actions[1]?.fn();
    else if (input === '3') actions[2]?.fn();
    else if (input === '4') actions[3]?.fn();
    else if (key.leftArrow || key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : actions.length - 1));
    } else if (key.rightArrow || key.downArrow) {
      setSelectedIndex((prev) => (prev < actions.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      actions[selectedIndex]?.fn();
    }
  });

  return (
    <BorderBox
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginY={1}
    >
      <Box marginBottom={1}>
        <ColoredText bold color="cyan">
          📋 PLAN PREVIEW & ESTIMATION
        </ColoredText>
      </Box>

      {/* Steps */}
      <Box flexDirection="column" marginY={0}>
        <Text bold dimColor>
          Steps ({plan.steps.length}):
        </Text>
        {plan.steps.map((step, idx) => (
          <Box key={idx} paddingLeft={1}>
            <ColoredText color="yellow">{idx + 1}. </ColoredText>
            <Text>{step}</Text>
          </Box>
        ))}
      </Box>

      {/* Target Files */}
      {plan.files.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            Files to touch:
          </Text>
          <Box paddingLeft={1}>
            <Text>{plan.files.join(', ')}</Text>
          </Box>
        </Box>
      )}

      {/* Shell commands */}
      {plan.commands.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold dimColor>
            Commands to run:
          </Text>
          {plan.commands.map((cmd, idx) => (
            <Box key={idx} paddingLeft={1}>
              <ColoredText color="green">$ </ColoredText>
              <Text>{cmd}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Risks */}
      {plan.risks.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <ColoredText bold color="red">
            Identified Risks:
          </ColoredText>
          {plan.risks.map((risk, idx) => (
            <Box key={idx} paddingLeft={1}>
              <ColoredText color="red">⚠ </ColoredText>
              <Text>{risk}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Estimates & Budgets */}
      <BorderBox
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginTop={1}
        justifyContent="space-between"
      >
        <Text>
          <Text dimColor>Est. Cost: </Text>
          <ColoredText color="green">
            ${plan.costEstimate.low.toFixed(3)} - ${plan.costEstimate.high.toFixed(3)}
          </ColoredText>
          <Text dimColor> (exp: ${plan.costEstimate.expected.toFixed(3)})</Text>
        </Text>
        <Text>
          <Text dimColor>Est. Time: </Text>
          <ColoredText color="yellow">
            {plan.timeEstimateSeconds.min}s - {plan.timeEstimateSeconds.max}s
          </ColoredText>
        </Text>
        <Text>
          <Text dimColor>Model: </Text>
          <ColoredText bold color="cyan">
            {plan.model}
          </ColoredText>
        </Text>
      </BorderBox>

      {/* Actions */}
      <Box gap={2} marginTop={1}>
        {actions.map((act, idx) => {
          const isSelected = idx === selectedIndex;
          return (
            <Box key={act.label}>
              <ColoredText bold={isSelected} color={isSelected ? 'green' : 'gray'}>
                {isSelected ? '► ' : '  '}
                {act.label}
              </ColoredText>
            </Box>
          );
        })}
      </Box>
    </BorderBox>
  );
};
