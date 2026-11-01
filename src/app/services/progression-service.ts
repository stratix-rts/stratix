/**
 * 文件职责：**养成回路的事件编排器**（task_040）—— 把 task_039 发出的 exp.gained 事件
 *   变成真实的状态变更与升级广播：
 *     exp.gained（task-service / chat-service 发射）
 *       → character manager.grantExperience（一次原子 setState：经验累加 + 等级结算落库
 *         WorldState.characters —— 结算曲线在 core/progression/curve.ts 的 levelUpCheck，
 *         经 growth 状态机委托，本服务**不自己算数**）
 *       → 升级（levelUps > 0）则广播 level.up（fromLevel / toLevel 取自 manager 的结算结果）。
 *   落库后 033 的 game-save-coordinator 档案 diff 订阅自动把 level / exp 持久化到 SQLite
 *   （characters 表）—— 本服务不碰任何 IO。
 *   经验事件审计流（@since v3.36，task_061）：可选 persistExpEvent 注入件把每条 exp.gained
 *   逐条写进 exp_events 表（升级时补一条 level_up 里程碑行）—— 成长曲线 / 活动热力的时间序
 *   真相源。注入件自己负责 IO（Electron = IPC 通道，缺省 = 不落库），本服务仍零 IO。
 * 输入：core 总线的 world 事件流 + 注入的 character manager（成长数值写入面的唯一入口）。
 * 输出：WorldState.characters 的更新（经 manager）+ level.up 总线事件。
 * 禁止事项：
 *   1. 在这里算等级 / 曲线 / 权重 —— 数值真相只在 core/progression；本文件只做「事件 → 写入面
 *      → 事件」的编排，出现第二处数值必然漂移；
 *   2. 直接 setState 改 characters —— 绕过 manager 会开第二条写路径（manager 是唯一入口，
 *      见其文件头），且丢掉它的拒发 / Notice / 对账语义；
 *   3. 碰 IO（落库 / toast）—— 持久化由 033 的协调器订阅 store 广播自动完成；
 *      UI 反馈（041）订阅 level.up 自己做，本服务不发通知不弹窗；
 *   4. 为「角色不存在」做重试 —— exp.gained 契约明确档案被删的边角由消费者容错：
 *      manager 会推一条 warn Notice（既有语义），这里记日志即止，绝不重试。
 *
 * why 是独立服务而不是组合根内联：main-entry 已经很长，且「订阅 → 编排 → 广播」的起停
 *   生命周期（start 返回退订）与 task-service 同一形状，独立文件便于单测接线全路径。
 *
 * @since v3.19（task_040）。依赖：task_039（exp.gained 事件）、task_033（档案落库）、
 *   core/progression（曲线 / levelUpCheck）、core/character/manager（写入面）。
 */

import { emitWorldEvent, onWorldEvent, type Unsubscribe } from '../../core/bus';
import type { CharacterManager } from '../../core/character';
import type { WorldEvent } from '../../core/types';

/** 服务依赖（全部注入，单测用真件 + 隔离 store）。 */
export interface ProgressionServiceDeps {
  /** 角色域写入面（组合根注入与 runtime 同一个实例 —— 两处写的是同一份 WorldState.characters）。 */
  readonly characterManager: CharacterManager;
  /** 日志口；缺省静默（与 task-service / chat-service 同一口径）。 */
  readonly logger?: (line: string) => void;
  /**
   * 经验事件落库口（@since v3.36，task_061）：每条 exp.gained 落一行来源行；升级再补一条
   * level_up 里程碑行（delta = 0，level = 升级后等级）。缺省 = 不落库（非 Electron 降级）。
   * 同步签名 fire-and-forget：注入件内部自己吞 IO 异常（曲线少一个点不是错误，养成状态另有真相）。
   */
  readonly persistExpEvent?: (insert: {
    readonly characterId: string;
    readonly delta: number;
    readonly reason: 'task_completed' | 'task_failed' | 'chat_round' | 'level_up';
    readonly level: number | null;
    readonly createdAt: number;
  }) => void;
}

/** 对外形状（组合根与单测按它操作）。 */
export interface ProgressionService {
  /** 接通订阅；返回 stop 闭包（资源必须可清理，页面卸载时调用）。重复 start 各返回各自的退订。 */
  start(): () => void;
}

export function createProgressionService(deps: ProgressionServiceDeps): ProgressionService {
  const logger = deps.logger ?? ((): void => { /* 缺省静默 */ });

  const handle = (event: WorldEvent): void => {
    if (event.type !== 'exp.gained') return;
    // 写入面唯一入口：一次 grant = 经验累加 + 等级结算 + 落库 + 状态广播（全在 manager 内原子完成）。
    const result = deps.characterManager.grantExperience(event.characterId, event.amount);
    if (!result.ok) {
      // 契约边角（角色被删 / amount 违约）：manager 已推 Notice，这里只留一行日志可追。
      logger(`[progression] exp.gained 写入被拒（${event.characterId}/${event.source}/${result.code}）`);
      return;
    }
    // 经验事件审计流（task_061）：来源行逐条落 exp_events（先落库后广播，订阅者拿到库里最新序）。
    deps.persistExpEvent?.({
      characterId: event.characterId,
      delta: event.amount,
      reason: event.source,
      level: null,
      createdAt: Date.now(),
    });
    // 升级广播时机：只有 levelUps > 0 才发（对账降级为负、普通累加为 0 都不算升级）；
    // 跨多级只发**一条**（级差由 toLevel - fromLevel 表达，与 levelUpCheck 一次结算的口径一致）。
    if (result.levelUps <= 0) return;
    // 里程碑行：升级结算补一条 level_up（delta 恒 0，level = 升级后等级）—— 曲线标记的真相源。
    deps.persistExpEvent?.({
      characterId: event.characterId,
      delta: 0,
      reason: 'level_up',
      level: result.character.level,
      createdAt: Date.now(),
    });
    emitWorldEvent({
      type: 'level.up',
      characterId: event.characterId,
      fromLevel: result.character.level - result.levelUps,
      toLevel: result.character.level,
    });
  };

  const start = (): Unsubscribe => onWorldEvent(handle);

  return { start };
}
