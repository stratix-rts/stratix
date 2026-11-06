/**
 * 单测：**代码路由在生产链路里的接线**（@since v3.3，task_194 / AP-04）。
 *
 * 覆盖（task_194 / AP-04 验收标准 ①「CodeFxLayer 在 BattlefieldScene 生效」）：
 *   ① 战场建出 CodeFxLayer（从 registry 读代码源）与 FxRouter（两条路由的裁决）；
 *   ② **所有**特效触点都走 router（没有旁路直播 sheet 的漏口）；
 *   ③ 代码层每帧被推进（tick）、场景关闭时被析构（destroy）；
 *   ④ 组合根在开局前装好代码源与调色板，并随主题变化热刷新调色板。
 *
 * why 读源码而不是渲染断言：BattlefieldScene 在 node 环境跑不起来（无 window/document），
 *   而「接线在不在」恰恰是**接线契约**问题（仓库里已有同类先例：
 *   src/app/__tests__/v34-main-entry-buttons.test.ts / src/world/__tests__/battlefield-scene-reset.test.ts）。
 *
 * @jest-environment node
 */

import * as fs from 'fs';
import * as path from 'path';

const WORLD_DIR = path.join(__dirname, '..');
const BATTLEFIELD = path.join(WORLD_DIR, 'scenes', 'BattlefieldScene.ts');
const MAIN_ENTRY = path.join(WORLD_DIR, '..', 'app', 'main', 'main-entry.ts');
const FX_ASSET_SCENE = path.join(WORLD_DIR, 'scenes', 'fx-asset-scene.ts');
const SPRITE_FX_LAYER = path.join(WORLD_DIR, 'objects', 'sprite-fx-layer.ts');

const battlefield = fs.readFileSync(BATTLEFIELD, 'utf-8');
const mainEntry = fs.readFileSync(MAIN_ENTRY, 'utf-8');
const fxAssetScene = fs.readFileSync(FX_ASSET_SCENE, 'utf-8');
const spriteFxLayer = fs.readFileSync(SPRITE_FX_LAYER, 'utf-8');

describe('BattlefieldScene：代码路由接线', () => {
  test('战场建出 CodeFxLayer（从 registry 读登记的代码源）', () => {
    expect(battlefield).toContain("import { CodeFxLayer } from '../objects/code-fx-layer'");
    expect(battlefield).toContain(
      'this.codeFxLayer = new CodeFxLayer(this, readCodeFxSources(this.registry))',
    );
  });

  test('战场建出 FxRouter：两条路由的播放口都接上（代码 → sheet 兜底）', () => {
    expect(battlefield).toContain("import { FxRouter } from '../objects/fx-router'");
    expect(battlefield).toContain('this.fxRouter = new FxRouter({');
    // 代码路由的播放口。
    expect(battlefield).toContain(
      'codePlay: (codeKind, x, y) => this.codeFxLayer.play(codeKind, x, y)',
    );
    // sheet 兜底的播放口（回落后演出照旧）。
    expect(battlefield).toContain(
      'sheetPlay: (sheetKind, x, y) => this.taskFxLayer.playFx(sheetKind, x, y)',
    );
    // 效果源是否就绪（没源 ⇒ 静默回落）。
    expect(battlefield).toContain(
      'hasCodeSource: (codeKind) => this.codeFxLayer.hasKind(codeKind)',
    );
    // reduced-motion 现取（沿用 world/motion.ts 口径）。
    expect(battlefield).toContain('reducedMotion: () => readReducedMotion(this.registry)');
  });

  test('所有特效触点都走 router（没有旁路直播 sheet 的漏口）', () => {
    // 六个触点：下场 / 上场 / 庆祝 / 报错 / 升级 / 指令。
    const plays = battlefield.match(/this\.fxRouter\.play\(/g) ?? [];
    expect(plays).toHaveLength(6);
    // 直播 sheet 的入口只有 router 装配时的那一处（其它地方都经 router）。
    const direct = battlefield.match(/this\.taskFxLayer\.playFx\(/g) ?? [];
    expect(direct).toHaveLength(1);
  });

  test('代码层每帧被推进、场景关闭时被析构（护栏与回收都活着）', () => {
    expect(battlefield).toContain('this.codeFxLayer.tick(this.time.now)');
    expect(battlefield).toContain('this.codeFxLayer.destroy()');
  });
});

describe('组合根：代码源与调色板在开局前就位', () => {
  test('开局前装配代码源（装失败 ⇒ 空清单 ⇒ 战场自动回落 sheet）', () => {
    expect(mainEntry).toContain('loadProductionCodeFxSources');
    // 装配发生在建游戏之前（代码源要进 registry ⇒ 场景创建时就能读到）。
    expect(mainEntry.indexOf('loadProductionCodeFxSources()')).toBeGreaterThan(-1);
    expect(mainEntry.indexOf('loadProductionCodeFxSources()')).toBeLessThan(
      mainEntry.indexOf('new Phaser.Game('),
    );
  });

  test('代码源与调色板都登记进 registry', () => {
    expect(mainEntry).toContain('booting.registry.set(CODE_FX_SOURCES_KEY, codeFxSources)');
    expect(mainEntry).toContain('booting.registry.set(FX_PALETTE_KEY, readFxPaletteTokens(document))');
  });

  test('主题变化 ⇒ 调色板热刷新（皮肤联动的光效颜色跟得上）', () => {
    expect(mainEntry).toContain('themeController.subscribe(');
    expect(mainEntry).toContain('game.registry.set(FX_PALETTE_KEY, readFxPaletteTokens(document))');
  });
});

describe('__s1 变体：烘焙产物在运行时被消费', () => {
  test('资产场景把 manifest 里的变体图集载入并登记（变体才有得挑）', () => {
    expect(fxAssetScene).toContain('spriteFxVariantsFromManifest(');
    expect(fxAssetScene).toContain('SPRITE_FX_VARIANTS_KEY');
  });

  test('sheet 特效层播之前随机挑一套变体（基础变体 + __s1 都可能被挑到）', () => {
    expect(spriteFxLayer).toContain('spriteFxCandidates(');
    expect(spriteFxLayer).toContain('pickSpriteFxCandidate(');
  });
});
