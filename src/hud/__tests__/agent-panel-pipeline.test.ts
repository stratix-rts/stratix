/**
 * 集成测试：Agent 侧栏的流水线模式（hud/panels/agent-panel.ts 的 task_051 增量）。
 * 覆盖：模式切换与控件互斥、预设选择、自定义两站（角色下拉 × 模板）、
 *   提交 → pipeline.start 经 adapter 派发、构造失败不发不关表单、
 *   实时 feed 驱动的流水线卡片（站序 + 相位徽标）渲染与卸载退订。
 * @jest-environment jsdom
 *
 * 面板是真组件（真 Shadow DOM、真事件链），替身只有 adapter 两个方法 + 注入的
 * pipeline feed（app 层 pipeline-service.feed 的同构替身 —— 形状一致，行为是
 * 「快照 + 通知」，面板不感知它是谁）。断言打在"派发出了什么命令 / 画出了什么读数"上。
 */

import type { HudCommand, WorldState } from '../../core/types';
import {
  AGENT_PANEL_TAG,
  mountAgentPanel,
  type AgentPanelDeps,
  type StratAgentPanelElement,
} from '../panels/agent-panel';
import type { PipelineCardInput, PipelineFeedInput } from '../panels/pipeline-catalog';

const UNITS: WorldState['units'] = [
  {
    id: 'u-neo',
    name: 'Neo',
    status: 'idle',
    missionId: null,
    power: 72,
    characterId: 'c-1',
  },
];

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: UNITS,
    missions: [],
    selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
    characters: [
      { id: 'c-1', name: '实现者', persona: '', level: 1, experience: 0, agentKind: 'claude-code' },
      { id: 'c-2', name: '评审员', persona: '', level: 1, experience: 0, agentKind: 'kimi' },
    ],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

interface Harness {
  readonly commands: HudCommand[];
  emit(state: WorldState): void;
  /** 推一份新的流水线快照给注入的 feed（走面板订阅的真实通知链）。 */
  pushPipelines(cards: readonly PipelineCardInput[] | null): void;
  unmount(): void;
}

/** pipeline-service.feed 的同构替身：快照 + 订阅通知（面板只认这个形状）。 */
function makeFeedStub(): { feed: PipelineFeedInput; harness: Pick<Harness, 'pushPipelines'> } {
  const listeners = new Set<() => void>();
  let snapshot: readonly PipelineCardInput[] | null = null;
  return {
    feed: {
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      snapshot: () => snapshot,
    },
    harness: {
      pushPipelines: (cards) => {
        snapshot = cards;
        listeners.forEach((listener) => listener());
      },
    },
  };
}

