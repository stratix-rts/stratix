/**
 * 集成测试：任务实时输出面板（hud/components/task-output/task-output-panel.ts，task_046）。
 * 覆盖组件层的规格点：
 *   1. 可见性：无角色上下文 / 无任务隐藏；running（busy 单位点开抽屉的既有语义）自动展开；
 *   2. 实时流：appendTaskOutput 原序渲染、不串上下文、XSS 零面（textContent 直写）；
 *   3. 跟随：默认跟随滚底；「暂停跟随」期间缓冲照收不丢数据，恢复即追平；
 *   4. 完成态保留：completed 后徽标换代、文本保留可回看；
 *   5. 清空重开：同角色下一次派发开工 → 缓冲清空、跟随复位；
 *   6. 折叠交互与卸载退订。
 * 相位真相走注入的 subscribe（模拟 core 广播），流文本走 appendTaskOutput 端口 ——
 * 与生产装配（chat-drawer 转发 subscribe + main-entry 接 onTaskChunk）同一调用面。
 * @jest-environment jsdom
 */

import type { CharacterTask, WorldState } from '../../core/types';
import {
  mountTaskOutputPanel,
  TASK_OUTPUT_PANEL_TAG,
  type StratTaskOutputPanelElement,
} from '../components/task-output/task-output-panel';

// ============================================================================
// 夹具
// ============================================================================

function task(id: string, patch: Partial<CharacterTask> = {}): CharacterTask {
  return {
    id,
    characterId: 'ch-1',
    prompt: '写点什么',
    status: 'running',
    createdAt: 100,
    startedAt: 100,
    endedAt: null,
    output: '',
    ...patch,
  };
}

function makeState(tasks: CharacterTask[]): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    tasks,
  };
}

interface Harness {
  readonly panel: StratTaskOutputPanelElement;
  /** 模拟 core 广播一份新状态（走组件订阅的真实链路）。 */
  emit(state: WorldState): void;
  subscriberCount(): number;
  unmount(): void;
}

function mountPanel(): Harness {
  const subs = new Set<(state: WorldState) => void>();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmount = mountTaskOutputPanel(
    {
      subscribe: (handler) => {
        subs.add(handler);
        return () => { subs.delete(handler); };
      },
    },
    host
  );
  const panel = host.querySelector(TASK_OUTPUT_PANEL_TAG) as StratTaskOutputPanelElement;
  if (!panel?.shadowRoot) throw new Error('任务输出面板未 upgrade（shadowRoot 为空）');
  return {
    panel,
    emit: (state) => subs.forEach((h) => h(state)),
    subscriberCount: () => subs.size,
    unmount: () => {
      unmount();
      host.remove();
    },
  };
}

/** 面板 Shadow DOM 里的按钮/区域取用。 */
function part(panel: StratTaskOutputPanelElement, role: string): HTMLElement | null {
  return panel.shadowRoot?.querySelector(`[data-role="${role}"]`) ?? null;
}

function click(panel: StratTaskOutputPanelElement, role: string): void {
  const node = part(panel, role);
  if (!node) throw new Error(`面板里没有 data-role="${role}"`);
  node.click();
}

// ============================================================================
// 可见性与默认展开
// ============================================================================

describe('组件：可见性与默认展开', () => {
  test('无角色上下文 / 无任务 → 整段隐藏', () => {
    const h = mountPanel();
    expect(h.panel.visible).toBe(false);
    h.panel.showFor('ch-1');
    h.emit(makeState([])); // 角色没有任务
    expect(h.panel.visible).toBe(false);
    h.unmount();
  });

  test('running 任务 + showFor → 可见、默认展开、徽标「执行中」、占位等待输出', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    expect(h.panel.visible).toBe(true);
    expect(h.panel.expanded).toBe(true); // 需求①：默认展开当 running
    expect(h.panel.taskStatus).toBe('running');
    expect(part(h.panel, 'phase')?.textContent).toBe('执行中');
    expect(part(h.panel, 'output')?.textContent).toBe('等待输出…');
    h.unmount();
  });

  test('冷开在终态任务上（completed）→ 可见但不强展开（回看是用户动作）', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1', { status: 'completed', endedAt: 200, output: '摘要' })]));
    h.panel.showFor('ch-1');
    expect(h.panel.visible).toBe(true);
    expect(h.panel.expanded).toBe(false);
    expect(h.panel.taskStatus).toBe('completed');
    h.unmount();
  });

  test('showFor(null) → 隐藏（清上下文）', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    expect(h.panel.visible).toBe(true);
    h.panel.showFor(null);
    expect(h.panel.visible).toBe(false);
    h.unmount();
  });
});

