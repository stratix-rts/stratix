/**
 * 单测：**代码路由特效层**（world/objects/code-fx-layer.ts）——
 *   运行时算出来的特效怎么挂到战场上，以及护栏是不是真的开着。
 *
 * 覆盖（task_194 / AP-04 验收标准 ①）：
 *   ① 世界锚定：上屏的 Image 是 scrollFactor = 1、原点按效果原点对齐、缩放按源；
 *   ② 护栏全开：渲染频率 = 生产档（30Hz）、并发上限 = 生产档（2 条）；
 *   ③ 面积超限 → 永远不播（成本与面积成正比）；
 *   ④ 效果自己炸了 → 静默不播（不抛异常拖垮战场）。
 *
 * why 要打 Phaser 桩：node 环境跑不起 Phaser（无 window/document）——
 *   被测的 play() 只碰四个 Phaser 能力（画布纹理 / 显示对象 / registry / 相机视口），
 *   桩足够（渲染循环的推进另有 dev 入口在浏览器里验过）。
 *
 * @jest-environment node
 *
 * @since v3.3（task_194 / AP-04）
 */

jest.mock('phaser', () => ({
  __esModule: true,
  default: {
    Textures: { FilterMode: { NEAREST: 'nearest' } },
  },
}));

import { CODE_FX_METRICS } from '../../../core/theme/visual-spec';
import { CodeFxLayer, type CodeFxSource } from '../code-fx-layer';

/** 一个上屏的 Image 桩（记录关键调用）。 */
interface FakeImage {
  x: number;
  y: number;
  textureKey: string;
  originX: number;
  originY: number;
  scale: number;
  depth: number;
  scrollFactor: number;
  destroyed: boolean;
}

/** 造一个 Phaser 场景桩（只提供被测代码碰到的能力）。 */
function makeScene(): { scene: Phaser.Scene; images: FakeImage[] } {
  const images: FakeImage[] = [];
  const scene = {
    registry: { get: () => undefined },
    textures: {
      createCanvas: (key: string) => ({
        key,
        setFilter: () => undefined,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4),
          }),
        }),
        refresh: () => undefined,
      }),
      remove: () => undefined,
    },
    add: {
      image: (x: number, y: number, textureKey: string): FakeImage => {
        const image: FakeImage = {
          x,
          y,
          textureKey,
          originX: 0.5,
          originY: 0.5,
          scale: 1,
          depth: 0,
          scrollFactor: 1,
          destroyed: false,
        };
        images.push(image);
        return {
          ...image,
          setOrigin(ox: number, oy: number) {
            image.originX = ox;
            image.originY = oy;
            return this;
          },
          setScale(value: number) {
            image.scale = value;
            return this;
          },
          setDepth(value: number) {
            image.depth = value;
            return this;
          },
          setScrollFactor(value: number) {
            image.scrollFactor = value;
            return this;
          },
          destroy() {
            image.destroyed = true;
          },
        } as unknown as FakeImage;
      },
    },
    time: { now: 0 },
    cameras: { main: { worldView: { x: 0, y: 0, right: 800, bottom: 600 } } },
  };
  return { scene: scene as unknown as Phaser.Scene, images };
}

/** 造一个特效源（默认 = 生产那条 heal 的形状）。 */
function makeSource(over: Partial<CodeFxSource> = {}): CodeFxSource {
  return {
    kind: 'heal',
    width: 256,
    height: 136,
    originX: 128,
    originY: 104,
    durationMs: 2900,
    loop: false,
    scale: 0.4,
    paletteRoles: ['success', 'success', 'success', 'success', 'success', 'accent', 'text', 'text'],
    create: () => ({ update: () => undefined, render: () => undefined, done: false }),
    ...over,
  };
}

describe('代码路由特效层：世界锚定', () => {
  test('上屏的 Image 锚在世界坐标（scrollFactor = 1），原点 / 缩放按效果源对齐', () => {
    const { scene, images } = makeScene();
    const layer = new CodeFxLayer(scene, [makeSource()]);

    expect(layer.play('heal', 320, 480)).toBe(true);

    expect(images).toHaveLength(1);
    const image = images[0];
    // 世界锚定：scrollFactor = 1（相机怎么动，特效就怎么动）。
    expect(image.scrollFactor).toBe(1);
    // 原点按效果原点对齐（挂载点 = 效果原点，与 sheet 路由的枢轴口径一致）。
    expect(image.originX).toBeCloseTo(128 / 256);
    expect(image.originY).toBeCloseTo(104 / 136);
    expect(image.scale).toBe(0.4);
    expect(image.depth).toBe(CODE_FX_METRICS.depth);
  });

  test('没登记的 kind → 不播（静默 false）', () => {
    const { scene, images } = makeScene();
    const layer = new CodeFxLayer(scene, [makeSource()]);

    expect(layer.play('nope', 10, 10)).toBe(false);
    expect(images).toHaveLength(0);
  });
});

describe('代码路由特效层：护栏全开', () => {
  test('渲染频率 = 生产档（30Hz）', () => {
    const { scene } = makeScene();
    const layer = new CodeFxLayer(scene, [makeSource()]);

    expect(layer.currentRenderHz).toBe(CODE_FX_METRICS.renderHz);
  });

  test('并发上限 = 生产档：第 3 条挤掉最老的一条，屏上仍是 2 条', () => {
    const { scene } = makeScene();
    const layer = new CodeFxLayer(scene, [makeSource()]);

    layer.play('heal', 0, 0);
    layer.play('heal', 10, 10);
    expect(layer.activeCount).toBe(2);

    layer.play('heal', 20, 20);
    expect(layer.activeCount).toBe(CODE_FX_METRICS.maxConcurrent);
  });

  test('面积超限 → 永远不播（护栏的第一道闸）', () => {
    const { scene, images } = makeScene();
    const tooBig = makeSource({ width: 512, height: 136 });
    const layer = new CodeFxLayer(scene, [tooBig]);

    expect(layer.play('heal', 0, 0)).toBe(false);
    expect(images).toHaveLength(0);
    expect(layer.activeCount).toBe(0);
  });

  test('效果自己炸了 → 静默不播（不抛异常拖垮战场）', () => {
    const { scene, images } = makeScene();
    const broken = makeSource({
      create: () => {
        throw new Error('效果炸了');
      },
    });
    const layer = new CodeFxLayer(scene, [broken]);

    expect(() => layer.play('heal', 0, 0)).not.toThrow();
    expect(layer.play('heal', 0, 0)).toBe(false);
    expect(images).toHaveLength(0);
  });
});

describe('代码路由特效层：效果源查询（路由裁决用）', () => {
  test('登记过的 kind → hasKind = true；没登记的 → false', () => {
    const { scene } = makeScene();
    const layer = new CodeFxLayer(scene, [makeSource()]);

    expect(layer.hasKind('heal')).toBe(true);
    expect(layer.hasKind('nope')).toBe(false);
  });
});
