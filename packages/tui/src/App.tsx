import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { IEventBus, ForgeEvent } from '@forge/core';
import { Header } from './components/Header.js';
import { StatusBadge } from './components/StatusBadge.js';

export interface AppProps {
  readonly version: string;
  readonly model: string;
  readonly eventBus: IEventBus;
}

export const App: React.FC<AppProps> = ({ version, model, eventBus }) => {
  const [events, setEvents] = useState<readonly ForgeEvent[]>([]);
  const [currentStatus, setCurrentStatus] = useState<
    'idle' | 'running' | 'waiting_approval' | 'error'
  >('idle');

  useEffect(() => {
    const unsubscribe = eventBus.subscribeAll((event) => {
      setEvents((prev) => [...prev.slice(-9), event]);

      if (event.type === 'turn.started') {
        setCurrentStatus('running');
      } else if (event.type === 'tool.requested') {
        setCurrentStatus('waiting_approval');
      } else if (event.type === 'tool.executed') {
        setCurrentStatus('running');
      } else if (event.type === 'session:closed' || event.type === 'turn.completed') {
        setCurrentStatus('idle');
      }
    });

    return () => {
      unsubscribe();
    };
  }, [eventBus]);

  return (
    <Box flexDirection="column" padding={1}>
      <Header version={version} model={model} />
      <Box marginY={1}>
        <StatusBadge status={currentStatus} />
      </Box>

      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        <Text bold underline>
          Activity Stream:
        </Text>
        {events.length === 0 ? (
          <Text dimColor>No events yet. Ready for instructions.</Text>
        ) : (
          events.map((evt) => (
            <Box key={evt.id}>
              <Text dimColor>[{new Date(evt.timestamp).toLocaleTimeString()}] </Text>
              <Text color="cyan">{evt.type}</Text>
              <Text> (by {evt.actor})</Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};
