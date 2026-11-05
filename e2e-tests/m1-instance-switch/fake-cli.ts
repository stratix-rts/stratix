/**
 * 文件职责：**CLI 替身**（@since v3.3，task_190 / docs/DESIGN-project-map.md §7.1「M1-16」行）。
 *
 * ============ 被替掉的只有「CLI 二进制」这一跳 ============
 *   派发链其余部分**全是真链路**：core 总线派单 → task-service 拼 prompt →
 *   cli-transport 拉起**真子进程**（node-process 工厂）→ 子进程真的在某个 cwd 里跑 →
 *   stdout 逐行回传 → 事件流 → 任务收尾 → **真落库**（character_tasks）。
 *   替身只负责回答两个问题：
 *     ① 我这个进程的 cwd 是哪儿（是不是默认沙盒那一份）；
 *     ② 我收到的 prompt 是什么（一并回报，便于事后核对派发内容）。
 *
 * ============ 为什么 prompt 走 argv 而不是环境变量 ============
 *   与真实 CLI 一致（claude 是 `-p <prompt>`；见 adapters/claude.ts）——
 *   替身走 argv ⇒ 验的是「子进程真的收到了那段 prompt」，
 *   而不是「替身从某个私有通道把 prompt 抄了一遍」。
 *   `--` 结尾的 `--` 是为了让 prompt 以 `-` 开头时也不被 node 当成选项。
 *
 * 输入：一段完整派单 prompt（app 侧拼好的原文）。
 * 输出：stdout 一段 JSON —— `{ marker, cwd, prompt }`（整段 stdout = 一条 message 事件，
 *      随任务收尾**落进 character_tasks.output**，验收脚本从库里读它 ⇒ 完整往返）。
 *
 * 禁止事项：
 *   1. 在这里做业务判断（cwd 对不对）—— 那是验收脚本的事；
 *   2. 假装成功 —— 它只回报「我看到了什么」，不加工、不美化；
 *   3. 读环境变量里的 prompt —— prompt 只从 argv 来（与真 CLI 同形）。
 *
 * @since v3.3，task_190。
 */

import { createCliTransport } from '../../src/app/services/cli-transport/runtime';
import { createNodeProcessFactory } from '../../src/app/services/cli-transport/node-process';
import type { CliAdapter } from '../../src/app/services/cli-transport/transport';
import type { TaskTransportFactory } from '../../src/app/services/task-service';

/** 替身标记 —— 脚本据此确认「这一轮确实经由替身跑过」。 */
export const FAKE_CLI_MARKER = 'e2e-m1-fake-cli';

/** 子进程里跑的代码：把自己看到的 cwd 与 prompt 原样吐成 JSON。 */
const REPORT_CODE = [
  `const marker = ${JSON.stringify(FAKE_CLI_MARKER)};`,
  'const prompt = process.argv[1] ?? "";',
  'process.stdout.write(JSON.stringify({ marker, cwd: process.cwd(), prompt }));',
].join('');

/** 造一条「只回报所见」的 adapter（binary = 本进程 node；prompt 走 argv）。 */
export function createReportCliAdapter(): CliAdapter {
  return {
    kind: 'claude-code',
    binary: process.execPath,
    outputMode: 'text',
    buildArgs: (prompt: string) => ['-e', REPORT_CODE, '--', prompt],
    parseLine: () => [],
  };
}

/** transport 工厂（真子进程工厂 + 上面那个 adapter）。 */
export function createReportTransportFactory(): TaskTransportFactory {
  const adapter = createReportCliAdapter();
  return () => createCliTransport(adapter, { factory: createNodeProcessFactory() });
}
