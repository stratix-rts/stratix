/**
 * 文件职责：**内置演示会话样例**（@since v3.9，task_148；task_149 补分野 / 时间线）——
 *   让阅读面在任何环境先亮灯。
 *
 * why 需要它（r5 P1② 原文）：
 *   「markdown 验收通路堵死 —— demo 假流只在演示模式，standalone 环境下 #145 的渲染效果
 *   永远验不到，用户也永远看不到。」
 *   管线接好了（marked → DOMPurify → DOM + 代码块外框 / 语言标签 / 复制按钮），
 *   但用户**至今没有见过一次真的 markdown 渲染** —— 没有角色就派不出任务，
 *   没有任务就没有输出面。
 *
 * 为什么这不是「拿 mock 数据当实现」：
 *   这段内容是**演示数据**，不是业务数据的替身 ——
 *   ① 每条消息都带「演示数据」徽标（肉眼与断言都能认出）；
 *   ② 它**不进入**任何业务通路（不进 core、不落库、不发命令），只是渲染到阅读面上；
 *   ③ 真实链路照旧：新建角色 → 派发 → 读到 agent 真的输出。
 *   没有它，用户永远在「等一个还没发生的将来」；有了它，**今天就能看见阅读面长什么样**。
 *
 * task_149 的增量：演示数据现在**带上身份与时刻** ——
 *   三种身份（用户 / agent / 系统事件）各出现一次（分野可辨）；
 *   同一 agent 连着两句（连续分组：不重复头像 / 名字）；
 *   时刻**跨分钟**（时间线分隔条当场可见）。
 *
 * 输入：无（常量数据 + 一个基准时刻）。
 * 输出：会话面板「示例会话」入口要渲染的消息（阅读列的输入形状）。
 * 禁止事项：
 *   1. import core / world / app —— 本文件是纯数据；
 *   2. 把演示数据混进真实会话列表 —— 它只出现在「示例会话」这一条明确标注的入口里。
 */

import type { ReadingMessage, ReadingRole } from '../components/reading-column/reading-logic';

/** 演示徽标文案（每条消息旁都挂它 —— 一眼认出是演示数据）。 */
export const DEMO_SESSION_BADGE = '演示数据';

/** 一条演示消息。 */
export interface DemoSessionMessage {
  /** 身份：user = 提问方；agent = agent 侧；system = 系统事件。 */
  readonly role: ReadingRole;
  /** 署名（显示在气泡上方）。 */
  readonly author: string;
  /** 正文（markdown 源文本 —— 代码块 / 表格 / 列表都在这里）。 */
  readonly text: string;
  /**
   * 相对基准时刻的偏移（毫秒，负数 = 更早）。
   * why 用相对偏移而不是绝对时刻：绝对时刻会随日期漂移（demo 隔天再看就"过期"了），
   *   相对偏移保证「跨分钟」这件事**永远**成立（分隔条当场可见）。
   */
  readonly offsetMs: number;
}

/**
 * 演示会话的消息序列。
 *
 * why 挑这几种结构：GFM 里用户真正会读的是**代码块**（可复制）、**表格**（对比）、
 *   **列表**（要点）—— 三样都摆出来，145 的渲染能力才被完整看见。
 * why 加了系统事件与时刻：让阅读面的三种身份、分组、时间线**当场可见**（task_149）。
 */
export const DEMO_SESSION_MESSAGES: readonly DemoSessionMessage[] = Object.freeze([
  {
    role: 'system',
    author: '会话',
    text: '示例会话建立 —— 下面每条都带「演示数据」徽标。',
    offsetMs: -8 * 60_000,
  },
  {
    role: 'user',
    author: '你',
    text: '帮我看看这个构建为什么挂了，顺便把修复写成补丁。',
    offsetMs: -7 * 60_000,
  },
  {
    role: 'agent',
    author: '审阅 agent',
    text: [
      '## 结论',
      '',
      '构建失败卡在**类型检查**这一步，单测其实是绿的。',
      '',
      '| 阶段 | 状态 | 说明 |',
      '| --- | --- | --- |',
      '| 类型检查 | 失败 | `src/hud/panels/session-panel.ts` 一处签名不匹配 |',
      '| 单元测试 | 通过 | 相关用例全绿 |',
      '',
      '排查顺序：',
      '',
      '1. 先跑 `npx tsc --noEmit` 拿到确切行号',
      '2. 再对着契约（`src/core/types.ts`）核字段名',
      '3. 最后跑相关 jest 确认没打破别的',
    ].join('\n'),
    offsetMs: -7 * 60_000 + 20_000,
  },
  {
    role: 'user',
    author: '你',
    text: '那把补丁贴给我。',
    offsetMs: -5 * 60_000,
  },
  {
    role: 'agent',
    author: '审阅 agent',
    text: [
      '补丁如下（改完类型检查就绿了）：',
      '',
      '```ts',
      "export function buildTaskCommand(prompt: string): TaskCommand | null {",
      "  const trimmed = prompt.trim();",
      "  if (trimmed.length === 0) return null;",
      "  return { type: 'task.assign', prompt: trimmed };",
      '}',
      '```',
      '',
      '- 签名与契约对齐',
      '- 空指令仍然直接拒绝（不发半截命令）',
      '- 回归测试保持绿',
    ].join('\n'),
    offsetMs: -5 * 60_000 + 15_000,
  },
  {
    // 连续同 agent → 与上一条**同组**（不重复头像 / 名字）。
    role: 'agent',
    author: '审阅 agent',
    text: '补丁已提交，CI 在跑。',
    offsetMs: -5 * 60_000 + 40_000,
  },
  {
    role: 'system',
    author: 'CI',
    text: '流水线通过。',
    offsetMs: -2 * 60_000,
  },
]);

/**
 * 演示数据 → 阅读列的消息形状。
 *
 * @param baseAt 基准时刻（缺省 = 现在）。单测可给固定时刻，断言就稳定。
 */
export function buildDemoReadingMessages(baseAt: number = Date.now()): ReadingMessage[] {
  return DEMO_SESSION_MESSAGES.map((message, index) => ({
    id: `demo-${index + 1}`,
    role: message.role,
    author: message.author,
    text: message.text,
    at: baseAt + message.offsetMs,
    badge: DEMO_SESSION_BADGE,
    markdown: true,
  }));
}
