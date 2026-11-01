/**
 * 文件职责：storage 读 API（/api/storage）的单测 —— 验「只读门面」这一层：
 *   路由形状、分页参数收紧、坏输入的拒绝，以及**端口未附着时如实报 503**（不假装正常）。
 * 输入：真起一个 express 实例（随机端口）+ 一个假读口（只记调用参数，不碰数据库）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不打桩 HTTP 层 —— 这里要验的就是「请求进得来、响应出得去」；
 *   2. 不用真数据库 —— 数据库归 storage 单测（那里验真落库）；这里验路由层，别把两层搅在一起。
 */

import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import type { PersistedChatMessage } from '../../../../app/services/persistence/chat-history-dao';
import { createStorageRoutes, type StorageReadPort } from '../storage';

interface CallLog {
  readonly readTaskOutput: string[];
  readonly loadChatMessages: Array<{ characterId: string; limit: number | undefined }>;
  readonly loadEarlierChatMessages: Array<{ characterId: string; beforeId: number; limit: number | undefined }>;
}

/** 造一个假读口：记调用参数 + 返回预置的读数。 */
function fakePort(output: string | null, messages: PersistedChatMessage[]): { port: StorageReadPort; calls: CallLog } {
  const calls: CallLog = { readTaskOutput: [], loadChatMessages: [], loadEarlierChatMessages: [] };
  return {
    calls,
    port: {
      readTaskOutput: (taskId) => {
        calls.readTaskOutput.push(taskId);
        return output;
      },
      loadChatMessages: (characterId, limit) => {
        calls.loadChatMessages.push({ characterId, limit });
        return messages;
      },
      loadEarlierChatMessages: (characterId, beforeId, limit) => {
        calls.loadEarlierChatMessages.push({ characterId, beforeId, limit });
        return messages;
      },
    },
  };
}

describe('storage 读 API', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    // 先挂一个「端口未附着」的实例（503 口径），用例里各自替换。
    app.use('/api/storage', createStorageRoutes(null));
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/api/storage`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** 起一个只挂指定读口的 express（随机端口），返回它的基址。 */
  async function serveWith(port: StorageReadPort): Promise<{ baseUrl: string; close: () => Promise<void> }> {
    const app = express();
    app.use('/api/storage', createStorageRoutes(port));
    const listener = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const address = listener.address() as AddressInfo;
    return {
      baseUrl: `http://127.0.0.1:${address.port}/api/storage`,
      close: () => new Promise<void>((resolve) => listener.close(() => resolve())),
    };
  }

  it('端口未附着：如实报 503（不返回空态假装正常）', async () => {
    const response = await fetch(`${baseUrl}/tasks/t-1/output`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as { success?: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('storage not attached');
  });

  it('GET /tasks/:id/output：返回库里的全文；库里没有就是 null', async () => {
    const { port, calls } = fakePort('任务输出全文', []);
    const served = await serveWith(port);
    try {
      const response = await fetch(`${served.baseUrl}/tasks/task-9/output`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { success?: boolean; data?: { taskId?: string; output?: string | null } };
      expect(body.success).toBe(true);
      expect(body.data?.taskId).toBe('task-9');
      expect(body.data?.output).toBe('任务输出全文');
      expect(calls.readTaskOutput).toEqual(['task-9']);
    } finally {
      await served.close();
    }
  });

  it('GET /chat/:characterId：返回历史；limit 收紧到 [1, 200]', async () => {
    const messages: PersistedChatMessage[] = [
      { id: 1, characterId: 'char-1', role: 'user', content: '在吗', sessionRef: null, createdAt: 1 },
    ];
    const { port, calls } = fakePort(null, messages);
    const served = await serveWith(port);
    try {
      const response = await fetch(`${served.baseUrl}/chat/char-1?limit=9999`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        success?: boolean;
        data?: { messages?: PersistedChatMessage[] };
      };
      expect(body.success).toBe(true);
      expect(body.data?.messages).toHaveLength(1);
      // 外部传入的 limit 不被信任：收紧到上限 200。
      expect(calls.loadChatMessages).toEqual([{ characterId: 'char-1', limit: 200 }]);
    } finally {
      await served.close();
    }
  });

  it('GET /chat/:characterId?beforeId=：向前翻页（游标透传给读口）', async () => {
    const { port, calls } = fakePort(null, []);
    const served = await serveWith(port);
    try {
      const response = await fetch(`${served.baseUrl}/chat/char-1?beforeId=42&limit=10`);
      expect(response.status).toBe(200);
      expect(calls.loadEarlierChatMessages).toEqual([
        { characterId: 'char-1', beforeId: 42, limit: 10 },
      ]);
      expect(calls.loadChatMessages).toHaveLength(0);
    } finally {
      await served.close();
    }
  });

  it('坏输入：超长角色 id / 坏游标一律 400', async () => {
    const { port } = fakePort(null, []);
    const served = await serveWith(port);
    try {
      const badCharacter = await fetch(`${served.baseUrl}/chat/${'x'.repeat(201)}`);
      expect(badCharacter.status).toBe(400);
      const badCursor = await fetch(`${served.baseUrl}/chat/char-1?beforeId=0`);
      expect(badCursor.status).toBe(400);
    } finally {
      await served.close();
    }
  });
});
