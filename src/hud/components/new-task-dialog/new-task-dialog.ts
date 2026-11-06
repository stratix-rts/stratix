/**
 * 文件职责：**新建任务对话框** Web Component（`<strat-new-task-dialog>`，@since v3.6 / task_112）——
 *   底栏「新建任务」的落地面板：填好标题点「新建任务」→ 这里弹出四个动作
 *   （单任务 / 流水线 / 派发 / 取消），由用户选一种发起方式。
 *   入口口径与「打开聊天」同源（hud 发 DOM 事件，组合根开面板）：
 *   命令面板（global 组的「新建任务」）派发 NEW_TASK_OPEN_EVENT（标题在 detail 里），
 *   组合根（app/main/main-entry.ts）收到后调 open({ title })。
 *
 * 输入：注入的四件套 —— dispatch（发 HudCommand）/ subscribe（读 WorldState：选中集 + 角色名单）/
 *      notify（toast 轻提示）/ occlusion（全屏弹窗登记：四角降对比禁点 + ESC 统一关闭）。
 * 输出：fixed 遮罩 + 居中对话框（Shadow DOM，皮肤 token）；四个动作按钮；每次动作都有 toast 反馈。
 * 禁止事项：
 *   1. import world/、phaser、app/、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— 命令一律经注入的 dispatch 发（与 hud 其余面板同一口径）；
 *   3. 自己写派单 / 编排逻辑 —— 三条动作的命令构造全部复用既有纯函数：
 *      单任务走 command-catalog 的 buildCommand、流水线走 pipeline-catalog 的
 *      buildPipelineStartCommand、派发走 agent-catalog 的 buildTaskAssignCommand；
 *      HUD 不裁决合法性（合法性归 core 状态机）；
 *   4. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   5. 编造成功文案 —— 成功与失败的真相是 core 的 Notice（notice 到达即 toast），
 *      HUD 只在**本地拒绝**（构造不出命令 / 没有候选角色）时自己说话；
 *   6. 泄漏监听器 —— 总线订阅在 disconnectedCallback 里撤（perf 硬约束）；
 *   7. 每次状态广播都重画对话框 —— 面板读数用签名判重（perf：广播很频繁）。
 *
 * @since v3.6（task_112）。
 */

import type { HudCommand, Notice, NoticeLevel, WorldState } from '../../../core/types';
import type { OcclusionController } from '../../layers/occlusion';
import { buildTaskAssignCommand } from '../../panels/agent-catalog';
import { buildCommand, findCommandSpec } from '../../panels/command-catalog';
import { PIPELINE_PRESETS, buildPipelineStartCommand } from '../../panels/pipeline-catalog';
import { recommendAssignees } from '../../panels/task-assign-catalog';
import { zVar } from '../../theme/layer-tokens';
import { MOTION_CLASS, MOTION_COMPONENT_CSS } from '../../theme/motion-tokens';
import type { ToastTone } from '../toast/toast-host';

export const NEW_TASK_DIALOG_TAG = 'strat-new-task-dialog';

/**
 * 「打开新建任务对话框」的 DOM 事件名（命令面板 → 组合根）。
 * why 走 DOM 事件而不是总线命令：开对话框是**纯 UI 动作**，core 不该为它加一条命令
 *   （core 只认业务语义）；口径与「打开聊天」（stratix:chat-open）完全一致。
 */
export const NEW_TASK_OPEN_EVENT = 'stratix:new-task-open';

/**
 * 「已提交一条任务」的 DOM 事件名（对话框 → 命令面板）。
 * why 需要它：标题草稿是命令面板的瞬时态，建完任务后草稿得清掉，
 *   否则再点一次「新建任务」会拿同一句话再建一条（用户以为按钮坏了）。
 *   事件从对话框冒泡到 document，命令面板在 document 上听（跨组件不互相持有引用）。
 */
export const NEW_TASK_SUBMITTED_EVENT = 'stratix:new-task-submitted';