function mountPanel(): { panel: StratAgentPanelElement; host: HTMLElement; harness: Harness } {
  const commands: HudCommand[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const stub = makeFeedStub();
  const deps: AgentPanelDeps = {
    dispatch: (command) => {
      commands.push(command);
    },
    subscribe: (handler) => {
      subs.add(handler);
      return () => {
        subs.delete(handler);
      };
    },
    pipelines: stub.feed,
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountPanel = mountAgentPanel(deps, host);
  const panel = host.querySelector(AGENT_PANEL_TAG) as StratAgentPanelElement;
  if (!panel?.shadowRoot) throw new Error('Agent 侧栏未 upgrade（shadowRoot 为空）');

  return {
    panel,
    host,
    harness: {
      commands,
      emit: (state) => {
        subs.forEach((handler) => handler(state));
      },
      pushPipelines: stub.harness.pushPipelines,
      unmount: () => {
        unmountPanel();
        host.remove();
      },
    },
  };
}

function openForm(panel: StratAgentPanelElement): void {
  const btn = panel.shadowRoot?.querySelector<HTMLButtonElement>('button[data-action="task-open"][data-unit="u-neo"]');
  if (!btn) throw new Error('派任务入口未渲染');
  btn.click();
}

function clickFormAction(panel: StratAgentPanelElement, action: string): void {
  const btn = panel.shadowRoot?.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`);
  if (!btn) throw new Error(`表单按钮未渲染: ${action}`);
  btn.click();
}

const pipelinesHost = (panel: StratAgentPanelElement): HTMLElement | null =>
  (panel.shadowRoot?.querySelector('[data-role="pipelines"]') as HTMLElement | null) ?? null;

let dispose: Array<() => void> = [];

afterEach(() => {
  dispose.forEach((fn) => fn());
  dispose = [];
  document.body.innerHTML = '';
});

describe('流水线模式（task_051）：表单', () => {
  test('模式切换：默认单任务（承接人列表在）；切流水线 → 预设列表出、承接人列表藏', () => {
    const { panel, harness } = mountPanel();
    dispose.push(harness.unmount);
    harness.emit(makeState());
    openForm(panel);

    const assignees = panel.shadowRoot?.querySelector('[data-role="assignee-list"]') as HTMLElement;
    const presets = panel.shadowRoot?.querySelector('[data-role="pipeline-presets"]') as HTMLElement;
    const custom = panel.shadowRoot?.querySelector('[data-role="pipeline-custom"]') as HTMLElement;
    expect(assignees?.hidden).toBe(false);
    expect(presets?.hidden).toBe(true);

    clickFormAction(panel, 'form-mode-pipeline');
    expect(presets?.hidden).toBe(false);
    expect(assignees?.hidden).toBe(true);
    expect(custom?.hidden).toBe(true); // 选了预设（默认第一个），自定义控件还藏着

    clickFormAction(panel, 'form-mode-single');
    expect(presets?.hidden).toBe(true);
    expect(assignees?.hidden).toBe(false);
  });

  test('预设列表：3 个预设 + 自定义两站，选自定义 → 两站控件出（角色下拉带 kind 标签）', () => {
    const { panel, harness } = mountPanel();
    dispose.push(harness.unmount);
    harness.emit(makeState());
    openForm(panel);
    clickFormAction(panel, 'form-mode-pipeline');

    const presets = Array.from(panel.shadowRoot?.querySelectorAll<HTMLButtonElement>('[data-action="pipeline-preset"]') ?? []);
    expect(presets.map((btn) => btn.dataset.preset)).toEqual([
      'impl-review',
      'translate-proofread',
      'analyze-summarize',
      'custom',
    ]);

    const customBtn = presets.find((btn) => btn.dataset.preset === 'custom')!;
    customBtn.click();
    const custom = panel.shadowRoot?.querySelector('[data-role="pipeline-custom"]') as HTMLElement;
    expect(custom?.hidden).toBe(false);
    const selects = Array.from(custom.querySelectorAll<HTMLSelectElement>('[data-role="pipeline-station-character"]'));
    expect(selects).toHaveLength(2);
    // 角色下拉：空占位 + 两个在档角色（名字带 kind 标签 —— agentKindLabel 的渲染面）。
    expect(selects[0].options.length).toBe(3);
    expect(selects[0].options[1].textContent).toContain('实现者');
    expect(selects[0].options[2].textContent).toContain('评审员');
    expect(custom.querySelectorAll('[data-role="pipeline-station-template"]')).toHaveLength(2);
  });

  test('预设提交：pipeline.start 经命令端口发出（规格 = 预设翻译），表单关闭', () => {
    const { panel, harness } = mountPanel();
    dispose.push(harness.unmount);
    harness.emit(makeState());
    openForm(panel);
    clickFormAction(panel, 'form-mode-pipeline');

    const input = panel.shadowRoot?.querySelector('[data-role="task-input"]') as HTMLTextAreaElement;
    input.value = '修复登录页';
    clickFormAction(panel, 'task-submit');

    expect(harness.commands).toHaveLength(1);
    const command = harness.commands[0] as { type: string; spec?: { name: string; steps: unknown[] }; issue: string };
    expect(command.type).toBe('pipeline.start');
    expect(command.spec?.name).toBe('实现+审阅');
    expect(command.spec?.steps).toHaveLength(2);
    expect(command.issue).toBe('修复登录页');
    const form = panel.shadowRoot?.querySelector('[data-role="task-form"]') as HTMLElement;
    expect(form.hidden).toBe(true);
  });

  test('自定义提交：两站 characterId × 模板 → pipeline.start（characterId 型站位）', () => {
    const { panel, harness } = mountPanel();
    dispose.push(harness.unmount);
    harness.emit(makeState());
    openForm(panel);
    clickFormAction(panel, 'form-mode-pipeline');

    (Array.from(panel.shadowRoot?.querySelectorAll<HTMLButtonElement>('[data-action="pipeline-preset"]') ?? []).find(
      (btn) => btn.dataset.preset === 'custom'
    ) as HTMLButtonElement).click();
    const custom = panel.shadowRoot?.querySelector('[data-role="pipeline-custom"]') as HTMLElement;
    const selects = Array.from(custom.querySelectorAll<HTMLSelectElement>('[data-role="pipeline-station-character"]'));
    const templates = Array.from(custom.querySelectorAll<HTMLTextAreaElement>('[data-role="pipeline-station-template"]'));
    selects[0].value = 'c-1';
    selects[1].value = 'c-2';
    templates[0].value = '做 {{task}}';
    templates[1].value = '审 {{prev_output}}';
    const input = panel.shadowRoot?.querySelector('[data-role="task-input"]') as HTMLTextAreaElement;
    input.value = '议题X';

    clickFormAction(panel, 'task-submit');
    const command = harness.commands[0] as {
      spec?: { steps: Array<{ characterId?: string; promptTemplate: string }> };
    };
    expect(command.spec?.steps).toEqual([
      { characterId: 'c-1', promptTemplate: '做 {{task}}' },
      { characterId: 'c-2', promptTemplate: '审 {{prev_output}}' },
    ]);
  });

  test('构造失败不发不关表单：空议题（预设模式下直接提交）', () => {
    const { panel, harness } = mountPanel();
    dispose.push(harness.unmount);
    harness.emit(makeState());
    openForm(panel);
    clickFormAction(panel, 'form-mode-pipeline');

    clickFormAction(panel, 'task-submit');
    expect(harness.commands).toHaveLength(0);
    const form = panel.shadowRoot?.querySelector('[data-role="task-form"]') as HTMLElement;
    expect(form.hidden).toBe(false);
  });
});

describe('流水线模式（task_051）：实时卡片', () => {
  test('无 feed 快照 → 容器隐藏；推送 → 卡片渲染站序与相位徽标；空快照再收起', () => {
    const { panel, harness } = mountPanel();
    dispose.push(harness.unmount);
    harness.emit(makeState());

    expect(pipelinesHost(panel)?.hidden).toBe(true);

    harness.pushPipelines([
      {
        id: 'pipeline_1',
        name: '实现+审阅',
        issue: '修复登录页',
        status: 'running',
        steps: [
          { characterId: 'c-1', characterName: '实现者', phase: 'completed', prompt: 'a', taskId: 't1' },
          { characterId: 'c-2', characterName: '评审员', phase: 'running', prompt: 'b', taskId: 't2' },
        ],
      },
    ]);
    const host = pipelinesHost(panel);
    expect(host?.hidden).toBe(false);
    expect(host?.textContent).toContain('实现+审阅');
    expect(host?.textContent).toContain('实现者');
    expect(host?.textContent).toContain('完成');
    expect(host?.textContent).toContain('在办');
    expect(host?.textContent).toContain('跑站中');

    // 相位迁移：站 2 完成 → 整线 completed（feed 通知重画）。
    harness.pushPipelines([
      {
        id: 'pipeline_1',
        name: '实现+审阅',
        issue: '修复登录页',
        status: 'completed',
        steps: [
          { characterId: 'c-1', characterName: '实现者', phase: 'completed', prompt: 'a', taskId: 't1' },
          { characterId: 'c-2', characterName: '评审员', phase: 'completed', prompt: 'b', taskId: 't2' },
        ],
      },
    ]);
    expect(host?.textContent).toContain('已完成');
    expect(host?.textContent).not.toContain('在办');

    harness.pushPipelines(null);
    expect(pipelinesHost(panel)?.hidden).toBe(true);
  });

  test('跳过站没角色名 → 「第 N 站」占位（断链读数可见）', () => {
    const { panel, harness } = mountPanel();
    dispose.push(harness.unmount);
    harness.emit(makeState());

    harness.pushPipelines([
      {
        id: 'pipeline_2',
        name: '三站线',
        issue: '议题',
        status: 'failed',
        steps: [
          { characterId: 'c-1', characterName: '实现者', phase: 'completed', prompt: 'a', taskId: 't1' },
          { characterId: null, characterName: null, phase: 'skipped', prompt: '', taskId: null },
          { characterId: null, characterName: null, phase: 'skipped', prompt: '', taskId: null },
        ],
      },
    ]);
    const host = pipelinesHost(panel);
    expect(host?.textContent).toContain('第 2 站');
    expect(host?.textContent).toContain('第 3 站');
    expect(host?.textContent).toContain('跳过');
    expect(host?.textContent).toContain('已失败');
  });

  test('卸载后退订 feed（不泄漏：推送不再有订阅者）', () => {
    const { panel, harness } = mountPanel();
    harness.emit(makeState());
    harness.pushPipelines([]);
    harness.unmount();
    // 卸载后再推不炸（订阅已清 —— 通知链里没有面板回调了）。
    expect(() => harness.pushPipelines(null)).not.toThrow();
    expect(panel.isConnected).toBe(false);
  });
});
