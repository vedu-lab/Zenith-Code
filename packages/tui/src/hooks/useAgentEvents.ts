import { useState, useEffect, useRef } from 'react';
import { IEventBus, ForgeEvent } from '@forge/core';
import {
  TuiMessage,
  TuiToolCall,
  TuiTodo,
  PermissionRequest,
  CapabilityPromptRequest,
} from '../types.js';

export interface UseAgentEventsProps {
  readonly eventBus: IEventBus;
  readonly onPermissionRequested?: ((request: PermissionRequest) => void) | undefined;
  readonly onCapabilityRequested?: ((request: CapabilityPromptRequest) => void) | undefined;
}

export interface AgentEventsState {
  readonly messages: readonly TuiMessage[];
  readonly streamingText: string;
  readonly toolCalls: readonly TuiToolCall[];
  readonly todos: readonly TuiTodo[];
  readonly status: 'idle' | 'running' | 'waiting_approval' | 'error';
  readonly liveCost: number;
  readonly tokenCount: number;
  readonly contextUsagePercent: number;
  readonly activeCapabilitiesCount: number;
  readonly currentTurnIndex: number;
  readonly addMessage: (message: TuiMessage) => void;
  readonly clearMessages: () => void;
  readonly setTodos: (todos: readonly TuiTodo[]) => void;
  readonly setStatus: (status: 'idle' | 'running' | 'waiting_approval' | 'error') => void;
  readonly setActiveCapabilitiesCount: (count: number) => void;
}

export function useAgentEvents({
  eventBus,
  onPermissionRequested: _onPermissionRequested,
  onCapabilityRequested: _onCapabilityRequested,
}: UseAgentEventsProps): AgentEventsState {
  const [messages, setMessages] = useState<readonly TuiMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string>('');
  const [toolCalls, setToolCalls] = useState<readonly TuiToolCall[]>([]);
  const [todos, setTodos] = useState<readonly TuiTodo[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'waiting_approval' | 'error'>('idle');
  const [liveCost, setLiveCost] = useState<number>(0);
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [contextUsagePercent, setContextUsagePercent] = useState<number>(0);
  const [activeCapabilitiesCount, setActiveCapabilitiesCount] = useState<number>(0);
  const [currentTurnIndex, setCurrentTurnIndex] = useState<number>(0);

  const streamingRef = useRef<string>('');
  streamingRef.current = streamingText;

  useEffect(() => {
    const unsubscribe = eventBus.subscribeAll((event: ForgeEvent) => {
      switch (event.type) {
        case 'turn.started': {
          setStatus('running');
          setCurrentTurnIndex(event.payload.turnIndex);
          setStreamingText('');
          streamingRef.current = '';
          break;
        }

        case 'model.delta': {
          const delta = event.payload.delta;
          setStreamingText((prev) => prev + delta);
          break;
        }

        case 'turn.completed': {
          setStatus('idle');
          const currentText = streamingRef.current;
          if (currentText.trim().length > 0) {
            setMessages((prev) => [
              ...prev,
              {
                id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                role: 'assistant',
                content: currentText,
                timestamp: Date.now(),
              },
            ]);
            setStreamingText('');
            streamingRef.current = '';
          }
          break;
        }

        case 'tool.requested': {
          setStatus('running');
          const { callId, toolName, parameters } = event.payload;
          setToolCalls((prev) => {
            const existing = prev.findIndex((tc) => tc.callId === callId);
            const item: TuiToolCall = {
              callId,
              toolName,
              parameters,
              status: 'running',
            };
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = item;
              return updated;
            }
            return [...prev, item];
          });
          break;
        }

        case 'tool.executed': {
          const { callId, toolName, success, durationMs, output, error } = event.payload;
          setToolCalls((prev) =>
            prev.map((tc) =>
              tc.callId === callId
                ? {
                    ...tc,
                    status: success ? 'success' : 'failure',
                    durationMs,
                    output,
                    error,
                  }
                : tc,
            ),
          );

          // If tool was todo_write, automatically parse updated todos from parameters or output
          if (toolName === 'todo_write') {
            const rawTodos =
              (output as { todos?: unknown })?.todos ?? (output as readonly unknown[]) ?? [];
            if (Array.isArray(rawTodos)) {
              const parsedTodos: TuiTodo[] = rawTodos.map((t, idx) => {
                if (typeof t === 'string') {
                  return { id: `todo-${idx}`, content: t, status: 'pending' };
                }
                const obj = t as Record<string, unknown>;
                return {
                  id: String(obj['id'] ?? `todo-${idx}`),
                  content: String(obj['content'] ?? obj['title'] ?? obj['task'] ?? ''),
                  status:
                    obj['status'] === 'completed' || obj['status'] === 'in_progress'
                      ? obj['status']
                      : 'pending',
                };
              });
              setTodos(parsedTodos);
            }
          }
          break;
        }

        case 'usage.updated': {
          setLiveCost(event.payload.costUsd);
          setTokenCount(event.payload.totalTokens);
          const pct = Math.min(100, Math.round((event.payload.totalTokens / 128_000) * 100));
          setContextUsagePercent(pct);
          break;
        }

        case 'error': {
          setStatus('error');
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: 'error',
              content: `[${event.payload.code}] ${event.payload.message}${
                event.payload.remediation ? ` (Remediation: ${event.payload.remediation})` : ''
              }`,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case 'session:closed': {
          setStatus('idle');
          break;
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [eventBus]);

  const addMessage = (message: TuiMessage): void => {
    setMessages((prev) => [...prev, message]);
  };

  const clearMessages = (): void => {
    setMessages([]);
    setStreamingText('');
    setToolCalls([]);
  };

  return {
    messages,
    streamingText,
    toolCalls,
    todos,
    status,
    liveCost,
    tokenCount,
    contextUsagePercent,
    activeCapabilitiesCount,
    currentTurnIndex,
    addMessage,
    clearMessages,
    setTodos,
    setStatus,
    setActiveCapabilitiesCount,
  };
}
