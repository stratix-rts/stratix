/**
 * 单测：**角色烘焙静默降级**（app/services/character-bake-service.ts，@since v3.3，task_196 / CP-02）。
 *
 * 权威定义：docs/DESIGN-asset-pipelines.md §2.2 纪律 2 ——
 *   「烘焙失败 ⇒ 自动回落运行时直接合成（CP-01 之前的现状路径），用户永远看到可用结果；
 *     失败只进内部日志/遥测，不弹错不阻塞。」
 *
 * 覆盖四类失败面（每类都要：静默回落 + 内部日志可事后定位）：
 *   ① 部件缺件（parts-missing）：元数据取不到 / 某层素材缺 / 合成计划为空；
 *   ② 渲染失败（render-failed）：合成抛错 / 整图 PNG 编码失败；
 *   ③ 缓存目录不可写（cache-unwritable）：落盘失败；
 *   ④ 版本损坏（cache-corrupt）：缓存产物的版本/键/指纹对不上，或缓存文件本身坏了。
 *
 * 零用户可见错误：任何失败都不许抛到调用方（调用方 = UI 那一侧），
 *   且运行时读缓存失败时必须返 null ⇒ 调用方走直合成（用户看到的仍是可用结果）。
 *
 * 边界说明：合成器 / 注册表 / 存取口都是**假实现**（注入失败是这里的正常手段），
 *   真素材 1.3G 不在仓内。
 */

import type { CharacterAppearance } from '../../core/types';
import { appearanceFingerprint, characterBakeKey } from '../../world/appearance/bake-cache-key';
import { buildBakedSheetMeta } from '../../world/appearance/bake-sheet-meta';
import type { CharacterComposer } from '../../world/appearance/character-composer';
import type { PartInfo } from '../../world/appearance/types';
import type { PartRegistry } from '../../world/appearance/part-registry';
import {
  createFakeCanvas,
  createFakeImageFactory,
} from '../../world/appearance/__tests__/helpers/fakes';

import {
  createCharacterBakeService,
  type CharacterBakeOutcome,
} from '../services/character-bake-service';
import {
  CharacterBakeStoreError,
  createMemoryCharacterBakeStore,
  type CharacterBakeEntry,
  type CharacterBakeStore,
} from '../services/character-bake-store';
import { createUnitSpriteSource } from '../services/unit-sprite-source';

const APPEARANCE: CharacterAppearance = {
  bodyType: 'male',
  parts: { hair: 'black', body: 'light' },
};
const AGENT_ID = 'char_1';
const SKIN = appearanceFingerprint(APPEARANCE);

/** 一层可画的层（合成计划非空 = 不是缺件面）。 */
const PART: PartInfo = {
  itemId: 'body',
  variant: 'light',
  spritePath: '/spritesheets/body/male/walk/light.png',
  zPos: 10,
  layerNum: 1,
  animation: 'walk',
  yPos: 0,
};

/** 假注册表：可注入「元数据加载失败」。 */
function createFakeRegistry(options: { failMetadata?: boolean } = {}): PartRegistry {
  return {
    loadMetadata: jest.fn(async () => {
      if (options.failMetadata) throw new Error('元数据取不到');
    }),
    getDefaultSelections: jest.fn(() => ({
      shadow: { itemId: 'shadow', variant: 'shadow' },
      body: { itemId: 'body', variant: 'light' },
    })),
    resolveSelections: jest.fn(() => ({ hair: { itemId: 'hair', variant: 'black' } })),
  } as unknown as PartRegistry;
}

/** 假合成器：可注入「抛错 / 缺件 / 空计划 / 编码失败」。 */
function createFakeComposer(
  options: {
    fail?: boolean;
    failedParts?: readonly string[];
    emptyPlan?: boolean;
    encodeFail?: boolean;
  } = {}
): CharacterComposer & { composeCharacter: jest.Mock } {
  const fake = createFakeCanvas();
  if (options.encodeFail) {
    // 编码炸了：toDataURL 抛错（真实浏览器里就是「画布 tainted / 上下文丢了」那类故障）。
    (fake.canvas as unknown as { toDataURL: () => string }).toDataURL = () => {
      throw new Error('编码炸了');
    };
  }
  const composeCharacter = jest.fn(async () => {
    if (options.fail) throw new Error('合成炸了');
    return {
      canvas: fake.canvas,
      parts: options.emptyPlan ? [] : [PART],
      credits: [],
      failedParts: options.failedParts ?? [],
    };
  });
  return { composeCharacter } as unknown as CharacterComposer & { composeCharacter: jest.Mock };
}

