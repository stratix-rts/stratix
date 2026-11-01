/**
 * 集成测试：单位形象精灵源（app/services/unit-sprite-source.ts）。
 * 覆盖：合成 → 裁出走路 4 行、合成失败降级返 null、并发请求串行化（共用画布不互踩）。
 *
 * 边界说明：这里只测"服务这一侧"的编排逻辑 —— 合成器与注册表都是**假实现**，
 *   真素材（1.3G LPC）的画面效果归 task_029 的实机手测。
 */

import { createFakeCanvas } from '../../world/appearance/__tests__/helpers/fakes';
import type { CharacterComposer } from '../../world/appearance/character-composer';
import { ANIMATION_OFFSETS, DEFAULT_ANIMATION, FRAME_SIZE } from '../../world/appearance/constants';
import type { PartRegistry } from '../../world/appearance/part-registry';
import { UNIT_SHEET_COLUMNS } from '../../world/objects/unit-sprite-sheet';

import { createUnitSpriteSource } from '../services/unit-sprite-source';

/** 假注册表：记录调用，返回固定的默认部位与解析结果。 */
function createFakeRegistry(): PartRegistry & {
  loadMetadata: jest.Mock;
  getDefaultSelections: jest.Mock;
  resolveSelections: jest.Mock;
} {
  const loadMetadata = jest.fn(async () => undefined);
  const getDefaultSelections = jest.fn(() => ({
    shadow: { itemId: 'shadow', variant: 'shadow' },
    body: { itemId: 'body', variant: 'light' },
  }));
  const resolveSelections = jest.fn(() => ({
    hair: { itemId: 'hair', variant: 'black' },
  }));
  return { loadMetadata, getDefaultSelections, resolveSelections } as unknown as PartRegistry & {
    loadMetadata: jest.Mock;
    getDefaultSelections: jest.Mock;
    resolveSelections: jest.Mock;
  };
}

/** 假合成器：返回一张假精灵表；可注入失败与并发观测。 */
function createFakeComposer(options: {
  fail?: boolean;
  /** 并发观测：合成期间同时在跑几个。 */
  track?: { current: number; max: number };
} = {}): CharacterComposer & { composeCharacter: jest.Mock } {
  const fake = createFakeCanvas();
  const composeCharacter = jest.fn(async () => {
    if (options.track) {
      options.track.current += 1;
      options.track.max = Math.max(options.track.max, options.track.current);
    }
    // 让出一次事件循环：真的在异步画图（并发观测才有意义）。
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (options.track) options.track.current -= 1;
    if (options.fail) throw new Error('合成炸了');
    return { canvas: fake.canvas, parts: [], credits: [] };
  });
  return { composeCharacter } as unknown as CharacterComposer & { composeCharacter: jest.Mock };
}

const APPEARANCE = { bodyType: 'male' as const, parts: { hair: 'black' } };

describe('单位形象精灵源（app 层实现）', () => {
  test('合成后裁出走路 4 行（宽度 = 走路列数 × 64，高 = 4 × 64）', async () => {
    const registry = createFakeRegistry();
    const composer = createFakeComposer();
    const band = createFakeCanvas();

    const source = createUnitSpriteSource({
      registry,
      composer,
      createCanvas: () => band.canvas,
    });

    const result = await source.loadWalkBand('character_1', APPEARANCE);

    expect(result).not.toBeNull();
    expect(result?.width).toBe(UNIT_SHEET_COLUMNS * FRAME_SIZE);
    expect(result?.height).toBe(4 * FRAME_SIZE);
    // 裁剪的源区域从走路动画的行偏移开始（不是从精灵表顶部）。
    expect(band.drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      ANIMATION_OFFSETS[DEFAULT_ANIMATION],
      UNIT_SHEET_COLUMNS * FRAME_SIZE,
      4 * FRAME_SIZE,
      0,
      0,
      UNIT_SHEET_COLUMNS * FRAME_SIZE,
      4 * FRAME_SIZE
    );
  });

  test('合成前先等素材元数据就绪（没有元数据就没有部位可选）', async () => {
    const registry = createFakeRegistry();
    const composer = createFakeComposer();
    const band = createFakeCanvas();

    const source = createUnitSpriteSource({
      registry,
      composer,
      createCanvas: () => band.canvas,
    });

    await source.loadWalkBand('character_1', APPEARANCE);

    expect(registry.loadMetadata).toHaveBeenCalled();
    expect(registry.getDefaultSelections).toHaveBeenCalledWith('male');
    expect(registry.resolveSelections).toHaveBeenCalledWith(APPEARANCE);
    expect(composer.composeCharacter).toHaveBeenCalledTimes(1);
  });

  test('合成失败 → 返 null（渲染侧回落到占位形体，不炸战场）', async () => {
    const registry = createFakeRegistry();
    const composer = createFakeComposer({ fail: true });
    const band = createFakeCanvas();

    const source = createUnitSpriteSource({
      registry,
      composer,
      createCanvas: () => band.canvas,
    });

    const result = await source.loadWalkBand('character_1', APPEARANCE);
    expect(result).toBeNull();
  });

  test('并发请求串行执行（合成共用一张画布，同时跑会互踩画面）', async () => {
    const registry = createFakeRegistry();
    const track = { current: 0, max: 0 };
    const composer = createFakeComposer({ track });
    const band = createFakeCanvas();

    const source = createUnitSpriteSource({
      registry,
      composer,
      createCanvas: () => band.canvas,
    });

    await Promise.all([
      source.loadWalkBand('character_1', APPEARANCE),
      source.loadWalkBand('character_2', APPEARANCE),
    ]);

    expect(track.max).toBe(1);
    expect(composer.composeCharacter).toHaveBeenCalledTimes(2);
  });
});
