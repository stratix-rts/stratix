/**
 * 文件职责：CDP 走查 —— mission（战场任务）全链闭环。
 *
 * 用法：node e2e-tests/mission.mjs [characterId] [prompt]
 *   characterId —— 承接角色 id；缺省自动挑一个「已绑 agent 且场上有对应单位」的角色。
 *   prompt      —— 任务指令原文；缺省用一句最省事的「回一句 READY」。
 *
 * 链路：mission.create（指派单位 → 相位 pending）→ mission.confirm accept（原子进 running）
 *      → task.assign 带 missionId → 轮询到 task 终态 + mission 收尾。
 *
 * 口径（core 契约，src/core/types.ts + src/core/mission/manager.ts）：
 *   - mission 相位：draft / pending / confirmed / running / done / cancelled；
 *   - confirm accept 把 confirmed→running 合并成一次写入（不分两步广播）；
 *   - 任务终态回报：completed → mission done；failed → mission cancelled（中止语义）。
 *
 * 产出：stdout 一份 JSON 链路摘要；stderr 过程日志。
 * 退出码：mission 到 done → 0；否则 1。
 */

import {
  connectPage,
  READ_STATE_EXPR,
  dispatchExpr,
  sleep,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
} from './lib/cdp.mjs';

async function main() {
  const [, , characterIdArg, ...promptParts] = process.argv;
  const prompt = promptParts.join(' ') || '请回复一句 READY（不要做任何其他操作）。';

  const session = await connectPage();
  try {
    const before = await session.evaluate(READ_STATE_EXPR);
    if (before?.error) {
      console.error(`读页面状态失败：${before.error}`);
      return 1;
    }

    // ① 选角色：显式指定优先，否则自动挑「有单位在场上」的角色（mission 要指派单位）
    const character = characterIdArg
      ? before.characters.find((c) => c.id === characterIdArg)
      : before.characters.find((c) => before.units.some((u) => u.characterId === c.id));
    if (!character) {
      console.error(
        characterIdArg
          ? `角色不存在：${characterIdArg}`
          : '找不到可用角色（需要一个已建档、且场上有对应单位的角色）'
      );
      console.error(
        `在场角色：\n${
          before.characters
            .map((c) => `  ${c.id}  ${c.name}  (${c.agentKind ?? '未绑定 agent'})`)
            .join('\n') || '  （无）'
        }`
      );
      return 1;
    }
    const unitIds = before.units.filter((u) => u.characterId === character.id).map((u) => u.id);
    if (unitIds.length === 0) {
      console.error(`角色 ${character.name}（${character.id}）在场上没有对应单位，无法指派 mission`);
      return 1;
    }
    console.error(`[mission] 角色=${character.name}（${character.id}）单位=${unitIds.join(',')}`);

    // ② 建使命（指派名单非空 → 相位 pending）
    const knownMissionIds = new Set(before.missions.map((m) => m.id));
    const title = `E2E 使命验证 ${new Date().toLocaleTimeString()}`;
    const created = await session.evaluate(
      dispatchExpr({ type: 'mission.create', title, unitIds })
    );
    if (created?.error) {
      console.error(`mission.create 失败：${created.error}`);
      return 1;
    }

    // ③ 等新使命出现在状态里（core 广播是异步的）
    let mission = null;
    const createDeadline = Date.now() + 15000;
    while (Date.now() < createDeadline) {
      await sleep(500);
      const snap = await session.evaluate(READ_STATE_EXPR);
      const fresh = (snap?.missions ?? []).filter((m) => !knownMissionIds.has(m.id));
      if (fresh.length > 0) {
        mission = fresh[fresh.length - 1];
        break;
      }
    }
    if (!mission) {
      console.error('mission.create 后没等到新使命出现在状态里');
      return 1;
    }
    console.error(`[mission] missionId=${mission.id} 相位=${mission.phase}`);
    if (mission.phase !== 'pending') {
      console.error(
        `mission 相位异常（期望 pending）：${mission.phase}` +
          '（单位 id 不在场上时会被对账丢弃，相位落 draft）'
      );
      return 1;
    }

    // ④ 确认接单（accept → confirmed → running 一次到位）
    const confirmed = await session.evaluate(
      dispatchExpr({ type: 'mission.confirm', missionId: mission.id, decision: 'accept' })
    );
    if (confirmed?.error) {
      console.error(`mission.confirm 失败：${confirmed.error}`);
      return 1;
    }
    await sleep(500);
    const afterConfirm = await session.evaluate(READ_STATE_EXPR);
    mission = afterConfirm.missions.find((m) => m.id === mission.id) ?? mission;
    console.error(`[mission] confirm accept 后相位=${mission.phase}`);
    if (mission.phase !== 'running' && mission.phase !== 'confirmed') {
      console.error(`mission 未进入 running，当前=${mission.phase}`);
      return 1;
    }

    // ⑤ 带 missionId 派任务
    const knownTaskIds = new Set(afterConfirm.tasks.map((t) => t.id));
    const assigned = await session.evaluate(
      dispatchExpr({ type: 'task.assign', characterId: character.id, prompt, missionId: mission.id })
    );
    if (assigned?.error) {
      console.error(`task.assign 失败：${assigned.error}`);
      return 1;
    }
    console.error('[mission] 已带 missionId 派单，开始轮询闭环');

    // ⑥ 轮询：任务终态 + mission 收尾
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let task = null;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const snap = await session.evaluate(READ_STATE_EXPR);
      const fresh = (snap?.tasks ?? []).filter(
        (t) => !knownTaskIds.has(t.id) && t.missionId === mission.id
      );
      task = fresh[fresh.length - 1] ?? null;
      const live = (snap?.missions ?? []).find((m) => m.id === mission.id);
      if (live) mission = live;
      console.error(
        `[mission] mission=${mission.phase}` +
          (task ? ` task=${task.status}` : ' task=（未入队）') +
          (task?.output ? ` 输出=${task.output.slice(0, 60)}` : '')
      );
      if (mission.phase === 'done' || mission.phase === 'cancelled') break;
    }

    const ok = mission.phase === 'done';
    console.log(
      JSON.stringify(
        {
          mission: {
            id: mission.id,
            title: mission.title,
            phase: mission.phase,
            unitIds: mission.unitIds,
          },
          task: task ? { id: task.id, status: task.status, output: task.output } : null,
          ok,
        },
        null,
        2
      )
    );
    return ok ? 0 : 1;
  } finally {
    session.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`mission 异常：${err?.message ?? err}`);
    process.exitCode = 1;
  });
