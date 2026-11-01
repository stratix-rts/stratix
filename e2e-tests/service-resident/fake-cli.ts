/**
 * 文件职责：**fake CLI adapter**（前后端分离 C1 / task_084）—— e2e 剧本的执行替身。
 * 输入：一段任务 prompt（core 侧拼好的完整指令）。
 * 输出：一个把 prompt 原样回显的 CLI 适配器（+ 工厂），供 service 进程注入执行环。
 *
 * why 有它：验收剧本要**确定性**（每次跑出来的输出都一样、不花 token、不看网络），
 *   但任务执行链必须是**真的**（core 状态机 → 执行环 → transport → 落点回报 一条都不许省）。
 *   于是只替掉**最末端那一跳**：真的 spawn 一个子进程（node 自己），
 *   但那个子进程不是真 claude —— 它只是把 prompt 回显出来。
 *   ★ 被替掉的是「CLI 二进制」，不是「任务链路」：core 的裁决、队列、相位、mission 回报全是真的。
 *
 * why 不在 task_084 里 mock 核心链路数据：正因为替身只在最末端，
 *   断言「task completed → mission done」验的仍是**真链路**的因果。
 *
 * 禁止事项：
 *   1. 在这里读环境变量 / 读文件 —— 替身只认 prompt（配置由调用方注入）；
 *   2. 直接改 core store —— 替身只产出文本，状态一律由 core 裁决；
 *   3. 让替身「假装成功」—— 它回显什么就回显什么，不加工、不美化。
 *
 * @since task_084（service-split C1）。
 */

import { createCliTransport } from '../../src/app/services/cli-transport/runtime';
import { createNodeProcessFactory } from '../../src/app/services/cli-transport/node-process';
import type { CliAdapter } from '../../src/app/services/cli-transport/transport';
import type { TaskTransportFactory } from '../../src/app/services/task-service';

/**
 * 回显前缀 —— 断言用：任务输出里出现它，就证明这一轮**确实**经由替身跑过
 * （而不是任务凭空变成 completed）。
 */
export const FAKE_CLI_MARKER = 'e2e-fake-cli';

/**
 * 造一个 echo 型 fake adapter（测试替身）。
 *
 * 二进制换成本进程自己（node），参数把 prompt 原样写回 stdout ——
 * 于是走的是**真的** node-process 工厂（子进程真的被 spawn、真的退出、真的回吐字节）。
 */
export function createFakeCliAdapter(): CliAdapter {
  return {
    kind: 'claude-code',
    binary: process.execPath,
    outputMode: 'text',
    buildArgs: (prompt: string) => [
      '-e',
      `process.stdout.write(${JSON.stringify(`${FAKE_CLI_MARKER}:${prompt}`)})`,
    ],
    // text 形态：runtime 会把整段 stdout 当成一条 message 事件 —— 这里没有逐行可解析的东西。
    parseLine: () => [],
  };
}

/**
 * 造 transport 工厂（注入 service 的执行环用）。
 *
 * 形状 = TaskTransportFactory（按 agent 种类给 transport）；替身对任何种类都给同一条回显链 ——
 *   why 不挑种类：角色绑的 agent 种类由**探测结果**决定（那台机器上装了什么就绑什么），
 *   替身只管把这一轮跑完，不该因为种类不同而行为不同。
 */
export function createFakeTransportFactory(): TaskTransportFactory {
  const adapter = createFakeCliAdapter();
  return () => createCliTransport(adapter, { factory: createNodeProcessFactory() });
}
