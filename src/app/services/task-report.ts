/**
 * 文件职责：**任务结果回流**（task_039）—— 任务终态记录 → 三路副作用：
 *   ① 落库：报告消息写 character_chat_messages（completed → role=assistant / failed → role=error，
 *     与 036 的落库词表对齐；回填历史时错误报告自动渲染成错误气泡，与即时注入同观感）；
 *   ② 回流注入：报告消息经抽屉 addMessage 进该角色的会话存储 —— **抽屉未开不弹**（addMessage
 *     不碰开合态），打开即可见；
 *   ③ 轻提示：toast 一条「XX 完成任务 / XX 任务失败」（组合根接 hud 的 toast 宿主，3s 自动消失）。
 *   ④ 成果物摘要（task_048）：completed 记录携带的 artifacts JSON → 反序列化 → 报告尾部附
 *     📂 文件清单（≤10 条折叠）+ 📐 摘要（渲染模型与任务输出面板共用，规格④）；坏形状
 *     宽容降级 —— 反序列化失败 / 解析为空 → 报告格式与 039 完全一致（纯文本兑底，不编造）。
 * 输入：task-service 的终态回调（TaskPersistRecord，completed 带全文 / failed 带原因）；
 *   WorldState.characters 快照（toast 文案要角色名）；注入的视图口 / 落库口 / toast 口。
 * 输出：createTaskReportHandler 产出的回调（组合根注入 task-service 的 onTaskSettled）+
 *   一组导出的纯函数（报告文案 / toast 文案 / 注入裁决，单测直接断言）。
 * 禁止事项：
 *   1. 在这里认识 transport / 任务执行 —— 本模块只消费终态记录，怎么到终态归 task-service；
 *   2. 在这里改抽屉开合态 —— 报告是「被动可见」的（用户打开才看），自动弹抽屉是打断；
 *   3. 引入新依赖 —— core 类型 + 注入端口，仅此而已；
 *   4. 副作用互相绑架 —— 三路各自 try/catch（fire-and-forget 口径，与 035/036 同一纪律）。
 *
 * ============ 注入裁决：什么时候进抽屉的内存会话（规格②的「抽屉未开不弹，打开可见」）============
 * 抽屉会话存储有一条 036 固化的回填规则：「内存非空 → 不回填 SQLite 历史」（内存被当作超集）。
 * 用户对话产生的内存消息天然满足超集（发过言 = 看过），但任务报告可能落在**从未打开过的**
 * 角色会话上 —— 只有一条报告的内存会话会挡住历史回填，用户打开抽屉只能看到孤零零一条报告。
 * 故注入只发生在「内存本来就是超集」的两种情形，其余一律只落库 + toast，可见性交给 036 的回填：
 *   - 抽屉开着且正看该角色（isOpen && viewing === characterId）：即时上屏；
 *   - 该角色本轮已有内存消息（sessionCharacterIds 含它）：内存是超集，追加不破坏回填裁决。
 * 已知窄窗（与 036 自己的回填竞态同一口径，接受）：抽屉正看某角色且回填在途时报告注入 →
 *   回填落地发现内存非空而丢弃历史 —— 本轮运行里旧历史不可见，重启后恢复（库里都是全的）。
 * 失败报告的错误气泡带「重试」钮（034 的错误气泡既有行为，历史回填同款）：点它重发的是该角色
 *   **聊天**最近一次失败的原文（chat-service.retry），不是任务 —— 任务重派走 038 的派发表单（新任务）。
 *
 * @since v3.18（task_039）。三路副作用的顺序固定为「落库 → 注入 → toast」：库是真相、展示是
 *   投影（回填 / 审计都读库），先落库再展示；toast 最后（用户从抽屉看到详细报告的同时角落轻提示）。
 *   v3.24（task_048）追加④：完成报告尾部附成果物摘要块（详见上文章件职责）。
 */

import type { CharacterView, TaskStatus, WorldState } from '../../core/types';
import type { ChatPersistedMessage } from './chat-service';
import { formatTaskArtifactsBlock, parseTaskArtifactsJson, type TaskArtifacts } from './task-artifacts';
import type { TaskPersistRecord } from './task-service';

// ============================================================================
// 常量与纯函数（可独立单测；导出常量供单测断言，别在测试里抄一遍字符串）
// ============================================================================

