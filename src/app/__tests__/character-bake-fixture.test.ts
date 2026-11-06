/**
 * 单测：**角色烘焙夹具 · 缓存失效 / 降级路径 / 整体重建**（@since v3.3，task_197 / CP-03）。
 *
 * 权威定义：docs/DESIGN-asset-pipelines.md §2.2 三条纪律 ——
 *   1. 缓存键 = agent 标识 + 皮肤 + Composer 版本号（版本变 ⇒ 旧图自动失效重烘）；
 *   2. 静默降级（失败只进内部日志，用户永远看到可用结果）；
 *   3. 本地缓存可整体重建（删缓存目录 ⇒ 下次触发全量重烘）。
 *
 * ★ 与 CP-01 / CP-02 单测的差别：那些用**假注册表 + 假合成器**（验的是「服务怎么调度」）；
 *   这里用**真 PartRegistry + 真 CharacterComposer**（生产代码不打桩），
 *   素材元数据用仓内夹具 —— 于是「烘焙出来的东西」也是真的（能读出像素、能落 PNG）。
 *
 * ★ 失败注入沿用 CP-02 的手法（把失败注入到**边界**：图片工厂 / 元数据 fetch / 缓存写盘），
 *   但走的是**真合成器** —— 于是降级判据（缺件面）验的是真逻辑，不是假返回值。
 */

import type { CharacterAppearance } from '../../core/types';
import { characterBakeKey } from '../../world/appearance/bake-cache-key';
import {
  createFixtureComposer,
  createPaintingCanvas,
} from '../../world/appearance/__tests__/helpers/bake-fixture';

import { createCharacterBakeService } from '../services/character-bake-service';
import {
  createMemoryCharacterBakeStore,
  type CharacterBakeStore,
} from '../services/character-bake-store';

const AGENT_ID = 'char_1';
const APPEARANCE: CharacterAppearance = {
  bodyType: 'male',
  parts: { body: 'light', hair: 'black', eyes: 'blue' },
};

/** 造一套「真合成器 + 内存存取口」的烘焙服务。 */
async function createService(
  options: {
    store?: CharacterBakeStore;
    composerVersion?: string;
    failImages?: boolean;
    failMetadata?: boolean;
  } = {}
) {
  const { composer, registry, images } = await createFixtureComposer({
    failImages: options.failImages ?? false,
    failMetadata: options.failMetadata ?? false,
  });
  // 烘焙服务自己那张整精灵图画布（合成目标就画在它上面）。
  const sheetCanvas = createPaintingCanvas();
  const store = (options.store ??
    createMemoryCharacterBakeStore()) as CharacterBakeStore & { size?: () => number };
  const logs: string[] = [];
  const composeSpy = jest.spyOn(composer, 'composeCharacter');

  const service = createCharacterBakeService({
    registry,
    composer,
    createCanvas: () => sheetCanvas.canvas,
    createImage: images.createImage,
    store,
    logger: (line) => logs.push(line),
    ...(options.composerVersion ? { composerVersion: options.composerVersion } : {}),
  });

  /** 缓存里现在有几条产物（内存存取口才有条数；自定义存取口一律按 0 计）。 */
  const storeSize = (): number => (typeof store.size === 'function' ? store.size() : 0);

  return { service, composer, composeSpy, store, storeSize, logs, sheetCanvas };
}

/** 日志里有没有「原因 + agent」齐全的一条（事后可定位）。 */
function hasDegradeLog(logs: readonly string[], reason: string): boolean {
  return logs.some((line) => line.includes(`原因=${reason}`) && line.includes(`agent=${AGENT_ID}`));
}

