/**
 * 文件职责：`stratix_chat_send` 的单测 —— 受理回执结构、回复截断、角色守门、忙碌锁与端口缺失。
 * 输入：隔离的 McpHost（注入一轮对话的端口；对话本身是打桩的 —— 被测的是工具这一侧的契约）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不打桩 core 状态机 —— 本工具只读世界态、不落任何命令，守门判定走的是真 WorldState；
 *   2. 不在这里造一份"假聊天服务"的生产实现 —— 对话端口由组合根注入（见 context.ts 的说明），
 *      本用例只验工具收到端口结果之后给出的回执形状。
 */

import { createStore, type CoreStore } from '../../../core/store';
import type { WorldState } from '../../../core/types';
import { McpToolError } from '../envelope';
import { chatSendTool } from '../tools/chat';
import type { ChatRoundOutcome, McpHost } from '../types';

function makeStore(overrides: Partial<WorldState> = {}): CoreStore {
  return createStore({
    characters: [
      {
        id: 'ch_kimi',
        name: 'Kimi',
        persona: '你是 Kimi',
        level: 7,
        experience: 120,
        agentKind: 'kimi',
      },
    ],
    detectedAgents: [
      { kind: 'kimi', tier: 'T1', installed: true, status: 'installed', version: '1.0.0', path: '/bin/kimi' },
    ],
    units: [
      {
        id: 'unit_kimi',
        name: 'Kimi',
        status: 'idle',
        missionId: null,
        power: 0,
        characterId: 'ch_kimi',
        online: true,
      },
    ],
    missions: [],
    tasks: [],
    ...overrides,
  });
}

interface ChatData {
  message_id: string | null;
  character: { id: string; name: string };
  status: string;
  reply: string;
  reply_truncated: boolean;
  duration_ms: number;
  session_id: string | null;
}

function makeHost(
  store: CoreStore,
  sendChatRound?: (characterId: string, text: string) => Promise<ChatRoundOutcome>
): McpHost {
  const host: McpHost = {
    getWorldState: () => store.getState(),
    dispatchCommand: () => {
      throw new Error('对话工具不该投递命令');
    },
  };
  return sendChatRound ? { ...host, sendChatRound } : host;
}