/** 任务报告消息的前缀标记（抽屉里一眼认出这是报告，不是角色说的话）。 */
export const TASK_REPORT_PREFIX = '📋 任务报告：';

/** 任务失败报告的前缀标记。 */
export const TASK_FAILED_PREFIX = '⚠ 任务失败';

/** 报告首行的任务指令摘要长度上限（码点）。 */
export const TASK_REPORT_PROMPT_SUMMARY_LEN = 40;

/** 报告正文的输出长度上限（码点）：全文短于它就放全文，超了截断。 */
export const TASK_REPORT_OUTPUT_LIMIT = 2000;

/** 截断标记（拼在截断点后，读报告的人知道被剪了）。 */
export const TASK_REPORT_TRUNCATION_MARK = '…';

/**
 * 完成报告尾部的成果物摘要块（task_048）：📂 N 个文件 · +A/-B 行 + ≤TASK_REPORT_FILES_LIMIT
 * 条折叠清单（超出折成「…及 M 个文件」）+ 📎 摘要（有才出）。files 为空 → 不附（纯文本兑底）。
 * 渲染逻辑在 task-artifacts.ts 的 formatTaskArtifactsBlock（与任务输出面板共用同一渲染模型，
 * 规格④）；这里只管拼接到报告尾部。
 */

/**
 * 任务指令的单行摘要：空白折叠成空格（报告首行不折行）+ 截断到 40 码点。
 * 空指令防御性回落占位（core 侧 prompt 非空是入队契约，这里只是不崩）。
 */
export function summarizeTaskPrompt(prompt: string): string {
  const oneLine = prompt.replace(/\s+/g, ' ').trim();
  if (oneLine.length === 0) return '（无指令）';
  return oneLine.length > TASK_REPORT_PROMPT_SUMMARY_LEN
    ? oneLine.slice(0, TASK_REPORT_PROMPT_SUMMARY_LEN) + TASK_REPORT_TRUNCATION_MARK
    : oneLine;
}

/** 输出全文截断（> 2000 码点截到 2000 + 截断标记；否则原样放全文）。 */
export function clampTaskReportOutput(output: string): string {
  return output.length > TASK_REPORT_OUTPUT_LIMIT
    ? output.slice(0, TASK_REPORT_OUTPUT_LIMIT) + TASK_REPORT_TRUNCATION_MARK
    : output;
}

/**
 * 完成报告文案：首行「📋 任务报告：<指令摘要>」，换行后输出全文（或截断），尾部附成果物
 * 摘要块（task_048，解析得到文件清单/摘要时；解析为空时格式与 039 完全一致 —— 纯文本兑底）。
 * 首行与正文分行：抽屉气泡是 pre-wrap，混在一行会看不出哪里是指令哪里是结果。
 */
export function buildTaskReportText(
  prompt: string,
  output: string,
  artifacts: TaskArtifacts | null = null
): string {
  const base = `${TASK_REPORT_PREFIX}${summarizeTaskPrompt(prompt)}\n${clampTaskReportOutput(output)}`;
  const block = formatTaskArtifactsBlock(artifacts);
  return block.length > 0 ? `${base}\n${block}` : base;
}

/** 失败报告文案：「⚠ 任务失败：<原因>」（reason 为空时给占位，不让气泡空白）。 */
export function buildTaskFailedText(reason: string): string {
  return `${TASK_FAILED_PREFIX}：${reason.length > 0 ? reason : '（未提供原因）'}`;
}

/** toast 轻提示文案（XX = 角色名；名字的取法见 handler 内的回落规则）。 */
export function taskToastText(characterName: string, status: TaskStatus): string {
  return status === 'completed' ? `${characterName} 完成任务` : `${characterName} 任务失败`;
}

// ============================================================================
// 端口与服务
// ============================================================================

/**
 * 抽屉视图口（034 组件公开方法 + 三个只读观察面的子集）。
 * why 不复用 chat-service 的 ChatDrawerView：那个口只有写入面，而注入裁决还要读开合态 /
 * 查看对象 / 已有会话（见文件头「注入裁决」）；结构上 StratCharacterChatDrawerElement 满足它。
 */
