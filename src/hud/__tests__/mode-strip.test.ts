/**
 * 单测：模式状态条（@since v3.6，task_117）。
 * 覆盖死功能报告 P3#9 / P3#10 的原症状与本任务的验收口径：
 *   - 演示模式 / 导演镜头任一开启 → 顶栏下方出现**可见指示**（写着是什么 + 怎么关）；
 *   - 两个开关各自有独立的真相端口（演示态 / 导演态），组件不存第二份；
 *   - 点指示即可退出对应模式（演示态走端口 set，导演态走 camera.director 命令口）；
 *   - 刷新后（端口一开始就是开的）指示照样在 —— 演示模式的 localStorage 记忆在 UI 有可见反映；
 *   - 组件卸载时退订 + 撤掉版面让位变量（不留监听器、不留残影）。
 *
 * @jest-environment jsdom
 */

import {
  MODE_STRIP_ATTRIBUTE,
  MODE_STRIP_CSS_VAR,
  MODE_STRIP_DEMO_TEXT,
  MODE_STRIP_DIRECTOR_TEXT,
  MODE_STRIP_HEIGHT_PX,
  MODE_STRIP_TAG,
  mountModeStrip,
  type ModeStripDemoPort,
  type ModeStripDirectorPort,
} from '../components/mode-strip/mode-strip';

/** 可控的演示态端口（单测替身：真源在 demo-mode 单例）。 */
function stubDemoPort(initial = false): ModeStripDemoPort & { setCalls: boolean[] } {
  const listeners = new Set<(enabled: boolean) => void>();
  let enabled = initial;
  const port = {
    setCalls: [] as boolean[],
    get enabled(): boolean {
      return enabled;
    },
    subscribe(listener: (enabled: boolean) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: boolean): void {
      port.setCalls.push(next);
      enabled = next;
      for (const listener of Array.from(listeners)) listener(enabled);
    },
    /** 模拟「刷新后仍然是开的」（localStorage 记忆恢复）。 */
    restore(on: boolean): void {
      enabled = on;
      for (const listener of Array.from(listeners)) listener(enabled);
    },
  };
  return port;
}