// ============================================================================
// 实时流
// ============================================================================

describe('组件：实时流渲染', () => {
  test('chunk 原序渲染到输出区', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    h.panel.appendTaskOutput('ch-1', '第一行\n');
    h.panel.appendTaskOutput('ch-1', '第二行');
    expect(h.panel.outputText).toBe('第一行\n第二行');
    expect(part(h.panel, 'output')?.textContent).toBe('第一行\n第二行');
    h.unmount();
  });

  test('别的角色的 chunk 不进当前视图（缓冲各收各的）', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1'), task('task-9', { characterId: 'ch-2', createdAt: 50 })]));
    h.panel.showFor('ch-1');
    h.panel.appendTaskOutput('ch-2', '乙的流');
    expect(h.panel.outputText).toBe('');
    // 上下文切过去能看见（缓冲一直在收）
    h.panel.showFor('ch-2');
    expect(h.panel.outputText).toBe('乙的流');
    h.unmount();
  });

  test('CLI 输出是外部输入：textContent 直写，无 XSS 面', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    h.panel.appendTaskOutput('ch-1', '<img src=x onerror=alert(1)>');
    expect(part(h.panel, 'output')?.querySelector('img')).toBeNull();
    expect(h.panel.outputText).toBe('<img src=x onerror=alert(1)>');
    h.unmount();
  });
});

// ============================================================================
// 跟随（auto-scroll）与暂停
// ============================================================================

describe('组件：跟随与暂停（不丢数据 + 追平）', () => {
  test('默认跟随；流式更新触发滚底', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    expect(h.panel.following).toBe(true);
    const before = h.panel.scrollSyncs;
    h.panel.appendTaskOutput('ch-1', 'x');
    expect(h.panel.scrollSyncs).toBe(before + 1); // 跟随中：文本变更即滚底
    h.unmount();
  });

  test('暂停跟随：缓冲照收照更（不丢数据）、不滚；恢复即追平', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    h.panel.appendTaskOutput('ch-1', '头部');
    click(h.panel, 'follow'); // 「暂停跟随」
    expect(h.panel.following).toBe(false);
    expect(part(h.panel, 'follow')?.textContent).toBe('恢复跟随');

    const frozen = h.panel.scrollSyncs;
    h.panel.appendTaskOutput('ch-1', '暂停期间照收的尾段');
    // 数据没丢：缓冲与 DOM 都在长，只是不滚
    expect(h.panel.outputText).toBe('头部暂停期间照收的尾段');
    expect(part(h.panel, 'output')?.textContent).toContain('暂停期间照收的尾段');
    expect(h.panel.scrollSyncs).toBe(frozen);

    click(h.panel, 'follow'); // 「恢复跟随」→ 立即追平一次
    expect(h.panel.following).toBe(true);
    expect(h.panel.scrollSyncs).toBe(frozen + 1);
    h.unmount();
  });

  test('点头部（非跟随钮）折叠/展开；展开时在跟随则滚到当前尾部', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    h.panel.appendTaskOutput('ch-1', '内容');
    click(h.panel, 'toggle'); // 折叠
    expect(h.panel.expanded).toBe(false);
    expect(part(h.panel, 'root')?.getAttribute('data-expanded')).toBe('false');

    const frozen = h.panel.scrollSyncs;
    h.panel.appendTaskOutput('ch-1', '折叠期间的流'); // 仍收仍更，但折叠态不滚
    expect(h.panel.outputText).toContain('折叠期间的流');
    expect(h.panel.scrollSyncs).toBe(frozen);

    click(h.panel, 'toggle'); // 展开 → 追平
    expect(h.panel.expanded).toBe(true);
    expect(h.panel.scrollSyncs).toBe(frozen + 1);
    h.unmount();
  });
});

