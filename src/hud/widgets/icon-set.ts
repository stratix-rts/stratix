/**
 * 文件职责：**HUD 图标组**（@since v3.6，task_121）—— 全站唯一的 SVG 图标来源。
 *
 * ============ 为什么要有这一层 ============
 *   审美评估原话：「emoji 当功能图标 = 西装配拖鞋」。emoji 是**字形**不是图标：
 *     它跟着系统字体走、跨平台长得不一样、没法跟"描边 + 圆角端点"的线条风对齐。
 *   本文件把这层换成**手写 inline SVG**，并且满足三条硬要求：
 *     ① **统一风格**（唯一口径，改这一处就够）：24×24 视图框、1.5px 描边、
 *        圆角端点 / 圆角拐角、fill:none（纯线条不填色块）、currentColor 取色。
 *     ② **走皮肤 token**：颜色不写死 —— 走 currentColor，由组件的 CSS 变量
 *        （--srf-text / --srf-accent / --srf-warn…）驱动，换皮肤自动跟随，
 *        像素皮肤将来换一套同构图标即可（不改任何组件）。
 *     ③ **像素位预留**：图标按「图标集（IconSet）」组织 —— 同一组**图标名**，
 *        每个皮肤一套路径数据（现代风线条版 / 像素风方块版是同构的）。
 *        组件只认图标名，不认路径 → 换图标集 = 换一张表，组件零改动。
 *
 * 输入：图标名（IconName）+ 可选的图标集 id。
 * 输出：inline SVG 字符串（可直接进 innerHTML —— 内容全部来自本文件的常量表，非用户输入）。
 * 禁止事项：
 *   1. 引入图标库 / 动画库依赖 —— 手写 inline SVG（依赖纪律：零新增 npm 包）；
 *   2. 在本文件里写死颜色 —— 一律 currentColor；
 *   3. 在组件里各画各的图标 —— 图标只有这一处（组件按图标名取）；
 *   4. import core / world / app —— 图标组是纯数据，零依赖（可被任何层引）。
 */

/** 视图框（唯一口径：24×24 方格）。 */
export const ICON_VIEW_BOX = '0 0 24 24';

/** 默认描边宽度（px）—— 线条风的"标准笔"粗细。 */
export const ICON_STROKE_WIDTH = 1.5;

/**
 * 图标名清单（= 图标组的"词表"）。
 * why 是显式联合类型而不是 `Record<string, string>`：少写一个图标名要**编译期**报错，
 *   而不是运行时画不出东西。
 */
export type IconName =
  // —— 顶栏四件（@since v3.6，task_121 替换 emoji）——
  | 'sound'
  | 'sound-muted'
  | 'director'
  | 'demo'
  | 'more'
  // —— 溢出菜单五项 ——
  | 'chat'
  | 'sessions'
  | 'character'
  | 'settings'
  | 'palette'
  // —— 通用件 ——
  | 'close'
  | 'check'
  | 'chevron-down'
  | 'layers'
  | 'plus'
  | 'command'
  | 'back'
  | 'search'
  | 'filter'
  | 'warning'
  | 'info'
  | 'replay';

/**
 * 渲染模式（@since v3.8，task_135）。
 *   stroke = 线条描边（现代风：fill:none + currentColor 描边）；
 *   fill   = 实心方块（像素风：每个美术像素是**填色的方块**，不是描边 —— 描边出来的
 *            "像素" 仍然是矢量线条，只是拐角变方 —— 这正是用户验收退回的那一版）。
 */
export type IconRenderMode = 'stroke' | 'fill';

/**
 * 一套图标（同构的一组路径数据）。
 * why 路径存"内联片段"而不是裸 `d`：有些图标要 mix 路径 / 圆 / 矩形
 *   （如 more 用三个圆点、settings 用三条滑杆 + 三个旋钮），存片段最省事。
 */