/** 可控的导演态端口（单测替身：真源是 core 广播的 WorldState.directorEnabled）。 */
function stubDirectorPort(
  initial = false
): ModeStripDirectorPort & { disableCalls: number; restore(on: boolean): void } {
  const listeners = new Set<(enabled: boolean) => void>();
  let enabled = initial;
  const port = {
    disableCalls: 0,
    get enabled(): boolean {
      return enabled;
    },
    subscribe(listener: (enabled: boolean) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    disable(): void {
      port.disableCalls += 1;
      enabled = false;
      for (const listener of Array.from(listeners)) listener(enabled);
    },
    restore(on: boolean): void {
      enabled = on;
      for (const listener of Array.from(listeners)) listener(enabled);
    },
  };
  return port;
}

interface Harness {
  readonly host: HTMLElement;
  readonly demo: ReturnType<typeof stubDemoPort>;
  readonly director: ReturnType<typeof stubDirectorPort>;
  /** 细条本体（Shadow DOM 内部结构）。 */
  strip(): HTMLElement | null;
  /** 某个模式项（demo / director）。 */
  item(mode: 'demo' | 'director'): HTMLElement | null;
  /** 指示文字（给人看的那句）。 */
  text(mode: 'demo' | 'director'): string;
  /** 让位变量（写在 <html> 上）。 */
  layoutVar(): string;
  unmount(): void;
}

function mountHarness(options?: {
  demoOn?: boolean;
  directorOn?: boolean;
}): Harness {
  const demo = stubDemoPort(options?.demoOn ?? false);
  const director = stubDirectorPort(options?.directorOn ?? false);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const { element, unmount } = mountModeStrip(host, { demo, director });
  const root = element.shadowRoot;
  return {
    host,
    demo,
    director,
    strip: () => root?.querySelector('[data-role="mode-strip"]') ?? null,
    item: (mode) => root?.querySelector(`[data-mode="${mode}"]`) ?? null,
    text: (mode) => root?.querySelector(`[data-mode="${mode}"] .label`)?.textContent ?? '',
    layoutVar: () => document.documentElement.style.getPropertyValue(MODE_STRIP_CSS_VAR),
    unmount: () => {
      unmount();
      host.remove();
    },
  };
}

describe('模式状态条（演示模式 / 导演镜头 状态指示）', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(MODE_STRIP_CSS_VAR);
    document.documentElement.removeAttribute(MODE_STRIP_ATTRIBUTE);
  });

  test('两个模式都没开 → 细条整条隐藏（不占版面、不留残影）', () => {
    const h = mountHarness();
    expect(h.strip()?.hidden).toBe(true);
    expect(h.item('demo')?.hidden).toBe(true);
    expect(h.item('director')?.hidden).toBe(true);
    expect(h.layoutVar()).toBe('');
    h.unmount();
  });

  test('开启演示模式 → 出现可见指示（写着是什么 + 怎么关）', () => {
    const h = mountHarness();
    h.demo.set(true);
    expect(h.strip()?.hidden).toBe(false);
    expect(h.item('demo')?.hidden).toBe(false);
    expect(h.text('demo')).toBe('演示模式运行中');
    expect(h.item('demo')?.textContent).toContain(MODE_STRIP_DEMO_TEXT);
    h.unmount();
  });

  test('开启导演镜头 → 出现可见指示（导演镜头 ON）', () => {
    const h = mountHarness();
    h.director.restore(true);
    expect(h.strip()?.hidden).toBe(false);
    expect(h.item('director')?.hidden).toBe(false);
    expect(h.text('director')).toBe('导演镜头 ON');
    expect(h.item('director')?.textContent).toContain(MODE_STRIP_DIRECTOR_TEXT);
    h.unmount();
  });

  test('两个模式同时开 → 两项都在（各自一条，互不吞掉）', () => {
    const h = mountHarness();
    h.demo.set(true);
    h.director.restore(true);
    expect(h.item('demo')?.hidden).toBe(false);
    expect(h.item('director')?.hidden).toBe(false);
    expect(h.strip()?.hidden).toBe(false);
    h.unmount();
  });

  test('指示亮出时下方版面让位一条（--srf-mode-strip-h）', () => {
    const h = mountHarness();
    h.demo.set(true);
    expect(h.layoutVar()).toBe(`${MODE_STRIP_HEIGHT_PX}px`);
    expect(document.documentElement.getAttribute(MODE_STRIP_ATTRIBUTE)).toBe('on');
    h.demo.set(false);
    expect(h.layoutVar()).toBe('');
    expect(document.documentElement.getAttribute(MODE_STRIP_ATTRIBUTE)).toBeNull();
    h.unmount();
  });

  test('点演示指示 → 退出演示模式（端口收到 set(false)）', () => {
    const h = mountHarness({ demoOn: true });
    h.item('demo')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.demo.setCalls).toEqual([false]);
    expect(h.strip()?.hidden).toBe(true);
    h.unmount();
  });

  test('点导演指示 → 退出导演镜头（端口收到 disable）', () => {
    const h = mountHarness({ directorOn: true });
    h.item('director')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.director.disableCalls).toBe(1);
    expect(h.strip()?.hidden).toBe(true);
    h.unmount();
  });

  test('刷新后仍是开的（端口一开始就是开的）→ 指示照样在', () => {
    // 演示模式的记忆在 localStorage（demo-mode 单例负责），端口读出来就是 true。
    const h = mountHarness({ demoOn: true, directorOn: true });
    expect(h.strip()?.hidden).toBe(false);
    expect(h.item('demo')?.hidden).toBe(false);
    expect(h.item('director')?.hidden).toBe(false);
    h.unmount();
  });

  test('卸载后不留监听器与版面残影（退订 + 撤让位变量）', () => {
    const h = mountHarness({ demoOn: true });
    expect(h.layoutVar()).toBe(`${MODE_STRIP_HEIGHT_PX}px`);
    h.unmount();
    expect(h.layoutVar()).toBe('');
    expect(document.documentElement.getAttribute(MODE_STRIP_ATTRIBUTE)).toBeNull();
    // 端口再变化不应再触发渲染（组件已离场 → 订阅已退订 → 让位变量不会被写回来）。
    h.demo.set(true);
    expect(h.layoutVar()).toBe('');
  });

  test('组件标签名固定（装配方与 e2e 按它找）', () => {
    expect(MODE_STRIP_TAG).toBe('strat-mode-strip');
  });
});