/** 假存取口：可注入「读失败 / 写失败」（失败种类可指定）。 */
function createFakeStore(
  options: {
    readError?: { kind: 'corrupt' | 'unavailable'; message: string };
    writeError?: { kind: 'corrupt' | 'unavailable'; message: string };
  } = {}
): CharacterBakeStore & { readonly writes: number } {
  const memory = createMemoryCharacterBakeStore();
  const state = { writes: 0 };
  return {
    get writes(): number {
      return state.writes;
    },
    async read(key: string): Promise<CharacterBakeEntry | null> {
      if (options.readError) {
        throw new CharacterBakeStoreError(options.readError.kind, options.readError.message);
      }
      return memory.read(key);
    },
    async write(
      key: string,
      pngBase64: string,
      meta: Parameters<typeof memory.write>[2]
    ): Promise<void> {
      if (options.writeError) {
        throw new CharacterBakeStoreError(options.writeError.kind, options.writeError.message);
      }
      state.writes += 1;
      await memory.write(key, pngBase64, meta);
    },
    async clear(): Promise<void> {
      await memory.clear();
    },
  };
}

/** 造一套服务（假合成器 + 假存取口 + 收集内部日志）。 */
function createService(
  options: {
    composer?: CharacterComposer & { composeCharacter: jest.Mock };
    store?: CharacterBakeStore | null;
    registry?: PartRegistry;
    composerVersion?: string;
  } = {}
): {
  service: ReturnType<typeof createCharacterBakeService>;
  composer: CharacterComposer & { composeCharacter: jest.Mock };
  store: CharacterBakeStore;
  logs: string[];
} {
  const composer = options.composer ?? createFakeComposer();
  const store = options.store === undefined ? createFakeStore() : options.store;
  const images = createFakeImageFactory();
  const logs: string[] = [];
  const service = createCharacterBakeService({
    registry: options.registry ?? createFakeRegistry(),
    composer,
    createCanvas: () => createFakeCanvas().canvas,
    createImage: images.createImage,
    store,
    logger: (line) => logs.push(line),
    ...(options.composerVersion ? { composerVersion: options.composerVersion } : {}),
  });
  return { service, composer, store: store as CharacterBakeStore, logs };
}

/** 日志里有没有「某原因 + agent + 皮肤」齐全的一条（事后可定位）。 */
function hasDegradeLog(logs: readonly string[], reason: string, agentId = AGENT_ID): boolean {
  return logs.some(
    (line) =>
      line.includes(`原因=${reason}`) &&
      line.includes(`agent=${agentId}`) &&
      line.includes(`skin=${SKIN}`)
  );
}

