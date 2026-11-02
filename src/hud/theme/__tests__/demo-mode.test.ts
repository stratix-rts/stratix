/**
 * 单测：演示模式骨架（hud/theme/demo-mode.ts）—— 开关 / localStorage 记忆 / 字号放大 / 工程件过滤。
 * 环境：jsdom（要 document + localStorage）。
 *
 * @since v3.3（task_110）
 * @jest-environment jsdom
 */

import {
  DEMO_MODE_ATTRIBUTE,
  DEMO_MODE_STYLE_ID,
  buildDemoTypographyCss,
  createDemoModeController,
  readBaseFontSizes,
  type DemoModeStorage,
} from '../demo-mode';

/** 内存版 localStorage（可控、可断言）。 */
function createMemoryStorage(initial: Record<string, string> = {}): DemoModeStorage & {
  readonly data: Map<string, string>;
} {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

/** 装一张假的皮肤样式表（theme-controller 注入的那种形态），供基准字号读取。 */
function installFakeSkin(base: Record<string, number> = { xs: 11, sm: 12, md: 14, lg: 16 }): void {
  const style = document.createElement('style');
  style.id = 'srf-theme-default';
  style.textContent = `:root {\n  --srf-font-size-xs: ${base.xs}px;\n  --srf-font-size-sm: ${base.sm}px;\n  --srf-font-size-md: ${base.md}px;\n  --srf-font-size-lg: ${base.lg}px;\n}\n`;
  document.head.appendChild(style);
}

afterEach(() => {
  document.getElementById('srf-theme-default')?.remove();
  document.getElementById(DEMO_MODE_STYLE_ID)?.remove();
  document.documentElement.removeAttribute(DEMO_MODE_ATTRIBUTE);
  window.localStorage.clear();
});

describe('开关与记忆', () => {
  test('默认关闭', () => {
    const controller = createDemoModeController({ storage: () => createMemoryStorage(), document: () => document });
    expect(controller.enabled).toBe(false);
  });

  test('开启后写入 localStorage（键名取自唯一事实源）', () => {
    const storage = createMemoryStorage();
    const controller = createDemoModeController({ storage: () => storage, document: () => document });
    controller.set(true);
    expect(controller.enabled).toBe(true);
    expect(storage.getItem('stratix.demo-mode')).toBe('on');
  });

  test('重新构造控制器时从 localStorage 恢复（记忆生效）', () => {
    const storage = createMemoryStorage({ 'stratix.demo-mode': 'on' });
    const controller = createDemoModeController({ storage: () => storage, document: () => document });
    expect(controller.enabled).toBe(true);
  });

  test('toggle 翻转状态并同步记忆', () => {
    const storage = createMemoryStorage();
    const controller = createDemoModeController({ storage: () => storage, document: () => document });
    expect(controller.toggle()).toBe(true);
    expect(storage.getItem('stratix.demo-mode')).toBe('on');
    expect(controller.toggle()).toBe(false);
    expect(storage.getItem('stratix.demo-mode')).toBe('off');
  });

  test('订阅者在状态变化时收到通知（重复设同值不通知）', () => {
    const controller = createDemoModeController({ storage: () => createMemoryStorage(), document: () => document });
    const seen: boolean[] = [];
    controller.subscribe((enabled) => seen.push(enabled));
    controller.set(true);
    controller.set(true);
    controller.set(false);
    expect(seen).toEqual([true, false]);
  });

  test('退订后不再收到通知', () => {
    const controller = createDemoModeController({ storage: () => createMemoryStorage(), document: () => document });
    const seen: boolean[] = [];
    const off = controller.subscribe((enabled) => seen.push(enabled));
    off();
    controller.set(true);
    expect(seen).toEqual([]);
  });
});

describe('字号放大（+30%）', () => {
  test('开启时注入覆盖样式表并把四个字号 token 放大 1.3 倍', () => {
    installFakeSkin();
    const controller = createDemoModeController({ storage: () => createMemoryStorage(), document: () => document });
    controller.set(true);
    const style = document.getElementById(DEMO_MODE_STYLE_ID);
    expect(style).not.toBeNull();
    const css = style?.textContent ?? '';
    expect(css).toContain('--srf-font-size-xs: 14.3px;');
    expect(css).toContain('--srf-font-size-sm: 15.6px;');
    expect(css).toContain('--srf-font-size-md: 18.2px;');
    expect(css).toContain('--srf-font-size-lg: 20.8px;');
  });

  test('关闭时撤掉覆盖样式表与 html 标记', () => {
    installFakeSkin();
    const controller = createDemoModeController({ storage: () => createMemoryStorage(), document: () => document });
    controller.set(true);
    controller.set(false);
    expect(document.getElementById(DEMO_MODE_STYLE_ID)).toBeNull();
    expect(document.documentElement.hasAttribute(DEMO_MODE_ATTRIBUTE)).toBe(false);
  });

  test('换皮肤后 refreshTypography 按新皮肤的基准字号重算', () => {
    installFakeSkin({ xs: 11, sm: 12, md: 14, lg: 16 });
    const controller = createDemoModeController({ storage: () => createMemoryStorage(), document: () => document });
    controller.set(true);
    // 换成另一套皮肤的基准字号（像素风更小）。
    document.getElementById('srf-theme-default')?.remove();
    installFakeSkin({ xs: 10, sm: 11, md: 13, lg: 15 });
    controller.refreshTypography();
    const css = document.getElementById(DEMO_MODE_STYLE_ID)?.textContent ?? '';
    expect(css).toContain('--srf-font-size-md: 16.9px;');
  });

  test('读不到基准字号时不注入（宁可不放大，也不写来路不明的字号）', () => {
    const controller = createDemoModeController({ storage: () => createMemoryStorage(), document: () => document });
    controller.set(true);
    expect(document.getElementById(DEMO_MODE_STYLE_ID)).toBeNull();
  });

  test('基准字号读取与 CSS 生成是纯函数', () => {
    installFakeSkin();
    expect(readBaseFontSizes(document)).toEqual({
      '--srf-font-size-xs': 11,
      '--srf-font-size-sm': 12,
      '--srf-font-size-md': 14,
      '--srf-font-size-lg': 16,
    });
    expect(buildDemoTypographyCss({ '--srf-font-size-md': 14 }, 1.3)).toContain('--srf-font-size-md: 18.2px;');
  });
});

describe('工程件过滤（骨架机制）', () => {
  test('演示模式下 data-engineering 节点隐藏，关闭后恢复', () => {
    const controller = createDemoModeController({ storage: () => createMemoryStorage(), document: () => document });
    const host = document.createElement('div');
    const node = document.createElement('div');
    node.setAttribute('data-engineering', 'true');
    host.appendChild(node);

    controller.set(true);
    controller.filterEngineering(host);
    expect(node.hasAttribute('hidden')).toBe(true);
    expect(node.style.display).toBe('none');

    controller.set(false);
    controller.filterEngineering(host);
    expect(node.hasAttribute('hidden')).toBe(false);
    expect(node.style.display).toBe('');
  });

  test('未标记 data-engineering 的节点不受影响', () => {
    const controller = createDemoModeController({ storage: () => createMemoryStorage(), document: () => document });
    const host = document.createElement('div');
    const node = document.createElement('div');
    host.appendChild(node);
    controller.set(true);
    controller.filterEngineering(host);
    expect(node.hasAttribute('hidden')).toBe(false);
  });
});