/** 本对话框在遮挡栈里的登记名（@since v3.5 task_099 的 R1/R4：全屏弹窗 = 模态）。 */
export const NEW_TASK_OCCLUSION_ID = 'new-task-dialog';

/**
 * 反馈窗口时长（ms）：动作发出后这段时间内 core 的新 Notice 都 toast。
 * why 8s：本地直连是同步到达（毫秒级），远程模式（world-sync 往返 + 快照节流 100ms）也在秒级 ——
 *   8s 足够覆盖，两种模式都不会出现「建了任务却一声不吭」。
 */
export const FEEDBACK_WINDOW_MS = 8_000;

/**
 * 动作 id（DOM 上的 data-action）。四个动作 = 任务书要求的「四按钮组」。
 *
 * @since v3.9（task_148）新增 'create-character'：**死按钮的出口** ——
 *   0 角色时「派发」不可用（禁用态 + 原因说明），必须同时给一条**真能走的路**：
 *   点「去新建角色」→ 建档向导（建完就能派发）。
 */
export type NewTaskAction = 'single' | 'pipeline' | 'dispatch' | 'cancel' | 'create-character';

/** 打开对话框时带的入参。 */
export interface NewTaskOpenOptions {
  /** 底栏输入框里的任务标题（已由命令面板 trim 过）。 */
  readonly title: string;
}

/** 对话框依赖（组合根注入；与 hud 其余面板同一装配口径）。 */
export interface NewTaskDialogDeps {
  /** 命令派发口（与 HUD 其余面板同一个 adapter）。 */
  readonly dispatch: (command: HudCommand) => void;
  /** 状态订阅口（读选中集与角色名单）。 */
  readonly subscribe: (handler: (state: WorldState) => void) => () => void;
  /** 轻提示口（toast）。缺省 = 不提示（此时只靠对话框自身的可见反馈）。 */
  readonly notify?: (text: string, tone?: ToastTone) => void;
  /** 遮挡控制器（全屏弹窗登记：四角降对比禁点 + ESC 统一关闭）。 */
  readonly occlusion?: OcclusionController | null;
  /**
   * 「去新建角色」出口（@since v3.9，task_148）—— 组合根接既有建档向导。
   *
   * why 需要它：0 角色时「派发」是**死按钮**（点了永远没有结果）。
   *   治理口径不是「点一下给个 toast 就算了」，而是**禁用 + 说清原因 + 给一条真能走的路**：
   *   禁用的按钮配一条能点通的「去新建角色」，墙后面才有门。
   *   缺省 = 没有出口（此时只显示禁用态与原因，不假装有路可走）。
   */
  readonly onCreateCharacter?: () => void;
}

/** 自定义元素的对外形状（组合根与测试按它操作）。 */
export interface StratNewTaskDialogElement extends HTMLElement {
  /** 打开对话框（幂等：已开只换标题）。 */
  open(options: NewTaskOpenOptions): void;
  /** 关闭对话框（幂等）。 */
  close(): void;
  /** 当前是否开着（渲染态镜像）。 */
  readonly opened: boolean;
}

/** Notice 级别 → toast 语气（error 用 danger —— 「出事了」）。 */
function toneOf(level: NoticeLevel): ToastTone {
  if (level === 'warn') return 'warn';
  if (level === 'error') return 'danger';
  return 'info';
}

/** HTML 文本转义（标题是用户输入，必须转义后才进 innerHTML）。 */
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
 * 工厂：注册 `<strat-new-task-dialog>`。
 * 幂等（与 defineToastHost / defineShortcutHelp 同约定）：重复 register 返回已注册构造器。
 */
