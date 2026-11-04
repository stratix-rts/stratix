/**
 * 文件职责：命令面板 Web Component（`<strat-command-panel>`）—— HUD 的**唯一命令入口**，
 *   合并旧 CommandPanel（选中单位后的操作）与 CommandPalette（全局命令 + 搜索）的功能语义。
 *   命令清单与命令构造全在 command-catalog.ts（纯逻辑），本文件只负责：把 WorldState 画成列表、
 *   把点击变成 HudCommand 经注入的 adapter 派发。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 panels/ 层级；语义提取自 src/components/CommandPanel.vue
 *   与 src/composables/useCommandPalette.ts（只读参考，未复制任何实现）。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力就够）；用户输入（搜索词、任务标题草稿）。
 * 输出：Shadow DOM 面板；点击 → HudCommand → adapter.dispatch。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 发命令与订阅状态；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   4. 在本地维护选择集 / 任务相位 —— 可用性一律现算自 WorldState，判断权在 core；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订，否则元素反复挂卸会累积订阅（perf 硬约束）。
 *
 * 渲染策略（perf）：core 每次状态变更都全量广播，面板不能跟着无脑重建 DOM。
 *   用 renderSignature（选择集 revision + 单位数 + 任务相位 + 前 N 条通知）判重，
 *   签名不变就跳过重渲染；输入框所在的"外壳"只在挂载时建一次，输入时光标不丢。
 *
 * 外部样式钩子（@since v3.7，task_020）：命令分组根节点带 `part="group"`，
 *   供 hud/screens/main-screen.ts 把分组内的命令按钮排成横排（底栏"命令横条"用）。
 *   why 用 part 而不是改内部样式：面板内部布局不动（见文件头禁止事项），
 *   挂载方按 part 适配即可；本组件不因外部样式改变行为。
 *
 * 紧凑条形态（@since v3.4，task_090）：`variant="strip"` —— 控制岛（Z4）里的 1 行命令条。
 *   形态差异只有**排版**：抬头 / 通知列表 / 两个输入框压成行内窄控件，命令按钮去掉副标题
 *   （副标题改为按钮的 title 悬停提示），两个 scope 分组的按钮汇进同一条横向滚动行。
 *   why 归本组件而不是外部样式：`::part()` 只能改样式、不能改 DOM 顺序，
 *   而「1 行 6 条 + 其余横向滚动」要求把两个分组摊平成一条流 —— 那是结构，不是皮肤。
 *   ★ 命令一条不减：12 条命令仍在（滚动可达），搜索框与任务标题草稿框仍在（压成行内窄控件）。
 *   ★ 行为零差异：判定 / 构造 / 派发全走同一份 command-catalog，本形态只改排版。
 *
 * 「新建任务」的去向（@since v3.6，task_112）：global 组的「新建任务」**不再直发** mission.create ——
 *   它派发 DOM 事件 NEW_TASK_OPEN_EVENT，由组合根打开新建任务对话框（单任务 / 流水线 / 派发 / 取消）。
 *   why：发起方式有四种，命令条只能给一个按钮 —— 走对话框才让用户选；
 *   why 走 DOM 事件而不是总线命令：开对话框是纯 UI 动作，core 不该为它加一条命令
 *   （与「打开聊天」stratix:chat-open 同一口径）。命令的**构造**仍出自 command-catalog
 *   （对话框拿同一份构造器用），判定口径一字未改。
 *   副产物：对话框建完任务会派发 NEW_TASK_SUBMITTED_EVENT → 本面板清掉标题草稿
 *   （否则再点一次「新建任务」会用同一句话再建一条）。
 *
 * 命令行注册表（@since v3.6，task_113）：搜索框**同时是命令行** —— 回车即执行。
 *   此前它是死的：输入框只做模糊搜索、Enter 毫无反应，提示词承诺的
 *   「mission / 主题 / 设置」全都不认（死功能报告第 2 条）。
 *   why 词表独立在 command-registry.ts（纯逻辑）：命令清单只有一份，
 *     「help 列出来的」与「真能敲的」必然同源（两份清单迟早对不上 = 又一个假入口）。
 *   why 回执落在面板自己的输出区（data-role="output"）而不是 toast：
 *     命令行就在眼前，回执贴着输入框才像终端；toast 是跨面板的顶层反馈面，
 *     用在这里反而把结果甩到屏幕角落。
 *   why mission 复用 NEW_TASK_OPEN_EVENT（task_112 的通路）而不是自己派单：
 *     发起方式有四种，对话框才是选方式的地方；命令行只负责"把标题带过去"。
 *   why theme 的降级判定看**皮肤有没有真的换掉**：命令只管发 theme.set，
 *     皮肤没换（handler 没接上）就说「皮肤系统接入中，请到设置页操作」——
 *     不假装切成功，也不空口说"接入中"。
 *   why replay 走注入的控制器：回放控制器在组合根建（它要 app 层的读取口），
 *     面板只认一个控制器接口；网关不可用时给的是**人话 + 重试指引**，不是错误码。
 *
 * 提示词 composer（@since v3.9，task_144）：输入面**重造** —— 单行 <input> → 多行 <textarea>。
 *   用户原话：「命令输入的文本框是最基础的人和应用交互点……肉眼难辨的小区域如何让用户输入大段提示词」。
 *   why 值得重造：产品本质是 agent 指挥台，**prompt 就是产品**；一行 96px 的窄框装不下提示词。
 *   形态：Enter 提交 / Shift+Enter 换行 / ⌘Enter 必交 / IME 合成中 Enter 不提交（中文用户命门）/
 *     ↑↓ 翻历史（首/末行才接管，中部光标不抢键）/ Esc 清空再失焦 / 粘贴长文自动长高（≤10 行后内滚）。
 *   键位 / IME / 历史 / 长高全在 prompt-composer.ts（纯 DOM 组件，可单测）；本面板只接「原文」。
 *   why 紧凑条形态改成两行（composer 独占第 1 行）：命令按钮行保持 1 行 6 条的可达性不变，
 *     composer 铺满整行宽度 —— 输入面终于是个「一眼看得见」的面。
 *   why 多行 / 长自由文本回车走**任务通路**（不是新造命令）：面板能落地的出口只有既有契约，
 *     大段提示词先当任务标题带进新建任务对话框，由用户选发起方式。
 */