async function callChat(host: McpHost, args: Record<string, unknown>): Promise<ChatData> {
  const result = await chatSendTool.handler(args, host);
  const envelope = result.structuredContent as { ok: boolean; data: ChatData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

describe('stratix_chat_send', () => {
  it('回执含消息 id + 角色 + 状态 + 回复 + 耗时 + 会话 id', async () => {
    const store = makeStore();
    const host = makeHost(store, async (characterId, text) => {
      expect(characterId).toBe('ch_kimi');
      expect(text).toBe('重构一下路由层');
      return {
        status: 'completed',
        reply: '路由层重构已完成，改动集中在 bus-adapter.ts。',
        sessionId: 'sess_9f2c',
        durationMs: 8420,
        messageId: 'msg_1754_7',
      };
    });

    const data = await callChat(host, {
      character: 'ch_kimi',
      message: '重构一下路由层',
    });

    expect(data).toEqual({
      message_id: 'msg_1754_7',
      character: { id: 'ch_kimi', name: 'Kimi' },
      status: 'completed',
      reply: '路由层重构已完成，改动集中在 bus-adapter.ts。',
      reply_truncated: false,
      duration_ms: 8420,
      session_id: 'sess_9f2c',
    });
  });

  it('回复超过 2000 码点 → 截断并标 reply_truncated', async () => {
    const store = makeStore();
    const long = '答'.repeat(2500);
    const host = makeHost(store, async () => ({
      status: 'completed',
      reply: long,
      sessionId: null,
      durationMs: 10,
      messageId: null,
    }));

    const data = await callChat(host, { character: 'ch_kimi', message: '长篇大论' });
    expect(data.reply_truncated).toBe(true);
    expect([...data.reply].length).toBe(2000);
  });

  it('角色不在档 → unknown_character；未绑 agent → character_unbound', async () => {
    const store = makeStore();
    const host = makeHost(store, async () => ({
      status: 'completed',
      reply: '在的',
      sessionId: null,
      durationMs: 1,
      messageId: null,
    }));

    try {
      await callChat(host, { character: 'ch_ghost', message: '在吗' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('unknown_character');
    }

    const unboundStore = makeStore({
      characters: [
        {
          id: 'ch_kimi',
          name: 'Kimi',
          persona: '',
          level: 1,
          experience: 0,
          agentKind: null,
        },
      ],
    });
    const unboundHost = makeHost(unboundStore, async () => ({
      status: 'completed',
      reply: '在的',
      sessionId: null,
      durationMs: 1,
      messageId: null,
    }));
    try {
      await callChat(unboundHost, { character: 'ch_kimi', message: '在吗' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('character_unbound');
    }
  });

  it('角色离线 → character_offline（可重试），不落到对话', async () => {
    const offlineStore = makeStore({
      units: [
        {
          id: 'unit_kimi',
          name: 'Kimi',
          status: 'idle',
          missionId: null,
          power: 0,
          characterId: 'ch_kimi',
          online: false,
        },
      ],
    });
    let called = false;
    const host = makeHost(offlineStore, async () => {
      called = true;
      return {
        status: 'completed',
        reply: '在的',
        sessionId: null,
        durationMs: 1,
        messageId: null,
      };
    });

    try {
      await callChat(host, { character: 'ch_kimi', message: '在吗' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('character_offline');
      expect((error as McpToolError).retryable).toBe(true);
    }
    expect(called).toBe(false);
  });

  it('已有轮次在跑 → chat_busy（可重试），不静默丢弃', async () => {
    const store = makeStore();
    const host = makeHost(store, async () => {
      throw new McpToolError('chat_busy');
    });

    try {
      await callChat(host, { character: 'ch_kimi', message: '在吗' });
      throw new Error('应当抛错');
    } catch (error) {
      expect((error as McpToolError).code).toBe('chat_busy');
      expect((error as McpToolError).retryable).toBe(true);
    }
  });

  it('本轮以失败收束 → 回执里 status 如实为 failed（不是裸成功）', async () => {
    const store = makeStore();
    const host = makeHost(store, async () => ({
      status: 'timeout',
      reply: '⚠ 调用超时',
      sessionId: null,
      durationMs: 180000,
      messageId: null,
    }));

    const data = await callChat(host, { character: 'ch_kimi', message: '在吗' });
    expect(data.status).toBe('timeout');
    expect(data.reply).toContain('超时');
  });

  it('宿主没接对话端口 → internal_error + retryable:false（缺端口不会自愈），且给出替代路径', async () => {
    const store = makeStore();
    const host = makeHost(store);

    try {
      await callChat(host, { character: 'ch_kimi', message: '在吗' });
      throw new Error('应当抛错');
    } catch (error) {
      const toolError = error as McpToolError;
      expect(toolError.code).toBe('internal_error');
      // task_125 / N1：旧实现落 internal_error 的**缺省** retryable:true —— 那是架构缺口，
      // 重试不会自愈，标成可重试会诱导外部 agent 无效重试。
      expect(toolError.retryable).toBe(false);
      expect(toolError.message).toContain('not_available');
      // hint 必须指向真正能用的替代路径。
      expect(toolError.hint).toContain('stratix_task_assign');
      expect(toolError.hint).toContain('stratix_session_list');
    }
  });

  it('端口未接时先报不可用（不落到角色守门）—— 换个角色 id 也不会「碰巧成功」', async () => {
    const store = makeStore();
    const host = makeHost(store);

    try {
      await callChat(host, { character: 'ch_ghost', message: '在吗' });
      throw new Error('应当抛错');
    } catch (error) {
      const toolError = error as McpToolError;
      expect(toolError.code).toBe('internal_error');
      expect(toolError.retryable).toBe(false);
    }
  });

  it('message 为空 / 超长 → invalid_arguments', async () => {
    const store = makeStore();
    const host = makeHost(store, async () => ({
      status: 'completed',
      reply: '在的',
      sessionId: null,
      durationMs: 1,
      messageId: null,
    }));

    await expect(callChat(host, { character: 'ch_kimi', message: '   ' })).rejects.toBeInstanceOf(
      McpToolError
    );
    await expect(
      callChat(host, { character: 'ch_kimi', message: 'x'.repeat(8001) })
    ).rejects.toBeInstanceOf(McpToolError);
  });
});