export interface IconSet {
  /** 图标集 id（"modern" / "pixel"）。 */
  readonly id: string;
  /** 描边宽度（px）—— 像素图标集用更粗的笔（2）以免在低分辨率下消失。 */
  readonly strokeWidth: number;
  /** 图标名 → 内联 SVG 片段（不含 <svg> 外壳）。 */
  readonly paths: Readonly<Record<IconName, string>>;
  /** 渲染模式（缺省 = stroke = 线条风）。 */
  readonly mode?: IconRenderMode;
  /** viewBox（缺省 = 24×24；像素风 = 16×16 网格）。 */
  readonly viewBox?: string;
  /** shape-rendering（缺省 = 不写；像素风 = crispEdges，硬边不插值）。 */
  readonly shapeRendering?: string;
}

/**
 * 现代风图标集（本期唯一的一套）。
 * 画法约定：
 *   - 主体轮廓 1.5px、端点圆、拐角圆；
 *   - 画布留 2px 边距（图标在 16px 格里看着不挤）；
 *   - 细节点用 `h.01` + 圆头端点表示（画出来就是一个圆点），
 *     不用 fill（fill 会破坏"纯线条"的统一感）。
 */
export const MODERN_ICON_SET: IconSet = Object.freeze({
  id: 'modern',
  strokeWidth: ICON_STROKE_WIDTH,
  paths: Object.freeze({
    // 喇叭（声音开）：喇叭体 + 两道声波。
    sound: '<path d="M11 5 6.5 9H3.5v6h3L11 19V5Z"/><path d="M15.2 9.3a4 4 0 0 1 0 5.4"/><path d="M18 6.4a8 8 0 0 1 0 11.2"/>',
    // 喇叭（静音）：喇叭体 + 斜杠。
    'sound-muted': '<path d="M11 5 6.5 9H3.5v6h3L11 19V5Z"/><path d="M15.6 9.6 20 14"/><path d="M20 9.6 15.6 14"/>',
    // 导演镜头：摄像机（机身 + 镜头仓）。
    director: '<rect x="2.5" y="7" width="13" height="10" rx="2"/><path d="M15.5 11.6 21 8.2v7.6l-5.5-3.4"/>',
    // 演示模式：播放三角。
    demo: '<path d="M8.5 5.6 18.5 12 8.5 18.4V5.6Z"/>',
    // 更多：三个横排圆点。
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    // 聊天：对话气泡。
    chat: '<path d="M20 15.6A2.4 2.4 0 0 1 17.6 18H9l-5 4V6.4A2.4 2.4 0 0 1 6.4 4h11.2A2.4 2.4 0 0 1 20 6.4v9.2Z"/>',
    // 会话：面板 + 两行条目。
    sessions: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M7 9h7M7 13h5"/>',
    // 角色：头 + 肩。
    character: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
    // 设置：三条滑杆 + 三个旋钮（比齿轮更"战术"、更好认）。
    settings: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
    // 皮肤：2×2 像素格（= 像素风的位）。
    palette: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
    // 关闭：叉。
    close: '<path d="M6 6 18 18M18 6 6 18"/>',
    // 完成：对勾。
    check: '<path d="M5 12.5 10 17.5 19 7"/>',
    // 下拉箭头。
    'chevron-down': '<path d="M6 9.5 12 15.5 18 9.5"/>',
    // 信息层级：三层叠板。
    layers: '<path d="M12 3 21 8l-9 5-9-5 9-5Z"/><path d="M3 13.6 12 18.6 21 13.6"/>',
    // 新建：加号。
    plus: '<path d="M12 5v14M5 12h14"/>',
    // 命令行：终端框 + 提示符。
    command: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7.5 10 10 12.5 7.5 15M12.5 15H17"/>',
    // 返回：左箭头。
    back: '<path d="M11 5 4 12l7 7"/><path d="M4 12h16"/>',
    // 搜索：放大镜。
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M15.8 15.8 20.5 20.5"/>',
    // 过滤：漏斗。
    filter: '<path d="M4 5h16l-6.5 7.6V19l-3 1.6v-8L4 5Z"/>',
    // 警告：三角 + 感叹号。
    warning: '<path d="M12 4 21 19.5H3L12 4Z"/><path d="M12 10v4.4M12 17.3h.01"/>',
    // 信息：圆 + 感叹号。
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6M12 7.8h.01"/>',
    // 回放：环形箭头。
    replay: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>',
  }),
});

