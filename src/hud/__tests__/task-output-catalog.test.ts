/**
 * 单元测试：任务实时输出流的缓冲存储与视图模型派生
 * （hud/components/task-output/task-output-catalog.ts，task_046）。
 * 纯逻辑（node 可算，无 DOM），覆盖 task_046 需求⑤的前四点（纯函数面）：
 *   1. 流转发顺序：append 原序拼接，多角色缓冲互不串台；
 *   2. 截断策略：超上限截头保尾 + truncated 标记；追加中途断后续仍留尾部；
 *   3. 完成态保留：缓冲在任务收尾后原样保留（不丢单 —— 面板靠它回看）；
 *   4. 清空时机：begin 换 taskId = 清空重开；同 taskId 重复广播不清；占位缓冲被认领不清；
 * 另覆盖视图模型合成（latestTaskFor / resolveTaskOutputDisplay 的回落规则）。
 * @since v3.24（task_048）追加 artifactsBlock 参数：非空时附在展示文本尾部（面板与 📋 报告
 *   共用同一渲染模型的产物 —— formatTaskArtifactsBlock 在 app 层算好，hud 只收字符串）。
 */

import type { CharacterTask, TaskStatus } from '../../core/types';
import {
  createTaskOutputStore,
  latestTaskFor,
  MAX_TASK_OUTPUT_BUFFER_CHARS,
  resolveTaskOutputDisplay,
  STREAMING_TASK_ID,
  TASK_PHASE_LABELS,
} from '../components/task-output/task-output-catalog';

// ============================================================================
// 夹具
// ============================================================================

function task(id: string, patch: Partial<CharacterTask> = {}): CharacterTask {
  return {
    id,
    characterId: 'ch-1',
    prompt: '做点事',
    status: 'running',
    createdAt: 100,
    startedAt: 100,
    endedAt: null,
    output: '',
    ...patch,
  };
}

// ============================================================================
// 缓冲存储：流转发顺序
// ============================================================================

describe('createTaskOutputStore：流转发顺序', () => {
  test('chunk 按到达顺序拼接', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', '第一段');
    store.append('ch-1', '第二段');
    store.append('ch-1', '第三段');
    expect(store.entry('ch-1')?.text).toBe('第一段第二段第三段');
  });

  test('多角色缓冲互不串台', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.begin('ch-2', 'task-2');
    store.append('ch-1', '甲的输出');
    store.append('ch-2', '乙的输出');
    expect(store.entry('ch-1')?.text).toBe('甲的输出');
    expect(store.entry('ch-2')?.text).toBe('乙的输出');
    expect(store.entry('ch-3')).toBeNull();
  });

  test('空 chunk 是 no-op（transport 不发，防御）', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', '');
    expect(store.entry('ch-1')?.text).toBe('');
  });

  test('begin 之前先到的 chunk：占位缓冲（STREAMING_TASK_ID），不丢字符', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.append('ch-1', '早到的流');
    expect(store.entry('ch-1')?.taskId).toBe(STREAMING_TASK_ID);
    expect(store.entry('ch-1')?.text).toBe('早到的流');
  });
});

// ============================================================================
// 缓冲存储：截断策略（截头保尾）
// ============================================================================

