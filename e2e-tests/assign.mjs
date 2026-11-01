/**
 * 文件职责：CDP 走查 —— 向指定角色派一单，并轮询到任务终态。
 *
 * 用法：node e2e-tests/assign.mjs <characterId> [prompt]
 *   characterId —— WorldState.characters 里的角色 id（用 probe.mjs 查）。
 *   prompt      —— 任务指令原文；缺省用一句最省事的「回一句 READY」。
 *
 * 产出：stdout 一份 JSON 终态摘要；stderr 走查过程日志（人读）。
 * 退出码：completed → 0；failed / cancelled / 超时 → 1。
 *
 * 口径：任务相位词表见 src/core/types.ts 的 TaskStatus ——
 *   queued / running / awaiting_approval / completed / failed / cancelled，
 *   后三个是终态。awaiting_approval 是**非终态**（任务在等用户裁决），
 *   轮询要继续等，不能当完成。
 */

import {
  connectPage,
  READ_STATE_EXPR,
  dispatchExpr,
  sleep,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
} from './lib/cdp.mjs';

const TERMINAL_TASK_STATUS = new Set(['completed', 'failed', 'cancelled']);

async function main() {
  const [, , characterId, ...promptParts] = process.argv;
  if (!characterId) {
    console.error('用法：node e2e-tests/assign.mjs <characterId> [prompt]');
    return 2;
  }
  const prompt = promptParts.join(' ') || '请回复一句 READY（不要做任何其他操作）。';

  const session = await connectPage();
  try {
    const before = await session.evaluate(READ_STATE_EXPR);
    if (before?.error) {
      console.error(`读页面状态失败：${before.error}`);
      return 1;
    }
    const known = before.characters.find((c) => c.id === characterId);
    if (!known) {
      console.error(
        `角色不存在：${characterId}\n在场角色：\n${
          before.characters
            .map((c) => `  ${c.id}  ${c.name}  (${c.agentKind ?? '未绑定 agent'})`)
            .join('\n') || '  （无）'
        }`
      );
      return 1;
    }

    const knownTaskIds = new Set(before.tasks.map((t) => t.id));
    const dispatched = await session.evaluate(
      dispatchExpr({ type: 'task.assign', characterId, prompt })
    );
    if (dispatched?.error) {
      console.error(`派单失败：${dispatched.error}`);
      return 1;
    }
    console.error(`[assign] 已派给 ${known.name}（${characterId}）：${prompt}`);

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let target = null;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const snap = await session.evaluate(READ_STATE_EXPR);
      if (snap?.error) {
        console.error(`[assign] 读状态失败：${snap.error}`);
        continue;
      }
      const fresh = snap.tasks.filter((t) => !knownTaskIds.has(t.id) && t.characterId === characterId);
      target = fresh[fresh.length - 1] ?? null;
      if (!target) {
        console.error('[assign] 等待任务入队…');
        continue;
      }
      console.error(
        `[assign] 任务 ${target.id} 状态=${target.status}` +
          (target.missionId ? ` mission=${target.missionId}` : '')
      );
      if (TERMINAL_TASK_STATUS.has(target.status)) break;
    }

    if (!target) {
      console.error('[assign] 超时：任务始终未入队');
    } else if (!TERMINAL_TASK_STATUS.has(target.status)) {
      console.error(`[assign] 超时：任务停在 ${target.status}`);
      target = { ...target, timedOut: true };
    }

    console.log(
      JSON.stringify(
        {
          character: { id: characterId, name: known.name },
          task: target,
          ok: target?.status === 'completed',
        },
        null,
        2
      )
    );
    return target?.status === 'completed' ? 0 : 1;
  } finally {
    session.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`assign 异常：${err?.message ?? err}`);
    process.exitCode = 1;
  });
