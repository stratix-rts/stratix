/**
 * 单测：**@会话引用的纯逻辑**（core/session/reference.ts —— task_107 / v3.2b-B8）。
 *
 * 覆盖验收口径：
 *   1. 解析：0 个引用 / 1 个 / 多个（保序去重）/ 非法写法（光杆 `@session_`、超长 id）
 *      / 词字符前缀不算引用（邮箱、标识符）；
 *   2. 注入块格式：【引用会话 <title>(<id>)】+ 摘要（压缩摘要）+ 时间线（近期原文），
 *      以及条数上限与截断标注；
 *   3. 防御式：载荷是脏形状（不是对象 / 字段不是字符串）时不炸块。
 *
 * ★ 本文件只测**纯逻辑**：会话是否存在是 app 层服务的事（core 不碰 IO）。
 */

import {
  buildSessionReferenceBlock,
  parseSessionReferences,
  SESSION_REFERENCE_MAX_BLOCK_LEN,
  SESSION_REFERENCE_MAX_EVENTS,
  SESSION_REFERENCE_MAX_ID_LEN,
  SESSION_REFERENCE_MAX_SECTION_LEN,
  SESSION_REFERENCE_MAX_TARGETS,
  SESSION_REFERENCE_PREFIX,
  type SessionReferenceSource,
} from '../session';
import type { SessionEventView, SessionRecord } from '../session/types';

// ============================================================================
// 夹具
// ============================================================================

function makeSession(id: string, title: string): SessionRecord {
  return {
    id,
    kind: 'peer_chat',
    title,
    participants: ['ch-a', 'ch-b'],
    status: 'closed',
    createdAt: 1_700_000_000_000,
    lastEventAt: 1_700_000_600_000,
    closedAt: 1_700_000_600_000,
    eventCount: 3,
  };
}

function makeEvent(seq: number, type: string, payload: unknown, createdAt = 1_700_000_000_000 + seq * 60_000): SessionEventView {
  return { sessionId: 'session-x', seq, type, payload, createdAt };
}

/** 消息事件（时间线最常见的形状）。 */
function makeMessage(seq: number, author: string, text: string): SessionEventView {
  return makeEvent(seq, 'message', { author, text });
}

/** 压缩摘要事件（折叠出来的那条）。 */
function makeCompressed(seq: number): SessionEventView {
  return makeEvent(seq, 'compressed', {
    fromSeq: 1,
    toSeq: 10,
    rounds: 3,
    participants: ['阿尔法', '贝塔'],
    firstSummary: '先定侦察方向',
    lastSummary: '决定分两路',
    keyEvents: ['中断：超时'],
    foldedCount: 10,
  });
}

// ============================================================================
// 解析
// ============================================================================

describe('parseSessionReferences：@session_<id> 语法解析', () => {
  test('0 个引用：普通文本原样通过（既不是 id 也不是非法 token）', () => {
    const parsed = parseSessionReferences('先侦察还是先扩张');
    expect(parsed.ids).toEqual([]);
    expect(parsed.invalid).toEqual([]);
  });

  test('空串 / 空白：同上', () => {
    expect(parseSessionReferences('')).toEqual({ ids: [], invalid: [] });
    expect(parseSessionReferences('   ')).toEqual({ ids: [], invalid: [] });
  });

  test('1 个引用：id 原样取出', () => {
    const parsed = parseSessionReferences('接着 @session_session_peer_chat_1 聊的那条线继续');
    expect(parsed.ids).toEqual(['session_peer_chat_1']);
    expect(parsed.invalid).toEqual([]);
  });

  test('多个引用：保序；重复 id 只留一次', () => {
    const parsed = parseSessionReferences('@session_a 与 @session_b，再看 @session_a');
    expect(parsed.ids).toEqual(['a', 'b']);
    expect(parsed.invalid).toEqual([]);
  });

  test('id 允许字母 / 数字 / 下划线 / 连字符', () => {
    expect(parseSessionReferences('@session_a-B_9').ids).toEqual(['a-B_9']);
  });

  test('光杆 `@session_`（后面没跟 id）→ 非法 token（如实报出，不静默吞掉）', () => {
    const parsed = parseSessionReferences('参考 @session_ 的内容');
    expect(parsed.ids).toEqual([]);
    expect(parsed.invalid).toEqual([SESSION_REFERENCE_PREFIX]);
  });

  test('超长 id（> 上限）→ 非法 token（截短展示，防超长进 prompt）', () => {
    const long = 'x'.repeat(SESSION_REFERENCE_MAX_ID_LEN + 1);
    const parsed = parseSessionReferences(`@session_${long}`);
    expect(parsed.ids).toEqual([]);
    expect(parsed.invalid).toHaveLength(1);
    expect(parsed.invalid[0]!.length).toBeLessThanOrEqual(
      SESSION_REFERENCE_PREFIX.length + SESSION_REFERENCE_MAX_ID_LEN + 1
    );
    expect(parsed.invalid[0]!.endsWith('…')).toBe(true);
  });

  test('恰好等于上限的 id → 合法（边界含端点）', () => {
    const exact = 'y'.repeat(SESSION_REFERENCE_MAX_ID_LEN);
    expect(parseSessionReferences(`@session_${exact}`).ids).toEqual([exact]);
  });

  test('@ 前面是词字符 → 不算引用（邮箱 / 标识符的一部分）', () => {
    expect(parseSessionReferences('a@session_x').ids).toEqual([]);
    expect(parseSessionReferences('mail@session_x').invalid).toEqual([]);
  });

  test('引用上限常量：一次最多 5 个（prompt 必须有界）', () => {
    expect(SESSION_REFERENCE_MAX_TARGETS).toBe(5);
  });
});