describe('createTaskOutputStore：截断策略', () => {
  test('超过上限截头保尾，truncated 标记', () => {
    const store = createTaskOutputStore({ cap: 10, now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', '0123456789'); // 恰好等于上限：不截
    expect(store.entry('ch-1')?.text).toBe('0123456789');
    expect(store.entry('ch-1')?.truncated).toBe(false);

    store.append('ch-1', 'ABC'); // 超了 3：丢头 3 保尾 10
    expect(store.entry('ch-1')?.text).toBe('3456789ABC');
    expect(store.entry('ch-1')?.truncated).toBe(true);
  });

  test('单 chunk 就超上限：只留尾部', () => {
    const store = createTaskOutputStore({ cap: 8, now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', 'x'.repeat(20));
    expect(store.entry('ch-1')?.text).toBe('x'.repeat(8));
    expect(store.entry('ch-1')?.truncated).toBe(true);
  });

  test('截断后继续追加：窗口滑动，truncated 持续为真', () => {
    const store = createTaskOutputStore({ cap: 5, now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', 'AAAAA');
    store.append('ch-1', 'B');
    store.append('ch-1', 'C');
    expect(store.entry('ch-1')?.text).toBe('AAABC');
    expect(store.entry('ch-1')?.truncated).toBe(true);
  });

  test('默认上限是契约常量 32k（缺省 cap 生效）', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', 'a'.repeat(MAX_TASK_OUTPUT_BUFFER_CHARS + 7));
    expect(store.entry('ch-1')?.text).toHaveLength(MAX_TASK_OUTPUT_BUFFER_CHARS);
    expect(store.entry('ch-1')?.truncated).toBe(true);
  });
});

// ============================================================================
// 缓冲存储：完成态保留 / 清空时机
// ============================================================================

describe('createTaskOutputStore：完成态保留与清空时机', () => {
  test('任务收尾后缓冲原样保留（面板回看的依据；存储侧没有收尾动作 —— 保留是默认）', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', '执行的全文尾部窗口');
    // （无任何收尾调用）读回仍是原文本
    expect(store.entry('ch-1')?.text).toBe('执行的全文尾部窗口');
    expect(store.entry('ch-1')?.taskId).toBe('task-1');
  });

  test('begin 换 taskId → 清空重开（下次派发的落点）', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', '旧任务的输出');
    store.begin('ch-1', 'task-2');
    expect(store.entry('ch-1')?.text).toBe('');
    expect(store.entry('ch-1')?.taskId).toBe('task-2');
    expect(store.entry('ch-1')?.truncated).toBe(false);
  });

  test('begin 同 taskId（状态重复广播）→ 不清刚收的流', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', '已收的流');
    store.begin('ch-1', 'task-1');
    expect(store.entry('ch-1')?.text).toBe('已收的流');
  });

  test('占位缓冲被 begin 认领：改挂新 taskId，文本不丢', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.append('ch-1', '早到的流');
    store.begin('ch-1', 'task-1');
    expect(store.entry('ch-1')?.taskId).toBe('task-1');
    expect(store.entry('ch-1')?.text).toBe('早到的流');
  });

  test('clear 丢弃缓冲（角色删除等清场）', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', 'x');
    store.clear('ch-1');
    expect(store.entry('ch-1')).toBeNull();
  });
});

// ============================================================================
// 视图模型派生
// ============================================================================

describe('latestTaskFor：取角色最新任务', () => {
  const t1 = task('task-1', { createdAt: 100, status: 'completed', endedAt: 200 });
  const t2 = task('task-2', { createdAt: 300, status: 'queued', startedAt: null });

  test('createdAt 最大者胜；同刻取数组靠后者', () => {
    expect(latestTaskFor([t1, t2], 'ch-1')?.id).toBe('task-2');
    const tieA = task('tie-a', { createdAt: 500 });
    const tieB = task('tie-b', { createdAt: 500 });
    expect(latestTaskFor([tieA, tieB], 'ch-1')?.id).toBe('tie-b');
  });

  test('别的角色 / 空数组 / undefined / 无角色上下文 → null', () => {
    expect(latestTaskFor([t1, t2], 'ch-9')).toBeNull();
    expect(latestTaskFor([], 'ch-1')).toBeNull();
    expect(latestTaskFor(undefined, 'ch-1')).toBeNull();
    expect(latestTaskFor([t1], null)).toBeNull();
  });
});