// ============================================================================
// 像素风图标集（@since v3.8，task_135）—— 填上 task_121 预留的那个空位
// ============================================================================

/**
 * 一个"方块"（像素风的最小绘制单位）。
 * 坐标单位 = **美术像素**（8×8 美术网格），不是 SVG 单位。
 */
type PixelRect = readonly [x: number, y: number, w: number, h: number];

/** 美术网格边长（8×8 —— 8 位机的标准画布；下面的坐标都落在这个网格里）。 */
/** 1 个美术像素 = 多少 SVG 单位（viewBox 16×16 / 美术 8×8 → 每像素 2 单位）。 */
const PIXEL_ART_SCALE = 2;

/**
 * 把美术方块表烘成 inline SVG 片段（每块一个 `<path>`）。
 *
 * why 每个方块是**一条 path**（而不是一个大 path + 多个子路径）：
 *   断言「像素图标 = 方块坐标组合」时，DOM 里能逐条数出方块（现代图标是一条含曲线的大 path）。
 * why 路径只用 M/h/v/z：**没有任何曲线指令（C/Q/A）** —— 曲线 = 矢量，
 *   曲线插值出来的边缘会糊，这正是「现代 SVG 换描边不算像素艺术」的根因。
 * why 坐标全是整数：块与块严丝合缝，不出现半像素缝。
 */
function pixelArt(rects: readonly PixelRect[]): string {
  return rects
    .map(([x, y, w, h]) => {
      const sx = x * PIXEL_ART_SCALE;
      const sy = y * PIXEL_ART_SCALE;
      const sw = w * PIXEL_ART_SCALE;
      const sh = h * PIXEL_ART_SCALE;
      return `<path d="M${sx} ${sy}h${sw}v${sh}h-${sw}z"/>`;
    })
    .join('');
}

/**
 * 像素风图标集：与 MODERN_ICON_SET **同构同名**（23 个图标一一对应），
 * 画法是 8×8 美术网格上的实心方块。
 */
