/**
 * 文件职责：**service 进程的世界态恢复**（前后端分离 A4 / task_080）——
 *   启动时把 service 侧 SQLite 的角色档案读回来，投影成 core 世界态里的
 *   「角色 + 战场单位」，让 MCP / 外部 client 看到的不是空世界。
 * 输入：一个库句柄（SqliteDatabaseLike）+ 世界态持有者（CoreStore）。
 * 输出：恢复结果（角色数 / 单位数 / 脏行数），并把角色与单位写进 store。
 * 禁止事项：
 *   1. 在这里自己写一份「记录 → 角色」的映射 —— 翻译只有一份，在
 *      app/services/persistence/character-record.ts（渲染侧与服务侧共用）；
 *   2. 绕过 core 直接改业务字段 —— 这里只做**启动恢复注入**（与渲染侧 boot 同一动作：
 *      写 characters / units 两个数组），相位与等级等业务字段仍由 core 裁决；
 *   3. 恢复失败时抛出去打断启动 —— 读档坏了降级成空世界 + 一行警告，
 *      绝不让服务起不来（与渲染侧 game-save-coordinator 同一口径）；
 *   4. 恢复站位（战场坐标）—— 坐标真相在世界层，service 进程没有战场，站位种子不归这里。
 *
 * why 需要这一步（A4 的核心痛点）：
 *   service 进程持有 core runtime 后，MCP 看到的就是**这份**世界态。若启动时不恢复角色，
 *   每次重启 MCP 都会看到 units 0 —— 那正是本单要消解的痛点。
 *   角色档案是 service 侧 SQLite 的 characters 表（铁律 6：SQLite 只由 service 进程打开写）。
 *
 * @since v3.43（task_080 / service-split A4）。
 */

import { buildRestoreInjection } from '../../app/services/persistence/character-record';
import { loadGameSnapshot, type SqliteDatabaseLike } from '../../app/services/persistence/game-save-dao';
import type { CoreStore } from '../../core/store';

/** 恢复结果（供启动日志与测试断言用）。 */
export interface WorldRestoreResult {
  /** 恢复进 store 的角色数。 */
  readonly characters: number;
  /** 恢复进 store 的战场单位数（角色单位，与建档时同一投影）。 */
  readonly units: number;
  /** 库里读到的行数（脏行 / 超上限被丢弃的行也计入）。 */
  readonly records: number;
}

/**
 * 从库里恢复世界态（角色 + 单位）到 store。
 *
 * 幂等：同一个 id 已在 store 里就跳过（不重复投影单位）。
 * 失败不抛：读档出错 → 空世界 + 警告（服务照常启动）。
 */
export function restoreWorldFromDatabase(
  store: CoreStore,
  db: SqliteDatabaseLike,
  logger: (line: string) => void = (line) => console.warn(line)
): WorldRestoreResult {
  let records = 0;
  let characters = 0;
  let units = 0;

  try {
    const snapshot = loadGameSnapshot(db);
    records = snapshot.characters.length;
    const injection = buildRestoreInjection(snapshot);

    store.setState((current) => {
      const knownCharacterIds = new Set(current.characters.map((character) => character.id));
      const knownUnitIds = new Set(current.units.map((unit) => unit.id));
      const restoredCharacters = injection.characters.filter(
        (character) => !knownCharacterIds.has(character.id)
      );
      const restoredUnits = injection.units.filter((unit) => !knownUnitIds.has(unit.id));
      characters = restoredCharacters.length;
      units = restoredUnits.length;
      if (restoredCharacters.length === 0 && restoredUnits.length === 0) return current;
      return {
        ...current,
        characters: [...current.characters, ...restoredCharacters],
        units: [...current.units, ...restoredUnits],
      };
    });
  } catch (error) {
    logger(
      `[service] 世界态恢复失败，降级为空世界：${error instanceof Error ? error.message : String(error)}`
    );
    return { characters: 0, units: 0, records: 0 };
  }

  return { characters, units, records };
}
