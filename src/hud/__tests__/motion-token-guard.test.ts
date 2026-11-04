/**
 * **收编守卫**（@since v3.9，task_147）——
 *   把「HUD 里的动效时长只能来自 motion token」这条纪律写成**会失败的测试**，
 *   而不是写进文档里靠自觉。
 *
 * 覆盖两条硬约束：
 *   ① **零字面量**：src/hud 里的 transition / animation 声明不得自带时长字面量
 *      （`140ms` / `0.3s` / `250ms cubic-bezier(...)` 一律不许）——
 *      时长与缓动只能来自 var(--srf-motion-*)。
 *   ② **降级通道全覆盖**：凡是带 transition / animation 的文件，
 *      必须挂上既有禁用通道（prefers-reduced-motion 块 / MOTION_REDUCED_CSS /
 *      MOTION_COMPONENT_CSS）——
 *      影子树自成样式作用域，文档级规则穿不进去，谁有动效谁自己得带这块。
 *
 * why 用源码扫描而不是 computed style 断言：
 *   jsdom 不实现 CSS 级联与媒体查询（matchMedia 恒 false、媒体查询不生效），
 *   算出来的 computed style 验不出「有没有降级块」；
 *   真正能守住这条纪律的是**源码里有没有那几行**。
 *   视觉层（reduced-motion 下画面到底动不动）由 e2e（tests/e2e/motion.spec.ts）验。
 *
 * @jest-environment node
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const HUD_DIR = join(__dirname, '..');

/**
 * 免检文件（各带理由）——
 *   ① theme/motion-tokens.ts：**token 文件本身**（时长声明处 + 降级块定义处）；
 *   ② theme/tokens-*.css：**皮肤 token 表**（--srf-transition 是皮肤运动语言信号，
 *      不是组件动效时长；组件已不再消费它的时长部分）。
 */
const EXEMPT_FILES = new Set([
  join('theme', 'motion-tokens.ts'),
]);

/** 收集 src/hud 下的 .ts 源文件（排除 __tests__ 与免检文件）。 */
function collectSources(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      collectSources(full, acc);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    const rel = relative(HUD_DIR, full);
    if (EXEMPT_FILES.has(rel)) continue;
    acc.push(full);
  }
  return acc;
}

/**
 * 去掉注释（块注释 + 行注释）——
 *   why 要去：注释里写「140ms 淡入淡出」是**说明**，不是动效声明，
 *   留着会让守卫误报（守卫要盯的是「声明里自带时长」）。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 命中即为「声明里自带时长字面量」。 */
const LITERAL_DURATION = /(?:transition|animation(?:-duration)?)[^;{}]*?\d+(?:\.\d+)?m?s\b/;

describe('收编守卫：HUD 动效时长只能来自 motion token', () => {
  const files = collectSources(HUD_DIR);

  test('扫到源文件（守卫本身没空转）', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  test('① 零字面量：transition / animation 声明里没有时长字面量', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'));
      if (LITERAL_DURATION.test(src)) {
        offenders.push(relative(HUD_DIR, file).split(sep).join('/'));
      }
    }
    expect(offenders).toEqual([]);
  });

  test('② 降级通道全覆盖：带动效的文件都挂了既有禁用通道', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const hasMotion = /(?:^|[;{\s])(?:transition|animation)\s*:/.test(src);
      if (!hasMotion) continue;
      const hasChannel =
        src.includes('prefers-reduced-motion') ||
        src.includes('MOTION_REDUCED_CSS') ||
        src.includes('MOTION_COMPONENT_CSS');
      if (!hasChannel) {
        offenders.push(relative(HUD_DIR, file).split(sep).join('/'));
      }
    }
    expect(offenders).toEqual([]);
  });
});
