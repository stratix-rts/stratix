/**
 * 文件职责：**Phaser 最小桩**（@since v3.3，task_190 / docs/DESIGN-project-map.md §7.1「M1-16」行）。
 *
 * ============ 为什么需要它 ============
 *   验收脚本要在 **node** 里跑真实的 `BattlefieldScene`（战场场景）—— 它是「切副本零残留」
 *   的**表现态主人**（单位表 / 地图槽 / 站位种子都在它身上）。
 *   但 Phaser 3 需要 window / document / canvas ⇒ node 里跑不起来。
 *   ⇒ 本文件把 `phaser` 模块换成**最小桩**：只提供场景类与场景生命周期所需的成员，
 *   其余一律「万能空对象」（任何方法调用返回自己 ⇒ 链式调用不炸）。
 *
 * ============ 桩的边界（诚实声明）============
 *   被替掉的只有 **Phaser 框架本身**（渲染 / 输入 / 动画）——
 *   场景的**业务逻辑**（init 的四板清理 / syncUnits 的对账 / create 的站位种子读取）
 *   一行没改，跑的是**真类**。
 *   这与仓库既有做法同源：`src/world/__tests__/battlefield-scene-reset.test.ts`
 *   用 `jest.mock('phaser')` 换掉同一层（那里只测真场景的 init）。
 *
 * ============ 桩里唯一「有行为」的三处 ============
 *   ① `events` —— 迷你事件发射器：`once` / `on` / `off` / `emit` 真跑，**且支持 context 绑定**。
 *      为什么必须有：Phaser 的 `scene.start` 会先 `sys.shutdown()`（⇒ emit SHUTDOWN）
 *      再 `init` + `create`；场景在 `create()` 里注册了
 *      `events.once(SHUTDOWN, onShutdown, this)`（⇒ 退订总线、析构表现层）。
 *      桩不发射 SHUTDOWN ⇒ 旧桥接层不退订 ⇒ 订阅泄漏 ⇒ 断言会被重复转发污染。
 *      why 要 context：Phaser 的 `once(event, fn, ctx)` 用 `fn.call(ctx)` 调一次 ——
 *      不绑 this 的话 `this.onShutdown` 里的 `this.bridge` 是 undefined ⇒ 直接炸。
 *   ② `registry` —— 键仓（Phaser 的 `game.registry` 是 DataManager）：
 *      站位种子键就住在里面（`stratix:unit-position-seed:<instanceId>`）。
 *      why 不是普通 Map：`PositionSeedStore` 要的是 `remove(key)`，Map 只有 `delete`。
 *   ③ `cameras.main` —— **带真数字**的相机（scrollX / scrollY / width / height / zoom）：
 *      `CameraController` 会读写这五个字段（`camera.width / 2` 参与算位姿）⇒
 *      万能空对象会让位姿算成 NaN。
 *
 * 输入：无（作为 `phaser` 模块被 import）。
 * 输出：Phaser 桩（`Scene` 类 + `Scenes.Events` + 万能空对象）。
 * 禁止事项：
 *   1. 在桩里实现任何 Stratix 业务 —— 桩只提供 Phaser 形状；
 *   2. 让桩「顺手」把断言做掉 —— 断言在驱动脚本里。
 */

/** 迷你事件发射器（Phaser 的 `scene.events` 形状的最小实现）。 */
export class StubEventEmitter {
  private readonly handlers = new Map<string, Set<(payload?: unknown) => void>>();
  /** 每个 handler 绑定的 context（Phaser 的 `once(event, fn, ctx)` 语义）。 */
  private readonly contexts = new Map<(payload?: unknown) => void, unknown>();

  on(event: string, handler: (payload?: unknown) => void, context?: unknown): this {
    const bucket = this.handlers.get(event) ?? new Set();
    bucket.add(handler);
    this.handlers.set(event, bucket);
    if (context !== undefined) this.contexts.set(handler, context);
    return this;
  }

  once(event: string, handler: (payload?: unknown) => void, context?: unknown): this {
    // context 在闭包里捕获（Phaser 的 `once(event, fn, ctx)` 用 `fn.call(ctx)` 调一次）。
    const wrapped = (payload?: unknown): void => {
      this.off(event, wrapped);
      handler.call(context, payload);
    };
    return this.on(event, wrapped);
  }

  off(event: string, handler: (payload?: unknown) => void): this {
    this.handlers.get(event)?.delete(handler);
    this.contexts.delete(handler);
    return this;
  }

  emit(event: string, payload?: unknown): this {
    for (const handler of Array.from(this.handlers.get(event) ?? [])) {
      handler.call(this.contexts.get(handler), payload);
    }
    return this;
  }
}

