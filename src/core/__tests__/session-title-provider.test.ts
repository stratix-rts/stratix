/**
 * 单测：**标题端口的默认实现（规则版）** + **改标题的显式写面**（@since v3.47，task_104 / v3.2b-B5）。
 *
 * 覆盖验收口径：
 *   1. 规则版起名**确定性**（同一素材两次调用同一条标题）；
 *   2. 规则版与 2a 的建会话标题**逐字一致**（无 env 配置时行为与 2a 完全一致）；
 *   3. 种子翻译口径（首条用户消息 > 任务标题 > 参与者兜底）；
 *   4. manager.updateTitle：改标题即投影进 WorldState.sessions；同名不改（不广播）；
 *      空标题不改；会话不存在返回 null。
 *
 * 用真 store（createStore()）隔离：不 mock store —— manager 的职责就是写 store。
 */

import {
  createRulesTitleProvider,
  createSessionManager,
  deriveSessionTitle,
  resolveTitleBodyText,
  sessionKindLabel,
  type SessionManager,
} from '../session';
import { createStore, type CoreStore } from '../store';
import type { SessionRecord } from '../session/types';

interface Harness {
  readonly store: CoreStore;
  readonly manager: SessionManager;
}

function harness(): Harness {
  const store = createStore();
  let ids = 0;
  const manager = createSessionManager({
    store,
    now: () => Date.now(),
    createId: (prefix: string) => `${prefix}_${++ids}`,
  });
  return { store, manager };
}

function sessionsOf(store: CoreStore): SessionRecord[] {
  return store.getState().sessions ?? [];
}

// ============================================================================
// 1. 规则版实现（确定性 / 与 2a 一致）
// ============================================================================

describe('RulesTitleProvider：规则版起名', () => {
  const provider = createRulesTitleProvider();

  test('实现标识是 rules（便于日志与诊断）', () => {
    expect(provider.id).toBe('rules');
  });

  test('同一份素材两次调用结果一致（确定性）', () => {
    const seed = {
      kind: 'peer_chat' as const,
      participants: ['alice', 'bob'],
      firstUserMessage: '我们开始吧，先把分工说清楚',
    };
    expect(provider.generate(seed)).toBe(provider.generate(seed));
  });

  test('与 2a 的建会话标题逐字一致（无 env 配置时行为不变）', () => {
    // 建会话时的标题（manager.createSession 走 deriveSessionTitle）
    const { manager } = harness();
    const created = manager.createSession({
      kind: 'peer_chat',
      participants: ['alice', 'bob'],
      firstMessage: '互聊第一句话，先把分工说清楚',
    });
    // 同一份素材经端口起名
    const titled = provider.generate({
      kind: 'peer_chat',
      participants: ['alice', 'bob'],
      firstUserMessage: '互聊第一句话，先把分工说清楚',
    });
    expect(titled).toBe(created?.title);
  });

  test('task_run：任务标题与建会话时那条标题一致', () => {
    const { manager } = harness();
    const created = manager.createSession({
      kind: 'task_run',
      participants: ['char-9'],
      firstMessage: '去东门放哨并记录可疑动静',
    });
    const titled = provider.generate({
      kind: 'task_run',
      participants: ['char-9'],
      taskTitle: '去东门放哨并记录可疑动静',
    });
    expect(titled).toBe(created?.title);
  });

  test('参与者会被归一（去重 / 丢空串）后再起名', () => {
    const titled = provider.generate({
      kind: 'peer_chat',
      participants: ['alice', 'alice', ''],
    });
    expect(titled).toBe(deriveSessionTitle({ kind: 'peer_chat', participants: ['alice'] }));
  });

  test('素材翻译：首条用户消息 > 任务标题 > 空', () => {
    expect(resolveTitleBodyText({ kind: 'peer_chat', firstUserMessage: '嗨', taskTitle: '任务' })).toBe('嗨');
    expect(resolveTitleBodyText({ kind: 'task_run', taskTitle: '任务' })).toBe('任务');
    expect(resolveTitleBodyText({ kind: 'task_run' })).toBe('');
    expect(resolveTitleBodyText({ kind: 'task_run', firstUserMessage: '   ' })).toBe('');
  });

  test('kind 标签对外可读（LLM 版要在 prompt 里说明会话类型）', () => {
    expect(sessionKindLabel('peer_chat')).toBe('互聊');
    expect(sessionKindLabel('task_run')).toBe('任务执行');
  });
});

// ============================================================================
// 2. manager.updateTitle（改标题的唯一写面）
// ============================================================================

describe('manager.updateTitle：改标题', () => {
  test('改标题后 WorldState.sessions 里的那条记录随之更新（投影）', () => {
    const { store, manager } = harness();
    const created = manager.createSession({ kind: 'peer_chat', participants: ['alice', 'bob'] });
    expect(created).not.toBeNull();
    const updated = manager.updateTitle(created!.id, '北门加固方案讨论');
    expect(updated?.title).toBe('北门加固方案讨论');
    expect(sessionsOf(store)[0]?.title).toBe('北门加固方案讨论');
  });

  test('超长标题被截到上限（与其它标题同一口径）', () => {
    const { manager } = harness();
    const created = manager.createSession({ kind: 'peer_chat', participants: ['alice'] });
    const updated = manager.updateTitle(created!.id, '字'.repeat(50));
    expect(updated?.title.length).toBeLessThanOrEqual(20);
    expect(updated?.title.endsWith('…')).toBe(true);
  });

  test('空标题不改（不把用户能看见的信息抹掉）', () => {
    const { store, manager } = harness();
    const created = manager.createSession({ kind: 'peer_chat', participants: ['alice'] });
    const before = created!.title;
    expect(manager.updateTitle(created!.id, '   ')).toBeNull();
    expect(sessionsOf(store)[0]?.title).toBe(before);
  });

  test('会话不存在返回 null（不编造）', () => {
    const { manager } = harness();
    expect(manager.updateTitle('session_peer_chat_不存在', '随便什么')).toBeNull();
  });

  test('同名不改：标题一样时状态原样返回（无 env 配置时白广播一轮不做）', () => {
    const { store, manager } = harness();
    const created = manager.createSession({
      kind: 'peer_chat',
      participants: ['alice', 'bob'],
      firstMessage: '我们开始吧',
    });
    const before = sessionsOf(store)[0];
    const same = manager.updateTitle(created!.id, created!.title);
    expect(same?.title).toBe(created!.title);
    // 状态引用没换（同名没写 store → 没触发广播）
    expect(sessionsOf(store)[0]).toBe(before);
  });

  test('已收尾的会话也允许改标题（标题是摘要字段，与终态无关）', () => {
    const { manager } = harness();
    const created = manager.createSession({ kind: 'peer_chat', participants: ['alice'] });
    manager.closeSession(created!.id, '讨论完成');
    const updated = manager.updateTitle(created!.id, '收场之后补的标题');
    expect(updated?.title).toBe('收场之后补的标题');
  });
});
