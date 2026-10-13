import React from 'react';
import { Box, Text } from 'ink';

export interface StatusBadgeProps {
  readonly status: 'idle' | 'running' | 'waiting_approval' | 'error';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status }) => {
  switch (status) {
    case 'running':
      return (
        <Box>
          <Text color="green">● RUNNING</Text>
        </Box>
      );
    case 'waiting_approval':
      return (
        <Box>
          <Text color="yellow">▲ WAITING APPROVAL</Text>
        </Box>
      );
    case 'error':
      return (
        <Box>
          <Text color="red">✖ ERROR</Text>
        </Box>
      );
    case 'idle':
    default:
      return (
        <Box>
          <Text dimColor>○ IDLE</Text>
        </Box>
      );
  }
};
