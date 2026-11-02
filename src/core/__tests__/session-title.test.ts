/**
 * 单测：自动起名（core/session/machine.ts 的 deriveSessionTitle）—— 纯函数、确定性、无 LLM。
 *
 * 覆盖口径（验收要求）：**五种 kind 各 ≥2 个用例**，另加跨 kind 的不变式：
 *   - 标题长度恒落在 [12, 20] 码点（太长广播撑爆、太短界面没辨识度）；
 *   - 同一输入两次调用结果一致（确定性 —— 事件重放要能复现同一条标题）；
 *   - 首条消息优先于参与者（消息才是这轮会话在聊什么）。
 */

import { deriveSessionTitle } from '../session/machine';
import { MAX_SESSION_TITLE_LEN, MIN_SESSION_TITLE_LEN, type SessionKind } from '../session/types';

const KINDS: readonly SessionKind[] = [
  'character_chat',
  'peer_chat',
  'task_run',
  'mission_run',
  'shell_link',
];

describe('deriveSessionTitle：五种 kind 的起名规则', () => {
  test('character_chat：前缀「角色对话」+ 首条消息', () => {
    const title = deriveSessionTitle({
      kind: 'character_chat',
      participants: ['char-1'],
      firstMessage: '今天去哪儿加固城墙？',
    });
    expect(title.startsWith('角色对话：')).toBe(true);
    expect(title).toContain('今天去哪儿加固城墙');
    expect(title.length).toBeLessThanOrEqual(MAX_SESSION_TITLE_LEN);
  });

  test('character_chat：没有首条消息时用参与者兜底', () => {
    const title = deriveSessionTitle({ kind: 'character_chat', participants: ['小北'] });
    expect(title.startsWith('角色对话：')).toBe(true);
    expect(title).toContain('小北');
    expect(title.length).toBeGreaterThanOrEqual(MIN_SESSION_TITLE_LEN);
  });

  test('peer_chat：前缀「互聊」+ 首条消息', () => {
    const title = deriveSessionTitle({
      kind: 'peer_chat',
      participants: ['alice', 'bob'],
      firstMessage: '互聊第一句话，先把分工说清楚',
    });
    expect(title.startsWith('互聊：')).toBe(true);
    expect(title).toContain('先把分工说清楚');
  });

  test('peer_chat：消息太短时补默认短语（标题不至于只有两个字）', () => {
    const title = deriveSessionTitle({ kind: 'peer_chat', participants: ['alice'], firstMessage: '嗨' });
    expect(title.startsWith('互聊：')).toBe(true);
    expect(title.length).toBeGreaterThanOrEqual(MIN_SESSION_TITLE_LEN);
    expect(title.length).toBeLessThanOrEqual(MAX_SESSION_TITLE_LEN);
  });

  test('task_run：前缀「任务执行」+ 参与者（无消息时）', () => {
    const title = deriveSessionTitle({ kind: 'task_run', participants: ['char-9'] });
    expect(title.startsWith('任务执行：')).toBe(true);
    expect(title.length).toBeGreaterThanOrEqual(MIN_SESSION_TITLE_LEN);
  });

  test('task_run：有消息时消息在前', () => {
    const title = deriveSessionTitle({
      kind: 'task_run',
      participants: ['char-9'],
      firstMessage: '去东门放哨并记录可疑动静',
    });
    expect(title).toContain('去东门放哨');
  });

  test('mission_run：前缀「任务单」+ 参与者', () => {
    const title = deriveSessionTitle({ kind: 'mission_run', participants: ['mission_1_2'] });
    expect(title.startsWith('任务单：')).toBe(true);
    expect(title.length).toBeGreaterThanOrEqual(MIN_SESSION_TITLE_LEN);
  });

  test('mission_run：空参与者也有兜底标题', () => {
    const title = deriveSessionTitle({ kind: 'mission_run' });
    expect(title.startsWith('任务单：')).toBe(true);
    expect(title.length).toBeGreaterThanOrEqual(MIN_SESSION_TITLE_LEN);
    expect(title.length).toBeLessThanOrEqual(MAX_SESSION_TITLE_LEN);
  });

  test('shell_link：前缀「命令行」+ 参与者', () => {
    const title = deriveSessionTitle({ kind: 'shell_link', participants: ['claude-code'] });
    expect(title.startsWith('命令行：')).toBe(true);
    expect(title.length).toBeGreaterThanOrEqual(MIN_SESSION_TITLE_LEN);
  });

  test('shell_link：有消息时消息在前', () => {
    const title = deriveSessionTitle({
      kind: 'shell_link',
      participants: ['claude-code'],
      firstMessage: '帮我看看这个仓库的构建脚本',
    });
    expect(title).toContain('构建脚本');
  });
});

describe('deriveSessionTitle：跨 kind 的不变式', () => {
  test.each(KINDS)('%s：标题长度恒落在 [12,20]', (kind) => {
    const samples = [
      deriveSessionTitle({ kind }),
      deriveSessionTitle({ kind, participants: ['a'] }),
      deriveSessionTitle({ kind, participants: ['a', 'b'], firstMessage: '短' }),
      deriveSessionTitle({ kind, firstMessage: '这是一条比较长的首条消息内容用于验证截断行为是否正确' }),
    ];
    samples.forEach((title) => {
      expect(title.length).toBeGreaterThanOrEqual(MIN_SESSION_TITLE_LEN);
      expect(title.length).toBeLessThanOrEqual(MAX_SESSION_TITLE_LEN);
    });
  });

  test('同一输入两次调用结果一致（确定性）', () => {
    const input = {
      kind: 'peer_chat' as const,
      participants: ['alice', 'bob'],
      firstMessage: '我们开始吧',
    };
    expect(deriveSessionTitle(input)).toBe(deriveSessionTitle(input));
  });

  test('首条消息里的换行被压平（标题是单行文本）', () => {
    const title = deriveSessionTitle({
      kind: 'peer_chat',
      firstMessage: '第一行\n第二行   还有  空格',
    });
    expect(title).not.toContain('\n');
    expect(title).toContain('第一行 第二行 还有 空格');
  });

  test('超长首条消息被截断到上限（附省略号）', () => {
    const title = deriveSessionTitle({
      kind: 'peer_chat',
      firstMessage: '字'.repeat(200),
    });
    expect(title).toHaveLength(MAX_SESSION_TITLE_LEN);
    expect(title.endsWith('…')).toBe(true);
  });
});
