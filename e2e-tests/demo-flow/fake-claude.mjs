#!/usr/bin/env node
/**
 * 文件职责：**fake claude CLI**（e2e 演示剧本的执行替身）—— 演示链里「派活 → 干活 → 完成」
 *   这一段的末端替身。
 *
 * why 有它（与 e2e-tests/service-resident/fake-cli.ts 同一口径）：
 *   演示剧本要**确定性**（每次跑出来一样、不花 token、不看网络），但任务执行链必须是**真的**
 *   （core 状态机 → 出队 → transport → spawn 子进程 → 落库 一条都不许省）。
 *   于是只替掉**最末端那一跳**：真的 spawn 一个子进程（node 自己），但那个子进程不是真 claude。
 *   ★ 被替掉的是「CLI 二进制」，不是「任务链路」—— core 的裁决、队列、相位、回报全是真的。
 *
 * why 做成**可执行文件**而不是注入 adapter：
 *   演示链的 B 段跑在**本地模式**（渲染进程自带 core runtime + 自己的 task-service），
 *   那条路上没有 adapter 注入口 —— 唯一的替身位置就是 PATH 上的那个二进制。
 *   （C 段跑在远程模式，service 侧走的是既有的 fake-cli adapter 注入。）
 *
 * 替身的能力（够演示链用，不多不少）：
 *   - `--version` → 报版本（agent 探测要读它；探测到「已安装」任务才放行）；
 *   - `-p <prompt>` → 吐三行 stream-json（system / assistant / result），退出码 0；
 *   - prompt 里带 `E2E_FAIL` → 吐一条 is_error 的 result 并以退出码 1 结束（演示「卡住」那一下）。
 *
 * 禁止事项：
 *   1. 在这里改 core 状态 / 造任务 —— 替身只吐文本，状态一律由 core 裁决；
 *   2. 假装成功 —— 回显什么就是什么（失败那档就明着失败）。
 *
 * @since task_084（e2e 演示收口）。
 */

import { writeSync } from 'node:fs';

/** 替身标记 —— 断言用：任务输出里出现它，就证明这一轮确实经由替身跑过。 */
const MARKER = 'e2e-fake-cli';

/** 假版本号（与真 claude 的版本号格式同形，探测器的 semver 解析能吃）。 */
const FAKE_VERSION = '2.1.270';

/** 让「干活中」这段可观测：真 claude 干活要几秒，替身留 400ms 的窗口（够采到 busy 状态）。 */
const WORK_MS = 400;

/** 同步睡一会儿（子进程里最省事的睡法：不占事件循环，退出码可控）。 */
function sleepSync(ms) {
  const buffer = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(buffer, 0, 0, ms);
}

const args = process.argv.slice(2);

// ① 版本探测：agent 探测器跑的是「<二进制> --version」。
if (args.includes('--version')) {
  process.stdout.write(`${FAKE_VERSION} (${MARKER})\n`);
  process.exit(0);
}

// ② 取 prompt：claude 的形态是 `-p <prompt>`（其余参数原样忽略）。
const promptIndex = args.indexOf('-p');
const prompt = promptIndex >= 0 ? args[promptIndex + 1] ?? '' : args.join(' ');
const sessionId = `${MARKER}-session`;

sleepSync(WORK_MS);

// ③ 失败档：演示链要演一次「卡住」—— 让这一轮明着失败（core 据此发 task.failed）。
if (prompt.includes('E2E_FAIL')) {
  writeSync(
    1,
    `${JSON.stringify({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: `${MARKER}: 故意失败（演示卡住）`,
      session_id: sessionId,
    })}\n`
  );
  process.exit(1);
}

// ④ 成功档：三行 stream-json（system → assistant → result），与真 claude 的形状一致。
writeSync(
  1,
  `${[
    { type: 'system', subtype: 'init', session_id: sessionId },
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: `${MARKER}:${prompt}` }] },
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: `${MARKER}:done`,
      session_id: sessionId,
    },
  ]
    .map((line) => JSON.stringify(line))
    .join('\n')}\n`
);
process.exit(0);
