/**
 * 集成测试：里程碑大字 overlay（hud/components/marquee/milestone.ts，task_080）。
 * 覆盖：每 10 个完成任务触发一次大字 + 一记 camera shake 命令、大字 1.5s 后自动收、
 *       演示模式强制开启（关闭时只计数不出字）。
 * @jest-environment jsdom
 */

import { MARQUEE_METRICS } from '../../core/theme/visual-spec';
import type { HudCommand } from '../../core/types';
import {
  MILESTONE_ENABLED_KEY,
  mountMilestone,
  type StratMilestoneElement,
} from '../components/marquee/milestone';

let host: HTMLElement;
let element: StratMilestoneElement;
let unmount: () => void;
let commands: HudCommand[];

function mount(remembered: Record<string, string> = {}): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  commands = [];
  const data = { ...remembered };
  const mounted = mountMilestone(host, {
    dispatch: (command) => { commands.push(command); },
    storage: () => ({
      getItem: (key: string) => (key in data ? data[key] : null),
    }),
  });
  element = mounted.element;
  unmount = mounted.unmount;
}

/** 影子 DOM 里的大字节点。 */
function bigNode(): HTMLElement | null {
  return element.shadowRoot?.querySelector('[data-role="big"]') ?? null;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  unmount?.();
  host?.remove();
  jest.useRealTimers();
});

describe('里程碑大字：触发条件', () => {
  test('前 9 次完成不出大字', () => {
    mount();
    for (let i = 0; i < 9; i += 1) {
      expect(element.noteCompleted()).toBeNull();
    }
    expect(element.completedCount).toBe(9);
    expect(element.showing).toBe(false);
    expect(commands).toHaveLength(0);
  });

  test('第 10 次完成触发大字，并甩出一记 camera.shake 命令', () => {
    mount();
    for (let i = 0; i < 9; i += 1) element.noteCompleted();

    expect(element.noteCompleted()).toBe(10);
    expect(element.showing).toBe(true);
    expect(element.text).toBe('第 10 个任务完成！');
    expect(commands).toEqual([
      {
        type: 'camera.shake',
        durationMs: MARQUEE_METRICS.shakeDurationMs,
        intensity: MARQUEE_METRICS.shakeIntensity,
      },
    ]);
  });

  test('第 20 次再触发一次（每 10 个一轮）', () => {
    mount();
    let hit: number | null = null;
    for (let i = 0; i < 20; i += 1) {
      const result = element.noteCompleted();
      if (result !== null) hit = result;
    }
    expect(hit).toBe(20);
    expect(commands).toHaveLength(2);
  });
});

describe('里程碑大字：停留与收起', () => {
  test('1.5s 后自动收起（文案清空、show 类摘掉）', () => {
    mount();
    for (let i = 0; i < 10; i += 1) element.noteCompleted();
    expect(element.showing).toBe(true);

    jest.advanceTimersByTime(MARQUEE_METRICS.milestoneDurationMs);

    expect(element.showing).toBe(false);
    expect(element.text).toBe('');
  });

  test('收起前不会提前消失', () => {
    mount();
    for (let i = 0; i < 10; i += 1) element.noteCompleted();
    jest.advanceTimersByTime(MARQUEE_METRICS.milestoneDurationMs - 1);
    expect(element.showing).toBe(true);
  });
});

describe('里程碑大字：演示模式强制开启', () => {
  test('本地记忆为 off 时只计数不出字、不发震动', () => {
    mount({ [MILESTONE_ENABLED_KEY]: 'off' });
    for (let i = 0; i < 10; i += 1) element.noteCompleted();

    expect(element.completedCount).toBe(10);
    expect(element.showing).toBe(false);
    expect(commands).toHaveLength(0);
  });

  test('强制开启后照常出字（演示模式覆盖本地记忆）', () => {
    mount({ [MILESTONE_ENABLED_KEY]: 'off' });
    element.setForced(true);
    for (let i = 0; i < 10; i += 1) element.noteCompleted();

    expect(element.showing).toBe(true);
    expect(commands).toHaveLength(1);
  });

  test('默认（无记忆）开启', () => {
    mount();
    for (let i = 0; i < 10; i += 1) element.noteCompleted();
    expect(element.showing).toBe(true);
  });
});

describe('里程碑大字：卸载清理', () => {
  test('元素离场后计时器被清掉（不再摸已卸载的 DOM）', () => {
    mount();
    for (let i = 0; i < 10; i += 1) element.noteCompleted();
    expect(() => {
      unmount();
      jest.advanceTimersByTime(MARQUEE_METRICS.milestoneDurationMs * 2);
    }).not.toThrow();
    expect(element.isConnected).toBe(false);
  });
});