describe('烘焙夹具 · 缓存失效（纪律 1：版本变 ⇒ 旧图自动作废重烘）', () => {
  test('同一版本重复触发：不重新合成（复用落盘的整图）', async () => {
    const { service, composeSpy } = await createService();

    expect(await service.ensureBaked(AGENT_ID, APPEARANCE)).toBe('baked');
    expect(await service.ensureBaked(AGENT_ID, APPEARANCE)).toBe('cached');

    expect(composeSpy).toHaveBeenCalledTimes(1);
  });

  test('版本号变 ⇒ 新键 ⇒ 重新烘焙（旧图不再被用）', async () => {
    const store = createMemoryCharacterBakeStore();
    const old = await createService({ store, composerVersion: 'r1-aaaaaaaa' });
    await old.service.ensureBaked(AGENT_ID, APPEARANCE);

    const next = await createService({ store, composerVersion: 'r2-bbbbbbbb' });
    const outcome = await next.service.ensureBaked(AGENT_ID, APPEARANCE);

    expect(outcome).toBe('baked');
    expect(next.composeSpy).toHaveBeenCalledTimes(1);
    // 两条产物并存（键不同互不干扰），新键另起一份。
    expect(store.size()).toBe(2);
    const newKey = characterBakeKey({
      agentId: AGENT_ID,
      appearance: APPEARANCE,
      composerVersion: 'r2-bbbbbbbb',
    });
    expect(await store.read(newKey)).not.toBeNull();
  });

  test('换肤（皮肤指纹变）⇒ 新键 ⇒ 重新烘焙', async () => {
    const store = createMemoryCharacterBakeStore();
    const first = await createService({ store });
    await first.service.ensureBaked(AGENT_ID, APPEARANCE);

    const other = await createService({ store });
    const outcome = await other.service.ensureBaked(AGENT_ID, {
      ...APPEARANCE,
      parts: { ...APPEARANCE.parts, eyes: 'green' },
    });

    expect(outcome).toBe('baked');
    expect(other.composeSpy).toHaveBeenCalledTimes(1);
    expect(store.size()).toBe(2);
  });

  test('烤进缓存的是**这次真实合成**的产物（PNG 非空、画布上确实有像素）', async () => {
    const { service, store, storeSize, sheetCanvas } = await createService();

    await service.ensureBaked(AGENT_ID, APPEARANCE);

    const key = characterBakeKey({ agentId: AGENT_ID, appearance: APPEARANCE });
    const entry = await store.read(key);
    expect(entry).not.toBeNull();
    expect(entry?.pngBase64.length).toBeGreaterThan(0);
    // 画布上确实画过东西（像素数 > 0，笔数 > 0）—— 不是空表。
    expect(sheetCanvas.paintedCount()).toBeGreaterThan(0);
    expect(sheetCanvas.draws.length).toBeGreaterThan(0);
    // 运行时能把这张缓存图读回来（尺寸 = 整张精灵表）。
    const sheet = await service.loadCachedSheet(AGENT_ID, APPEARANCE);
    expect(sheet?.width).toBe(832);
    expect(sheet?.height).toBe(3456);
  });
});

describe('烘焙夹具 · 降级路径（纪律 2：静默降级，用户永远看到可用结果）', () => {
  test('素材取不到（图片全失败）⇒ 不落盘、静默回落（内部日志含 parts-missing）', async () => {
    const { service, storeSize, logs, composeSpy } = await createService({ failImages: true });

    const outcome = await service.ensureBaked(AGENT_ID, APPEARANCE);

    expect(outcome).toBe('failed');
    expect(storeSize()).toBe(0);
    expect(composeSpy).toHaveBeenCalledTimes(1);
    // 运行时读不到缓存 ⇒ 调用方直合成（用户看到的仍是可用结果）。
    expect(await service.loadCachedSheet(AGENT_ID, APPEARANCE)).toBeNull();
    // 内部日志可事后定位：原因 + agent + 皮肤。
    expect(hasDegradeLog(logs, 'parts-missing')).toBe(true);
  });

  test('元数据取不到 ⇒ 合成计划为空 ⇒ 静默回落（内部日志含 parts-missing）', async () => {
    const { service, storeSize, logs } = await createService({ failMetadata: true });

    const outcome = await service.ensureBaked(AGENT_ID, APPEARANCE);

    expect(outcome).toBe('failed');
    expect(storeSize()).toBe(0);
    expect(hasDegradeLog(logs, 'parts-missing')).toBe(true);
    expect(await service.loadCachedSheet(AGENT_ID, APPEARANCE)).toBeNull();
  });

  test('缓存目录不可写 ⇒ 静默回落（内部日志含 cache-unwritable）', async () => {
    const store: CharacterBakeStore = {
      read: async () => null,
      write: async () => {
        throw new Error('磁盘满了');
      },
      clear: async () => undefined,
    };
    const { service, logs } = await createService({ store });

    expect(await service.ensureBaked(AGENT_ID, APPEARANCE)).toBe('failed');
    expect(hasDegradeLog(logs, 'cache-unwritable')).toBe(true);
  });

  test('降级不抛到调用方（返回值表示结果，异常不冒泡到 UI 层）', async () => {
    const { service } = await createService({ failImages: true });

    await expect(service.ensureBaked(AGENT_ID, APPEARANCE)).resolves.toBe('failed');
    await expect(service.loadCachedSheet(AGENT_ID, APPEARANCE)).resolves.toBeNull();
  });
});

describe('烘焙夹具 · 整体重建（纪律 3：删缓存目录 ⇒ 下次触发全量重烘）', () => {
  test('清掉缓存后下次触发全量重烘（删目录 ⇒ 无其他依赖）', async () => {
    const { service, composeSpy, storeSize } = await createService();

    expect(await service.ensureBaked(AGENT_ID, APPEARANCE)).toBe('baked');
    expect(storeSize()).toBe(1);

    await service.clearCache();
    expect(storeSize()).toBe(0);

    expect(await service.ensureBaked(AGENT_ID, APPEARANCE)).toBe('baked');
    expect(composeSpy).toHaveBeenCalledTimes(2);
    expect(storeSize()).toBe(1);
  });

  test('重建后产物照样能用（运行时能读回整图）', async () => {
    const { service, storeSize } = await createService();

    await service.ensureBaked(AGENT_ID, APPEARANCE);
    await service.clearCache();
    await service.ensureBaked(AGENT_ID, APPEARANCE);

    const sheet = await service.loadCachedSheet(AGENT_ID, APPEARANCE);
    expect(sheet).not.toBeNull();
    expect(sheet?.width).toBe(832);
    expect(storeSize()).toBe(1);
  });
});
