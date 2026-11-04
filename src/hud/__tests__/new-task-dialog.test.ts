/**
 * 集成测试：新建任务对话框（hud/components/new-task-dialog/new-task-dialog.ts，task_112）。
 * jsdom：开合语义（open 属性 / aria）、四按钮组渲染、四个动作各自的命令口径与 toast、
 *        core Notice → toast 的反馈链、遮挡登记与资源清理。
 * @jest-environment jsdom
 */

import type { HudCommand, Notice, WorldState } from '../../core/types';
import { createOcclusionController, type OcclusionController } from '../layers/occlusion';
import type { ToastTone } from '../components/toast/toast-host';
import {
  mountNewTaskDialog,
  NEW_TASK_DIALOG_TAG,
  NEW_TASK_SUBMITTED_EVENT,
  type StratNewTaskDialogElement,
} from '../components/new-task-dialog/new-task-dialog';

// ============================================================================
// 夹具
// ============================================================================

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: [{ id: 'u1', name: 'Neo', status: 'idle', missionId: null, power: 3 }],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

function makeNotice(id: string, text: string, level: Notice['level'] = 'info'): Notice {
  return { id, level, text, createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
}

interface Harness {
  readonly element: StratNewTaskDialogElement;
  readonly commands: HudCommand[];
  readonly toasts: Array<{ text: string; tone?: ToastTone }>;
  readonly occlusion: OcclusionController;
  /** 「去新建角色」出口被点了几次（死按钮治理的出口断言）。 */
  readonly createCharacterCalls: number;
  /** 推一次状态广播（模拟 core 广播）。 */
  push(state: WorldState): void;
  /** 组件是否已退订总线（资源清理断言）。 */
  unsubscribed(): boolean;
  unmount(): void;
}

function mount(state: WorldState = makeState()): Harness {
  const commands: HudCommand[] = [];
  const toasts: Array<{ text: string; tone?: ToastTone }> = [];
  let unsubscribed = false;
  let createCharacterCalls = 0;
  let handler: ((s: WorldState) => void) | null = null;

  // 真实遮挡控制器（不造桩）：断言的是「全屏弹窗真的进了模态栈」。
  const occlusion = createOcclusionController({ document });

  const container = document.createElement('div');
  document.body.appendChild(container);

  const { element, unmount } = mountNewTaskDialog(
    {
      dispatch: (command: HudCommand): void => { commands.push(command); },
      subscribe: (h: (s: WorldState) => void): (() => void) => {
        handler = h;
        h(state);
        return (): void => { unsubscribed = true; handler = null; };
      },
      notify: (text: string, tone?: ToastTone): void => { toasts.push({ text, tone }); },
      occlusion,
      onCreateCharacter: (): void => { createCharacterCalls += 1; },
    },
    container
  );

  return {
    element,
    commands,
    toasts,
    occlusion,
    get createCharacterCalls(): number { return createCharacterCalls; },
    push: (s: WorldState): void => { handler?.(s); },
    unsubscribed: (): boolean => unsubscribed,
    unmount: (): void => { unmount(); occlusion.destroy(); container.remove(); },
  };
}

/** 点一个动作按钮（走真实点击路径：shadow 内真 button）。 */
function clickAction(el: StratNewTaskDialogElement, action: string): void {
  const btn = el.shadowRoot?.querySelector<HTMLButtonElement>(`button.option[data-action="${action}"]`);
  if (!btn) throw new Error(`动作按钮不存在：${action}`);
  btn.click();
}

function actionLabels(el: StratNewTaskDialogElement): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('button.option .opt-title') ?? []).map(
    (n) => n.textContent ?? ''
  );
}

// ============================================================================
// 开合语义
// ============================================================================

describe('开合语义', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('默认关闭：无 open 属性、aria-hidden=true、role=dialog', () => {
    const h = mount();
    expect(h.element.opened).toBe(false);
    expect(h.element.hasAttribute('open')).toBe(false);
    expect(h.element.getAttribute('aria-hidden')).toBe('true');
    expect(h.element.getAttribute('role')).toBe('dialog');
    h.unmount();
  });

  test('open / close：opened 与 open 属性同步', () => {
    const h = mount();
    h.element.open({ title: '去侦察' });
    expect(h.element.opened).toBe(true);
    expect(h.element.hasAttribute('open')).toBe(true);
    expect(h.element.getAttribute('aria-hidden')).toBe('false');
    expect(h.element.getAttribute('aria-modal')).toBe('true');

    h.element.close();
    expect(h.element.opened).toBe(false);
    expect(h.element.hasAttribute('open')).toBe(false);
    h.unmount();
  });

  test('空标题不打开，并给出 warn 提示（不静默失败）', () => {
    const h = mount();
    h.element.open({ title: '   ' });
    expect(h.element.opened).toBe(false);
    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0]?.tone).toBe('warn');
    expect(h.toasts[0]?.text).toContain('任务标题');
    h.unmount();
  });

  test('遮挡控制器：打开进模态栈、关闭出栈（R1 全屏弹窗 = 模态）', () => {
    const h = mount();
    h.element.open({ title: '去侦察' });
    expect(h.occlusion.state.modals).toContain('new-task-dialog');
    expect(h.occlusion.state.activeModal).toBe('new-task-dialog');
    h.element.close();
    expect(h.occlusion.state.modals).not.toContain('new-task-dialog');
    h.unmount();
  });

  test('ESC（closeTopModal）→ 对话框关闭（R4 的第一条关闭途径）', () => {
    const h = mount();
    h.element.open({ title: '去侦察' });
    expect(h.occlusion.closeTopModal()).toBe(true);
    expect(h.element.opened).toBe(false);
    h.unmount();
  });

  test('卸载时退订总线（资源清理，perf 硬约束）', () => {
    const h = mount();
    h.unmount();
    expect(h.unsubscribed()).toBe(true);
  });
});