describe('resolveTaskOutputDisplay：视图模型合成', () => {
  test('无任务 → 隐藏', () => {
    expect(resolveTaskOutputDisplay(null, null).visible).toBe(false);
  });

  test('缓冲命中（taskId 一致）→ 展示流式文本，completed 也保留', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', '流式输出');
    const done = task('task-1', { status: 'completed', output: '摘要', endedAt: 200 });
    const view = resolveTaskOutputDisplay(store.entry('ch-1'), done);
    expect(view).toMatchObject({ visible: true, phase: 'completed', text: '流式输出', truncated: false, fromStream: true });
  });

  test('缓冲命中但流为空 + 终态有摘要 → 回落状态 output（空输出占位文案透出）', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    const done = task('task-1', { status: 'completed', output: '（任务完成，无文本输出）' });
    const view = resolveTaskOutputDisplay(store.entry('ch-1'), done);
    expect(view.text).toBe('（任务完成，无文本输出）');
    expect(view.fromStream).toBe(false);
  });

  test('缓冲未命中（守门失败从未 running）→ 终态回落 output（失败原因透出）', () => {
    const failed = task('task-g', { status: 'failed', output: '该 CLI 未安装，任务无法执行', startedAt: null, endedAt: 300 });
    const view = resolveTaskOutputDisplay(null, failed);
    expect(view).toMatchObject({ visible: true, phase: 'failed', text: '该 CLI 未安装，任务无法执行', fromStream: false });
  });

  test('缓冲未命中 + 在办（新派 queued / running 未 begin）→ 空文本（面板出占位）', () => {
    const queued = task('task-2', { status: 'queued', startedAt: null });
    expect(resolveTaskOutputDisplay(null, queued).text).toBe('');
    const running = task('task-3', {});
    expect(resolveTaskOutputDisplay(null, running).text).toBe('');
  });

  test('缓冲属于旧任务（latest 换代）→ 按新任务展示（终态回落摘要，在办为空）', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', '旧任务流');
    const newer = task('task-2', { createdAt: 999, status: 'queued', startedAt: null });
    const view = resolveTaskOutputDisplay(store.entry('ch-1'), newer);
    expect(view.taskId).toBe('task-2');
    expect(view.text).toBe('');
  });
});

describe('resolveTaskOutputDisplay：artifactsBlock 附尾（task_048）', () => {
  const BLOCK = ['📂 2 个文件 · +42/-8 行', '- src/a.ts（+30/-2）', '- src/b.ts（+12/-6）'].join('\n');

  test('流式文本在场 → 换行附块（完成态可回看成果物摘要）', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', '流式输出');
    const done = task('task-1', { status: 'completed', output: '摘要', endedAt: 200 });
    const view = resolveTaskOutputDisplay(store.entry('ch-1'), done, BLOCK);
    expect(view.text).toBe(`流式输出\n${BLOCK}`);
    expect(view.fromStream).toBe(true); // 块不改回落语义
  });

  test('块在场但文本为空（回落占位被块替换的极端形状）→ 块直接作正文', () => {
    const failed = task('task-g', { status: 'failed', output: '', startedAt: null, endedAt: 300 });
    expect(resolveTaskOutputDisplay(null, failed, BLOCK).text).toBe(BLOCK);
  });

  test('空块（默认参数 / 空串）→ 行为与 task_046 完全一致（格式不变兜底）', () => {
    const store = createTaskOutputStore({ now: () => 1 });
    store.begin('ch-1', 'task-1');
    store.append('ch-1', '流式输出');
    const done = task('task-1', { status: 'completed', output: '摘要', endedAt: 200 });
    const view = resolveTaskOutputDisplay(store.entry('ch-1'), done, '');
    expect(view.text).toBe('流式输出');
    expect(resolveTaskOutputDisplay(store.entry('ch-1'), done).text).toBe('流式输出');
  });

  test('隐藏态（无任务）不受块影响', () => {
    expect(resolveTaskOutputDisplay(null, null, BLOCK).visible).toBe(false);
  });
});

describe('TASK_PHASE_LABELS：相位词表完整', () => {
  test('四个相位都有文案', () => {
    const statuses: TaskStatus[] = ['queued', 'running', 'completed', 'failed'];
    for (const status of statuses) {
      expect(TASK_PHASE_LABELS[status].length).toBeGreaterThan(0);
    }
  });
});
