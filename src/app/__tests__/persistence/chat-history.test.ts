/**
 * 单测：角色对话历史的渲染侧端口（app/services/persistence/chat-history.ts，task_036）。
 * 覆盖三面：
 *   1. 翻译：库行 → 抽屉消息输入（role=error → error 标记；sessionRef 不进 UI；at ← createdAt）；
 *   2. 落库回调工厂：text→content 转写 + 时间戳盖章 + fire-and-forget（拒绝/抛错都不外溢）；
 *   3. preload 面适配（task_071）：preload 的原始面叫 saveChatMessage / loadChatMessages，
 *      端口叫 saveMessage / loadMessages —— 断言委托一一对应；面缺失 → null（非 Electron 降级）。
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
      id: '7',
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
      id: '7',
      characterId: 'ch-1',
      role: 'assistant',
      text: '⚠ 调用超时',
      error: true,
      at: 1700000000000,
    });
  });

  test('role=system 原样映射为 system 历史行，不带错误重试标记', () => {
    expect(chatHistoryEntryToDrawerInput(row({ role: 'system', content: '⚠ 调用超时：等太久' }))).toEqual({
      id: '7',
      characterId: 'ch-1',
      role: 'system',
      text: '⚠ 调用超时：等太久',
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

describe('chatHistoryEntryToDrawerInput：peer 前缀翻译（task_052）', () => {
  test('content 带 [peer:id] 前缀 → role=peer + peerId + 剥前缀正文', () => {
    const input = chatHistoryEntryToDrawerInput(
      row({ role: 'assistant', content: '[peer:ch-b] 我认为应该先侦察。' })
    );
    expect(input).toEqual({
      id: '7',
      characterId: 'ch-1',
      role: 'peer',
      text: '我认为应该先侦察。',
      peerId: 'ch-b',
      at: 1700000000000,
    });
  });

  test('普通 assistant 行不受影响；前缀缺尾随空格不匹配（退化为原样 assistant）', () => {
    expect(chatHistoryEntryToDrawerInput(row({ role: 'assistant', content: '在的' })).role).toBe('assistant');
    const noSpace = chatHistoryEntryToDrawerInput(
      row({ role: 'assistant', content: '[peer:ch-b]没有空格' })
    );
    expect(noSpace.role).toBe('assistant');
    expect(noSpace.text).toBe('[peer:ch-b]没有空格');
  });

  test('error 行不解析 peer 前缀（错误气泡语义优先）', () => {
    const input = chatHistoryEntryToDrawerInput(
      row({ role: 'error', content: '[peer:ch-b] 中断了' })
    );
    expect(input.role).toBe('assistant');
    expect(input.error).toBe(true);
  });

  test('user 行不解析 peer 前缀（插话落库是原文）', () => {
    expect(chatHistoryEntryToDrawerInput(row({ role: 'user', content: '[peer:x] ' })).role).toBe('user');
  });
});

describe('chatHistoryApi：preload 面适配（task_071）', () => {
  const scope = globalThis as { electronAPI?: unknown };

  test('无 electronAPI（node / 纯 vite dev）→ null；窗口常量 50', () => {
    expect(chatHistoryApi()).toBeNull();
    expect(CHAT_HISTORY_LOAD_LIMIT).toBe(50);
  });

  test('preload 三条历史通道一一委托；loadEarlierMessages 透传 beforeId 游标与 limit', async () => {
    const saveChatMessage = jest.fn(async () => ({ ok: true }));
    const loadChatMessages = jest.fn(async () => ({ ok: true, messages: [] }));
    const earlierResult = { ok: true, messages: [row({ id: 6 })] };
    const loadEarlierChatMessages = jest.fn(async () => earlierResult);
    scope.electronAPI = { gameSave: { saveChatMessage, loadChatMessages, loadEarlierChatMessages } };
    try {
      const api = chatHistoryApi();
      expect(api).not.toBeNull();

      const payload = {
        characterId: 'ch-1',
        role: 'user' as const,
        content: '在吗',
        sessionRef: null,
        createdAt: 1700000000000,
      };
      const saved = await api!.saveMessage(payload);
      expect(saved).toEqual({ ok: true });
      expect(saveChatMessage).toHaveBeenCalledTimes(1);
      expect(saveChatMessage).toHaveBeenCalledWith(payload);

      const loaded = await api!.loadMessages('ch-1', 20);
      expect(loaded).toEqual({ ok: true, messages: [] });
      expect(loadChatMessages).toHaveBeenCalledTimes(1);
      expect(loadChatMessages).toHaveBeenCalledWith('ch-1', 20);

      await expect(api!.loadEarlierMessages!('ch-1', 7, 20)).resolves.toBe(earlierResult);
      expect(loadEarlierChatMessages).toHaveBeenCalledWith('ch-1', 7, 20);
    } finally {
      delete scope.electronAPI;
    }
  });

  test('旧 preload 两条通道仍可加载最近历史；limit 缺省透传，分页能力缺省', async () => {
    const loadChatMessages = jest.fn(async () => ({ ok: true, messages: [] }));
    scope.electronAPI = { gameSave: { saveChatMessage: async () => ({ ok: true }), loadChatMessages } };
    try {
      const api = chatHistoryApi();
      await api!.loadMessages('ch-1');
      expect(loadChatMessages).toHaveBeenCalledWith('ch-1', undefined);
      expect(api!.loadEarlierMessages).toBeUndefined();
    } finally {
      delete scope.electronAPI;
    }
  });

  test('面缺失 → null（非 Electron 降级语义）：无 gameSave / 只有写通道 / 只有读通道', () => {
    try {
      scope.electronAPI = {};
      expect(chatHistoryApi()).toBeNull();

      scope.electronAPI = { gameSave: { saveChatMessage: async () => ({ ok: true }) } };
      expect(chatHistoryApi()).toBeNull();

      scope.electronAPI = { gameSave: { loadChatMessages: async () => ({ ok: true, messages: [] }) } };
      expect(chatHistoryApi()).toBeNull();
    } finally {
      delete scope.electronAPI;
    }
  });
});