/**
 * 万能空对象：任何属性读取都得到「另一个万能空对象」，任何方法调用返回它自己。
 * why 用 Proxy 而不是逐个列成员：Phaser 的 API 面很大，逐个列必然漏；
 *   漏掉的成员会让**真场景**在 node 里炸掉 ⇒ 断言跑不完。
 * why 不能返回 `undefined`：很多真代码要的是「可链式调用的对象」（Phaser 的显示对象都是）。
 * why 已写入的属性要能读回来：`camera.scrollX = 128` 之后读 `camera.scrollX` 必须还是 128
 *   （相机控制器每帧都这么读写）⇒ get 陷阱先看目标对象上有没有这个键。
 */
function makeUniversal(name: string): any {
  const fn: any = function universalStub(..._args: unknown[]) {
    return fn;
  };
  return new Proxy(fn, {
    get(target, prop) {
      // then：不能被当成 thenable（否则 await 会误判）。
      if (prop === 'then') return undefined;
      // Symbol.toPrimitive / toString：字符串化时不能抛（真代码会做模板拼接）。
      if (prop === Symbol.toPrimitive) return () => name;
      if (prop === 'toString') return () => name;
      // 迭代：真代码可能 for...of 遍历 ⇒ 给个空迭代器（不是抛错）。
      if (prop === Symbol.iterator) return () => [][Symbol.iterator]();
      // 已显式写入的成员优先（数值字段靠这条活下来）。
      if (Reflect.has(target, prop)) return Reflect.get(target, prop);
      return makeUniversal(`${name}.${String(prop)}`);
    },
    construct() {
      return makeUniversal(`${name}.new`);
    },
    apply() {
      return makeUniversal(`${name}.call`);
    },
  });
}

/**
 * 键仓（Phaser `game.registry` 的形状 + `PositionSeedStore` 的形状）。
 * why 要 `remove`：站位种子的旧全局键在迁移后**必须删掉**（不留回落口）——
 *   `PositionSeedStore.remove` 是契约的一部分，普通 Map 的 `delete` 不满足。
 */
export class StubRegistry {
  private readonly entries = new Map<string, unknown>();

  get(key: string): unknown {
    return this.entries.get(key);
  }

  set(key: string, value: unknown): unknown {
    this.entries.set(key, value);
    return this;
  }

  remove(key: string): void {
    this.entries.delete(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** 键清单（断言用：看「种子键分家」时不用猜键名）。 */
  keys(): string[] {
    return [...this.entries.keys()].sort();
  }
}

/** Phaser 场景基类（只提供场景生命周期要用的成员）。 */
export class Scene {
  /** 场景配置（Phaser 的 `scene.settings`）。 */
  settings: unknown;
  /** 相机（`this.cameras.main` —— 场景的相机控制器要拿它；**带真数字**，见文件头）。 */
  cameras: any = Object.assign(makeUniversal('cameras'), {
    main: Object.assign(makeUniversal('camera.main'), {
      scrollX: 0,
      scrollY: 0,
      width: 1280,
      height: 720,
      zoom: 1,
    }),
  });
  /** 键仓（Phaser 的 `game.registry` 的形状；站位种子键住这儿）。 */
  registry: StubRegistry = new StubRegistry();
  /** 显示列表（`this.add.*` —— 渲染层建对象用）。 */
  add: any = makeUniversal('add');
  /** 补间。 */
  tweens: any = makeUniversal('tweens');
  /** 场景时钟（`this.time.now` —— 气泡板取时间用）。 */
  time: any = Object.assign(makeUniversal('time'), { now: 0 });
  /** 视口尺寸。 */
  scale: any = Object.assign(makeUniversal('scale'), { width: 1280, height: 720 });
  /** 场景事件（迷你发射器 —— SHUTDOWN 要真发射）。 */
  events: StubEventEmitter = new StubEventEmitter();
  /** 输入。 */
  input: any = makeUniversal('input');
  /** 资源加载。 */
  load: any = makeUniversal('load');
  /** 纹理。 */
  textures: any = Object.assign(makeUniversal('textures'), { exists: () => false });
  /** 动画 / 声音 / 子对象 / 插件 / 其它插件面。 */
  anims: any = makeUniversal('anims');
  sound: any = makeUniversal('sound');
  data: any = makeUniversal('data');
  children: any = makeUniversal('children');
  plugins: any = makeUniversal('plugins');
  make: any = makeUniversal('make');
  game: any = makeUniversal('game');
  sys: any = makeUniversal('sys');
  scene: any = makeUniversal('scene');

  constructor(config?: unknown) {
    this.settings = config ?? {};
  }
}

/** Phaser 命名空间（未知成员一律给万能空对象）。 */
const Phaser: any = new Proxy(
  { Scene, Scenes: { Events: { SHUTDOWN: 'shutdown' } } },
  {
    get(target, prop) {
      if (prop in target) return (target as any)[prop];
      return makeUniversal(`Phaser.${String(prop)}`);
    },
  }
);

export default Phaser;