// ============================================================================
// 注入块
// ============================================================================

describe('buildSessionReferenceBlock：注入 agent 上下文的块', () => {
  test('没有素材 → 空串（调用方据此不拼前缀）', () => {
    expect(buildSessionReferenceBlock([])).toBe('');
  });

  test('单条引用：标题 + id 的头，摘要行，时间线行', () => {
    const sources: SessionReferenceSource[] = [
      {
        session: makeSession('sess-1', '先侦察还是先扩张'),
        events: [
          makeEvent(1, 'created', {}),
          makeMessage(2, '阿尔法', '我主张先侦察。'),
          makeMessage(3, '贝塔', '我同意侦察。'),
        ],
      },
    ];
    const block = buildSessionReferenceBlock(sources);
    expect(block).toContain('【引用会话 先侦察还是先扩张(sess-1)】');
    expect(block).toContain('时间线：');
    expect(block).toContain('阿尔法：我主张先侦察。');
    expect(block).toContain('贝塔：我同意侦察。');
    // 时间线每行带时刻（MM-DD HH:mm）。
    expect(block).toMatch(/- \d{2}-\d{2} \d{2}:\d{2} 阿尔法/);
  });

  test('有压缩摘要事件 → 多一行「摘要：」；摘要事件本身不占时间线行', () => {
    const sources: SessionReferenceSource[] = [
      {
        session: makeSession('sess-1', '长会话'),
        events: [makeCompressed(1), makeMessage(2, '阿尔法', '接着说。')],
      },
    ];
    const block = buildSessionReferenceBlock(sources);
    expect(block).toContain('摘要：');
    expect(block).toContain('共 3 轮');
    expect(block).toContain('参与者：阿尔法、贝塔');
    expect(block).toContain('起：先定侦察方向');
    expect(block).toContain('止：决定分两路');
    // 摘要事件不重复出现在时间线里（它是摘要本身，不是"最近发生的事"）。
    const timeline = block.slice(block.indexOf('时间线：'));
    expect(timeline).not.toContain('压缩');
  });

  test('多条引用：每条一段（各有各的标题与 id）', () => {
    const block = buildSessionReferenceBlock([
      { session: makeSession('sess-1', '甲会话'), events: [makeMessage(1, 'A', '甲')] },
      { session: makeSession('sess-2', '乙会话'), events: [makeMessage(1, 'B', '乙')] },
    ]);
    expect(block).toContain('【引用会话 甲会话(sess-1)】');
    expect(block).toContain('【引用会话 乙会话(sess-2)】');
    expect(block).toContain('A：甲');
    expect(block).toContain('B：乙');
  });

  test('时间线条数上限：只给最近若干条，并明说丢了多少条', () => {
    const events = Array.from({ length: SESSION_REFERENCE_MAX_EVENTS + 5 }, (_, index) =>
      makeMessage(index + 1, '阿尔法', `第${index + 1}句`)
    );
    const block = buildSessionReferenceBlock([
      { session: makeSession('sess-1', '长会话'), events },
    ]);
    expect(block).toContain('第20句');
    expect(block).not.toContain('第1句');
    expect(block).toContain('（更早的 5 条事件未注入）');
  });

  test('单段超长 → 截断并标注（agent 得知道上下文不全）', () => {
    const events = Array.from({ length: 12 }, (_, index) =>
      makeMessage(index + 1, '阿尔法', '长'.repeat(400))
    );
    const block = buildSessionReferenceBlock([
      { session: makeSession('sess-1', '长会话'), events },
    ]);
    expect(block).toContain('（本段引用已截断）');
    expect(block.length).toBeLessThanOrEqual(SESSION_REFERENCE_MAX_SECTION_LEN);
  });

  test('整块超长 → 截断并标注', () => {
    const events = Array.from({ length: 12 }, (_, index) =>
      makeMessage(index + 1, '阿尔法', '长'.repeat(400))
    );
    const block = buildSessionReferenceBlock([
      { session: makeSession('sess-1', '甲'), events },
      { session: makeSession('sess-2', '乙'), events },
      { session: makeSession('sess-3', '丙'), events },
      { session: makeSession('sess-4', '丁'), events },
      { session: makeSession('sess-5', '戊'), events },
    ]);
    expect(block.length).toBeLessThanOrEqual(SESSION_REFERENCE_MAX_BLOCK_LEN);
    expect(block).toContain('（引用内容过长，已截断）');
  });

  test('防御式：载荷是脏形状（不是对象 / 字段类型不对）→ 不炸块', () => {
    const block = buildSessionReferenceBlock([
      {
        session: makeSession('sess-1', '脏载荷'),
        events: [
          makeEvent(1, 'message', '不是对象'),
          makeEvent(2, 'message', { author: 42, text: { nope: true } }),
          makeEvent(3, 'unknown_type', null),
        ],
      },
    ]);
    expect(block).toContain('【引用会话 脏载荷(sess-1)】');
    expect(block.length).toBeGreaterThan(0);
  });

  test('reference 事件（引用留痕）也能渲染成时间线一行', () => {
    const block = buildSessionReferenceBlock([
      {
        session: makeSession('sess-1', '互相引用'),
        events: [makeEvent(1, 'reference', { targetSessionId: 'sess-0' })],
      },
    ]);
    expect(block).toContain('引用会话 sess-0');
  });
});