export const PIXEL_ICON_SET: IconSet = Object.freeze({
  id: 'pixel',
  strokeWidth: 0,
  mode: 'fill',
  viewBox: '0 0 16 16',
  shapeRendering: 'crispEdges',
  paths: Object.freeze({
    // 喇叭（声音开）：喇叭体 + 阶梯喇叭口 + 两道声波。
    sound: pixelArt([
      [0, 2, 2, 4], [2, 3, 1, 2], [3, 2, 1, 4], [4, 1, 1, 6],
      [6, 2, 1, 4], [7, 1, 1, 6],
    ]),
    // 喇叭（静音）：喇叭体 + 阶梯喇叭口 + 叉号。
    'sound-muted': pixelArt([
      [0, 2, 2, 4], [2, 3, 1, 2], [3, 2, 1, 4], [4, 1, 1, 6],
      [5, 1, 1, 1], [6, 2, 1, 1], [7, 3, 1, 1], [7, 1, 1, 1], [5, 3, 1, 1],
    ]),
    // 导演镜头：机身 + 阶梯镜头仓。
    director: pixelArt([
      [0, 2, 4, 4], [4, 3, 1, 2], [5, 2, 1, 4], [6, 1, 1, 6],
    ]),
    // 演示模式：播放三角（右指阶梯）。
    demo: pixelArt([
      [2, 1, 2, 1], [2, 2, 3, 1], [2, 3, 4, 2], [2, 5, 3, 1], [2, 6, 2, 1],
    ]),
    // 更多：三个 1×2 方块（拉开间距 —— 挨太近在 14px 下会连成一条横杠）。
    more: pixelArt([[0, 3, 1, 2], [3, 3, 1, 2], [6, 3, 1, 2]]),
    // 聊天：对话气泡 + 尾巴。
    chat: pixelArt([
      [1, 1, 6, 1], [1, 2, 1, 3], [6, 2, 1, 3], [1, 5, 4, 1], [2, 6, 2, 1],
    ]),
    // 会话：面板框 + 两行条目。
    sessions: pixelArt([
      [1, 1, 6, 1], [1, 2, 1, 4], [6, 2, 1, 4], [1, 6, 6, 1],
      [2, 3, 4, 1], [2, 5, 3, 1],
    ]),
    // 角色：头 + 肩。
    character: pixelArt([[2, 1, 4, 3], [1, 5, 6, 2]]),
    // 设置：三条滑杆 + 三个旋钮方块。
    settings: pixelArt([
      [0, 1, 6, 1], [5, 0, 2, 3],
      [1, 4, 6, 1], [1, 3, 2, 3],
      [0, 7, 6, 1], [4, 6, 2, 2],
    ]),
    // 皮肤：2×2 像素格。
    palette: pixelArt([[0, 0, 3, 3], [4, 0, 3, 3], [0, 4, 3, 3], [4, 4, 3, 3]]),
    // 关闭：叉（2×2 方块阶梯）。
    close: pixelArt([[1, 1, 2, 2], [3, 3, 2, 2], [5, 5, 2, 2], [5, 1, 2, 2], [1, 5, 2, 2]]),
    // 完成：对勾（阶梯）。
    check: pixelArt([[0, 4, 2, 2], [2, 5, 2, 2], [4, 3, 2, 2], [6, 1, 2, 2]]),
    // 下拉箭头：V 形阶梯。
    'chevron-down': pixelArt([[0, 2, 2, 2], [2, 3, 2, 2], [4, 3, 2, 2], [6, 2, 2, 2]]),
    // 信息层级：三层叠板。
    layers: pixelArt([[2, 1, 4, 1], [1, 3, 6, 1], [0, 5, 8, 1]]),
    // 新建：加号。
    plus: pixelArt([[3, 1, 2, 6], [1, 3, 6, 2]]),
    // 命令行：终端框 + 提示符。
    command: pixelArt([
      [0, 1, 8, 1], [0, 6, 8, 1], [0, 2, 1, 4], [7, 2, 1, 4],
      [1, 3, 1, 1], [2, 4, 1, 1], [1, 5, 1, 1], [4, 4, 3, 1],
    ]),
    // 返回：左箭头。
    back: pixelArt([[1, 2, 2, 2], [0, 3, 2, 2], [1, 4, 2, 2], [2, 3, 5, 2]]),
    // 搜索：放大镜。
    search: pixelArt([
      [1, 1, 4, 1], [1, 4, 4, 1], [1, 2, 1, 2], [4, 2, 1, 2],
      [5, 5, 1, 1], [6, 6, 1, 1], [7, 7, 1, 1],
    ]),
    // 过滤：漏斗。
    filter: pixelArt([[0, 1, 8, 1], [1, 2, 6, 1], [2, 3, 4, 1], [3, 4, 2, 3]]),
    // 警告：三角 + 感叹号。
    warning: pixelArt([
      [3, 0, 2, 1], [2, 1, 1, 1], [5, 1, 1, 1], [1, 2, 1, 1], [6, 2, 1, 1],
      [0, 3, 1, 2], [7, 3, 1, 2], [0, 5, 8, 1], [3, 2, 2, 2], [3, 4, 2, 1],
    ]),
    // 信息：圆 + 感叹号。
    info: pixelArt([
      [2, 1, 4, 1], [1, 2, 1, 4], [6, 2, 1, 4], [2, 6, 4, 1],
      [3, 2, 2, 1], [3, 4, 2, 2],
    ]),
    // 回放：环形箭头。
    replay: pixelArt([
      [2, 1, 4, 1], [1, 2, 1, 3], [6, 3, 1, 2], [2, 5, 4, 1],
      [5, 0, 2, 2], [6, 1, 1, 1], [7, 2, 1, 1],
    ]),
  }),
});