export interface TaskReportViewPort {
  addMessage(message: {
    readonly characterId?: string;
    readonly role: 'user' | 'assistant';
    readonly text: string;
    readonly error?: boolean;
  }): unknown;
  /** 抽屉是否开着。 */
  readonly isOpen: boolean;
  /** 当前查看的角色 id；未选为 null。 */
  readonly characterId: string | null;
  /** 本轮运行里出现过消息的角色 id（内存超集判定的观察面）。 */
  readonly sessionCharacterIds: readonly string[];
}

/** 注入裁决（导出供单测）：即时上屏（正看着）或内存已是超集（有过消息）才注入内存会话。 */
export function shouldInjectReport(
  view: Pick<TaskReportViewPort, 'isOpen' | 'characterId' | 'sessionCharacterIds'>,
  characterId: string
): boolean {
  if (view.isOpen && view.characterId === characterId) return true;
  return view.sessionCharacterIds.includes(characterId);
}

/** toast 的语气色（hud toast 宿主的 tone 词表子集：完成绿 / 失败红）。 */
export type TaskReportTone = 'success' | 'danger';

export interface TaskReportDeps {
  /** 抽屉视图口（组合根传 034 组件元素；缺省 = 无抽屉环境，只落库 + toast）。 */
  readonly view?: TaskReportViewPort;
  /** 世界快照读取口（toast 文案的角色名；组合根传 worldStore.getState）。 */
  readonly getState: () => Pick<WorldState, 'characters'>;
  /** 报告消息落库口（与 chat-service 同形状 —— 组合根注入同一个 persister 实例）。缺省不落库。 */
  readonly persistMessage?: (message: ChatPersistedMessage) => void;
  /** hud toast 口（组合根接 toast 宿主的 show）。缺省无提示（无 hud 环境的单测 / 非 Electron）。 */
  readonly toast?: (text: string, tone: TaskReportTone) => void;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
}

/** 角色名回落：档案缺失（刚被删）用 id —— 与抽屉 headerNameOf 同一口径（id 是事实，不编造名字）。 */
function displayNameOf(characters: readonly CharacterView[], characterId: string): string {
  return characters.find((c) => c.id === characterId)?.name ?? characterId;
}

/**
 * 组装终态回调：消费 TaskPersistRecord（completed 全文 / failed 原因），产出三路副作用。
 * 组合根把它注入 task-service 的 onTaskSettled；单测直接调返回的函数断言各路输出。
 */
export function createTaskReportHandler(deps: TaskReportDeps): (record: TaskPersistRecord) => void {
  const logger = deps.logger ?? ((): void => { /* 缺省静默 */ });

  const safe = (label: string, action: () => void): void => {
    try {
      action();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      logger(`[task-report] ${label}抛错：${text}`);
    }
  };

  return (record) => {
    const completed = record.status === 'completed';
    const name = displayNameOf(deps.getState().characters, record.characterId);
    // 成果物（task_048）：completed 才反序列化（宽容：坏 JSON/坏形状 → null，报告回落纯文本）；
    // failed 没有成果物可言（没产出，不是产出不明）。
    const artifacts = completed ? parseTaskArtifactsJson(record.artifacts) : null;
    const text = completed
      ? buildTaskReportText(record.prompt, record.output, artifacts)
      : buildTaskFailedText(record.output);

    // ① 落库先行：库是真相（回填 / 审计都读它），展示路径都只是投影；fire-and-forget。
    if (deps.persistMessage) {
      safe(`落库（${record.characterId}/${record.status}）`, () => {
        deps.persistMessage?.({
          characterId: record.characterId,
          role: completed ? 'assistant' : 'error',
          text,
          sessionRef: null, // 任务会话是一次性的（037），没有可指的聊天会话回执
        });
      });
    }

    // ② 回流注入：裁决见文件头「注入裁决」；failed 走错误气泡（error 标记 → 警示配色）。
    const view = deps.view;
    if (view && shouldInjectReport(view, record.characterId)) {
      safe(`注入（${record.characterId}/${record.status}）`, () => {
        view.addMessage({
          characterId: record.characterId,
          role: 'assistant',
          text,
          ...(completed ? {} : { error: true }),
        });
      });
    }

    // ③ 轻提示：右上角 toast，3s 自动消失（hud toast 宿主兑现，这里只给文案与语气）。
    if (deps.toast) {
      safe(`toast（${record.characterId}/${record.status}）`, () => {
        deps.toast?.(taskToastText(name, record.status), completed ? 'success' : 'danger');
      });
    }
  };
}
