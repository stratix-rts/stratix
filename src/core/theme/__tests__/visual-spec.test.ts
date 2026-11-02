/**
 * 单测：视觉常量唯一事实源（core/theme/visual-spec.ts）—— 调色板七色 / 尺寸时长 easing /
 *   演示模式参数，以及「色值只此一份」的纪律（world 与 hud 不得另抄）。
 * 依赖：纯常量 + fs 扫源码（不需要浏览器）。
 *
 * @since v3.3（task_110）
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  DEMO_MODE,
  PALETTE_CSS_VARS,
  VISUAL_METRICS,
  VISUAL_PALETTE,
  hexToNumber,
  hexToRgba,
  type PaletteKey,
} from '../visual-spec';

/** 仓库根目录（本文件在 src/core/theme/__tests__/ 下）。 */
const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

describe('调色板：七色语义值逐字对齐 DEMO-PLAN §1', () => {
  test('七色齐全且值一致', () => {
    expect(VISUAL_PALETTE).toEqual({
      background: '#0d1126',
      grid: '#1a2140',
      unit: '#4fc3f7',
      progress: '#f0a020',
      success: '#2ecc71',
      danger: '#ff5470',
      accent: '#8a6bff',
    });
  });

  test('恰好七色（多一个少一个都算漂移）', () => {
    expect(Object.keys(VISUAL_PALETTE)).toHaveLength(7);
  });

  test('每个语义色都有对应的 CSS 变量名，且互不重复', () => {
    const vars = Object.values(PALETTE_CSS_VARS);
    expect(new Set(vars).size).toBe(vars.length);
    for (const key of Object.keys(VISUAL_PALETTE) as PaletteKey[]) {
      expect(PALETTE_CSS_VARS[key]).toMatch(/^--srf-visual-[a-z]+$/);
    }
  });
});

describe('色值换算', () => {
  test('hexToNumber 换出 0xRRGGBB', () => {
    expect(hexToNumber('#0d1126')).toBe(0x0d1126);
    expect(hexToNumber('4fc3f7')).toBe(0x4fc3f7);
  });

  test('hexToNumber 对非法输入抛错（不静默吞掉）', () => {
    expect(() => hexToNumber('#fff')).toThrow(/not a #rrggbb color/);
    expect(() => hexToNumber('nope')).toThrow(/not a #rrggbb color/);
  });

  test('hexToRgba 换出 rgba 串', () => {
    expect(hexToRgba('#0d1126', 0.8)).toBe('rgba(13,17,38,0.8)');
  });
});

describe('尺寸 / 时长 / easing 规范', () => {
  test('命中盒 48px、hover 1.1x', () => {
    expect(VISUAL_METRICS.unitHitboxPx).toBe(48);
    expect(VISUAL_METRICS.hoverScale).toBe(1.1);
  });

  test('入场 Back.Out 250ms / 退场 Cubic.In 300ms / 镜头 Cubic.easeInOut 600ms', () => {
    expect(VISUAL_METRICS.enter).toEqual({ ease: 'Back.Out', durationMs: 250 });
    expect(VISUAL_METRICS.exit).toEqual({ ease: 'Cubic.In', durationMs: 300 });
    expect(VISUAL_METRICS.camera).toEqual({ ease: 'Cubic.easeInOut', durationMs: 600 });
  });
});

describe('演示模式参数', () => {
  test('字号放大 1.3（= +30%）、记忆键名固定', () => {
    expect(DEMO_MODE.fontScale).toBe(1.3);
    expect(DEMO_MODE.storageKey).toBe('stratix.demo-mode');
  });
});

/** 递归列出目录下所有 .ts / .css 文件（相对仓库根）。 */
function listSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(full, acc);
    } else if (/\.(ts|css)$/.test(entry.name)) {
      acc.push(path.relative(REPO_ROOT, full));
    }
  }
  return acc;
}

describe('纪律：色值只此一份', () => {
  const FACT_FILE = path.join('src', 'core', 'theme', 'visual-spec.ts');

  test('world 与 hud 的源码里不再出现调色板色值字面量', () => {
    const offenders: string[] = [];
    for (const scope of ['src/world', 'src/hud', 'src/app']) {
      for (const file of listSourceFiles(path.join(REPO_ROOT, scope))) {
        if (file === FACT_FILE) continue;
        const text = fs.readFileSync(path.join(REPO_ROOT, file), 'utf-8');
        for (const hex of Object.values(VISUAL_PALETTE)) {
          if (text.toLowerCase().includes(hex.toLowerCase())) offenders.push(`${file} :: ${hex}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