/**
 * 图标集注册表（按 id 取一套）。
 * why 是一张表而不是一个常量：像素皮肤将来加一套**同构**图标（同名不同形），
 *   组件只认图标名 → 换皮 = 换表，组件零改动（这是"预留像素版图标位"的落点）。
 */
export const ICON_SETS: Readonly<Record<string, IconSet>> = Object.freeze({
  modern: MODERN_ICON_SET,
  pixel: PIXEL_ICON_SET,
});

/** 缺省图标集 id（认不出的 id 一律回落这套 —— 图标永不画不出来）。 */
export const DEFAULT_ICON_SET_ID = 'modern';

/** 取一套图标集（认不出的 id → 缺省集；绝不返回 undefined）。 */
export function resolveIconSet(setId?: string | null): IconSet {
  if (!setId) return MODERN_ICON_SET;
  return ICON_SETS[setId] ?? MODERN_ICON_SET;
}

// ============================================================================
// 当前生效的图标集（@since v3.8，task_135）—— 皮肤 → 图标集的联动
// ============================================================================

/**
 * 模块级「当前图标集」id。
 * why 是模块级而不是逐个组件传参：组件只认图标名（`iconSvg('demo')`），
 *   换皮时不该有 23 个调用点各改一遍 —— **换图标集 = 换一张表**（本文件的设计初衷）。
 * why 默认 modern：没切过皮肤时按现代线条渲染（= 旧行为，一字不差）。
 */
let activeIconSetId: string = DEFAULT_ICON_SET_ID;

/** 切当前图标集（认不出的 id → 缺省集，绝不抛错）。 */
export function setActiveIconSet(setId?: string | null): void {
  activeIconSetId = resolveIconSet(setId).id;
}

/** 当前图标集（= 新建图标时的缺省来源）。 */
export function getActiveIconSet(): IconSet {
  return resolveIconSet(activeIconSetId);
}

/**
 * 把一套图标集刷到某个已渲染的 `<svg>` 上（换皮时用）。
 * why 直接改属性而不是重建元素：重建会丢引用（测试 / 事件），改属性最省。
 */
