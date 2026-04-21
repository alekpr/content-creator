import type { Server as HttpServer } from 'http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { env } from '../config/env.js';
import type {
  StageStatusEvent,
  StageProgressEvent,
  StageResultEvent,
  StageErrorEvent,
  ProjectCompleteEvent,
  CostUpdateEvent,
} from '@content-creator/shared';

let io: SocketServer | null = null;

export function initSocketIO(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      credentials: true,
    },
  });

  io.on('connection', (socket: Socket) => {
    socket.on('project:join', ({ projectId }: { projectId: string }) => {
      void socket.join(`project:${projectId}`);
    });

    socket.on('project:leave', ({ projectId }: { projectId: string }) => {
      void socket.leave(`project:${projectId}`);
    });
  });

  console.log('[Socket] Socket.io initialized');
  return io;
}

export function getIO(): SocketServer {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

// ─── Emitters ─────────────────────────────────────────────────────────────────

export function emitStageStatus(event: StageStatusEvent): void {
  getIO().to(`project:${event.projectId}`).emit('stage:status', event);
}

export function emitStageProgress(event: StageProgressEvent): void {
  getIO().to(`project:${event.projectId}`).emit('stage:progress', event);
}

export function emitStageResult(event: StageResultEvent): void {
  getIO().to(`project:${event.projectId}`).emit('stage:result', event);
}

export function emitStageError(event: StageErrorEvent): void {
  getIO().to(`project:${event.projectId}`).emit('stage:error', event);
}

export function emitProjectComplete(event: ProjectCompleteEvent): void {
  getIO().to(`project:${event.projectId}`).emit('project:complete', event);
}

export function emitCostUpdate(event: CostUpdateEvent): void {
  getIO().to(`project:${event.projectId}`).emit('project:cost', event);
}