describe('角色烘焙静默降级（task_196 / CP-02）', () => {
  // ===== 失败面 ①：部件缺件 =====
  describe('失败面 ① 部件缺件', () => {
    test('某层素材取不到 ⇒ 不烘焙、不落盘、静默回落（日志含 agent/皮肤/原因）', async () => {
      const composer = createFakeComposer({ failedParts: ['/spritesheets/eyes/male/walk/light.png'] });
      const { service, store, logs } = createService({ composer });

      const outcome = await service.ensureBaked(AGENT_ID, APPEARANCE);

      expect(outcome).toBe('failed');
      // 坏产物不落盘（缺件的那张图不该被烤进缓存）。
      expect((store as unknown as { writes: number }).writes).toBe(0);
      // 运行时读不到缓存 ⇒ 调用方直合成（用户看到的仍是可用结果）。
      expect(await service.loadCachedSheet(AGENT_ID, APPEARANCE)).toBeNull();
      // 内部日志可事后定位：原因 + agent + 皮肤。
      expect(hasDegradeLog(logs, 'parts-missing')).toBe(true);
    });

    test('元数据取不到 ⇒ 静默回落（日志含 parts-missing）', async () => {
      const registry = createFakeRegistry({ failMetadata: true });
      const { service, logs } = createService({ registry });

      const outcome = await service.ensureBaked(AGENT_ID, APPEARANCE);

      expect(outcome).toBe('failed');
      expect(hasDegradeLog(logs, 'parts-missing')).toBe(true);
    });

    test('合成计划为空（什么层都没画上）⇒ 静默回落（日志含 parts-missing）', async () => {
      const composer = createFakeComposer({ emptyPlan: true });
      const { service, logs } = createService({ composer });

      const outcome = await service.ensureBaked(AGENT_ID, APPEARANCE);

      expect(outcome).toBe('failed');
      expect(hasDegradeLog(logs, 'parts-missing')).toBe(true);
    });
  });

  // ===== 失败面 ②：渲染失败 =====
  describe('失败面 ② 渲染失败', () => {
    test('合成抛错 ⇒ 静默回落（日志含 render-failed）', async () => {
      const composer = createFakeComposer({ fail: true });
      const { service, logs } = createService({ composer });

      const outcome = await service.ensureBaked(AGENT_ID, APPEARANCE);

      expect(outcome).toBe('failed');
      expect(hasDegradeLog(logs, 'render-failed')).toBe(true);
      expect(await service.loadCachedSheet(AGENT_ID, APPEARANCE)).toBeNull();
    });

    test('整图 PNG 编码失败 ⇒ 静默回落（日志含 render-failed）', async () => {
      const composer = createFakeComposer({ encodeFail: true });
      const { service, store, logs } = createService({ composer });

      const outcome = await service.ensureBaked(AGENT_ID, APPEARANCE);

      expect(outcome).toBe('failed');
      expect((store as unknown as { writes: number }).writes).toBe(0);
      expect(hasDegradeLog(logs, 'render-failed')).toBe(true);
    });
  });

  // ===== 失败面 ③：缓存目录不可写 =====
  describe('失败面 ③ 缓存目录不可写', () => {
    test('落盘失败 ⇒ 静默回落（日志含 cache-unwritable）', async () => {
      const store = createFakeStore({
        writeError: { kind: 'unavailable', message: 'EACCES: permission denied' },
      });
      const { service, logs } = createService({ store });

      const outcome = await service.ensureBaked(AGENT_ID, APPEARANCE);

      expect(outcome).toBe('failed');
      expect(hasDegradeLog(logs, 'cache-unwritable')).toBe(true);
      // 运行时读不到 ⇒ 直合成兜底。
      expect(await service.loadCachedSheet(AGENT_ID, APPEARANCE)).toBeNull();
    });
  });

  // ===== 失败面 ④：版本损坏 =====
  describe('失败面 ④ 版本损坏', () => {
    test('缓存产物版本号对不上 ⇒ 运行时判损坏并回落直合成（日志含 cache-corrupt）', async () => {
      const store = createMemoryCharacterBakeStore();
      const version = 'r1-aaaaaaaa';
      const key = characterBakeKey({ agentId: AGENT_ID, appearance: APPEARANCE, composerVersion: version });
      // 存一条「旧版本」的产物（键对得上，但元数据里的版本号是旧的）。
      await store.write(
        key,
        'UExBQw==',
        buildBakedSheetMeta({
          key,
          agentId: AGENT_ID,
          composerVersion: 'r0-oldold',
          skinFingerprint: SKIN,
          credits: [],
        })
      );
      const { service, logs } = createService({ store, composerVersion: version });

      const sheet = await service.loadCachedSheet(AGENT_ID, APPEARANCE);

      // 损坏的缓存不喂给运行时 ⇒ 调用方直合成（用户看到的仍是可用结果）。
      expect(sheet).toBeNull();
      expect(hasDegradeLog(logs, 'cache-corrupt')).toBe(true);
    });

    test('缓存文件本身坏了（读出来就是坏的）⇒ 判损坏并回落（日志含 cache-corrupt）', async () => {
      const store = createFakeStore({
        readError: { kind: 'corrupt', message: '元数据 JSON 损坏' },
      });
      const { service, logs } = createService({ store });

      const sheet = await service.loadCachedSheet(AGENT_ID, APPEARANCE);

      expect(sheet).toBeNull();
      expect(hasDegradeLog(logs, 'cache-corrupt')).toBe(true);
      expect(logs.join('\n')).toContain('元数据 JSON 损坏');
    });

    test('损坏的缓存会被下一次触发重烘修好（不自愈就永远坏着）', async () => {
      const store = createMemoryCharacterBakeStore();
      const version = 'r1-aaaaaaaa';
      const key = characterBakeKey({ agentId: AGENT_ID, appearance: APPEARANCE, composerVersion: version });
      await store.write(
        key,
        'UExBQw==',
        buildBakedSheetMeta({
          key,
          agentId: AGENT_ID,
          composerVersion: 'r0-oldold',
          skinFingerprint: SKIN,
          credits: [],
        })
      );
      const { service, logs } = createService({ store, composerVersion: version });

      const outcome = await service.ensureBaked(AGENT_ID, APPEARANCE);

      expect(outcome).toBe('baked');
      expect(hasDegradeLog(logs, 'cache-corrupt')).toBe(true);
      // 修好之后运行时就能读到缓存图了。
      expect(await service.loadCachedSheet(AGENT_ID, APPEARANCE)).not.toBeNull();
    });
  });

  // ===== 零用户可见错误 =====
  describe('零用户可见错误', () => {
    test('四类失败都不抛到调用方（返回值表示结果，异常不冒泡到 UI 层）', async () => {
      const cases: Array<{
        options: {
          composer?: CharacterComposer & { composeCharacter: jest.Mock };
          store?: CharacterBakeStore;
          registry?: PartRegistry;
        };
        /** 期望的结果（读缓存坏了会被这次触发重烘修好 ⇒ 那是 baked，不是 failed）。 */
        expected: CharacterBakeOutcome;
      }> = [
        { options: { composer: createFakeComposer({ failedParts: ['/x.png'] }) }, expected: 'failed' },
        { options: { composer: createFakeComposer({ fail: true }) }, expected: 'failed' },
        { options: { composer: createFakeComposer({ encodeFail: true }) }, expected: 'failed' },
        {
          options: { store: createFakeStore({ writeError: { kind: 'unavailable', message: '磁盘满了' } }) },
          expected: 'failed',
        },
        {
          options: { store: createFakeStore({ readError: { kind: 'corrupt', message: '文件坏了' } }) },
          expected: 'baked',
        },
        { options: { registry: createFakeRegistry({ failMetadata: true }) }, expected: 'failed' },
      ];

      for (const item of cases) {
        const { service } = createService(item.options);
        // ensureBaked 不 reject（失败 = 返回 failed，而不是抛）。
        await expect(service.ensureBaked(AGENT_ID, APPEARANCE)).resolves.toBe(item.expected);
        // loadCachedSheet 不 reject，且失败时返 null（调用方直合成）。
        await expect(service.loadCachedSheet(AGENT_ID, APPEARANCE)).resolves.toBeNull();
      }
    });

    test('触发面 syncCharacters 遇到失败也不抛（状态广播不能被烘焙失败带崩）', async () => {
      const { service, logs } = createService({ composer: createFakeComposer({ fail: true }) });

      expect(() =>
        service.syncCharacters([{ id: AGENT_ID, appearance: APPEARANCE }])
      ).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(hasDegradeLog(logs, 'render-failed')).toBe(true);
    });

    test('端到端：烘焙失败后战场仍拿到可用形象（直合成兜底，不弹错不空场）', async () => {
      // 存取口写不进去（失败面 ③）⇒ 烘焙必失败。
      const store = createFakeStore({
        writeError: { kind: 'unavailable', message: 'EACCES: permission denied' },
      });
      const { service, logs } = createService({ store });

      // 触发烘焙 ⇒ 落盘失败（失败面 ③）⇒ 静默降级。
      expect(await service.ensureBaked(AGENT_ID, APPEARANCE)).toBe('failed');
      expect(hasDegradeLog(logs, 'cache-unwritable')).toBe(true);

      const source = createUnitSpriteSource({
        registry: createFakeRegistry(),
        composer: createFakeComposer(),
        createCanvas: () => createFakeCanvas().canvas,
        loadCachedSheet: (characterId: string, appearance: CharacterAppearance) =>
          service.loadCachedSheet(characterId, appearance),
      });

      const band = await source.loadWalkBand(AGENT_ID, APPEARANCE);

      // 用户看到的仍是可用结果（一条精灵带），不是错误、不是空场。
      expect(band).not.toBeNull();
      expect(band?.height).toBeGreaterThan(0);
    });
  });
});
