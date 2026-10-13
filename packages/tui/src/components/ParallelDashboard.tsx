import React from 'react';
import { Box, Text, useInput } from 'ink';
import { ParallelDashboardData, ParallelAgentDisplayState } from '../types.js';

export interface ParallelDashboardProps {
  readonly data: ParallelDashboardData;
  readonly onOpenReviewerReport?: (() => void) | undefined;
  readonly onClose?: (() => void) | undefined;
}

export const ParallelDashboard: React.FC<ParallelDashboardProps> = ({
  data,
  onOpenReviewerReport,
  onClose,
}) => {
  useInput((input, key) => {
    if ((input === 'r' || input === 'R') && onOpenReviewerReport) {
      onOpenReviewerReport();
    } else if (key.escape && onClose) {
      onClose();
    }
  });

  const formatTime = (ms: number): string => {
    const sec = Math.floor(ms / 1000);
    return `${sec}s`;
  };

  const getStatusColor = (status: ParallelAgentDisplayState['status']): string => {
    switch (status) {
      case 'completed':
        return 'green';
      case 'running':
        return 'yellow';
      case 'budget_exhausted':
        return 'magenta';
      case 'failed':
      case 'crashed':
        return 'red';
      default:
        return 'gray';
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={1}
      width="100%"
    >
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text bold color="cyan">
            PARALLEL AGENTS DASHBOARD{' '}
          </Text>
          <Text color="gray">[{data.mode.toUpperCase()} MODE]</Text>
        </Box>
        <Box>
          <Text color="gray">
            Concurrency: {data.maxConcurrency} | Cap: ${data.totalCostCapUsd.toFixed(2)}
          </Text>
        </Box>
      </Box>

      {/* Cost Warning Banner */}
      <Box marginBottom={1}>
        <Text backgroundColor="yellow" color="black" bold>
          {' '}
          {data.costWarning}{' '}
        </Text>
      </Box>

      {/* Summary Stats */}
      <Box marginBottom={1} justifyContent="space-between">
        <Text>
          Total Cost:{' '}
          <Text bold color={data.totalCostUsd > data.totalCostCapUsd ? 'red' : 'green'}>
            ${data.totalCostUsd.toFixed(3)}
          </Text>{' '}
          / ${data.totalCostCapUsd.toFixed(2)}
        </Text>
        <Text>
          Active / Total Agents:{' '}
          <Text bold color="cyan">
            {data.agents.length}
          </Text>
        </Text>
      </Box>

      {/* Agent Table Header */}
      <Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={0}>
        <Box width="20%">
          <Text bold color="white">
            Agent
          </Text>
        </Box>
        <Box width="18%">
          <Text bold color="white">
            Model / Strat
          </Text>
        </Box>
        <Box width="16%">
          <Text bold color="white">
            Status
          </Text>
        </Box>
        <Box width="16%">
          <Text bold color="white">
            Cost / Budget
          </Text>
        </Box>
        <Box width="14%">
          <Text bold color="white">
            Tests
          </Text>
        </Box>
        <Box width="16%">
          <Text bold color="white">
            Elapsed
          </Text>
        </Box>
      </Box>

      {/* Agent Rows */}
      {data.agents.map((agent) => (
        <Box key={agent.agentId} paddingX={1} marginY={0}>
          <Box width="20%">
            <Text bold color="cyan">
              {agent.name || agent.agentId}
            </Text>
          </Box>
          <Box width="18%">
            <Text color="gray">{agent.strategy || agent.model}</Text>
          </Box>
          <Box width="16%">
            <Text color={getStatusColor(agent.status)} bold>
              {agent.status.toUpperCase()}
            </Text>
          </Box>
          <Box width="16%">
            <Text color={agent.costUsd >= agent.budgetUsd ? 'magenta' : 'white'}>
              ${agent.costUsd.toFixed(3)} / ${agent.budgetUsd.toFixed(2)}
            </Text>
          </Box>
          <Box width="14%">
            <Text
              color={
                agent.testStatus === 'passed'
                  ? 'green'
                  : agent.testStatus === 'failed'
                    ? 'red'
                    : 'yellow'
              }
            >
              {agent.testStatus === 'passed'
                ? '✓ PASS'
                : agent.testStatus === 'failed'
                  ? '✗ FAIL'
                  : 'PENDING'}
            </Text>
          </Box>
          <Box width="16%">
            <Text color="gray">{formatTime(agent.elapsedMs)}</Text>
          </Box>
        </Box>
      ))}

      {/* Reviewer Report Highlights (if available) */}
      {data.reviewerSummary && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="blue"
          marginTop={1}
          paddingX={1}
        >
          <Text bold color="blue">
            Reviewer Agent Evaluation:
          </Text>
          <Text>{data.reviewerSummary}</Text>
          {data.winnerId && (
            <Text color="green" bold>
              Top Candidate: Agent '{data.winnerId}'
            </Text>
          )}
        </Box>
      )}

      {/* Footer Navigation Hints */}
      <Box marginTop={1} justifyContent="space-between">
        <Text color="gray">[R] View Full Reviewer Report & Diff | [Esc] Close Dashboard</Text>
      </Box>
    </Box>
  );
};