import type { HudCommand, WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import {
  NEW_TASK_OPEN_EVENT,
  NEW_TASK_SUBMITTED_EVENT,
} from '../components/new-task-dialog/new-task-dialog';
import type { ReplayController } from '../components/replay/replay-controller';
// 宿主动作登记口 + 草稿共享面（@since v3.9，task_150）：
//   ⌘K 面板与底栏 composer 共用**一份事实源** —— 命令定义在 hud/lib/command-registry.ts，
//   草稿（用户正在敲的任务标题）经 draft-store 共享（两块面说的必须是同一句话）。
import { registerAppAction } from '../lib/app-actions';
import { setDraftTitle as publishDraftTitle } from '../lib/draft-store';
// markdown 管线（@since v3.9，task_145）：回执区按 markdown 渲染（marked → DOMPurify → DOM）。
import { enhanceMarkdown, MARKDOWN_CLASS, MARKDOWN_CSS, renderMarkdown } from '../lib/markdown';
// 浮层刻度（@since v3.9，task_146）：z-index 一律走刻度表，不写死数字。
import { zVar } from '../theme/layer-tokens';
// 动效层（@since v3.8，task_138）：面板入场（位移 + 淡入）/ 列表项 hover 光标过渡 /
//   命令行提交时输入行微脉冲 —— 全部走共享动效工具类，时长缓动取 --srf-motion-* token。
import { MOTION_CLASS, MOTION_COMPONENT_CSS, installMotionTokens } from '../theme/motion-tokens';

import type {
  CommandContext,
  CommandScope,
  PanelCommandId,
  ResolvedCommand,
} from './command-catalog';
import {
  buildCommand,
  describeSelection,
  filterCommands,
  findCommandSpec,
  groupByScope,
  MAX_VISIBLE_NOTICES,
  renderSignature,
  resolveCommands,
} from './command-catalog';
import type { CliCommandSpec } from './command-registry';
import {
  CLI_COMMANDS,
  cliHelpText,
  cliUnknownText,
  cliUsageHint,
  cliUsageList,
  parseCliInput,
} from './command-registry';
// 提示词 composer（@since v3.9，task_144）：输入面的键位 / IME / 历史 / 自动长高全在那边，
//   本面板只负责「拿到原文 → 走命令注册表 / 任务通路」。
import { PromptComposer } from './prompt-composer';

export const COMMAND_PANEL_TAG = 'strat-command-panel';

/** 面板需要的最小能力面：只要"发命令"与"订阅状态"，与 hello-loop-panel 同一约定。 */
export type CommandPanelDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratCommandPanelElement extends HTMLElement {
  /** 注入的适配器；在 connected 之前或之后设置都生效。 */
  adapter: CommandPanelDeps | null;
  /**
   * 当日回放控制器（@since v3.6，task_113）—— 命令行 `replay` 的落地面。
   * 缺省 = null → 该命令如实说"没接线"，不假装能放。
   */
  replay: ReplayController | null;
  /** 搜索词（面板瞬时态）。 */
  query: string;
  /** 「发起任务」的标题草稿（面板瞬时态，不是业务状态）。 */
  draftTitle: string;
  /** 命令行回执（最后一次执行的结果 / 引导文案；空串 = 没话要说）。 */
  readonly output: string;
  /** 强制重算重渲染（改了瞬时态或注入新 state 后可手动调用）。 */
  refresh(): void;
  /** 当前可见的命令 id（按渲染顺序），供测试断言"该显示的显示了"。 */
  readonly visibleCommandIds: readonly PanelCommandId[];
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

const SECTION_LABELS: Record<'selection' | 'global', string> = {
  selection: '选中单位',
  global: '全局命令',
};

/**
 * 自由文本（提示词）的长度门槛（@since v3.9，task_144）。
 * why 有门槛：单行短文本按命令解析（「瞎敲的」仍然是「没有匹配的命令」，
 *   那是既有反馈，不该被提示词通路吞掉）；**多行**或**明显长于命令**的自由文本
 *   才当提示词处理（粘贴一大段进来的人，敲回车是想把这段话送出去，不是想看命令清单）。
 */
const PROMPT_TEXT_MIN_LENGTH = 80;

/** HTML 文本转义。hint / 通知文本含用户输入（任务标题、单位名），必须转义后才进 innerHTML。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}

/**
 * 读当前激活的皮肤 id（'default' | 'pixel' | null = 读不到）。
 * why 从 DOM 读而不是从适配器读：皮肤的真源是主题控制器（token 样式表 + localStorage 记忆），
 *   而控制器住在组合根手里、面板这一层拿不到；DOM 上「哪张 token 样式表没被 disable」
 *   就是控制器 current 的镜像（theme-controller 的 apply 就是这么切的，见 hud/theme/theme-controller.ts）。
 * 读不到（没注入 token —— 单测 / 极简装配）→ null，调用方据此**不判定降级**
 *   （没皮肤系统 ≠ 皮肤系统坏了，两回事）。
 *
 * why 读 `disabled` **属性**而不是 CSS 选择器 `style[data-srf-theme]:not([disabled])`：
 *   theme-controller 切皮肤走的是 `node.disabled = true`（IDL 属性），
 *   而在 Chromium 上这个赋值**不反射成同名 content attribute**（实测 hasAttribute('disabled') 仍为 false）——
 *   于是 `:not([disabled])` 会把两张表都算成"启用"，永远读到第一张（切了也像没切）。
 *   读 IDL 属性才是控制器真正写的那一位。
 *   why 用 `!node.disabled` 而不是 `node.disabled === false`：jsdom 根本没实现
 *   HTMLStyleElement.disabled（读出来是 undefined），严格比较会把"启用"误判成"没有可读的表"。
 */
function readActiveThemeId(): 'default' | 'pixel' | null {
  const nodes = Array.from(document.querySelectorAll<HTMLStyleElement>('style[data-srf-theme]'));
  const active = nodes.find((node) => !node.disabled);
  const id = active?.getAttribute('data-srf-theme');
  if (id === 'pixel') return 'pixel';
  if (id === 'default') return 'default';
  return null;
}

/**
 * 工厂：注册 `<strat-command-panel>`。
 * 幂等（与 defineStratButton 同约定）：重复 register 返回已注册构造器，不抛错。
 */
export function defineCommandPanel(): typeof HTMLElement {
  if (customElements.get(COMMAND_PANEL_TAG)) {
    return customElements.get(COMMAND_PANEL_TAG) as unknown as typeof HTMLElement;
  }

  class CommandPanel extends HTMLElement implements StratCommandPanelElement {
    private _adapter: CommandPanelDeps | null = null;
    private _replay: ReplayController | null = null;
    private _query = '';
    private _draftTitle = '';
    /** 命令行回执（最后一次执行的结果 / 引导文案）。 */
    private _output = '';
    private _state: WorldState | null = null;
    private _lastSignature: string | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;
    /** 提示词 composer（@since v3.9，task_144）：输入面的键位 / IME / 历史 / 长高都在那边。 */
    private _composer: PromptComposer | null = null;
    /** 宿主动作注销闭包（@since v3.9，task_150：⌘K 的「清空任务草稿」）。 */
    private _unregisterDraftAction: (() => void) | null = null;

    // —— 属性面 ——
    get adapter(): CommandPanelDeps | null { return this._adapter; }
    set adapter(value: CommandPanelDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get replay(): ReplayController | null { return this._replay; }
    set replay(value: ReplayController | null) { this._replay = value; }

    get output(): string { return this._output; }

    get query(): string { return this._query; }
    set query(value: string) {
      this._query = value;
      // 外部回填（测试 / 组合根）也要同步到编辑区 —— 面板瞬时态与 DOM 只有一份真相。
      this._composer?.setValue(value);
      this.refresh();
    }

    get draftTitle(): string { return this._draftTitle; }
    set draftTitle(value: string) {
      this._draftTitle = value;
      // 草稿是**跨面共享**的事实（@since v3.9，task_150）：⌘K 面板的「派发任务」要拿到同一句。
      publishDraftTitle(value);
      this.refresh();
    }

    get lastState(): WorldState | null { return this._state; }

    get visibleCommandIds(): readonly PanelCommandId[] {
      return this.contextualCommands().map((c) => c.spec.id);
    }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      // 动效 token 注入文档根（幂等）——面板用的 --srf-motion-* 与其他组件同源同速。
      installMotionTokens();
      this.renderChrome();
      // 清签名强制首绘：挂载前 adapter setter 里那次 refresh 已经把签名记下了，
      // 而那时还没有 shadowRoot、列表根本没画 —— 不清掉的话这次 refresh 会被判重跳过，列表就空了。
      this._lastSignature = null;
      // 「已提交任务」事件（@since v3.6，task_112）：对话框建完任务后清标题草稿。
      // 挂在 document 上 —— 对话框与本面板是兄弟组件（互不持有引用，事件是唯一通道）。
      document.addEventListener(NEW_TASK_SUBMITTED_EVENT, this.onNewTaskSubmitted);
      // 宿主动作（@since v3.9，task_150）：⌘K 面板的「清空任务草稿」走这条 ——
      //   草稿住在本面板里，别的面板只能**请求**清空，不能直接改本面板的私有态。
      this._unregisterDraftAction?.();
      this._unregisterDraftAction = registerAppAction('clear-draft', () => {
        this.setDraftTitle('');
      });
      this.bindAdapter();
      this.refresh();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：不退订的话，反复挂卸会把订阅堆成 O(n)，且组件已不在文档里仍在收广播。
      this.releaseAdapter();
      document.removeEventListener(NEW_TASK_SUBMITTED_EVENT, this.onNewTaskSubmitted);
      // 宿主动作注销（动作表是全局单例 —— 不注销会留下一个「永远可用但点了没反应」的幽灵）。
      this._unregisterDraftAction?.();
      this._unregisterDraftAction = null;
      // composer 的监听同样必须摘（perf 硬约束：反复挂卸不累积监听器）。
      this._composer?.destroy();
      this._composer = null;
      this._lastSignature = null;
    }

    refresh(): void {
      const signature = renderSignature(this._state, this._draftTitle, this._query);
      if (signature === this._lastSignature) return;
      this._lastSignature = signature;
      this.renderSections();
      this.renderOutput();
    }

    // —— 订阅生命周期 ——
    private bindAdapter(): void {
      if (!this.isConnected || !this._adapter || this._unsubscribe) return;
      this._unsubscribe = this._adapter.subscribe((state) => {
        this._state = state;
        this.refresh();
      });
    }

    private releaseAdapter(): void {
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    // —— 命令派生（纯逻辑都在 catalog 里，这里只组装上下文）——
    private context(): CommandContext {
      return { state: this._state, draftTitle: this._draftTitle };
    }

    private contextualCommands(): ResolvedCommand[] {
      return filterCommands(resolveCommands(this.context()), this._query);
    }

    /**
     * 过滤空时的提示语（@since v3.6，task_113）。
     * 输入像一条命令 → 告诉用户回车就能执行；不像 → 老实说没匹配上（清单由 empty-hint 补）。
     */
    private emptyHintText(): string {
      const q = this._query.trim();
      // 提示词（多行 / 长文本）：引导语要说「回车能把它送出去」，别再摆命令清单。
      if (q.includes('\n') || q.length > PROMPT_TEXT_MIN_LENGTH) {
        return '提示词已就绪 · 回车提交（走新建任务通路）';
      }
      const parsed = parseCliInput(this._query);
      if (parsed.kind === 'matched' && parsed.spec) {
        const arg = parsed.arg.length > 0 ? ` ${parsed.arg}` : '';
        return `回车执行：${parsed.spec.name}${arg}`;
      }
      if (parsed.kind === 'missing-arg' && parsed.spec) {
        return `回车执行前请补全参数：${parsed.spec.usage}`;
      }
      return '没有匹配的命令';
    }

    /**
     * 点某条命令 → HudCommand → adapter.dispatch。
     * scope 一并传进来：同一个 id 在两个分组下入参不同（发起任务带指派对象 / 新建任务是草稿），
     * 用点击时携带的 scope 定位目录项，保证"点到的"与"构造出的"严格一致。
     * 构造不出来就什么都不发 —— 不发半截命令给 core。
     *
     * 例外（@since v3.6，task_112）：global 组的「新建任务」**不发命令**，改为打开新建任务对话框
     * （单任务 / 流水线 / 派发 / 取消 四选一）。selection 组的「发起任务」照旧直发 mission.create。
     */
    private runCommand(id: PanelCommandId, scope: CommandScope): void {
      if (!this._adapter) return;
      if (id === 'mission.create' && scope === 'global') {
        this.requestNewTaskDialog();
        return;
      }
      const spec = findCommandSpec(id, scope);
      if (!spec) return;
      const command: HudCommand | null = buildCommand(spec, this.context());
      if (!command) return;
      this._adapter.dispatch(command);
    }

    /**
     * 请求打开新建任务对话框（@since v3.6，task_112）。
     * 事件带标题（组合根据此预填对话框）；标题为空时什么都不做
     * —— 按钮此刻是禁用态，走不到这里；这里再挡一道是防「事件被外部伪造」。
     *
     * @since v3.6（task_113）显式标题：命令行 `mission <标题>` 把标题带过来，
     *   不经过草稿框（草稿框是"点按钮"那条路的入口，命令行不必先填它）。
     */
    private requestNewTaskDialog(explicitTitle?: string): void {
      const title = (explicitTitle ?? this._draftTitle).trim();
      if (title.length === 0) return;
      this.dispatchEvent(
        new CustomEvent(NEW_TASK_OPEN_EVENT, {
          bubbles: true,
          composed: true,
          detail: { title },
        })
      );
    }

    // —— 命令行（@since v3.6，task_113）——

    /**
     * 回车执行一行命令行。
     * 分支口径与注册表一致：命中 → 执行；参数缺失 / 非法 → 给用法提示；未命中 → 给可用命令清单。
     * why 未命中要给清单而不是一句拒绝：死功能报告里最刺眼的正是「没有匹配的命令」——
     *   用户照着提示词敲了一串，得到的只有一堵墙。给得出清单，才叫引导。
     */
    private async runCli(raw: string): Promise<void> {
      const trimmed = raw.trim();
      // 多行 = 提示词（@since v3.9，task_144）：命令都是一行的，多行一定是粘进来的正文。
      if (trimmed.includes('\n')) {
        await this.submitPromptAsTask(trimmed);
        return;
      }
      const parsed = parseCliInput(raw);
      // 未命中且**明显是长文本** → 当提示词走任务通路（别拿「没有匹配的命令」糊一脸）。
      if (parsed.kind === 'unknown' && trimmed.length > PROMPT_TEXT_MIN_LENGTH) {
        await this.submitPromptAsTask(trimmed);
        return;
      }
      switch (parsed.kind) {
        case 'empty':
          this.setOutput(`请输入命令。\n可用命令：${cliUsageList()}`);
          return;
        case 'unknown':
          this.setOutput(cliUnknownText(parsed.input));
          return;
        case 'missing-arg':
          this.setOutput(cliUsageHint(parsed.spec));
          return;
        case 'invalid-arg':
          this.setOutput(
            `「${parsed.arg}」不是 ${parsed.spec.name} 的合法参数。可选：${(parsed.spec.allowedArgs ?? []).join(' / ')}`
          );
          return;
        case 'matched':
          await this.executeCli(parsed.spec, parsed.arg);
      }
    }

    /** 执行一条命中的命令。每条命令都必须**当场看得见效果**（看得见才算接上）。 */
    private async executeCli(spec: CliCommandSpec, arg: string): Promise<void> {
      switch (spec.id) {
        case 'mission': {
          const title = arg.trim();
          if (title.length === 0) {
            this.setOutput(cliUsageHint(spec));
            return;
          }
          // 草稿框同步成同一句：之后点「发起任务」也是这个标题（面板内不出现两份真相）。
          this.setDraftTitle(title);
          // 复用 task_112 的通路：派 DOM 事件，由组合根打开对话框（不重复实现派单逻辑）。
          this.requestNewTaskDialog(title);
          this.setOutput(`已打开新建任务对话框，标题已预填「${title}」`);
          this.clearQuery();
          return;
        }
        case 'theme': {
          this.runThemeCommand(arg);
          return;
        }
        case 'settings': {
          if (!this._adapter) return;
          this._adapter.dispatch({ type: 'ui.navigate', screen: 'settings' });
          this.setOutput('已打开设置页');
          this.clearQuery();
          return;
        }
        case 'replay': {
          await this.runReplayCommand();
          return;
        }
        case 'help': {
          this.setOutput(cliHelpText());
          this.clearQuery();
          return;
        }
      }
    }

    /**
     * 自由文本提示词 → 任务通路（@since v3.9，task_144）。
     * why 走任务通路而不是新造一条命令：面板能落地的出口只有既有契约
     *   （mission.create / ui.navigate / theme.set / 回放控制器），
     *   新造一条「发提示词」的契约要动 core —— 那是另一个任务的地盘。
     *   任务标题带整段提示词过去，由用户在新建任务对话框里选发起方式（单任务 / 流水线 / 派发）。
     */
    private async submitPromptAsTask(prompt: string): Promise<void> {
      if (!this._adapter) return;
      const spec = CLI_COMMANDS.find((c) => c.id === 'mission');
      if (!spec) {
        this.setOutput('提示词已收到，但任务通路没接线。');
        return;
      }
      this.setDraftTitle(prompt);
      this.requestNewTaskDialog(prompt);
      this.setOutput(`已打开新建任务对话框，提示词已预填（${prompt.length} 字）`);
      this.clearQuery();
    }

    /**
     * `theme`：发 theme.set，切皮肤。
     * 降级判定看**皮肤有没有真的换掉**：命令只管发命令，皮肤没换就是 handler 没接上，
     * 那就说「皮肤系统接入中，请到设置页操作」—— 不假装切成功。
     */
    private runThemeCommand(arg: string): void {
      if (!this._adapter) return;
      const before = readActiveThemeId();
      // 不带参数 = 在两套之间切（当前是像素风就切回现代风，否则切像素风）。
      // 白名单只有 default/pixel（注册表已校验过参数），这里再收一次窄口径给契约。
      const target: 'default' | 'pixel' =
        arg.length > 0
          ? arg === 'pixel'
            ? 'pixel'
            : 'default'
          : before === 'pixel'
            ? 'default'
            : 'pixel';
      this._adapter.dispatch({ type: 'theme.set', themeId: target });
      const after = readActiveThemeId();
      if (before !== null && after !== target) {
        this.setOutput('皮肤系统接入中，请到设置页操作');
        return;
      }
      this.setOutput(
        `已切换到${target === 'pixel' ? '像素风' : '现代风'}（再敲一次 theme 切回去）`
      );
      this.clearQuery();
    }

    /**
     * `replay`：放今天的回放。
     * 网关不可用 / 今天没活儿 / 控制器没接上 —— 三种情况都给人话 + 重试指引，
     * 不给错误码也不给空白（回放读不到就是读不到，不编数据）。
     */
    private async runReplayCommand(): Promise<void> {
      const controller = this._replay;
      if (!controller) {
        this.setOutput('回放没接线：当前没有回放控制器（底栏回放条没挂上）。');
        return;
      }
      let state = controller.state;
      if (!state.loaded) {
        this.setOutput('正在读取今天的记录…');
        await controller.load();
        state = controller.state;
      }
      if (state.failed) {
        this.setOutput(
          '回放失败：回放服务没连上 —— 确认它已启动（npm run dev），再敲一次「replay」重试。'
        );
        return;
      }
      if (state.entries.length === 0) {
        this.setOutput('今天还没有任务记录 · 跑一条任务就有回放了（再敲一次「replay」重试）。');
        return;
      }
      controller.play();
      this.setOutput(`正在回放今天（${state.entries.length} 条记录）`);
      this.clearQuery();
    }

    /** 写回执（面板瞬时态；不进渲染签名 —— 它自己触发重绘）。 */
    private setOutput(text: string): void {
      this._output = text;
      this.renderOutput();
    }

    /** 命令执行成功后清空输入框：命令行跑完就该回到"待输入"状态（回执留在输出区）。 */
    private clearQuery(): void {
      this._query = '';
      // 走 composer（不是直接改 DOM）：编辑区的历史游标 / 高度状态得一起复位。
      this._composer?.clear();
      const input = this.shadowRoot?.querySelector('[data-role="query"]') as HTMLTextAreaElement | null;
      if (input) input.value = '';
      this.refresh();
    }

    /** 标题草稿同步（草稿框 + 面板瞬时态是同一份，不留两份真相）。 */
    private setDraftTitle(title: string): void {
      this._draftTitle = title;
      // 共享面（@since v3.9，task_150）：⌘K 面板读到的是同一句草稿。
      publishDraftTitle(title);
      const input = this.shadowRoot?.querySelector('[data-role="draft"]') as HTMLInputElement | null;
      if (input) input.value = title;
      this.refresh();
    }

    /**
     * 对话框建完任务后的回调（@since v3.6，task_112）：清掉标题草稿。
     * 只在草稿**还是**刚提交的那句时才清 —— 用户若已经改写了输入框，别把他的新字抹掉。
     * why 是箭头函数字段：它要当 document 的事件监听用（普通方法被摘下来当监听时 this 会指向 document）。
     */
    private readonly onNewTaskSubmitted = (event: Event): void => {
      const title = (event as CustomEvent<{ title?: string }>).detail?.title ?? '';
      if (title.length === 0 || title !== this._draftTitle.trim()) return;
      this._draftTitle = '';
      publishDraftTitle('');
      const input = this.shadowRoot?.querySelector('[data-role="draft"]') as HTMLInputElement | null;
      if (input) input.value = '';
      this.refresh();
    };

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>
          ${MOTION_COMPONENT_CSS}
          :host { all: initial; }
          .panel {
            display: grid;
            gap: var(--srf-spacing-sm);
            padding: var(--srf-spacing-md);
            background: var(--srf-panel);
            /* 外圈宽度走 var（@since v3.8，task_135）：像素皮 = 1px 外实 + 1px 内衬线（双线），
               总厚度不变、**外框尺寸与现代皮一致**（布局骨架零变化）；
               现代皮拿不到本变量 → 兜底 var(--srf-border-width) = 原样零变化。 */
            border: var(--srf-outer-border-width, var(--srf-border-width)) solid var(--srf-border);
            border-radius: var(--srf-radius);
            /* 像素细节（@since v3.8，task_135）：双线边框（外实 + 内侧亮线）+ 四角角块
               （background 定位的 2×2 方块 = 直角缺角感）。
               why 都是「不占位」的绘制：inset 阴影画在边框内侧、background 不参与布局 ——
               外框尺寸一分不变。现代皮拿不到变量 → 什么都不画。 */
            box-shadow: var(--srf-double-shadow, var(--srf-shadow));
            background-image:
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent));
            background-size: var(--srf-notch-size, 0px) var(--srf-notch-size, 0px);
            background-position: left top, right top, left bottom, right bottom;
            background-repeat: no-repeat;
            color: var(--srf-text);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-md);
            line-height: var(--srf-line-height);
          }
          .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--srf-spacing-sm); }
          .title { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-semibold); }
          .selection, .field-name, .group-name, .empty { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          .notices, .sections, .group { display: grid; gap: var(--srf-spacing-xs); }
          .notice {
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            border-left: var(--srf-spacing-xxs) solid var(--srf-border-strong);
            border-radius: var(--srf-radius);
            background: var(--srf-panel-elevated);
            color: var(--srf-text-muted);
            font-size: var(--srf-font-size-sm);
          }
          .notice[data-level="warn"] { color: var(--srf-warn); border-left-color: var(--srf-warn); }
          .notice[data-level="error"] { color: var(--srf-danger); border-left-color: var(--srf-danger); }
          label.field { display: grid; gap: var(--srf-spacing-xs); }
          input {
            width: 100%;
            box-sizing: border-box;
            padding: var(--srf-spacing-sm);
            background: var(--srf-bg);
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            transition: border-color var(--srf-motion-hover), box-shadow var(--srf-motion-hover);
          }
          input:hover { border-color: var(--srf-border-strong); }
          input:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          /* —— 提示词 composer（@since v3.9，task_144）——
             输入面重造：单行 <input> → 多行 <textarea>。
             ① 字号升到 md（14px）：提示词是产品本体，输入面不能比回执还小；
             ② 聚焦态描边 + 微光晕：用户原话「肉眼难辨」——聚焦时必须一眼看见它在哪；
             ③ resize:none + overflow 由 JS 控：高度只跟内容走，拖不动 = 布局不会失控；
             ④ pre-wrap + break-word：粘贴的长中文不撑出横向滚动条。 */
          textarea.composer {
            width: 100%;
            box-sizing: border-box;
            /* 纵向内边距压到 xs(4px)：控制岛的高度预算是 100px（硬验收），
               收起态这一行必须只占一行的高度（21+8+2 = 31px）。 */
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            background: var(--srf-bg);
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-md);
            line-height: 1.5;
            resize: none;
            overflow-y: hidden;
            white-space: pre-wrap;
            word-break: break-word;
            overflow-wrap: anywhere;
            transition: border-color var(--srf-motion-hover), box-shadow var(--srf-motion-hover);
          }
          textarea.composer:hover { border-color: var(--srf-border-strong); }
          textarea.composer::placeholder { color: var(--srf-text-muted); }
          textarea.composer:focus {
            border-color: var(--srf-accent);
            outline: none;
            /* 微光晕：描边之外再加一层柔光，聚焦时这块区域在余光里也认得出来。 */
            box-shadow:
              0 0 0 2px color-mix(in srgb, var(--srf-accent) 45%, transparent),
              0 0 16px color-mix(in srgb, var(--srf-accent) 30%, transparent);
          }
          /* 降级动效：系统要「少动」时，composer 不做过渡（只留静态描边）。 */
          @media (prefers-reduced-motion: reduce) {
            textarea.composer { transition: none; }
          }
          .group-name { font-weight: var(--srf-font-weight-semibold); letter-spacing: 0.04em; }
          .empty { padding: var(--srf-spacing-md); text-align: center; border: var(--srf-border-width) dashed var(--srf-border); border-radius: var(--srf-radius); }
          /* 命令行回执区（@since v3.6）：贴着输入框的一行"终端输出"。
             why 不进 toast：命令就在眼前，回执也得在眼前。
             @since v3.9（task_144）：字号从 xs(11px) 升 sm(12px) —— 回执是命令的**结果**，
               11px 在深色底上几乎读不出来；长回执内部滚动，不把面板撑开。 */
          .output {
            padding: var(--srf-spacing-xs);
            color: var(--srf-text-muted);
            font-size: var(--srf-font-size-sm);
            line-height: var(--srf-line-height);
            border-left: var(--srf-spacing-xxs) solid var(--srf-border-strong);
            /* @since v3.9（task_145）：回执按 markdown 渲染 —— 容器不再自己 pre-wrap
               （markdown 是块级结构，块间换行会变成多余空行），段内换行由 .md-content p 负责。 */
            white-space: normal;
            max-height: 220px;
            overflow-y: auto;
          }
          .empty-hint { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          button.command {
            display: grid;
            gap: var(--srf-spacing-xxs);
            width: 100%;
            text-align: left;
            padding: var(--srf-spacing-sm);
            background: var(--srf-panel-elevated);
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            cursor: pointer;
            transition: background var(--srf-motion-hover), border-color var(--srf-motion-hover), color var(--srf-motion-hover),
              /* 列表项 hover 光标过渡（@since v3.8，task_138）：整行朝光标方向挪 2px ——
                 why 挪而不是只变色：变色只改颜色，挪动才「指向」那一行（长列表里眼睛更容易跟上）。 */
              transform var(--srf-motion-hover);
          }
          button.command:hover:not(:disabled) {
            border-color: var(--srf-border-strong);
            background: var(--srf-panel);
            transform: translateX(2px);
          }
          button.command:active:not(:disabled) { border-color: var(--srf-accent); }
          button.command:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          button.command[data-primary="true"]:not(:disabled) { border-color: var(--srf-accent); color: var(--srf-accent); }
          button.command:disabled { color: var(--srf-text-disabled); cursor: not-allowed; opacity: 0.65; }
          .cmd-label { font-weight: var(--srf-font-weight-semibold); }
          .cmd-hint { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          button.command:disabled .cmd-hint { color: var(--srf-text-disabled); }
          /* —— 紧凑条形态（@since v3.4）：控制岛内的命令条 ——
             排版差异全部收在这里；命令清单、可用性判定与派发与完整形态完全一致。
             why 抬头与通知列表在紧凑形态下沉：控制岛的高度预算是 100px（硬验收），
             抬头 / 通知 / 两个输入框一行摆不下 —— 通知的「计数」仍由顶栏徽标承担。
             @since v3.9（task_144）：命令条改成**两行**（flex-wrap 换行，DOM 顺序不动）：
               第 1 行 = 提示词 composer（flex-basis 100% → 独占一行）；
               第 2 行 = 任务标题草稿 + 命令按钮横排 + 回执（沿用原口径）。
             why composer 单独占一行：它现在是「大段提示词」的入口，
               挤在横排里就只能是个几十像素的小缝（用户原话：肉眼难辨的小区域）。
             why 用 flex-wrap 而不是 grid-template-areas：
               **绝对定位的子元素在 grid 里以「网格区域」为包含块** ——
               多行回执浮层（left/right: 0 要铺满整行）会被关进那列几十像素宽的格子里，
               清单被压成一列一个字（实测 clientWidth=8px）。
               flex 容器没有这条规则：脱流浮层的包含块就是面板本身 → 铺满整行。 */
          :host([variant="strip"]) .panel {
            display: flex;
            flex-flow: row wrap;
            align-items: center;
            gap: var(--srf-spacing-xs) var(--srf-spacing-sm);
            padding: 0;
            background: transparent;
            border: none;
            border-radius: 0;
            overflow: visible;
            /* 定位上下文：多行回执 / 展开态 composer 浮在命令条上方时要相对本面板定位（不依赖宿主）。 */
            position: relative;
          }
          :host([variant="strip"]) .head,
          :host([variant="strip"]) .notices { display: none; }
          /* 两个输入框压成行内窄控件（搜索 + 任务标题草稿都还在，一项功能不减）。 */
          :host([variant="strip"]) label.field {
            display: flex;
            align-items: center;
            gap: var(--srf-spacing-xxs);
            flex: 0 0 auto;
            min-width: 0;
          }
          :host([variant="strip"]) .field-name { display: none; }
          :host([variant="strip"]) input {
            width: var(--command-strip-input-w, 96px);
            height: 22px;
            padding: 0 var(--srf-spacing-xs);
            font-size: var(--srf-font-size-xs);
          }
          /* composer：独占第 1 行（basis 100% → 后面的兄弟自动换行）。
             why 选择器写 label.field-composer：上面的 label.field 规则
             （display:flex / flex:0 0 auto）选择器更具体，不对齐就会被它压回去
             —— 实测 composer 被压成 0 宽，整条输入面消失。 */
          :host([variant="strip"]) label.field-composer {
            /* order:-1 → composer 排到最前，独占第 1 行（DOM 顺序不动，只改排版顺序）。
               why 不靠 basis 断行：草稿框在前会先占住第 1 行，composer 被挤到第 2 行、
               按钮被挤到第 3 行 —— 控制岛直接顶到 100px 上限（实测）。 */
            order: -1;
            flex: 0 0 100%;
            display: grid;
            position: static;
            /* 展开态（编辑区脱流浮起）时这一格不能塌 —— 否则控制岛会缩一下再弹回来。
               32px = 1 行（21px）+ 上下内边距（4+4）+ 边框（2）+ 余量。 */
            min-height: 32px;
          }
          :host([variant="strip"]) .field-draft { flex: 0 0 auto; }
          /* 命令流：两个 scope 分组的按钮摊平成一条横排（group-name 在紧凑形态下沉）。 */
          :host([variant="strip"]) .sections {
            flex: 1 1 auto;
            display: flex;
            align-items: center;
            gap: var(--srf-spacing-xs);
            min-width: 0;
            overflow-x: auto;
            overflow-y: hidden;
            scrollbar-width: thin;
          }
          :host([variant="strip"]) .group { display: contents; }
          :host([variant="strip"]) .group-name { display: none; }
          :host([variant="strip"]) button.command {
            display: inline-flex;
            align-items: center;
            width: auto;
            flex: 0 0 auto;
            padding: 2px var(--srf-spacing-sm);
            font-size: var(--srf-font-size-xs);
            white-space: nowrap;
          }
          /* 副标题（作用对象 / 禁用原因）改挂按钮 title —— 悬停可见，不占行高。 */
          :host([variant="strip"]) .cmd-hint { display: none; }
          :host([variant="strip"]) .empty {
            padding: var(--srf-spacing-xs);
            font-size: var(--srf-font-size-xs);
          }
          /* 展开态 composer（@since v3.9，task_144）：脱流浮到命令条上方。
             why 不就地长高：控制岛的高度预算是 100px（硬验收），
               就地长高会把岛顶出屏幕（岛的 flex 是底对齐，溢出会往屏幕下跑）。
             why 浮起时铺满整行：提示词要能铺开写，缩在一条缝里等于没升级。 */
          :host([variant="strip"]) textarea.composer[data-expanded="true"] {
            position: absolute;
            left: 0;
            right: 0;
            bottom: calc(100% + 4px);
            z-index: ${zVar('localTop')};
            background: var(--srf-panel);
            border-color: var(--srf-border-strong);
            box-shadow: var(--srf-shadow);
          }
          /* 回执区在紧凑形态下压成行内窄条（不撑高控制岛：1 行 + 横向滚动）。
             why 不换行：控制岛的高度预算是 100px（硬验收），回执再高就把时间轴挤没了。 */
          :host([variant="strip"]) .output {
            flex: 0 1 auto;
            max-width: 300px;
            padding: 0 var(--srf-spacing-xs);
            border-left: none;
            white-space: nowrap;
            overflow-x: auto;
            overflow-y: hidden;
            max-height: none;
          }
          /* 多行回执（help 清单 / 未匹配清单）：浮到命令条上方、完整可读。
             why 浮层而不是就地换行：就地换行会把控制岛撑高（岛高 100px 是硬验收），
               剩下的行照样被裁成一行 —— 裁掉等于没反馈（复测 P2「help 零反馈」的真正成因：
               清单在 DOM 里，但用户眼前只有第一行的一截）。
             why 只对多行回执浮层：单行回执（已切换到像素风…）仍是行内窄条，观感不动。 */
          :host([variant="strip"]) .output[data-multiline="true"] {
            position: absolute;
            left: 0;
            right: 0;
            bottom: calc(100% + 4px);
            max-width: none;
            max-height: 160px;
            padding: var(--srf-spacing-xs);
            white-space: normal;
            overflow-x: hidden;
            overflow-y: auto;
            background: var(--srf-panel);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            z-index: ${zVar('localMid')};
          }
          :host([variant="strip"]) .empty-hint { white-space: nowrap; }
          ${MARKDOWN_CSS}
        </style>
        <div class="panel ${MOTION_CLASS.enter}" part="panel">
          <div class="head">
            <span class="title">命令</span>
            <span class="selection" data-role="selection">未选中单位</span>
          </div>
          <div class="notices" data-role="notices"></div>
          <label class="field field-draft">
            <span class="field-name">任务标题</span>
            <input type="text" data-role="draft" placeholder="输入后「发起任务」才可用" />
          </label>
          <label class="field field-composer">
            <span class="field-name">命令 / 提示词</span>
            <textarea
              class="composer"
              data-role="query"
              rows="1"
              spellcheck="false"
              title="Enter 提交 · Shift+Enter 换行 · ⌘Enter 总是提交 · ↑↓ 翻历史"
              placeholder="输入命令，或直接粘贴大段任务提示词…"
            ></textarea>
          </label>
          <div class="sections" data-role="sections"></div>
          <div class="output ${MARKDOWN_CLASS}" data-role="output" hidden></div>
        </div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;

        // 输入事件：只改瞬时态 + 重画列表。外壳（含编辑区）不重建，光标不丢。
        root.addEventListener('input', (ev: Event) => {
          const target = ev.target as HTMLInputElement | HTMLTextAreaElement | null;
          if (!target) return;
          if (target.dataset.role === 'draft') {
            this._draftTitle = target.value;
            // 共享面（@since v3.9，task_150）：草稿是跨面共享的一句。
            publishDraftTitle(target.value);
          } else if (target.dataset.role === 'query') this._query = target.value;
          else return;
          this.refresh();
        });

        // 命令点击：data-command / data-scope 上的目录项坐标 → HudCommand。
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          const host = target?.closest?.('[data-command]') as HTMLElement | null;
          const id = host?.getAttribute('data-command');
          const scope = host?.getAttribute('data-scope');
          if (!id || !scope) return;
          this.runCommand(id as PanelCommandId, scope as CommandScope);
        });
      }

      // 提示词 composer（@since v3.9，task_144）：键位（Enter / Shift+Enter / ⌘Enter / Esc）、
      //   IME 合成保护、↑↓ 历史导航、自动长高 —— 全在 prompt-composer 里。
      //   面板这一侧只接「原文」：拿去做命令解析 / 任务通路。
      // why 重建前先 destroy：反复挂卸时旧实例的监听还挂在旧节点上（内存 + 事件双泄漏）。
      this._composer?.destroy();
      this._composer = null;
      const composerEl = root.querySelector<HTMLTextAreaElement>('[data-role="query"]');
      if (composerEl) {
        this._composer = new PromptComposer(composerEl, {
          onSubmit: (raw) => { this.onComposerSubmit(raw); },
        });
      }

      this.renderNotices();
    }

    /**
     * composer 提交（@since v3.9，task_144）：原文 → 命令行。
     * why 读编辑区当下的值而不是 this._query：输入事件与提交之间可能夹着粘贴等路径，
     *   以编辑区当下的值为准，别拿可能滞后的镜像。
     */
    private onComposerSubmit(raw: string): void {
      this._query = raw;
      const el = this.shadowRoot?.querySelector('[data-role="query"]');
      // 输入行微脉冲（@since v3.8，task_138）：提交那一下行轻轻弹一下 ——
      //   why 需要：回执可能延迟出现，先给一个「收到了」的即时反馈（120ms，不阻塞）。
      if (el) this.pulseInput(el as HTMLElement);
      void this.runCli(raw);
    }

    /**
     * 输入行微脉冲（@since v3.8，task_138）：提交命令时给输入行一次 120ms 的轻弹。
     * why 要「摘类 → 强制回流 → 挂类」：同一元素重复挂同一个类不会重放动画，
     *   强制回流（读 offsetWidth）让浏览器重算样式，动画才会重新起跑。
     */
    private pulseInput(el: HTMLElement): void {
      el.classList.remove(MOTION_CLASS.pulse);
      void el.offsetWidth;
      el.classList.add(MOTION_CLASS.pulse);
      // 播完摘掉类：否则脉冲类会一直挂在元素上（fill: both 的终态是原样，不影响视觉，但要保持干净）。
      el.addEventListener(
        'animationend',
        () => {
          el.classList.remove(MOTION_CLASS.pulse);
        },
        { once: true },
      );
    }

    private renderNotices(): void {
      const box = this.shadowRoot?.querySelector('[data-role="notices"]');
      if (!box) return;
      const notices = (this._state?.notices ?? []).slice(0, MAX_VISIBLE_NOTICES);
      box.innerHTML = notices
        .map(
          (n) =>
            `<div class="notice" data-level="${escapeHtml(n.level)}">${escapeHtml(n.text)}</div>`
        )
        .join('');
    }

    /**
     * 回执区（@since v3.6，task_113；@since v3.9 task_145 改走 markdown 管线）：
     * 回执含用户输入，走 marked → DOMPurify → innerHTML —— 已消毒，可整块赋值。
     */
    private renderOutput(): void {
      const box = this.shadowRoot?.querySelector<HTMLElement>('[data-role="output"]');
      if (!box) return;
      box.innerHTML = renderMarkdown(this._output);
      enhanceMarkdown(box);
      box.hidden = this._output.length === 0;
      // 多行回执（help 清单 / 未匹配清单）打个标记：紧凑形态据此把回执浮到命令条上方，
      // 而不是压成一行被裁掉 —— 裁掉 = 用户看不见 = 等于没反馈（复测 P2：help 静默）。
      box.setAttribute('data-multiline', this._output.includes('\n') ? 'true' : 'false');
    }

    private renderSections(): void {
      const root = this.shadowRoot;
      const box = root?.querySelector('[data-role="sections"]');
      if (!root || !box) return;

      const selectionLabel = root.querySelector('[data-role="selection"]');
      if (selectionLabel) selectionLabel.textContent = describeSelection(this._state);
      this.renderNotices();

      const { selection, global } = groupByScope(this.contextualCommands());

      // 搜索把两个分组都过滤空了：只给一条"没匹配上"，不逐组重复报空。
      // @since v3.6（task_113）：命令行接通后，这块同时是**引导位**——
      //   输入像一条命令就提示"回车执行"，不像就顺带把能敲的命令列出来
      //   （死功能报告里的「没有匹配的命令」从此不再是死路一条）。
      if (selection.length === 0 && global.length === 0) {
        box.innerHTML =
          `<div class="empty" data-role="empty">${escapeHtml(this.emptyHintText())}</div>` +
          `<div class="empty-hint" data-role="empty-hint">可用命令：${escapeHtml(cliUsageList())}</div>`;
        return;
      }

      const groups: Array<{ scope: CommandScope; items: ResolvedCommand[] }> = [
        { scope: 'selection', items: selection },
        { scope: 'global', items: global },
      ];

      box.innerHTML = groups
        .filter((g) => g.items.length > 0)
        .map((g) => this.renderGroup(g.scope, g.items))
        .join('');
    }

    private renderGroup(scope: CommandScope, items: ResolvedCommand[]): string {
      const buttons = items.map((c) => this.renderCommand(c)).join('');
      return `
        <div class="group" part="group" data-scope="${scope}">
          <div class="group-name">${SECTION_LABELS[scope]}</div>
          ${buttons}
        </div>
      `;
    }

    private renderCommand(c: ResolvedCommand): string {
      const detail = c.enabled ? (c.hint ?? '') : (c.reason ?? '');
      const primary = c.spec.primary === true ? 'true' : 'false';
      return `
        <button
          type="button"
          class="command"
          data-command="${escapeHtml(c.spec.id)}"
          data-scope="${escapeHtml(c.spec.scope)}"
          data-primary="${primary}"
          data-enabled="${c.enabled ? 'true' : 'false'}"
          title="${escapeHtml(detail)}"
          ${c.enabled ? '' : 'disabled'}
        >
          <span class="cmd-label">${escapeHtml(c.spec.label)}</span>
          <span class="cmd-hint">${escapeHtml(detail)}</span>
        </button>
      `;
    }
  }

  customElements.define(COMMAND_PANEL_TAG, CommandPanel);
  return CommandPanel as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库面板的统一装配口径（与 main-screen / hello-loop-panel 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 * 选它而不是让调用方自己 createElement，是为了把"注册 + 注入 + 退订"三件事收在一处，
 *   调用方不必知道 custom element 的存在细节。
 *
 * @since v3.4（task_090）新增 options.variant：'strip' = 控制岛内的 1 行命令条（见文件头）。
 * @since v3.6（task_113）新增 options.replay：当日回放控制器 —— 命令行 `replay` 的落地面。
 *   缺省 = null → 该命令如实说"没接线"（不假装能放）。
 */
export function mountCommandPanel(
  deps: CommandPanelDeps,
  host: HTMLElement,
  options: {
    readonly variant?: 'default' | 'strip';
    readonly replay?: ReplayController | null;
  } = {}
): () => void {
  defineCommandPanel();
  const element = document.createElement(COMMAND_PANEL_TAG) as StratCommandPanelElement;
  // 形态属性必须在入 DOM 前落定 —— connectedCallback 里的首绘要按形态建外壳。
  element.setAttribute('variant', options.variant ?? 'default');
  element.replay = options.replay ?? null;
  element.adapter = deps;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}