export function defineNewTaskDialog(): typeof HTMLElement {
  if (customElements.get(NEW_TASK_DIALOG_TAG)) {
    return customElements.get(NEW_TASK_DIALOG_TAG) as unknown as typeof HTMLElement;
  }

  class NewTaskDialog extends HTMLElement implements StratNewTaskDialogElement {
    private _deps: NewTaskDialogDeps | null = null;
    private _opened = false;
    private _title = '';
    private _state: WorldState | null = null;
    private _unsubscribe: (() => void) | null = null;
    /** 上一次状态里的通知 id（判「这条通知是新来的」；每轮整体替换 → 不会无界增长）。 */
    private _prevNoticeIds: ReadonlySet<string> = new Set<string>();
    /**
     * 反馈窗口的截止时刻（ms 时间戳）：动作发出后的一小段时间内，core 的新 Notice 都要 toast。
     * why 需要窗口：命令是 fire-and-forget，落地结论由 core 的 Notice 给出；
     *   本地直连时 Notice 同步到达，远程模式（world-sync）时晚几十毫秒才到 —— 窗口保证两种模式 alike。
     */
    private _feedbackUntil = 0;
    /** 面板读数签名（选中数 + 推荐承接人 + 标题）—— 变了才重画（perf：广播很频繁）。 */
    private _panelSignature = '';

    get opened(): boolean {
      return this._opened;
    }

    /** 注入依赖（组合根在挂载前后设置都生效）。 */
    set deps(value: NewTaskDialogDeps | null) {
      this._deps = value;
      this.bindAdapter();
    }

    get deps(): NewTaskDialogDeps | null {
      return this._deps;
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.buildDom();
      this.bindAdapter();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：退订总线 + 撤遮挡登记（关闭即全恢复）。
      this.releaseAdapter();
      this._deps?.occlusion?.closeModal(NEW_TASK_OCCLUSION_ID);
      this._opened = false;
      this.removeAttribute('open');
      this.setAttribute('aria-hidden', 'true');
    }

    open(options: NewTaskOpenOptions): void {
      const title = options.title.trim();
      if (title.length === 0) {
        // 空标题没有可发的命令：本地拒绝并说清楚（不静默失败）。
        this._deps?.notify?.('先填任务标题，再点「新建任务」', 'warn');
        return;
      }
      this._title = title;
      this._feedbackUntil = Date.now() + FEEDBACK_WINDOW_MS;
      this.syncOpened(true);
      this.renderPanel();
      this.playEntrance();
    }

    /**
     * 任务单的入场强调（@since v3.9，task_148）—— 恢复「任务单开了」的存在感。
     *
     * why 需要：r5 实测「多行提示词回车后，用户不知道任务单已经开了」——
     *   反馈链只有底部输出区一行小字，任务单本身没有一点动静。
     *   治理口径：**开单这一刻必须被看见**（入场落位 + 一次微脉冲）。
     *
     * why 走既有动效 token（138）：入场用 MOTION_CLASS.enter（位移淡入），
     *   脉冲用 MOTION_CLASS.pulse（scale 微脉冲）—— 不自造关键帧、不写野值
     *   （147 的纪律：全应用一个节拍）。
     *
     * why 要强制重排：同一个元素反复 open 时，动画已在播 → 直接加类不会重播；
     *   摘类 + 读一次布局（offsetWidth）强制回流，再加类 = 重播。
     */
    private playEntrance(): void {
      const panel = this.shadowRoot?.querySelector<HTMLElement>('[data-role="panel"]');
      if (!panel) return;
      panel.classList.remove(MOTION_CLASS.enter, MOTION_CLASS.pulse);
      void panel.offsetWidth; // 强制回流：让摘掉的类真正失效（否则加回去不重播）
      panel.classList.add(MOTION_CLASS.enter, MOTION_CLASS.pulse);
    }

    close(): void {
      this.syncOpened(false);
    }

    // —— 订阅生命周期 ——
    private bindAdapter(): void {
      if (!this.isConnected || !this._deps || this._unsubscribe) return;
      this._unsubscribe = this._deps.subscribe((state) => {
        this._state = state;
        this.consumeNotices(state.notices ?? []);
        if (this._opened) this.renderPanel();
      });
    }

    private releaseAdapter(): void {
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    /**
     * 把 core 的新 Notice 变成 toast（成功与失败的真相都在这里）。
     * 只在反馈窗口内提示 —— 窗口外的新通知不抢戏（那是态势面板 / 日志抽屉的活）。
     */
    private consumeNotices(notices: readonly Notice[]): void {
      const now = Date.now();
      const current = new Set<string>();
      for (const notice of notices) {
        current.add(notice.id);
        if (this._prevNoticeIds.has(notice.id)) continue;
        if (now <= this._feedbackUntil) {
          this._deps?.notify?.(notice.text, toneOf(notice.level));
        }
      }
      // 整体替换（不是无限追加）：通知 id 集合因此不会随会话时长增长（perf 硬约束）。
      this._prevNoticeIds = current;
    }

    /** 开合态落 DOM：open 属性 + aria + 遮挡登记（R1：全屏弹窗 = 模态）。 */
    private syncOpened(opened: boolean): void {
      this._opened = opened;
      if (opened) {
        this.setAttribute('open', '');
        this._deps?.occlusion?.openModal(NEW_TASK_OCCLUSION_ID, () => this.close());
      } else {
        this.removeAttribute('open');
        this._deps?.occlusion?.closeModal(NEW_TASK_OCCLUSION_ID);
      }
      this.setAttribute('role', 'dialog');
      this.setAttribute('aria-modal', 'true');
      this.setAttribute('aria-hidden', opened ? 'false' : 'true');
    }

    // —— DOM ——
    private buildDom(): void {
      const root = this.shadowRoot;
      if (!root) return;
      // 初始态的对话框语义（构造即声明，屏幕阅读器不必等第一次开合）。
      this.setAttribute('role', 'dialog');
      this.setAttribute('aria-modal', 'true');
      this.setAttribute('aria-hidden', 'true');
      root.innerHTML = `
        <style>
          /*
           * 宿主本体 = 全屏浮层容器（fixed 铺满视口）。
           * why 不用「宿主零尺寸 + 内部 fixed 遮罩」（shortcut-help 的写法）：那样宿主没有盒子，
           *   「宿主可见吗」这类断言只能去看影子树里的元素 —— 浮层的可见性应当由宿主自己回答。
           * why pointer-events: auto：#hud-root 是 pointer-events:none（空白处要穿透到战场），
           *   浮层必须自己把事件接回来，否则按钮点不动。
           */
          :host {
            all: initial;
            position: fixed;
            inset: 0;
            z-index: ${zVar('spotlight')}; /* toast(50) 之上：对话框打开时它是当前焦点面 */
            display: block;
            pointer-events: auto;
            font-family: var(--srf-font-ui);
          }
          /*
           * 关闭态隐藏宿主 —— 必须用「:host() 参数形式」。
           * why：':host' 后直接接 ':not()' 的复合写法在 Chromium ≥~145 上不匹配
           *   （shortcut-help 已实证：裸 ':host' 生效、':host(:not([open]))' 生效，
           *   唯独复合写法失效 → 遮罩从启动起铺满全屏并吞掉所有点击）。
           */
          :host(:not([open])) { display: none; }
          .backdrop {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--srf-spacing-xl);
            box-sizing: border-box;
            background: var(--srf-backdrop);
          }
          .panel {
            box-sizing: border-box;
            width: min(520px, 92vw);
            max-height: 80vh;
            overflow-y: auto;
            scrollbar-width: thin;
            scrollbar-color: var(--srf-border-strong) transparent;
            padding: var(--srf-spacing-xl);
            background: var(--srf-panel);
            border: var(--srf-border-width) solid var(--srf-border-strong);
            border-radius: var(--srf-radius);
            box-shadow: var(--srf-double-shadow, var(--srf-shadow-lg));
            /* 四角角块（@since v3.8，task_135）：与按钮 / 面板 / 横幅同一套像素语言
               （background 定位的 2×2 方块 = 直角缺角感；现代皮兜底 0px = 什么都不画）。 */
            background-image:
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent)),
              linear-gradient(var(--srf-notch-color, transparent), var(--srf-notch-color, transparent));
            background-size: var(--srf-notch-size, 0px) var(--srf-notch-size, 0px);
            background-position: left top, right top, left bottom, right bottom;
            background-repeat: no-repeat;
            color: var(--srf-text);
          }
          .head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: var(--srf-spacing-md);
            margin-bottom: var(--srf-spacing-md);
            padding-bottom: var(--srf-spacing-md);
            border-bottom: var(--srf-border-width) solid var(--srf-border);
          }
          .title { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-semibold); }
          .subject {
            margin-bottom: var(--srf-spacing-lg);
            color: var(--srf-text-muted);
            font-size: var(--srf-font-size-sm);
            line-height: var(--srf-line-height);
            overflow-wrap: anywhere;
          }
          .options { display: grid; gap: var(--srf-spacing-sm); }
          button.option {
            display: grid;
            gap: var(--srf-spacing-xxs);
            width: 100%;
            text-align: left;
            padding: var(--srf-spacing-sm) var(--srf-spacing-md);
            background: var(--srf-panel-elevated);
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            line-height: var(--srf-line-height);
            cursor: pointer;
            transition: background var(--srf-motion-hover), border-color var(--srf-motion-hover), color var(--srf-motion-hover);
          }
          button.option:hover { border-color: var(--srf-border-strong); background: var(--srf-panel); }
          button.option:active { border-color: var(--srf-accent); }
          button.option:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          button.option[data-action="single"] { border-color: var(--srf-accent); }
          /* 死按钮的禁用态（@since v3.9，task_148）：灰掉 + not-allowed —— 一眼看得出点不了。 */
          button.option:disabled {
            opacity: 0.55;
            cursor: not-allowed;
            border-color: var(--srf-border);
            background: transparent;
            color: var(--srf-text-muted);
          }
          button.option:disabled:hover { border-color: var(--srf-border); background: transparent; }
          button.option:disabled .opt-title { text-decoration: line-through; }
          /* 出口按钮（task_148）：唯一「能走通」的那条路 —— 描边点亮。 */
          button.option[data-action="create-character"] { border-color: var(--srf-accent); }
          button.option[data-action="create-character"] .opt-title { color: var(--srf-accent); }
          .opt-title { font-weight: var(--srf-font-weight-semibold); }
          .opt-desc { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          button.close {
            all: unset;
            cursor: pointer;
            color: var(--srf-text-muted);
            font-size: var(--srf-font-size-md);
            padding: var(--srf-spacing-xxs) var(--srf-spacing-xs);
            border-radius: var(--srf-radius);
          }
          button.close:hover { color: var(--srf-text); background: var(--srf-panel-elevated); }
          button.close:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
        ${MOTION_COMPONENT_CSS}
        </style>
        <div class="backdrop" data-role="backdrop">
          <div class="panel" data-role="panel">
            <div class="head">
              <div class="title">新建任务</div>
              <button type="button" class="close" data-action="cancel" aria-label="关闭">×</button>
            </div>
            <div class="subject" data-role="subject"></div>
            <div class="options" data-role="options"></div>
          </div>
        </div>
      `;

      // 动作点击：data-action 上的四个 id → 对应动作。
      root.addEventListener('click', (event: Event) => {
        const backdrop = root.querySelector('[data-role="backdrop"]');
        // 点遮罩 = 取消（R4 的第二条关闭途径：ESC + 点遮罩双途径必齐）。
        if (event.target === backdrop) {
          this.runAction('cancel');
          return;
        }
        const target = event.target as HTMLElement | null;
        const host = target?.closest?.('[data-action]') as HTMLElement | null;
        const action = host?.getAttribute('data-action') as NewTaskAction | null;
        if (!action) return;
        this.runAction(action);
      });
    }

    /** 渲染四个动作按钮 + 当前上下文读数（指派对象 / 推荐承接人）。 */
    private renderPanel(): void {
      const root = this.shadowRoot;
      if (!root) return;
      const selected = this._state?.selection.unitIds.length ?? 0;
      const assignee = recommendAssignees(this._state ?? null)[0] ?? null;
      const signature = `${this._title}|${selected}|${assignee?.characterId ?? ''}`;
      if (signature === this._panelSignature) return;
      this._panelSignature = signature;

      const subject = root.querySelector('[data-role="subject"]');
      const options = root.querySelector('[data-role="options"]');
      if (!subject || !options) return;

      subject.textContent = `「${this._title}」`;
      const singleDesc = selected > 0
        ? `建一条战场任务 · 指派给选中的 ${selected} 个单位`
        : '建一条战场任务 · 待指派（之后可在任务面板里指派）';
      const pipelineDesc = `多 agent 串行协作 · 预设「${PIPELINE_PRESETS[0]?.label ?? '实现+审阅'}」`;
      // 死按钮治理（@since v3.9，task_148）：0 角色 ⇒「派发」没有任何承接人 ⇒
      //   它是个**点了永远不产生结果**的按钮。此时给三件套：禁用态 + 原因 + 出口。
      //   why 不做成「可点但点了弹 toast」：那还是死按钮（用户以为能派，实际派不出去），
      //   只会把「没出口」藏在一个 toast 里。
      const canDispatch = assignee !== null;
      const dispatchDesc = canDispatch
        ? `交给一个角色执行 · 推荐「${assignee!.name}」（${assignee!.reason}）`
        : '当前没有可派发的角色 · 先建一个角色，建完就能派出去';

      // 出口按钮：只在「派发」不可用时出现，紧贴死按钮 —— 墙后面必须有门（task_148 验收①）。
      const exit: Array<{ action: NewTaskAction; title: string; desc: string; disabled?: boolean }> =
        canDispatch
          ? []
          : [
              {
                action: 'create-character',
                title: '去新建角色',
                desc: '建一个角色 · 建完这条任务就能派出去',
              },
            ];

      const rows: Array<{ action: NewTaskAction; title: string; desc: string; disabled?: boolean }> = [
        { action: 'single', title: '单任务', desc: singleDesc },
        { action: 'pipeline', title: '流水线', desc: pipelineDesc },
        { action: 'dispatch', title: '派发', desc: dispatchDesc, disabled: !canDispatch },
        ...exit,
        { action: 'cancel', title: '取消', desc: '什么都不做 · 关掉这个对话框' },
      ];

      options.innerHTML = rows
        .map(
          (b) => `
            <button type="button" class="option" data-action="${b.action}"${b.disabled ? ' disabled aria-disabled="true"' : ''}>
              <span class="opt-title">${escapeHtml(b.title)}</span>
              <span class="opt-desc">${escapeHtml(b.desc)}</span>
            </button>
          `
        )
        .join('');
    }

    // —— 动作 ——
    private runAction(action: NewTaskAction): void {
      const deps = this._deps;
      if (!deps) return;
      switch (action) {
        case 'single':
          this.runSingle(deps);
          return;
        case 'pipeline':
          this.runPipeline(deps);
          return;
        case 'dispatch':
          this.runDispatch(deps);
          return;
        case 'create-character':
          // 死按钮的出口（@since v3.9，task_148）：关掉本对话框 → 走既有建档向导。
          // why 先关再走：对话框是全屏模态，不关它的话向导会被压在下面（遮挡栈只认栈顶）。
          this.close();
          deps.onCreateCharacter?.();
          return;
        case 'cancel':
          this.close();
          deps.notify?.('已取消新建', 'info');
          return;
      }
    }

    /**
     * 单任务 → mission.create。
     * 有选中单位时按「指派给选中单位」构造（selection 组），否则按「待指派草稿」构造（global 组）——
     * 两条口径都出自 command-catalog 的同一份构造器（面板与对话框共用一份真相）。
     */
    private runSingle(deps: NewTaskDialogDeps): void {
      const selected = this._state?.selection.unitIds.length ?? 0;
      const scope = selected > 0 ? 'selection' : 'global';
      const spec = findCommandSpec('mission.create', scope);
      if (!spec) {
        deps.notify?.('命令目录里没有「新建任务」这一条', 'warn');
        return;
      }
      const command = buildCommand(spec, { state: this._state, draftTitle: this._title });
      if (!command) {
        deps.notify?.('这条任务构造不出来（标题或选择集不合法）', 'warn');
        return;
      }
      this._feedbackUntil = Date.now() + FEEDBACK_WINDOW_MS;
      deps.dispatch(command);
      this.close();
      this.announceSubmitted();
    }

    /**
     * 流水线 → pipeline.start（预设模板；议题 = 标题）。
     * 构造口径与 agent-panel 的流水线表单同源（pipeline-catalog 的 buildPipelineStartCommand）。
     */
    private runPipeline(deps: NewTaskDialogDeps): void {
      const preset = PIPELINE_PRESETS[0];
      if (!preset) {
        deps.notify?.('没有可用的流水线预设', 'warn');
        return;
      }
      const command = buildPipelineStartCommand({ presetId: preset.id, custom: [], issue: this._title });
      if (!command) {
        deps.notify?.('流水线议题或规格不合法', 'warn');
        return;
      }
      this._feedbackUntil = Date.now() + FEEDBACK_WINDOW_MS;
      deps.dispatch(command);
      deps.notify?.(`已发起流水线「${preset.name}」`, 'success');
      this.close();
      this.announceSubmitted();
    }

    /**
     * 派发 → task.assign（承接人 = 推荐排序第一位；与 agent-panel 的「自动（推荐）」同一算法）。
     * 没有候选角色（角色没建档 / 没绑 agent）→ 本地拒绝并说清楚，不发半截命令。
     */
    private runDispatch(deps: NewTaskDialogDeps): void {
      const assignee = recommendAssignees(this._state ?? null)[0] ?? null;
      if (!assignee) {
        deps.notify?.('还没有可派发的角色 —— 先建个角色再来派', 'warn');
        return;
      }
      const command = buildTaskAssignCommand(assignee.characterId, this._title);
      if (!command) {
        deps.notify?.('派发命令构造不出来（指令为空）', 'warn');
        return;
      }
      this._feedbackUntil = Date.now() + FEEDBACK_WINDOW_MS;
      deps.dispatch(command);
      this.close();
      this.announceSubmitted();
    }

    /** 通知命令面板：标题草稿可以清掉了（再建一条要用新标题）。 */
    private announceSubmitted(): void {
      this.dispatchEvent(
        new CustomEvent(NEW_TASK_SUBMITTED_EVENT, {
          bubbles: true,
          composed: true,
          detail: { title: this._title },
        })
      );
    }
  }

  customElements.define(NEW_TASK_DIALOG_TAG, NewTaskDialog);
  return NewTaskDialog as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂（与 mountToastHost / mountShortcutHelp 同一装配口径）：建元素、注入依赖、挂进容器。
 */
export function mountNewTaskDialog(
  deps: NewTaskDialogDeps,
  host: HTMLElement
): { readonly element: StratNewTaskDialogElement; readonly unmount: () => void } {
  defineNewTaskDialog();
  const element = document.createElement(NEW_TASK_DIALOG_TAG) as StratNewTaskDialogElement & {
    deps: NewTaskDialogDeps | null;
  };
  element.deps = deps;
  host.appendChild(element);
  return {
    element,
    unmount: (): void => {
      element.remove();
    },
  };
}
