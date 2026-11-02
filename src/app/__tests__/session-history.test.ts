/**
 * 单测：会话历史读面（app/services/session-history/session-history.ts）——
 *   事件信封 → 历史条目 / 角色对话库行 → 历史条目 / 读取口的装配与两路真 IO 的调用形状。
 *
 * 只测**读面**：不写库、不改状态。IO 替身只有两个：注入的 fetch 与注入的 chatHistory 口。
 * @jest-environment node
 */

import type { ChatHistoryApi } from '../services/persistence/chat-history';
import type { PersistedChatMessage } from '../services/persistence/chat-history-dao';
import {
  chatMessageToEntry,
  createSessionHistoryPort,
  DEFAULT_SESSION_HISTORY_BASE_URL,
  httpBaseFromWorldSyncUrl,
  sessionEventToEntry,
} from '../services/session-history/session-history';

/** 造一条角色对话库行。 */
function chatRow(partial: Partial<PersistedChatMessage> & { id: number }): PersistedChatMessage {
  return {
    characterId: 'char-1',
    role: 'user',
    content: '正文',
    sessionRef: null,
    createdAt: 1_700_000_000_000,
    ...partial,
  };
}

/** 造一个 fetch 替身（记录调用，返回给定响应）。 */
function fakeFetch(
  body: unknown,
  init: { ok?: boolean; status?: number } = {}
): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: string) => {
    calls.push(String(input));
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      json: async () => body,
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('sessionEventToEntry：事件信封 → 历史条目', () => {
  const base = { sessionId: 's-1', seq: 7, createdAt: 1_700_000_000_000 };

  test('message 事件 → 发言人 + 正文', () => {
    const entry = sessionEventToEntry({
      ...base,
      type: 'message',
      payload: { author: '甲', text: '在的' },
    });
    expect(entry).toMatchObject({ id: 's-1#7', cursor: '7', author: '甲', text: '在的', tone: 'normal' });
  });

  test('interrupt 事件 → 警示语气', () => {
    const entry = sessionEventToEntry({ ...base, type: 'interrupt', payload: { reason: '超时' } });
    expect(entry.author).toBe('中断');
    expect(entry.text).toBe('超时');
    expect(entry.tone).toBe('warn');
  });

  test('closed 事件 → 收尾', () => {
    const entry = sessionEventToEntry({ ...base, type: 'closed', payload: {} });
    expect(entry.author).toBe('收尾');
    expect(entry.text).toBe('会话已结束');
  });

  // task_run 全量事件化（@since v3.46，task_105）：任务执行事件在抽屉里有人话，不是原始 JSON。
  test('task_started 事件 → 开工 + 描述摘要', () => {
    const entry = sessionEventToEntry({
      ...base,
      type: 'task_started',
      payload: { taskId: 'task-1', summary: '侦察北门' },
    });
    expect(entry.author).toBe('开工');
    expect(entry.text).toBe('侦察北门');
  });

  test('step 事件 → 步骤名（带明细时拼在后面）', () => {
    const entry = sessionEventToEntry({
      ...base,
      type: 'step',
      payload: { label: '计划待批准', detail: '先侦察再回报' },
    });
    expect(entry.author).toBe('步骤');
    expect(entry.text).toBe('计划待批准：先侦察再回报');
  });

  test('output_tail 事件 → 输出尾部', () => {
    const entry = sessionEventToEntry({
      ...base,
      type: 'output_tail',
      payload: { text: '结论在最末尾', truncated: true },
    });
    expect(entry.author).toBe('输出');
    expect(entry.text).toBe('结论在最末尾');
  });

  test('completed / failed 事件 → 完成 / 失败（失败是错误语气）', () => {
    const done = sessionEventToEntry({ ...base, type: 'completed', payload: { summary: '做完了' } });
    expect(done.author).toBe('完成');
    expect(done.text).toBe('做完了');
    const failed = sessionEventToEntry({ ...base, type: 'failed', payload: { reason: '执行超时' } });
    expect(failed.author).toBe('失败');
    expect(failed.text).toBe('执行超时');
    expect(failed.tone).toBe('error');
  });

  test('词表外的事件类型 → 如实显示类型与载荷（不猜含义）', () => {
    const entry = sessionEventToEntry({ ...base, type: 'weird', payload: { a: 1 } });
    expect(entry.author).toBe('weird');
    expect(entry.text).toContain('"a":1');
  });

  test('载荷里缺字段 → 退到兜底文案，不留 undefined', () => {
    const entry = sessionEventToEntry({ ...base, type: 'message', payload: {} });
    expect(entry.text).toBe('');
    expect(entry.author).toBe('发言');
  });
});

describe('chatMessageToEntry：角色对话库行 → 历史条目', () => {
  test('普通用户行 → 「我」', () => {
    const entry = chatMessageToEntry({
      id: 3,
      characterId: 'char-1',
      role: 'user',
      content: '你好',
      createdAt: 1_700_000_000_000,
    });
    expect(entry).toMatchObject({ author: '我', text: '你好', tone: 'normal', cursor: '3' });
  });

  test('peer 前缀被剥掉（与聊天抽屉同一口径）', () => {
    const entry = chatMessageToEntry({
      id: 4,
      characterId: 'char-1',
      role: 'assistant',
      content: '[peer:agent-9] 你好呀',
      createdAt: 1_700_000_000_000,
    });
    expect(entry.text).toBe('你好呀');
    expect(entry.author).toBe('对方');
  });

  test('error 行 → 错误语气', () => {
    const entry = chatMessageToEntry({
      id: 5,
      characterId: 'char-1',
      role: 'error',
      content: '模型超时',
      createdAt: 1_700_000_000_000,
    });
    expect(entry.tone).toBe('error');
  });
});

describe('httpBaseFromWorldSyncUrl', () => {
  test('ws → http，剥掉路径', () => {
    expect(httpBaseFromWorldSyncUrl('ws://127.0.0.1:7524/ws/world-sync')).toBe('http://127.0.0.1:7524');
  });

  test('wss → https', () => {
    expect(httpBaseFromWorldSyncUrl('wss://box.example:8443/ws/world-sync')).toBe('https://box.example:8443');
  });

  test('不认识的地址 → 回落到本机默认', () => {
    expect(httpBaseFromWorldSyncUrl('不是地址')).toBe(DEFAULT_SESSION_HISTORY_BASE_URL);
  });
});

describe('createSessionHistoryPort：装配与两路真 IO', () => {
  test('没有 preload 面 → 角色对话那路不接（面板会如实说"未附着"）', () => {
    const port = createSessionHistoryPort();
    expect(port.loadCharacterChat).toBeUndefined();
    expect(port.loadSessionEvents).toBeDefined();
  });

  test('注入 chatHistory → 角色对话那路接上并翻译库行', async () => {
    const calls: Array<{ characterId: string; limit?: number }> = [];
    const chatHistory: ChatHistoryApi = {
      saveMessage: async () => ({ ok: true }),
      loadMessages: async (characterId, limit) => {
        calls.push({ characterId, limit });
        return {
          ok: true,
          messages: [chatRow({ id: 11, role: 'user', content: '在的' })],
        };
      },
    };
    const port = createSessionHistoryPort({ chatHistory });

    const entries = await port.loadCharacterChat!('char-1', 50);
    expect(calls).toEqual([{ characterId: 'char-1', limit: 50 }]);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('在的');
  });

  test('翻页游标 → 走 loadEarlierMessages（老 preload 没这能力就退回最近一页）', async () => {
    const seen: Array<{ characterId: string; beforeId: number; limit?: number }> = [];
    const chatHistory: ChatHistoryApi = {
      saveMessage: async () => ({ ok: true }),
      loadMessages: async () => ({ ok: true, messages: [] }),
      loadEarlierMessages: async (characterId, beforeId, limit) => {
        seen.push({ characterId, beforeId, limit });
        return { ok: true, messages: [chatRow({ id: 3, content: '更早的' })] };
      },
    };
    const port = createSessionHistoryPort({ chatHistory });

    await port.loadCharacterChat!('char-1', 50, '3');
    expect(seen).toEqual([{ characterId: 'char-1', beforeId: 3, limit: 50 }]);
  });

  test('游标不合法 → 报错（不静默当成"没有更早的"）', async () => {
    const chatHistory: ChatHistoryApi = {
      saveMessage: async () => ({ ok: true }),
      loadMessages: async () => ({ ok: true, messages: [] }),
    };
    const port = createSessionHistoryPort({ chatHistory });

    await expect(port.loadCharacterChat!('char-1', 50, 'abc')).rejects.toThrow(/游标/);
  });

  test('读角色对话失败 → 抛错（面板据此显示"读取失败"，不显示假空）', async () => {
    const chatHistory: ChatHistoryApi = {
      saveMessage: async () => ({ ok: true }),
      loadMessages: async () => ({ ok: false, error: '库没开' }),
    };
    const port = createSessionHistoryPort({ chatHistory });

    await expect(port.loadCharacterChat!('char-1', 50)).rejects.toThrow('库没开');
  });

  test('会话事件流 → 打 service 的只读 REST，事件翻成条目', async () => {
    const { fetchImpl, calls } = fakeFetch({
      success: true,
      data: {
        events: [
          { sessionId: 's-1', seq: 1, type: 'created', payload: { title: '互聊' }, createdAt: 1 },
          { sessionId: 's-1', seq: 2, type: 'message', payload: { author: '甲', text: '在' }, createdAt: 2 },
        ],
      },
    });
    const port = createSessionHistoryPort({ baseUrl: 'http://127.0.0.1:9999', fetchImpl });

    const entries = await port.loadSessionEvents!('s-1', 50);
    expect(calls).toEqual(['http://127.0.0.1:9999/api/storage/sessions/s-1/events?limit=50']);
    expect(entries.map((e) => e.id)).toEqual(['s-1#1', 's-1#2']);
    expect(entries[1].text).toBe('在');
  });

  test('翻页 → 带 beforeSeq；会话 id 里的特殊字符被编码', async () => {
    const { fetchImpl, calls } = fakeFetch({ success: true, data: { events: [] } });
    const port = createSessionHistoryPort({ baseUrl: 'http://127.0.0.1:9999', fetchImpl });

    await port.loadSessionEvents!('a b/c', 50, '12');
    expect(calls[0]).toContain('/api/storage/sessions/a%20b%2Fc/events');
    expect(calls[0]).toContain('beforeSeq=12');
  });

  test('HTTP 非 2xx → 抛错', async () => {
    const { fetchImpl } = fakeFetch({}, { ok: false, status: 503 });
    const port = createSessionHistoryPort({ baseUrl: 'http://127.0.0.1:9999', fetchImpl });

    await expect(port.loadSessionEvents!('s-1', 50)).rejects.toThrow(/503/);
  });

  test('success=false → 抛错并带出服务端原因', async () => {
    const { fetchImpl } = fakeFetch({ success: false, error: '库没开' });
    const port = createSessionHistoryPort({ baseUrl: 'http://127.0.0.1:9999', fetchImpl });

    await expect(port.loadSessionEvents!('s-1', 50)).rejects.toThrow('库没开');
  });
});
