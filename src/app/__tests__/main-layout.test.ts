/**
 * 布局回归测试（@since v3.7，task_020）—— 正式入口必须是 **RTS 悬浮形态**，不是左右分屏。
 *   背景：用户反馈「hud 并没有环绕整个 rts 屏幕，看起来更像是左右分屏」。
 *   这里直接读入口 HTML / 入口装配脚本断言骨架，把"RTS 形态"钉成可回归的契约：
 *   1. #app 不再是两列 grid（grid-template-columns 必须消失）；
 *   2. #battlefield 绝对定位铺满视口，且层序在 HUD 之下；
 *   3. #hud-side 是覆盖层且 pointer-events:none（空白处事件穿透到 Phaser 画布）；
 *   4. Phaser 以 Scale.RESIZE 跟随容器尺寸（全屏容器尺寸变化时场景跟着 resize）。
 *
 * 为什么读文件而不是渲染断言：入口 HTML 是 vite build 的 input（唯一入口），
 * 它的骨架错了会在打包产物里静默复现；这里做的是"骨架契约"守门，不依赖浏览器。
 */

import * as fs from 'fs';
import * as path from 'path';

// 入口 HTML 住在站点根（task_122）：从 src/app/__tests__ 上溯三层到项目根。
const MAIN_HTML = path.join(__dirname, '..', '..', '..', 'index.html');
const MAIN_ENTRY = path.join(__dirname, '..', 'main', 'main-entry.ts');

const html = fs.readFileSync(MAIN_HTML, 'utf-8');
const entry = fs.readFileSync(MAIN_ENTRY, 'utf-8');

/** 取某个 id 选择器的规则体（拿不到就返回空串，交给断言去暴露）。 */
function ruleFor(selector: string): string {
  const match = new RegExp(`${selector}\\s*\\{([^}]*)\\}`).exec(html);
  return match ? match[1] : '';
}

describe('正式入口的 RTS 悬浮骨架', () => {
  test('#app 不再是两列 grid —— 左右分屏的根被拔掉', () => {
    const appRule = ruleFor('#app');
    expect(appRule).not.toBe('');
    expect(appRule).not.toMatch(/grid-template-columns/);
    expect(appRule).not.toMatch(/display:\s*grid/);
    expect(appRule).toMatch(/position:\s*relative/);
    expect(appRule).toMatch(/height:\s*100%/);
  });

  test('#battlefield 绝对定位铺满视口（战场全屏）', () => {
    const rule = ruleFor('#battlefield');
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/inset:\s*0/);
    expect(rule).toMatch(/z-index:\s*0/);
  });

  test('#hud-side 是覆盖层：绝对定位 + pointer-events:none（空白穿透到战场）', () => {
    const rule = ruleFor('#hud-side');
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).toMatch(/inset:\s*0/);
    expect(rule).toMatch(/pointer-events:\s*none/);
    // HUD 覆盖层必须压在战场之上。
    expect(rule).toMatch(/z-index:\s*10/);
  });

  test('层序：#battlefield 在 DOM 中先于 #hud-side（战场不被 HUD 盖住）', () => {
    const battlefieldAt = html.indexOf('id="battlefield"');
    const hudSideAt = html.indexOf('id="hud-side"');
    expect(battlefieldAt).toBeGreaterThan(-1);
    expect(hudSideAt).toBeGreaterThan(-1);
    expect(battlefieldAt).toBeLessThan(hudSideAt);
  });

  test('Phaser 以 Scale.RESIZE 跟随容器（全屏容器变尺寸时场景跟着 resize）', () => {
    expect(entry).toMatch(/scale:\s*\{[^}]*mode:\s*Phaser\.Scale\.RESIZE/);
  });
});
