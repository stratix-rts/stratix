/**
 * 单测：**浮层堆叠登记制度**（@since v3.9，task_146）—— 刻度表 / 登记表 / 收编纪律。
 *
 * 这里守的是三条**机器可验的纪律**（人靠自觉守不住）：
 *   ① 零硬编码：src/hud 全目录不得出现裸的 `z-index: <数字>`（刻度表文件本身除外）——
 *      这是「登记制度」的地基：浮层不再自己挑数字，只登记档位。
 *   ② 登记表全：每个浮层家族都在 OVERLAY_REGISTRY 里有一行，且档位合法、id 唯一。
 *   ③ 刻度单调：全局档位按语义递增（登记表的层序不能倒挂）。
 *
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  buildLayerTokensCss,
  CORNER_OWNERS,
  installLayerTokens,
  LAYER_TOKENS,
  LAYER_TOKENS_STYLE_ID,
  layerTokenVar,
  OVERLAY_REGISTRY,
  zVar,
  type LayerToken,
} from '../layer-tokens';

/** src/hud 目录（从 __dirname 上溯两层：__tests__ → theme → hud）。 */
const HUD_DIR = path.join(__dirname, '..', '..');

/** 刻度表文件自身（唯一允许出现裸数字的地方）。 */
const TOKEN_FILE = path.join(HUD_DIR, 'theme', 'layer-tokens.ts');

/** 递归列出目录下所有 .ts / .css 文件。 */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listFiles(full));
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

describe('浮层堆叠登记制度 · 刻度表', () => {
  test('zVar 产出 var(--srf-z-<档位>, <刻度值>) —— 数字只来自刻度表', () => {
    expect(zVar('toast')).toBe('var(--srf-z-toast, 55)');
    expect(zVar('modal')).toBe('var(--srf-z-modal, 50)');
    expect(layerTokenVar('fxRaised')).toBe('--srf-z-fx-raised');
  });

  test('全局档位按语义单调递增（登记表的层序不倒挂）', () => {
    const ladder: LayerToken[] = [
      'base',
      'underlay',
      'panel',
      'track',
      'island',
      'raised',
      'banner',
      'strip',
      'sticky',
      'overlay',
      'modal',
      'toast',
      'spotlight',
      'max',
    ];
    for (let i = 1; i < ladder.length; i++) {
      const prev = LAYER_TOKENS[ladder[i - 1]!];
      const cur = LAYER_TOKENS[ladder[i]!];
      expect(cur).toBeGreaterThan(prev);
    }
  });

  test('installLayerTokens 幂等注入刻度表（:root 上每个档位一个变量）', () => {
    installLayerTokens(document);
    const style = document.getElementById(LAYER_TOKENS_STYLE_ID);
    expect(style).not.toBeNull();
    const css = style?.textContent ?? '';
    for (const [name, value] of Object.entries(LAYER_TOKENS)) {
      expect(css).toContain(`${layerTokenVar(name as LayerToken)}: ${value};`);
    }
    // 幂等：再装一次仍只有一份。
    installLayerTokens(document);
    expect(document.querySelectorAll(`#${LAYER_TOKENS_STYLE_ID}`).length).toBe(1);
    expect(buildLayerTokensCss()).toContain('--srf-z-spotlight: 60;');
  });
});

describe('浮层堆叠登记制度 · 登记表', () => {
  test('每个家族一行、id 唯一、档位合法', () => {
    const ids = new Set<string>();
    for (const entry of OVERLAY_REGISTRY) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(Object.prototype.hasOwnProperty.call(LAYER_TOKENS, entry.layer)).toBe(true);
      expect(entry.host.length).toBeGreaterThan(0);
      expect(entry.note.length).toBeGreaterThan(0);
    }
  });

  test('本次修好的两个家族都在册：信息层级开关 + toast', () => {
    const ids = OVERLAY_REGISTRY.map((entry) => entry.id);
    expect(ids).toContain('layer-switch');
    expect(ids).toContain('toast');
    // 信息层级开关与左下角主人（事件轨）分属两条带 —— 不能同象限同档位。
    const track = OVERLAY_REGISTRY.find((entry) => entry.id === 'event-track');
    const switcher = OVERLAY_REGISTRY.find((entry) => entry.id === 'layer-switch');
    expect(track?.zone).toBe('left-bottom');
    expect(switcher?.zone).toBe('left-bottom');
    expect(track?.layer).not.toBe(switcher?.layer);
  });

  test('象限归属表：每一块屏幕都有主人', () => {
    for (const [zone, owner] of Object.entries(CORNER_OWNERS)) {
      expect(owner.length).toBeGreaterThan(0);
      expect(zone.length).toBeGreaterThan(0);
    }
  });
});

describe('浮层堆叠登记制度 · 收编纪律（零硬编码）', () => {
  test('src/hud 内不得出现裸的 z-index 数字（刻度表文件除外）', () => {
    const offenders: string[] = [];
    for (const file of listFiles(HUD_DIR)) {
      if (path.resolve(file) === path.resolve(TOKEN_FILE)) continue;
      const text = fs.readFileSync(file, 'utf-8');
      // 只抓「属性值是裸数字」的写法：z-index: 40 / z-index:40（z-index 1 —— 这种注释不算）。
      const re = /z-index\s*:\s*(\d+)\s*(?![-—])/g;
      let match = re.exec(text);
      while (match) {
        offenders.push(`${path.relative(HUD_DIR, file)}: ${match[0].trim()}`);
        match = re.exec(text);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('src/hud 内每条 z-index 声明都走刻度表（var(--srf-z-*) 或 zVar(...)）', () => {
    const offenders: string[] = [];
    for (const file of listFiles(HUD_DIR)) {
      if (path.resolve(file) === path.resolve(TOKEN_FILE)) continue;
      const text = fs.readFileSync(file, 'utf-8');
      const re = /z-index\s*:\s*([^;]+);/g;
      let match = re.exec(text);
      while (match) {
        const value = (match[1] ?? '').trim();
        // 两种合法写法：直接写 var(--srf-z-x)，或模板里插 ${zVar('x')}（TS 组件的常态）。
        const viaScale = value.startsWith('var(--srf-z-') || value.includes("zVar('");
        if (!viaScale) {
          offenders.push(`${path.relative(HUD_DIR, file)}: ${value}`);
        }
        match = re.exec(text);
      }
    }
    expect(offenders).toEqual([]);
  });
});
