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
 * 一套图标（同构的一组路径数据）。
 * why 路径存"内联片段"而不是裸 `d`：有些图标要 mix 路径 / 圆 / 矩形
 *   （如 more 用三个圆点、settings 用三条滑杆 + 三个旋钮），存片段最省事。
 */
export interface IconSet {
  /** 图标集 id（"modern" / 未来的 "pixel"）。 */
  readonly id: string;
  /** 描边宽度（px）—— 像素图标集用更粗的笔（2）以免在低分辨率下消失。 */
  readonly strokeWidth: number;
  /** 图标名 → 内联 SVG 片段（不含 <svg> 外壳）。 */
  readonly paths: Readonly<Record<IconName, string>>;
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

/**
 * 图标集注册表（按 id 取一套）。
 * why 是一张表而不是一个常量：像素皮肤将来加一套**同构**图标（同名不同形），
 *   组件只认图标名 → 换皮 = 换表，组件零改动（这是"预留像素版图标位"的落点）。
 */
export const ICON_SETS: Readonly<Record<string, IconSet>> = Object.freeze({
  modern: MODERN_ICON_SET,
});

/** 缺省图标集 id（认不出的 id 一律回落这套 —— 图标永不画不出来）。 */
export const DEFAULT_ICON_SET_ID = 'modern';

/** 取一套图标集（认不出的 id → 缺省集；绝不返回 undefined）。 */
export function resolveIconSet(setId?: string | null): IconSet {
  if (!setId) return MODERN_ICON_SET;
  return ICON_SETS[setId] ?? MODERN_ICON_SET;
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
  /** 图标集 id（缺省 = modern）。 */
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
 */
export function iconSvg(name: IconName, options: IconSvgOptions = {}): string {
  const set = resolveIconSet(options.setId);
  const body = set.paths[name];
  if (!body) return '';
  const extra = options.className ? ` ${escapeAttr(options.className)}` : '';
  return (
    `<svg class="srf-icon${extra}" viewBox="${ICON_VIEW_BOX}" width="1em" height="1em" ` +
    `fill="none" stroke="currentColor" stroke-width="${set.strokeWidth}" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">` +
    `${body}</svg>`
  );
}