// ============================================================================
// 四按钮组
// ============================================================================

describe('四按钮组', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('单任务 / 流水线 / 派发 / 去新建角色 / 取消 各有一个按钮（0 角色时多一个出口）', () => {
    const h = mount();
    h.element.open({ title: '去侦察' });
    expect(actionLabels(h.element)).toEqual(['单任务', '流水线', '派发', '去新建角色', '取消']);
    h.unmount();
  });

  test('有候选角色时按钮组是四个（不出现多余的出口）', () => {
    const state = makeState({
      characters: [
        { id: 'c1', name: '小虎', persona: '执行', level: 1, experience: 0, agentKind: 'claude-code' },
      ],
    });
    const h = mount(state);
    h.element.open({ title: '去侦察' });
    expect(actionLabels(h.element)).toEqual(['单任务', '流水线', '派发', '取消']);
    h.unmount();
  });

  test('副标题回显任务标题', () => {
    const h = mount();
    h.element.open({ title: '去侦察' });
    const subject = h.element.shadowRoot?.querySelector('[data-role="subject"]');
    expect(subject?.textContent).toContain('去侦察');
    h.unmount();
  });

  test('标题里的尖括号被转义（不进 innerHTML 当标签解析）', () => {
    const h = mount();
    h.element.open({ title: '<img src=x>' });
    expect(h.element.shadowRoot?.querySelector('img')).toBeNull();
    expect(h.element.shadowRoot?.querySelector('[data-role="subject"]')?.textContent).toContain('<img src=x>');
    h.unmount();
  });
});

// ============================================================================
// 四个动作
// ============================================================================

describe('动作口径', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('单任务（无选中单位）→ mission.create 待指派草稿 + 关闭 + 提交事件', () => {
    const h = mount();
    const submitted: string[] = [];
    document.addEventListener(NEW_TASK_SUBMITTED_EVENT, (e) => {
      submitted.push((e as CustomEvent<{ title?: string }>).detail?.title ?? '');
    });

    h.element.open({ title: '去侦察' });
    clickAction(h.element, 'single');

    expect(h.commands).toContainEqual({ type: 'mission.create', title: '去侦察', unitIds: [] });
    expect(h.element.opened).toBe(false);
    expect(submitted).toEqual(['去侦察']);
    h.unmount();
  });

  test('单任务（有选中单位）→ mission.create 带指派对象', () => {
    const state = makeState({
      selection: { unitIds: ['u1'], previewUnitIds: [], revision: 1 },
    });
    const h = mount(state);
    h.element.open({ title: '去侦察' });
    clickAction(h.element, 'single');
    expect(h.commands).toContainEqual({ type: 'mission.create', title: '去侦察', unitIds: ['u1'] });
    h.unmount();
  });

  test('流水线 → pipeline.start + success 提示', () => {
    const h = mount();
    h.element.open({ title: '走查验收' });
    clickAction(h.element, 'pipeline');
    expect(h.commands.some((c) => c.type === 'pipeline.start')).toBe(true);
    expect(h.toasts.some((t) => t.tone === 'success')).toBe(true);
    expect(h.element.opened).toBe(false);
    h.unmount();
  });

  test('派发（无候选角色）→ 按钮禁用 + 写明原因 + 不发半截命令，对话框留着', () => {
    const h = mount();
    h.element.open({ title: '走查验收' });
    const btn = h.element.shadowRoot?.querySelector<HTMLButtonElement>(
      'button.option[data-action="dispatch"]'
    );
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute('aria-disabled')).toBe('true');
    expect(btn?.textContent).toContain('当前没有可派发的角色');

    clickAction(h.element, 'dispatch');
    expect(h.commands).toHaveLength(0);
    expect(h.element.opened).toBe(true);
    h.unmount();
  });

  test('派发（有候选角色）→ task.assign + 关闭', () => {
    const state = makeState({
      characters: [
        {
          id: 'c1',
          name: '小虎',
          persona: '执行',
          level: 1,
          experience: 0,
          agentKind: 'claude-code',
        },
      ],
    });
    const h = mount(state);
    h.element.open({ title: '走查验收' });
    clickAction(h.element, 'dispatch');
    expect(h.commands).toContainEqual({ type: 'task.assign', characterId: 'c1', prompt: '走查验收' });
    expect(h.element.opened).toBe(false);
    h.unmount();
  });

  test('取消 → 关闭 + info 提示，不发任何命令', () => {
    const h = mount();
    h.element.open({ title: '走查验收' });
    clickAction(h.element, 'cancel');
    expect(h.commands).toHaveLength(0);
    expect(h.element.opened).toBe(false);
    expect(h.toasts.some((t) => t.text.includes('取消'))).toBe(true);
    h.unmount();
  });

  // —— 死按钮治理（@since v3.9，task_148）——
  test('死按钮出口：点「去新建角色」→ 关对话框 + 走建档向导（不发命令）', () => {
    const h = mount();
    h.element.open({ title: '走查验收' });
    clickAction(h.element, 'create-character');
    expect(h.createCharacterCalls).toBe(1);
    expect(h.element.opened).toBe(false);
    expect(h.commands).toHaveLength(0);
    h.unmount();
  });

  test('死按钮出口：对话框关闭后不再占模态栈（向导不会被压在下面）', () => {
    const h = mount();
    h.element.open({ title: '走查验收' });
    clickAction(h.element, 'create-character');
    expect(h.occlusion.state.modals).not.toContain('new-task-dialog');
    h.unmount();
  });
});

