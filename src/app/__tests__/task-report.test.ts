/**
 * 集成测试：任务结果回流（app/services/task-report.ts，task_039）。
 * 覆盖五个面（task_048 增⑤成果物摘要）：
 *   1. 报告文案纯函数：前缀标记 / 指令摘要（空白折叠 + 40 码点截断）/ 输出全文或 2000 截断 /
 *      失败文案 / toast 文案；
 *   2. 注入裁决 shouldInjectReport：正看着（开 + viewing）或内存已是超集（sessionCharacterIds）
 *      才注入，其余只落库 + toast；
 *   3. 终态回调三路副作用：落库（completed → assistant / failed → error）、抽屉注入
 *      （failed 带 error 标记）、toast（文案 + 语气）；角色名缺失回落 id；
 *   4. 副作用互相独立：一路抛错不影响其余两路（fire-and-forget 纪律，只记日志）；
 *   5. 成果物摘要（task_048）：completed 携带 artifacts JSON → 报告尾部附 📂 文件清单块；
 *      解析为空 / 坏形状 / failed → 报告格式与 039 完全一致（纯文本兜底，规格③）。
 */

import type { CharacterView, WorldState } from '../../core/types';
import { parseTaskArtifactsJson, serializeTaskArtifacts, type TaskArtifacts } from '../services/task-artifacts';
import type { TaskPersistRecord } from '../services/task-service';
import {
  buildTaskFailedText,
  buildTaskReportText,
  clampTaskReportOutput,
  createTaskReportHandler,
  shouldInjectReport,
  summarizeTaskPrompt,
  TASK_FAILED_PREFIX,
  TASK_REPORT_OUTPUT_LIMIT,
  TASK_REPORT_PREFIX,
  TASK_REPORT_PROMPT_SUMMARY_LEN,
  TASK_REPORT_TRUNCATION_MARK,
  taskToastText,
  type TaskReportTone,
  type TaskReportViewPort,
} from '../services/task-report';

// ============================================================================
// 夹具
// ============================================================================

const character: CharacterView = {
  id: 'ch-1',
  name: '阿尔法',
  persona: '冷静的战术分析师。',
  level: 1,
  experience: 0,
  agentKind: 'claude-code',
};

const characters: readonly CharacterView[] = [character];

function makeRecord(patch: Partial<TaskPersistRecord> = {}): TaskPersistRecord {
  return {
    id: 'task_1',
    characterId: 'ch-1',
    prompt: '侦察北门',
    status: 'completed',
    createdAt: 1,
    startedAt: 2,
    endedAt: 3,
    output: '北门无敌情，一切正常。',
    ...patch,
  };
}

/** 可配置的视图口桩：默认「关着、没在看谁、无内存会话」。 */
function makeView(patch: Partial<TaskReportViewPort> = {}): TaskReportViewPort {
  const base: TaskReportViewPort = {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    addMessage: (): void => {},
    isOpen: false,
    characterId: null,
    sessionCharacterIds: [],
  };
  return { ...base, ...patch };
}

interface HandlerHarness {
  readonly handle: (record: TaskPersistRecord) => void;
  readonly injected: Array<{ characterId: string; role: string; text: string; error?: boolean }>;
  readonly persisted: Array<{ characterId: string; role: string; text: string; sessionRef: string | null }>;
  readonly toasts: Array<{ text: string; tone: TaskReportTone }>;
  readonly logs: string[];
}

/** 完整接线桩：三路副作用全部记账（view / persist / toast 都注入）。 */
function makeHandler(
  view: TaskReportViewPort = makeView(),
  state: Pick<WorldState, 'characters'> = { characters: [...characters] }
): HandlerHarness {
  const injected: HandlerHarness['injected'] = [];
  const persisted: HandlerHarness['persisted'] = [];
  const toasts: HandlerHarness['toasts'] = [];
  const logs: string[] = [];
  const trackingView: TaskReportViewPort = {
    ...view,
    addMessage(message): void {
      injected.push(message as { characterId: string; role: string; text: string; error?: boolean });
    },
  };
  const handle = createTaskReportHandler({
    view: trackingView,
    getState: () => state,
    persistMessage: (message) => {
      persisted.push({
        characterId: message.characterId,
        role: message.role,
        text: message.text,
        sessionRef: message.sessionRef,
      });
    },
    toast: (text, tone) => {
      toasts.push({ text, tone });
    },
    logger: (line) => {
      logs.push(line);
    },
  });
  return { handle, injected, persisted, toasts, logs };
}

// ============================================================================
// 报告文案纯函数
// ============================================================================