// ============================================================================
// 完成态保留 / 清空重开
// ============================================================================

describe('组件：完成态保留与清空重开', () => {
  test('任务完成：徽标「已完成」、流式文本保留（可回看）、不自动收起', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    h.panel.appendTaskOutput('ch-1', '执行的输出全文');
    h.emit(makeState([task('task-1', { status: 'completed', endedAt: 300, output: '摘要…' })]));
    expect(h.panel.taskStatus).toBe('completed');
    expect(part(h.panel, 'phase')?.textContent).toBe('已完成');
    expect(h.panel.outputText).toBe('执行的输出全文'); // 保留（与 📋 报告同一回看口径）
    expect(h.panel.expanded).toBe(true); // 用户在看，不自动收起
    h.unmount();
  });

  test('任务失败（执行中断流）：徽标「失败」、已有流保留', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    h.panel.appendTaskOutput('ch-1', '跑到一半的输出');
    h.emit(makeState([task('task-1', { status: 'failed', endedAt: 300, output: '执行超时：…' })]));
    expect(part(h.panel, 'phase')?.textContent).toBe('失败');
    expect(h.panel.outputText).toBe('跑到一半的输出');
    h.unmount();
  });

  test('守门失败的任务（从未 running、无缓冲）→ 失败徽标 + 状态里的原因透出', () => {
    const h = mountPanel();
    h.emit(makeState([
      task('task-g', { status: 'failed', startedAt: null, endedAt: 300, output: '该 CLI 未安装，任务无法执行' }),
    ]));
    h.panel.showFor('ch-1');
    expect(h.panel.taskStatus).toBe('failed');
    expect(h.panel.outputText).toBe('该 CLI 未安装，任务无法执行');
    h.unmount();
  });

  test('下次派发开工（新 taskId running）→ 清空重开、跟随复位', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    h.panel.appendTaskOutput('ch-1', '旧任务输出');
    h.emit(makeState([task('task-1', { status: 'completed', endedAt: 300, output: '摘要' })]));
    click(h.panel, 'follow'); // 用户曾暂停跟随

    // 新任务开工（状态里出现 running 的 task-2 —— 对账 begin 清空）
    h.emit(makeState([
      task('task-1', { status: 'completed', endedAt: 300, output: '摘要' }),
      task('task-2', { createdAt: 900 }),
    ]));
    expect(h.panel.outputText).toBe(''); // 清空重开（占位由渲染层出）
    expect(part(h.panel, 'output')?.textContent).toBe('等待输出…');
    expect(h.panel.taskStatus).toBe('running');
    expect(h.panel.expanded).toBe(true); // 新执行重新展开
    expect(h.panel.following).toBe(true); // 跟随复位
    h.panel.appendTaskOutput('ch-1', '新流');
    expect(h.panel.outputText).toBe('新流');
    h.unmount();
  });

  test('同一任务的重复状态广播不清流（begin 幂等对账）', () => {
    const h = mountPanel();
    h.emit(makeState([task('task-1')]));
    h.panel.showFor('ch-1');
    h.panel.appendTaskOutput('ch-1', '已收的流');
    h.emit(makeState([task('task-1')])); // 同 taskId 再广播
    expect(h.panel.outputText).toBe('已收的流');
    h.unmount();
  });
});

// ============================================================================
// 生命周期
// ============================================================================

describe('组件：卸载退订', () => {
  test('反复挂卸不累积监听器', () => {
    const h = mountPanel();
    expect(h.subscriberCount()).toBe(1);
    h.unmount();
    expect(h.subscriberCount()).toBe(0);
    const h2 = mountPanel();
    expect(h2.subscriberCount()).toBe(1);
    h2.unmount();
  });
});
