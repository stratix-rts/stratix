/**
 * 文件职责：**互聊回合的 CLI 替身**（会话域验收 / v3.2a S7 + v3.2b-B9）——
 *   两支：① **静默** adapter（互聊回合的「超时制造机」）；② **可切换** adapter（静默 ⇄ 回显，
 *   供 task_108 的六能力剧本在「超时中断」与「恢复后续聊」之间切换）。
 * 输入：一段任务 prompt（core 侧拼好的完整指令）。
 * 输出：一个 CLI 适配器（+ 工厂），供 service 进程注入互聊执行环。
 *
 * why 有它：会话域要验的是「**超时不再是静默丢失**」——
 *   回合超时 → 会话显式转 'interrupted' + 落一条 'interrupt' 事件。
 *   要造出这个超时，就得造一个**真的不吭声**的 CLI：它被真 spawn、真占着进程、真被看门狗杀。
 *
 * ★ 被替掉的只是「CLI 二进制」（与 task_084 的 fake CLI adapter 同一纪律）：
 *   超时判定、杀进程树、错误码（timeout）、中断记账、会话状态迁移**全是真链路** ——
 *   本文件只让子进程「跑着但不说话」，超时由 cli-transport runtime 自己的看门狗判定。
 *
 * 禁止事项：
 *   1. 在这里读环境变量 / 读文件 —— 替身只认 prompt（配置由调用方注入）；
 *   2. 自己判定「超时了」—— 超时是 runtime 的职责（这里只制造「一直不输出」这个前提）；
 *   3. 让替身「假装成功」—— 它什么都不产出，回合只能以超时收场。
 *
 * @since v3.2a S7（task_097）。
 */

import type { ChatTransportFactory } from '../../src/app/services/chat-service';
import { createNodeProcessFactory } from '../../src/app/services/cli-transport/node-process';
import { createCliTransport } from '../../src/app/services/cli-transport/runtime';
import type { CliAdapter } from '../../src/app/services/cli-transport/transport';
import { FAKE_CLI_MARKER } from '../service-resident/fake-cli';

/**
 * 子进程「静默」多久（毫秒）—— 远大于回合超时（10s），保证**永远是看门狗先动手**。
 * why 要留这么长的余量：若子进程自己先退（正常结束），runtime 会走 done 分支，
 *   那样就验不到「超时 → interrupted」这条链了。
 */
export const SILENT_HOLD_MS = 600_000;

/**
 * 子进程命令行里的**唯一标记** —— 剧本据此在进程表里认领「这是本剧本的静默子进程」
 * （收尾清点用：超时之后它必须已经不在了，否则就是孤儿）。
 * why 用标记而不是按进程名找：按名扫杀会误伤用户实例；这里只**认领**不杀
 * （要杀也只按 pid 精确回收）。
 */
export const SILENT_CLI_MARKER = 'STRATIX_E2E_SILENT';

/**
 * 静默替身：真 spawn 一个 node 子进程，它只挂着一个长定时器 —— 不输出任何字节。
 * 回合超时由 runtime 的看门狗判定（terminate('timeout') → killTree → error{code:'timeout'}）。
 */
export function createSilentCliAdapter(): CliAdapter {
  return {
    kind: 'claude-code',
    binary: process.execPath,
    outputMode: 'text',
    buildArgs: () => [
      '-e',
      `/* ${SILENT_CLI_MARKER} */ setTimeout(() => {}, ${SILENT_HOLD_MS});`,
    ],
    // text 形态：runtime 会把整段 stdout 当成一条 message 事件 —— 这里永远没有 stdout。
    parseLine: () => [],
  };
}

/**
 * 造 transport 工厂（注入互聊服务的执行环用）。
 * 形状 = ChatTransportFactory（按 agent 种类给 transport）；替身对任何种类都给同一条静默链 ——
 *   why 不挑种类：互聊双方用哪个 CLI 与「它说不说话」无关（这里要的就是「都不说话」）。
 */
export function createSilentTransportFactory(): ChatTransportFactory {
  const adapter = createSilentCliAdapter();
  return () => createCliTransport(adapter, { factory: createNodeProcessFactory() });
}

/**
 * 互聊替身的两种模式（@since v3.2b-B9 / task_108）。
 *
 * - `silent`：子进程真跑、但一个字不说 → 回合被看门狗判超时（验「超时即中断」那条链）；
 * - `echo`  ：子进程把 prompt 原样回显 → 回合正常收束（验「续聊产出新事件」「引用注入可见」）。
 *
 * why 需要两种：同一场互聊既要能**超时**，又要能在**恢复之后继续说话** ——
 *   而互聊服务按 agent 种类**缓存** transport（同一个 transport 实例会被复用），
 *   故模式不能靠「换工厂」切换，只能让**适配器在 spawn 的那一刻**读当前模式
 *   （buildArgs 每次 spawn 都会被调用）。
 */
export type PeerCliMode = 'silent' | 'echo';

/**
 * 可切换模式的 CLI 适配器（测试替身）。
 *
 * ★ 被替掉的仍然只是「CLI 二进制」：超时判定 / 杀进程树 / 错误码 / 会话记账 / 状态迁移全是真链路。
 *   模式只决定子进程「说不说话」—— 而这正是两条验收链各自需要的前提。
 */
export function createSwitchableCliAdapter(getMode: () => PeerCliMode): CliAdapter {
  return {
    kind: 'claude-code',
    binary: process.execPath,
    outputMode: 'text',
    buildArgs: (prompt: string) =>
      getMode() === 'echo'
        ? // 回显模式：把 prompt 原样写回 stdout —— 于是「注入块有没有真的进到 agent 的输入里」
          // 可以从落库的发言原文里直接看见（不用猜）。
          ['-e', `process.stdout.write(${JSON.stringify(`${FAKE_CLI_MARKER}:${prompt}`)})`]
        : // 静默模式：一个字不说 → 看门狗先动手（回合只能以超时收场）。
          ['-e', `/* ${SILENT_CLI_MARKER} */ setTimeout(() => {}, ${SILENT_HOLD_MS});`],
    // text 形态：runtime 会把整段 stdout 当成一条 message 事件 —— 这里没有逐行可解析的东西。
    parseLine: () => [],
  };
}

/**
 * 造可切换模式的 transport 工厂（注入互聊服务的执行环用）。
 *
 * 形状同 createSilentTransportFactory（ChatTransportFactory）；模式由 getMode 在**每次 spawn** 时读。
 */
export function createSwitchableTransportFactory(getMode: () => PeerCliMode): ChatTransportFactory {
  const adapter = createSwitchableCliAdapter(getMode);
  return () => createCliTransport(adapter, { factory: createNodeProcessFactory() });
}