describe('summarizeTaskPrompt：指令单行摘要', () => {
  test('短指令原样（空白折叠）', () => {
    expect(summarizeTaskPrompt('侦察北门')).toBe('侦察北门');
    expect(summarizeTaskPrompt('  侦察\n北门\t出发  ')).toBe('侦察 北门 出发');
  });

  test('超过 40 码点截断 + 截断标记；边界恰好 40 不截', () => {
    const long = '甲'.repeat(TASK_REPORT_PROMPT_SUMMARY_LEN + 5);
    expect(summarizeTaskPrompt(long)).toBe(
      '甲'.repeat(TASK_REPORT_PROMPT_SUMMARY_LEN) + TASK_REPORT_TRUNCATION_MARK
    );
    expect(summarizeTaskPrompt('乙'.repeat(TASK_REPORT_PROMPT_SUMMARY_LEN))).toBe(
      '乙'.repeat(TASK_REPORT_PROMPT_SUMMARY_LEN)
    );
  });

  test('空指令防御性占位（core 契约保证非空，这里只是不崩）', () => {
    expect(summarizeTaskPrompt('   ')).toBe('（无指令）');
  });
});

describe('clampTaskReportOutput：输出全文或截断', () => {
  test('≤ 2000 放全文；> 2000 截到 2000 + 标记', () => {
    const short = '结果';
    expect(clampTaskReportOutput(short)).toBe(short);
    const exact = 'x'.repeat(TASK_REPORT_OUTPUT_LIMIT);
    expect(clampTaskReportOutput(exact)).toBe(exact);
    const long = 'y'.repeat(TASK_REPORT_OUTPUT_LIMIT + 100);
    expect(clampTaskReportOutput(long)).toBe(
      'y'.repeat(TASK_REPORT_OUTPUT_LIMIT) + TASK_REPORT_TRUNCATION_MARK
    );
  });
});

describe('buildTaskReportText / buildTaskFailedText：报告消息格式（规格②）', () => {
  test('完成报告 = 前缀标记 + 指令摘要行 + 换行 + 输出全文', () => {
    const text = buildTaskReportText('侦察北门', '北门无敌情。');
    expect(text).toBe('📋 任务报告：侦察北门\n北门无敌情。');
    expect(text.startsWith(TASK_REPORT_PREFIX)).toBe(true);
    // 首行只含前缀 + 摘要（指令与结果分行，抽屉气泡 pre-wrap 可读）
    expect(text.split('\n', 1)[0]).toBe(`${TASK_REPORT_PREFIX}侦察北门`);
  });

  test('超长输出走截断（全文 ≤ 2001 码点）', () => {
    const long = 'z'.repeat(5000);
    const text = buildTaskReportText('写长报告', long);
    const body = text.split('\n').slice(1).join('\n');
    expect(body.length).toBe(TASK_REPORT_OUTPUT_LIMIT + TASK_REPORT_TRUNCATION_MARK.length);
    expect(body.endsWith(TASK_REPORT_TRUNCATION_MARK)).toBe(true);
  });

  test('失败报告 = ⚠ 前缀 + 原因；空原因给占位', () => {
    expect(buildTaskFailedText('执行超时：等了 600 秒')).toBe('⚠ 任务失败：执行超时：等了 600 秒');
    expect(buildTaskFailedText('')).toBe(`${TASK_FAILED_PREFIX}：（未提供原因）`);
  });
});

describe('taskToastText：轻提示文案（规格③）', () => {
  test('「XX 完成任务」/「XX 任务失败」', () => {
    expect(taskToastText('阿尔法', 'completed')).toBe('阿尔法 完成任务');
    expect(taskToastText('阿尔法', 'failed')).toBe('阿尔法 任务失败');
  });
});

// ============================================================================
// 注入裁决
// ============================================================================

describe('shouldInjectReport：抽屉注入裁决（内存超集保护）', () => {
  test('抽屉开着且正看该角色 → 注入（即时上屏）', () => {
    expect(shouldInjectReport(makeView({ isOpen: true, characterId: 'ch-1' }), 'ch-1')).toBe(true);
  });

  test('该角色本轮已有内存消息 → 注入（内存已是超集）', () => {
    expect(shouldInjectReport(makeView({ sessionCharacterIds: ['ch-1', 'ch-2'] }), 'ch-1')).toBe(true);
  });

  test('抽屉关着且该角色从未有过消息 → 不注入（可见性交给 036 回填，别挡历史）', () => {
    expect(shouldInjectReport(makeView(), 'ch-1')).toBe(false);
    // 开着但在看别人、目标角色也没说过话 → 不注入
    expect(shouldInjectReport(makeView({ isOpen: true, characterId: 'ch-2' }), 'ch-1')).toBe(false);
    // 关着但正看该角色（看对象保留、抽屉收起）→ 不注入：回填/内存都还没建立，走库
    expect(shouldInjectReport(makeView({ isOpen: false, characterId: 'ch-1' }), 'ch-1')).toBe(false);
  });
});

