import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useProjectStore } from '../store/projectStore.ts';
import type { StageStatusEvent, StageProgressEvent, StageResultEvent, StageErrorEvent, ProjectCompleteEvent, CostUpdateEvent } from '@content-creator/shared';

const SOCKET_URL = import.meta.env.VITE_API_URL ?? '';

export function useSocket(projectId: string | undefined, onRefresh?: () => void) {
  const socketRef = useRef<Socket | null>(null);
  const { updateStageStatus, updateCost, setConnected } = useProjectStore();
  const reconnectAttemptsRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const connect = useCallback(() => {
    if (!projectId) return;

    socketRef.current = io(SOCKET_URL, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      reconnectAttemptsRef.current = 0;
      setConnected(true);
      socket.emit('project:join', { projectId });
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', () => {
      reconnectAttemptsRef.current += 1;
      setConnected(false);
    });

    socket.on('stage:status', (event: StageStatusEvent) => {
      if (event.projectId !== projectId) return;
      updateStageStatus(event.stageKey, event.status);
    });

    socket.on('stage:error', (event: StageErrorEvent) => {
      if (event.projectId !== projectId) return;
      updateStageStatus(event.stageKey, 'failed', event.error);
    });

    socket.on('project:cost', (event: CostUpdateEvent) => {
      if (event.projectId !== projectId) return;
      updateCost(event.totalCostUSD, event.breakdown);
    });

    // These events trigger a full project re-fetch via callback
    socket.on('stage:result', (event: StageResultEvent) => {
      if (event.projectId !== projectId) return;
      onRefreshRef.current?.();
    });
    socket.on('stage:progress', (_event: StageProgressEvent) => {});
    socket.on('project:complete', (event: ProjectCompleteEvent) => {
      if (event.projectId !== projectId) return;
      onRefreshRef.current?.();
    });
  }, [projectId, updateStageStatus, updateCost, setConnected]);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.emit('project:leave', { projectId });
      socketRef.current?.disconnect();
    };
  }, [connect, projectId]);

  return socketRef.current;
}