function applyIconSetTo(svg: SVGSVGElement, name: IconName, set: IconSet): void {
  svg.setAttribute('viewBox', set.viewBox ?? ICON_VIEW_BOX);
  if ((set.mode ?? 'stroke') === 'fill') {
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('stroke', 'none');
    svg.removeAttribute('stroke-width');
    svg.removeAttribute('stroke-linecap');
    svg.removeAttribute('stroke-linejoin');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', String(set.strokeWidth));
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  if (set.shapeRendering) svg.setAttribute('shape-rendering', set.shapeRendering);
  else svg.removeAttribute('shape-rendering');
  const body = set.paths[name];
  if (!body) return;
  // innerHTML：SVG 元素的子内容就是 markup（textContent 会把标签当纯文本，丢图形）。
  svg.innerHTML = body;
}

/**
 * 收集一棵子树里所有**已渲染**的图标 `<svg>`（含 shadow DOM 内部）。
 * why 要钻 shadow DOM：按钮的图标在 shadow 里（widgets/strat-button.ts），
 *   只扫 light DOM 会漏掉顶栏的全部图标 —— 换皮后图标不变 = 用户验收退回。
 */
function collectIconElements(root: ParentNode): SVGSVGElement[] {
  const found: SVGSVGElement[] = [];
  const visit = (scope: ParentNode): void => {
    scope.querySelectorAll('svg.srf-icon[data-icon]').forEach((el) => {
      found.push(el as SVGSVGElement);
    });
    scope.querySelectorAll('*').forEach((el) => {
      const shadow = (el as HTMLElement).shadowRoot;
      if (shadow) visit(shadow);
    });
  };
  visit(root);
  return found;
}

/**
 * 把当前图标集刷到 DOM 里已经画好的图标上（切皮肤后调用）。
 *
 * why 需要这一步：切皮肤只换 stylesheet，**不重建 DOM**（重建会丢状态、动布局），
 *   所以已画好的图标还拿着旧图形 —— 必须就地换图形，这一步就是「图标真像素路径」的落点。
 * why 幂等：同一个皮肤反复切不会重复刷（刷一遍结果一样）。
 */
export function refreshIconsInDom(root?: ParentNode): void {
  const scope = root ?? (typeof document !== 'undefined' ? document : null);
  if (!scope) return;
  const set = getActiveIconSet();
  for (const svg of collectIconElements(scope)) {
    const name = svg.getAttribute('data-icon');
    if (!name || !isIconName(name)) continue;
    applyIconSetTo(svg, name, set);
  }
}

/** 图标名清单（运行时可枚举 —— 测试按它逐个断言"都有路径"）。 */
export const ICON_NAMES: readonly IconName[] = Object.freeze(
  Object.keys(MODERN_ICON_SET.paths) as IconName[],
);

/** 这个字符串是不是一个合法图标名（守卫：外部来的字符串不能直接当图标名用）。 */
export function isIconName(value: string): value is IconName {
  return Object.prototype.hasOwnProperty.call(MODERN_ICON_SET.paths, value);
}

/** 属性值转义（class 名等 —— 只防引号/尖括号，够用且不引依赖）。 */
function escapeAttr(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  })[c] as string);
}

/** 图标渲染选项。 */
export interface IconSvgOptions {
  /** 图标集 id（缺省 = **当前生效**的图标集；切皮肤时由 hud/theme/skin-icons.ts 设定）。 */
  readonly setId?: string | null;
  /** 追加的 class（srf-icon 始终带上）。 */
  readonly className?: string;
}

/**
 * 渲染一个图标（inline SVG 字符串）。
 *
 * why 尺寸写 `1em`：图标跟着所在处的字号走（按钮 12px → 图标 ~14px；
 *   小字处 11px → 图标 ~12.6px），一处规则全屏自适应，不必逐处写死像素。
 * why `aria-hidden`：图标是**装饰**，读屏的名字由按钮的 aria-label 给
 *   （图标按钮没有可见文字，必须有 aria-label —— 见 widgets/strat-button.ts）。
 * why 带 `data-icon`（@since task_135）：切皮肤时要**就地**把已画好的图标换成另一套图形
 *   （不重建 DOM → 不动布局），靠这个属性认出「这个 svg 是哪个图标」。
 */
export function iconSvg(name: IconName, options: IconSvgOptions = {}): string {
  const set = options.setId === undefined ? getActiveIconSet() : resolveIconSet(options.setId);
  const body = set.paths[name];
  if (!body) return '';
  const extra = options.className ? ` ${escapeAttr(options.className)}` : '';
  const viewBox = set.viewBox ?? ICON_VIEW_BOX;
  const isFill = (set.mode ?? 'stroke') === 'fill';
  // 像素集：实心方块（fill=currentColor，stroke=none）；现代集：线条（fill=none + 描边）。
  const paint = isFill
    ? 'fill="currentColor" stroke="none"'
    : `fill="none" stroke="currentColor" stroke-width="${set.strokeWidth}" ` +
      'stroke-linecap="round" stroke-linejoin="round"';
  const rendering = set.shapeRendering ? ` shape-rendering="${set.shapeRendering}"` : '';
  return (
    `<svg class="srf-icon${extra}" data-icon="${escapeAttr(name)}" viewBox="${viewBox}" ` +
    `width="1em" height="1em" ${paint}${rendering} aria-hidden="true" focusable="false">` +
    `${body}</svg>`
  );
}