// ============================================================================
// 终态回调三路副作用
// ============================================================================

describe('createTaskReportHandler：completed 的三路副作用', () => {
  test('落库 role=assistant + 报告全文；正看着 → 注入气泡（无 error）；toast 绿', () => {
    const h = makeHandler(makeView({ isOpen: true, characterId: 'ch-1' }));
    h.handle(makeRecord());

    expect(h.persisted).toHaveLength(1);
    expect(h.persisted[0]).toMatchObject({
      characterId: 'ch-1',
      role: 'assistant',
      sessionRef: null, // 任务会话一次性，无聊天会话回执
    });
    expect(h.persisted[0].text).toBe(buildTaskReportText('侦察北门', '北门无敌情，一切正常。'));

    expect(h.injected).toHaveLength(1);
    expect(h.injected[0].characterId).toBe('ch-1');
    expect(h.injected[0].role).toBe('assistant');
    expect(h.injected[0].error).toBeUndefined(); // 完成报告不是错误气泡
    expect(h.injected[0].text).toBe(h.persisted[0].text); // 注入与落库同文

    expect(h.toasts).toEqual([{ text: '阿尔法 完成任务', tone: 'success' }]);
  });

  test('从未看过该角色 → 只落库 + toast，不注入（打开抽屉由回填展示，不挡历史）', () => {
    const h = makeHandler(); // 关着、没看谁、无内存会话
    h.handle(makeRecord());
    expect(h.persisted).toHaveLength(1);
    expect(h.toasts).toHaveLength(1);
    expect(h.injected).toHaveLength(0);
  });

  test('该角色本轮已有消息（非正看）→ 注入（内存超集，追加不破坏回填裁决）', () => {
    const h = makeHandler(makeView({ isOpen: true, characterId: 'ch-2', sessionCharacterIds: ['ch-1'] }));
    h.handle(makeRecord());
    expect(h.injected).toHaveLength(1);
    expect(h.injected[0].characterId).toBe('ch-1');
  });

  test('角色档案缺失 → toast 文案回落 id（不编造名字）', () => {
    const h = makeHandler(makeView({ isOpen: true, characterId: 'ch-ghost' }), { characters: [] });
    h.handle(makeRecord({ characterId: 'ch-ghost' }));
    expect(h.toasts).toEqual([{ text: 'ch-ghost 完成任务', tone: 'success' }]);
  });
});

describe('createTaskReportHandler：failed 的三路副作用', () => {
  test('落库 role=error；注入错误气泡（error 标记）；toast 红「XX 任务失败」', () => {
    const h = makeHandler(makeView({ isOpen: true, characterId: 'ch-1' }));
    h.handle(makeRecord({ status: 'failed', output: '执行超时：等了 600 秒' }));

    expect(h.persisted[0]).toMatchObject({ characterId: 'ch-1', role: 'error' });
    expect(h.persisted[0].text).toBe('⚠ 任务失败：执行超时：等了 600 秒');

    expect(h.injected[0]).toMatchObject({ characterId: 'ch-1', role: 'assistant', error: true });
    expect(h.injected[0].text).toBe(h.persisted[0].text);

    expect(h.toasts).toEqual([{ text: '阿尔法 任务失败', tone: 'danger' }]);
  });
});

