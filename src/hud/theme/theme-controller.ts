/**
 * 文件职责：HUD 皮肤切换的总线响应器 —— 响应 HudCommand `theme.set`，本地加载 / 启停 token 样式表。
 *   来源：docs/REFACTOR_PLAN_V3.md §3「HUD 主题与像素风」(整体切换、组件零改动)。
 * 输入：宿主 document（HUD 挂载时传入）；通过 `apply()` 接收 HudCommand 中的 `theme.set`。
 * 输出：document.head 上挂的禁用 / 启用样式表（每套皮肤一张），控制 HUD 视觉整套切换。
 * 禁止事项：
 *   1. 直接接收 `--srf-*` 之外的样式 —— 本文件不负责任何组件级样式；
 *   2. 走任何框架（Vue / React / Pinia）—— 纯原生 DOM 接口；
 *   3. 副作用溢出 document.body —— 允许写入 document.head，不准动 body 内容；
 *   4. 同一皮肤重复加载——内部用 id 跟踪已注入 stylesheet，避免内存泄漏；
 *   5. 在本文件内部静态 import *.css——避免 bundler / jest transform 耦合，
 *      CSS 源应由调用方（dev-entry / 测试）通过 `sources` 注入。
 *
 * 设计要点：
 *   - 切换 = 切换 stylesheet 的 `disabled` 属性；不卸载 / 不重建 DOM，re-paint 极快；
 *   - 各套 token 文件均以 raw 字符串内联进 `<style>` 标签，避免静态资源路径与打包配置耦合；
 *   - 单元测试可通过 `StyleInjector` 桩把任意 CSS 注入，受测代码无 document 依赖；
 *   - 不内联 CSS 字面量，方便单测和未来按需延迟加载更多皮肤。
 */

/**
 * core 的 `theme.set` 命令载荷里认的皮肤 id（窄口径，见 core/types.ts）。
 * 皮肤库本身的完整词表见 skin-registry.ts 的 SkinId —— 本控制器按泛型放开，任意 id 都能切。
 */
export type ThemeId = 'default' | 'pixel';

/** 不同皮肤 stylesheet 的稳定 id，便于 `document.getElementById` 找回与避免重复挂载。 */
export const STYLE_ID_PREFIX = 'srf-theme-';

/** 测试用注入桩。允许测试代码传入伪 `style` 注入函数，把 document 副作用隔离掉。 */
export type StyleInjector = (id: string, css: string) => HTMLStyleElement;

/** 默认注入器：document 上挂 `<style>`；同 id 重复注入会被覆盖（避免泄漏）。 */
export const defaultStyleInjector: StyleInjector = (id, css) => {
  // 幂等：先清掉旧的同 id 标签，避免切换 / 重复挂载产生重复样式或意外覆盖。
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const style = document.createElement('style');
  style.id = id;
  style.appendChild(document.createTextNode(css));
  style.setAttribute('data-srf-theme', id.slice(STYLE_ID_PREFIX.length));
  document.head.appendChild(style);
  return style;
};

/**
 * 主题控制器：负责把所有 token 样式表挂到 document、决定当前激活哪一个。
 * 暴露 `apply(themeId)`，与 HudCommand.theme.set 一一对应。
 *
 * @since task_024：id 词表改为泛型 —— 控制器不再只认 default/pixel，新增皮肤不必改本文件
 *   （皮肤词表见 skin-registry.ts）。
 */
export interface ThemeController<Id extends string = string> {
  /** 切换 token 集合；同一 id 重复切换是 no-op。 */
  apply(themeId: Id): void;
  /** 当前激活皮肤。未知 = 还没切过（首次 apply 之前）。 */
  readonly current: Id | null;
}

export interface CreateThemeControllerOptions<Id extends string = string> {
  /**
   * 皮肤 id → CSS 字符串；由调用方提供，工厂不内联默认 CSS，方便单测。
   * 键类型取 string（不取 Id）：调用方（app / dev-entry）各自声明自己的 id 词表，
   * 这里再绑一次 Id 会让「只声明部分皮肤的调用方」被多余属性检查卡住。
   * id 词表的完整性由调用方自己的 Record<SkinId, string> 保证。
   */
  sources: Readonly<Record<string, string>>;
  /** 注入器；默认走 document.head。 */
  inject?: StyleInjector;
  /** 初始皮肤；可选，默认不预激活任何一套（首次 apply 才生效）。 */
  initial?: Id;
}

/**
 * 工厂：构造一个主题控制器。
 * 注意：默认行为会**一次性把所有 token 都注入到 DOM**，并把非初始的样式表 `disabled`。
 * 这样首次切换不需要再装载，零额外等待。
 */
export function createThemeController<Id extends string = string>(
  options: CreateThemeControllerOptions<Id>,
): ThemeController<Id> {
  const inject = options.inject ?? defaultStyleInjector;
  const styles = new Map<Id, HTMLStyleElement>();
  let current: Id | null = null;

  for (const id of Object.keys(options.sources) as Id[]) {
    const node = inject(STYLE_ID_PREFIX + id, options.sources[id]);
    if (options.initial !== id) node.disabled = true;
    styles.set(id, node);
  }
  if (options.initial) current = options.initial;

  const apply = (themeId: Id): void => {
    if (current === themeId) return;
    // 未知 id 直接报错：若放过，会把所有样式表 disable 掉，HUD 瞬间掉光 token（比报错更难查）。
    if (!styles.has(themeId)) throw new Error(`[theme-controller] unknown theme id: ${themeId}`);
    for (const [id, node] of styles) node.disabled = id !== themeId;
    current = themeId;
  };

  return { apply, get current() { return current; } };
}
