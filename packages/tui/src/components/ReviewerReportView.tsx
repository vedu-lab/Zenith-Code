import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { DiffViewer } from './DiffViewer.js';

export interface CandidateDisplaySummary {
  readonly agentId: string;
  readonly rank: number;
  readonly score: number;
  readonly testPassed: boolean;
}

export interface ReviewerReportViewProps {
  readonly summary: string;
  readonly winnerId?: string | undefined;
  readonly recommendedStrategy: string;
  readonly diff?: string | undefined;
  readonly candidates?: readonly CandidateDisplaySummary[] | undefined;
  readonly onApprove: () => void;
  readonly onReject: () => void;
  readonly onPickCandidate?: ((candidateId: string) => void) | undefined;
  readonly onBack?: (() => void) | undefined;
}

export const ReviewerReportView: React.FC<ReviewerReportViewProps> = ({
  summary,
  winnerId,
  recommendedStrategy,
  diff = '',
  candidates = [],
  onApprove,
  onReject,
  onPickCandidate: _onPickCandidate,
  onBack,
}) => {
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);
  const actions = ['Approve & Merge to Working Tree', 'Reject (Leave Working Tree Clean)'];

  useInput((_input, key) => {
    if (key.leftArrow || key.upArrow) {
      setSelectedActionIndex((prev) => Math.max(0, prev - 1));
    } else if (key.rightArrow || key.downArrow) {
      setSelectedActionIndex((prev) => Math.min(actions.length - 1, prev + 1));
    } else if (key.return) {
      if (selectedActionIndex === 0) {
        onApprove();
      } else {
        onReject();
      }
    } else if (key.escape && onBack) {
      onBack();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="green"
      paddingX={1}
      paddingY={1}
      width="100%"
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="green">
          REVIEWER AGENT EVALUATION & RECONCILIATION
        </Text>
        <Text color="gray">Strategy: {recommendedStrategy.toUpperCase()}</Text>
      </Box>

      {winnerId && (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            Top Ranked Winner: Agent '{winnerId}'
          </Text>
        </Box>
      )}

      {/* Reviewer Reasoning & Ranked Candidates */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color="cyan">
          Evaluation Summary:
        </Text>
        <Text>{summary}</Text>

        {candidates.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color="white">
              Candidate Rankings:
            </Text>
            {candidates.map((c) => (
              <Box key={c.agentId} justifyContent="space-between">
                <Text>
                  Rank {c.rank}: Agent '{c.agentId}' (Score: {c.score}/100)
                </Text>
                <Text color={c.testPassed ? 'green' : 'red'}>
                  {c.testPassed ? '✓ Tests Passed' : '✗ Tests Failed'}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* Diff Preview */}
      {diff ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="yellow">
            Proposed Diff for Final Merge:
          </Text>
          <DiffViewer diffText={diff} />
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text color="gray">No code changes to display in diff preview.</Text>
        </Box>
      )}

      {/* User Approval Decision Gate */}
      <Box
        flexDirection="column"
        borderStyle="double"
        borderColor="yellow"
        paddingX={1}
        paddingY={1}
      >
        <Text bold color="yellow">
          USER APPROVAL REQUIRED BEFORE MERGING TO WORKING TREE:
        </Text>
        <Box marginBottom={1}>
          <Text color="gray">
            Your active working tree will remain completely clean unless explicitly approved.
          </Text>
        </Box>

        <Box>
          {actions.map((act, index) => {
            const isSelected = index === selectedActionIndex;
            return (
              <Box key={act} marginRight={2} paddingX={1}>
                {isSelected ? (
                  <Text bold backgroundColor={index === 0 ? 'green' : 'red'} color="black">
                    {`▶ [${act}]`}
                  </Text>
                ) : (
                  <Text bold color={index === 0 ? 'green' : 'red'}>
                    {`  [${act}]`}
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">[Left/Right] Select Action | [Enter] Confirm | [Esc] Back</Text>
      </Box>
    </Box>
  );
};