// ============================================================================
// core Notice → toast（反馈链）
// ============================================================================

describe('反馈链：core 的 Notice 进 toast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('动作发出后 core 的新通知 → toast（文案与语气按 notice 走）', () => {
    const h = mount();
    h.element.open({ title: '去侦察' });
    clickAction(h.element, 'single');

    h.push(makeState({ notices: [makeNotice('n1', '已新建任务「去侦察」，待指派')] }));

    expect(h.toasts.some((t) => t.text.includes('已新建任务'))).toBe(true);
    h.unmount();
  });

  test('error 级通知 → danger 语气', () => {
    const h = mount();
    h.element.open({ title: '去侦察' });
    h.push(makeState({ notices: [makeNotice('n-err', '任务创建失败', 'error')] }));
    const toast = h.toasts.find((t) => t.text.includes('失败'));
    expect(toast?.tone).toBe('danger');
    h.unmount();
  });

  test('同一条通知只提示一次（不重复刷屏）', () => {
    const h = mount();
    h.element.open({ title: '去侦察' });
    const state = makeState({ notices: [makeNotice('n1', '已新建任务「去侦察」，待指派')] });
    h.push(state);
    h.push(state);
    expect(h.toasts.filter((t) => t.text.includes('已新建任务'))).toHaveLength(1);
    h.unmount();
  });

  test('反馈窗口外的新通知不抢戏（静默，不打断其他面板）', () => {
    const h = mount();
    h.element.open({ title: '去侦察' });
    // 窗口从 open 起算 8s —— 用 fake timers 把它推到窗口外。
    jest.useFakeTimers();
    try {
      jest.advanceTimersByTime(9_000);
      h.push(makeState({ notices: [makeNotice('n-late', '窗口外的通知')] }));
    } finally {
      jest.useRealTimers();
    }
    expect(h.toasts.some((t) => t.text.includes('窗口外'))).toBe(false);
    h.unmount();
  });
});

// ============================================================================
// 渲染节流（perf：广播很频繁）
// ============================================================================

describe('渲染节流', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('读数没变的状态广播不重画选项区（签名判重）', () => {
    const h = mount();
    h.element.open({ title: '去侦察' });
    const options = h.element.shadowRoot?.querySelector('[data-role="options"]');
    h.push(makeState());
    expect(h.element.shadowRoot?.querySelector('[data-role="options"]')).toBe(options);
    h.unmount();
  });
});

// ============================================================================
// 挂载工厂
// ============================================================================

describe('挂载工厂', () => {
  test('mountNewTaskDialog：元素挂进宿主、tag 正确、unmount 移除', () => {
    document.body.innerHTML = '';
    const container = document.createElement('div');
    document.body.appendChild(container);
    const { element, unmount } = mountNewTaskDialog(
      {
        dispatch: (): void => undefined,
        subscribe: (): (() => void) => (): void => undefined,
      },
      container
    );
    expect(element.tagName.toLowerCase()).toBe(NEW_TASK_DIALOG_TAG);
    expect(container.contains(element)).toBe(true);
    unmount();
    expect(container.contains(element)).toBe(false);
  });
});