describe('副作用互相独立（一路抛错不绑架其余）', () => {
  test('落库抛错 → 注入与 toast 照常，日志一行', () => {
    const injected: unknown[] = [];
    const toasts: Array<[string, TaskReportTone]> = [];
    const logs: string[] = [];
    const handle = createTaskReportHandler({
      view: makeView({
        isOpen: true,
        characterId: 'ch-1',
        addMessage: (message): void => {
          injected.push(message);
        },
      }),
      getState: () => ({ characters: [...characters] }),
      persistMessage: (): void => {
        throw new Error('库满');
      },
      toast: (text, tone) => {
        toasts.push([text, tone]);
      },
      logger: (line) => {
        logs.push(line);
      },
    });
    handle(makeRecord());
    expect(injected).toHaveLength(1);
    expect(toasts).toHaveLength(1);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('落库');
    expect(logs[0]).toContain('库满');
  });

  test('注入抛错 / toast 抛错 → 其余路照常（fire-and-forget 纪律）', () => {
    const persisted: unknown[] = [];
    const logs: string[] = [];
    const handle = createTaskReportHandler({
      view: makeView({
        isOpen: true,
        characterId: 'ch-1',
        addMessage: (): void => {
          throw new Error('抽屉炸了');
        },
      }),
      getState: () => ({ characters: [...characters] }),
      persistMessage: (message) => {
        persisted.push(message);
      },
      toast: (): void => {
        throw new Error('宿主没挂');
      },
      logger: (line) => {
        logs.push(line);
      },
    });
    handle(makeRecord());
    expect(persisted).toHaveLength(1);
    expect(logs).toHaveLength(2); // 注入 + toast 各一行
    expect(logs.join('\n')).toContain('抽屉炸了');
    expect(logs.join('\n')).toContain('宿主没挂');
  });

  test('三路口全缺省（无 view / persist / toast）→ 只要不抛就是合法配置', () => {
    const handle = createTaskReportHandler({ getState: () => ({ characters: [] }) });
    expect(() => handle(makeRecord())).not.toThrow();
  });
});

// ============================================================================
// 成果物摘要（task_048，规格③：报告格式两态）
// ============================================================================

const ARTIFACTS: TaskArtifacts = {
  files: [
    { path: 'src/core/types.ts', added: 30, removed: 2 },
    { path: 'src/app/foo.ts', added: 12, removed: 6 },
  ],
  summary: '已完成全部修改，测试通过。',
};

describe('buildTaskReportText：成果物两态（task_048）', () => {
  test('有成果物 → 基础格式不变，尾部换行附 📂 文件清单块（渲染模型与面板共用）', () => {
    const text = buildTaskReportText('重构类型', '输出正文。', ARTIFACTS);
    expect(text).toBe(
      '📋 任务报告：重构类型\n输出正文。\n' +
        '📎 摘要：已完成全部修改，测试通过。\n' +
        '📂 2 个文件 · +42/-8 行\n' +
        '- src/core/types.ts（+30/-2）\n' +
        '- src/app/foo.ts（+12/-6）'
    );
  });

  test('成果物为空 / files 空 → 格式与 039 完全一致（纯文本兜底，不编造）', () => {
    const bare = buildTaskReportText('侦察北门', '北门无敌情，一切正常。');
    expect(buildTaskReportText('侦察北门', '北门无敌情，一切正常。', null)).toBe(bare);
    expect(buildTaskReportText('侦察北门', '北门无敌情，一切正常。', { files: [], summary: '' })).toBe(bare);
  });
});

describe('createTaskReportHandler：成果物随终态记录回流（task_048）', () => {
  test('completed 带 artifacts JSON → 落库与注入的报告尾部都带 📂 块', () => {
    const h = makeHandler(makeView({ isOpen: true, characterId: 'ch-1' }));
    h.handle(makeRecord({ artifacts: serializeTaskArtifacts(ARTIFACTS) }));

    const expected = buildTaskReportText('侦察北门', '北门无敌情，一切正常。', ARTIFACTS);
    expect(h.persisted[0].text).toBe(expected);
    expect(h.injected[0].text).toBe(expected);
    expect(h.persisted[0].text).toContain('📂 2 个文件 · +42/-8 行');
  });

  test('completed 无 artifacts（解析不出 / 老记录）→ 报告格式与 039 一致', () => {
    const h = makeHandler(makeView({ isOpen: true, characterId: 'ch-1' }));
    h.handle(makeRecord());
    expect(h.persisted[0].text).toBe(buildTaskReportText('侦察北门', '北门无敌情，一切正常。'));
  });

  test('completed 带坏形状 artifacts（脏 JSON）→ 宽容降级纯文本，不抛不修', () => {
    const h = makeHandler(makeView({ isOpen: true, characterId: 'ch-1' }));
    expect(() => h.handle(makeRecord({ artifacts: '{oops' }))).not.toThrow();
    expect(h.persisted[0].text).toBe(buildTaskReportText('侦察北门', '北门无敌情，一切正常。'));
    expect(parseTaskArtifactsJson('{oops')).toBeNull(); // 降级口径：坏形状 = 无成果物
  });

  test('failed 不附成果物块（失败是没产出，不是产出不明）', () => {
    const h = makeHandler(makeView({ isOpen: true, characterId: 'ch-1' }));
    h.handle(makeRecord({ status: 'failed', output: '执行超时', artifacts: serializeTaskArtifacts(ARTIFACTS) }));
    expect(h.persisted[0].text).toBe('⚠ 任务失败：执行超时');
  });
});
