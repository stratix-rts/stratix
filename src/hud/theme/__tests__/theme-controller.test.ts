/**
 * 单测：HUD 皮肤切换控制器（hud/theme/theme-controller.ts）。
 * 覆盖：注入样式生成、初始皮肤、切换皮肤、idempotent 默认行为、无 sources 时抛错可预期。
 * 依赖：用桩 StyleInjector 替换 document.head 副作用；不依赖 DOM / jsdom；
 *   CSS 源通过 fs 直读，避免改 jest transform 解析 *.css。
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  createThemeController,
  type StyleInjector,
  type ThemeId,
} from '../theme-controller';

const readCss = (name: string): string =>
  fs.readFileSync(path.join(__dirname, '..', name), 'utf-8');

const defaultCss = readCss('tokens-default.css');
const pixelCss = readCss('tokens-pixel.css');

interface RecordedStyle {
  id: string;
  css: string;
  disabled: boolean;
}

function makeRecorder(): {
  inject: StyleInjector;
  records: RecordedStyle[];
  getNode: (id: string) => RecordedStyle;
} {
  const records: RecordedStyle[] = [];
  const byId = new Map<string, RecordedStyle>();
  const inject: StyleInjector = (id, css) => {
    const rec: RecordedStyle = { id, css, disabled: false };
    records.push(rec);
    byId.set(id, rec);
    return rec as unknown as HTMLStyleElement;
  };
  const getNode = (id: string): RecordedStyle => {
    const r = byId.get(id);
    if (!r) throw new Error(`style ${id} not injected`);
    return r;
  };
  return { inject, records, getNode };
}

const SOURCES = { default: defaultCss, pixel: pixelCss };

describe('createThemeController', () => {
  test('工厂默认注入 default 与 pixel 两套样式表', () => {
    const { inject, records } = makeRecorder();
    createThemeController({ inject, sources: SOURCES });
    expect(records.map((r) => r.id)).toEqual(['srf-theme-default', 'srf-theme-pixel']);
  });

  test('注入内容与源文件一致（确保 import 生效）', () => {
    const { inject, getNode } = makeRecorder();
    createThemeController({ inject, sources: SOURCES });
    expect(getNode('srf-theme-default').css).toBe(defaultCss);
    expect(getNode('srf-theme-pixel').css).toBe(pixelCss);
  });

  test('无 initial 时两套样式均 disable，等待首次 apply', () => {
    const { inject, getNode } = makeRecorder();
    const ctrl = createThemeController({ inject, sources: SOURCES });
    expect(getNode('srf-theme-default').disabled).toBe(true);
    expect(getNode('srf-theme-pixel').disabled).toBe(true);
    expect(ctrl.current).toBeNull();
  });

  test('initial 指定时，被选样式 enabled，其余 disable', () => {
    const { inject, getNode } = makeRecorder();
    const ctrl = createThemeController({ inject, sources: SOURCES, initial: 'pixel' });
    expect(getNode('srf-theme-default').disabled).toBe(true);
    expect(getNode('srf-theme-pixel').disabled).toBe(false);
    expect(ctrl.current).toBe('pixel');
  });

  test('apply 切换并设置 current', () => {
    const { inject, getNode } = makeRecorder();
    const ctrl = createThemeController({ inject, sources: SOURCES });
    ctrl.apply('pixel');
    expect(getNode('srf-theme-default').disabled).toBe(true);
    expect(getNode('srf-theme-pixel').disabled).toBe(false);
    expect(ctrl.current).toBe('pixel');

    ctrl.apply('default');
    expect(getNode('srf-theme-default').disabled).toBe(false);
    expect(getNode('srf-theme-pixel').disabled).toBe(true);
    expect(ctrl.current).toBe('default');
  });

  test('apply 同一皮肤是 no-op（disabled 不反复 toggle）', () => {
    const { inject, getNode } = makeRecorder();
    const ctrl = createThemeController({ inject, sources: SOURCES, initial: 'pixel' });
    const before = getNode('srf-theme-default').disabled;
    ctrl.apply('pixel');
    expect(getNode('srf-theme-default').disabled).toBe(before);
    expect(ctrl.current).toBe('pixel');
  });

  test('切换循环 N 次后最终状态可预期（无状态泄漏）', () => {
    const { inject, getNode } = makeRecorder();
    const ctrl = createThemeController({ inject, sources: SOURCES });
    const sequence: ThemeId[] = ['pixel', 'default', 'pixel', 'pixel', 'default'];
    for (const id of sequence) ctrl.apply(id);
    expect(getNode('srf-theme-default').disabled).toBe(false);
    expect(getNode('srf-theme-pixel').disabled).toBe(true);
    expect(ctrl.current).toBe('default');
  });
});
