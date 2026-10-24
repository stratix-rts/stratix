/**
 * 单测：角色对话历史的渲染侧端口（app/services/persistence/chat-history.ts，task_036）。
 * 覆盖三面：
 *   1. 翻译：库行 → 抽屉消息输入（role=error → error 标记；sessionRef 不进 UI；at ← createdAt）；
 *   2. 落库回调工厂：text→content 转写 + 时间戳盖章 + fire-and-forget（拒绝/抛错都不外溢）；
 *   3. window 探测：无 electronAPI 的环境（纯 vite dev / node 测试）返回 null。
 * IPC 面本身是 preload 的薄透传，主进程校验/DAO 行为由 dao 单测与集成链路覆盖。
 */

import {
  CHAT_HISTORY_LOAD_LIMIT,
  chatHistoryApi,
  chatHistoryEntryToDrawerInput,
  makeChatMessagePersister,
  type ChatHistoryApi,
} from '../../services/persistence/chat-history';
import type { PersistedChatMessage } from '../../services/persistence/chat-history-dao';

function row(patch: Partial<PersistedChatMessage> = {}): PersistedChatMessage {
  return {
    id: 7,
    characterId: 'ch-1',
    role: 'user',
    content: '在吗',
    sessionRef: 'sess-abc',
    createdAt: 1700000000000,
    ...patch,
  };
}

describe('chatHistoryEntryToDrawerInput：库行 → 抽屉消息输入', () => {
  test('user / assistant 原样翻译；at ← createdAt', () => {
    expect(chatHistoryEntryToDrawerInput(row())).toEqual({
      characterId: 'ch-1',
      role: 'user',
      text: '在吗',
      at: 1700000000000,
    });
    expect(chatHistoryEntryToDrawerInput(row({ role: 'assistant', content: '在的' }))).toMatchObject({
      role: 'assistant',
      text: '在的',
    });
  });

  test('role=error → assistant 气泡 + error 标记（渲染层据此走错误样式 + 重试钮）；sessionRef 不进 UI', () => {
    const input = chatHistoryEntryToDrawerInput(row({ role: 'error', content: '⚠ 调用超时' }));
    expect(input).toEqual({
      characterId: 'ch-1',
      role: 'assistant',
      text: '⚠ 调用超时',
      error: true,
      at: 1700000000000,
    });
  });

  test('error:false 不出现（普通消息不带 error 键，与组件的 addMessage 口径一致）', () => {
    expect('error' in chatHistoryEntryToDrawerInput(row())).toBe(false);
  });
});

describe('makeChatMessagePersister：落库回调工厂', () => {
  /** 排空微任务：fire-and-forget 的 then/catch 要落定后才好断言。 */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  test('text → content 转写 + createdAt 盖章；成功路径不打日志', async () => {
    const api = { save: [] as unknown[], saveMessage: jest.fn(async () => ({ ok: true })), loadMessages: jest.fn() } as unknown as ChatHistoryApi & { save: unknown[] };
    const lines: string[] = [];
    const persist = makeChatMessagePersister(api, (line) => lines.push(line));

    persist({ characterId: 'ch-1', role: 'error', text: '⚠ 超时', sessionRef: 'sess-1' });
    await flush();

    expect(api.saveMessage).toHaveBeenCalledTimes(1);
    const payload = (api.saveMessage as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ characterId: 'ch-1', role: 'error', content: '⚠ 超时', sessionRef: 'sess-1' });
    expect(typeof payload.createdAt).toBe('number');
    expect(lines).toEqual([]); // 成功不唠叨
  });

  test('主进程拒绝 / IPC 抛错 → 只 logger 一句，不向外抛（对话回路不被落库绑架）', async () => {
    const refuse = {
      saveMessage: jest.fn(async () => ({ ok: false, error: 'bad content' })),
      loadMessages: jest.fn(),
    } as unknown as ChatHistoryApi;
    const lines: string[] = [];
    makeChatMessagePersister(refuse, (line) => lines.push(line))({
      characterId: 'ch-1', role: 'user', text: 'x', sessionRef: null,
    });
    await flush();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('被拒');

    const broken = {
      saveMessage: jest.fn(async () => { throw new Error('IPC 断了'); }),
      loadMessages: jest.fn(),
    } as unknown as ChatHistoryApi;
    lines.length = 0;
    expect(() =>
      makeChatMessagePersister(broken, (line) => lines.push(line))({
        characterId: 'ch-1', role: 'user', text: 'x', sessionRef: null,
      })
    ).not.toThrow();
    await flush();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('失败');
  });
});

describe('chatHistoryApi：环境探测', () => {
  test('无 electronAPI（node / 纯 vite dev）→ null；窗口常量 50', () => {
    expect(chatHistoryApi()).toBeNull();
    expect(CHAT_HISTORY_LOAD_LIMIT).toBe(50);
  });

  test('有扩展面（gameSave.saveChatMessage）→ 取到同一对象', () => {
    const gameSave = {
      saveChatMessage: async () => ({ ok: true }),
      loadChatMessages: async () => ({ ok: true, messages: [] }),
    };
    (globalThis as { electronAPI?: unknown }).electronAPI = { gameSave };
    try {
      expect(chatHistoryApi()).toBe(gameSave);
    } finally {
      delete (globalThis as { electronAPI?: unknown }).electronAPI;
    }
  });
});
