#!/usr/bin/env node

/**
 * 脚本：真机跑一次本地 CLI agent 检测（task_022）。
 *
 * 用法：npm run detect:agents
 *
 * 为什么需要它：单测里跑的是**假** execFn（已装 / 未装 / 超时三态都能稳定复现），
 *   但「真机上到底能不能检出 claude / openclaw」只有真跑一次才知道 ——
 *   PATH 里的二进制名、CLI 的 --version 输出格式、各家是否真的支持 --version，
 *   这些都不是单测能覆盖的。
 *
 * 本脚本走的是**与 Electron 主进程完全相同**的代码路径（同一个 detector + 同一个 node-exec），
 * 输出格式也一致（formatDetectionLog），所以这里的日志就是主进程启动时你会看到的那几行。
 *
 * 预期输出（本机已装 claude / opencode / kimi / openclaw 时）：
 *   [agent-detector] claude-code (T1) ✓ 已安装 · 2.0.14 · /Users/.../claude
 *   [agent-detector] codex (T1) ✗ 未安装
 *   ...
 *   [agent-detector] 合计 11 项，已安装 4 项
 */

import { detectAllAgents, verifyAgentRoster } from '../src/app/services/agent-detector';
import { createNodeExec } from '../src/app/services/node-exec';

async function main(): Promise<void> {
  const roster = verifyAgentRoster();
  if (!roster.ok) {
    // 名单自检不过就别探测了：探出来的结果不可信（少项 / 重名），报出来比默默跑下去好。
    console.error('[agent-detector] 名单自检未通过：', roster.problems.join('；'));
    process.exitCode = 1;
    return;
  }

  const results = await detectAllAgents({ execFn: createNodeExec() });
  const installed = results.filter((result) => result.installed);
  const unknown = results.filter((result) => result.status === 'timeout' || result.status === 'failed');

  console.log(
    `[agent-detector] 合计 ${results.length} 项，已安装 ${installed.length} 项，未确认 ${unknown.length} 项`
  );

  // 有未确认项时给个非 0 退出码，方便 CI / 脚本调用方察觉（但不当作"失败"：超时是环境问题）。
  if (unknown.length > 0) process.exitCode = 2;
}

void main();
