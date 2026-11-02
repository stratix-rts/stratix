/**
 * 文件职责：**当日回放的表现态板**（task_082 / DEMO-PLAN.md §9）—— 把一串回放节拍
 *   （ReplayBeat）裁决成「每个角色此刻是什么相位」（开工 / 干活 / 完成 / 出错），
 *   并给每个角色一个**稳定的落位槽**（同一角色在同一次回放里永远落在同一个格子）。
 * 输入：ReplayBeat（core 契约；由 world 通道转发进来）。
 * 输出：ReplayAvatar 列表（角色 → 相位 + 槽位 + 时刻 + 短句）。
 * 禁止事项：
 *   1. import phaser —— 本层刻意不依赖渲染引擎（node 单测直接跑）；
 *   2. import hud / app —— 铁律：world 只认识 core/types；
 *   3. 自己读数据（去查会话 / 事件表）—— 回放的数据由 hud 侧控制器读，world 只消费节拍；
 *   4. 发明自己的相位词表 —— 相位词表是 core 的 ReplayBeatKind（一份真相）。
 *
 * ============ 为什么槽位是「哈希」而不是「按顺序排」============
 *   按到达顺序排的话，同一个角色在两次回放里会落在不同格子（事件到达顺序可能变）——
 *   画面就会跳。哈希槽位是**幂等**的：同一个 characterId 永远落在同一个格子，
 *   回放与回放之间位置稳定（直播时观众能认出"这是同一个人"）。
 *   冲突用线性探测往后找空位（48 个格子，48 个角色以内不会挤爆）。
 *
 * @since v3.3（task_082）。
 */

import { REPLAY_METRICS } from '../../core/theme/visual-spec';
import type { Bounds, Point, ReplayBeat } from '../../core/types';

/** 回放相位（= core 的 ReplayBeatKind 去掉 reset —— reset 是控制流不是相位）。 */
export type ReplayPhase = 'spawn' | 'work' | 'done' | 'error';

/** 一个角色在回放里的当前状态。 */
export interface ReplayAvatar {
  /** 角色 id（节拍带来的）。 */
  readonly characterId: string;
  /** 当前相位。 */
  readonly phase: ReplayPhase;
  /** 稳定槽位号（0 起）。 */
  readonly slotIndex: number;
  /** 该相位对应的时刻（ms）。 */
  readonly at: number;
  /** 短句（节拍的 label）。 */
  readonly label: string;
}

/** 终态相位（到了就不再被后来的节拍改写 —— 完成了就是完成了）。 */
const TERMINAL_PHASES: ReadonlySet<ReplayPhase> = Object.freeze(new Set<ReplayPhase>(['done', 'error']));

/** 稳定的字符串哈希（FNV-1a 32 位变体）—— 同一 id 永远同一哈希。 */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 槽位总数（网格列数 × 行数；规格钦定 8×6 = 48）。 */
export function replaySlotCount(): number {
  const { columns, rows } = REPLAY_METRICS.slotGrid;
  return Math.max(1, columns * rows);
}

/**
 * 槽位 → 世界坐标（网格铺开在战场里，居中）。
 * why 居中铺：默认镜头对着战场中心 —— 槽位铺在边上等于回放角色全在画面外。
 */
export function replaySlotPosition(index: number, bounds: Bounds): Point {
  const { columns, rows } = REPLAY_METRICS.slotGrid;
  const count = Math.max(1, columns * rows);
  const safe = ((index % count) + count) % count;
  const col = safe % columns;
  const row = Math.floor(safe / columns);
  const cellWidth = bounds.width / columns;
  const cellHeight = bounds.height / rows;
  return {
    x: bounds.x + cellWidth * (col + 0.5),
    y: bounds.y + cellHeight * (row + 0.5),
  };
}

/**
 * 回放锚点 id（@since v3.3，task_082）：回放化身在**气泡系统**里的说话方 id。
 * why 要单独一个 id：回放演的是历史角色，他多半不在战场上了 —— 气泡挂在真实单位头上
 *   找不到人。锚点 id 让气泡系统把「回放化身」当成一个说话方（位置由化身自己给）。
 * why 带前缀：避免和真实单位 id 撞车（同名会把两者的冷却/队列混在一起）。
 */
export function replayAnchorId(characterId: string): string {
  return `replay:${characterId}`;
}

/**
 * 回放化身的落位：**优先真实单位的位置**，角色不在场才走稳定槽位。
 *
 * why 优先真实单位：角色还在战场上时，回放化身就该站在他那儿（观众认得出是谁）；
 *   角色已经离场（历史角色常常如此）时走槽位网格 —— 化身不能凭空消失，
 *   也不能叠在别人的位置上（槽位是稳定哈希分配的）。
 */
export function replayAvatarPosition(
  avatar: ReplayAvatar,
  unitPosition: Point | null,
  bounds: Bounds
): Point {
  if (unitPosition) return { x: unitPosition.x, y: unitPosition.y };
  return replaySlotPosition(avatar.slotIndex, bounds);
}

/**
 * 回放表现态板：节拍 → 相位。
 * 真相只在这里（表现层只画结果 —— 与 TaskFxBoard 同一纪律）。
 */
export class ReplayBoard {
  private readonly avatars = new Map<string, ReplayAvatar>();
  /** 角色 → 槽位（分配过一次就固定下来）。 */
  private readonly slots = new Map<string, number>();
  /** 已占用的槽位（线性探测用）。 */
  private readonly taken = new Set<number>();
  private readonly slotCount: number;

  constructor(options: { readonly slotCount?: number } = {}) {
    this.slotCount = Math.max(1, options.slotCount ?? replaySlotCount());
  }

  /** 清场（拖动回放时先来一拍 reset —— 画面回到那一刻的样子，不叠上一轮的残留）。 */
  reset(): void {
    this.avatars.clear();
    this.slots.clear();
    this.taken.clear();
  }

  /**
   * 应用一拍节拍：返回该角色更新后的状态（null = 这一拍没有角色可更新）。
   *
   * why 终态不改写：一条任务完成后，后续的 step 事件（收尾噪声）不该把它变回"在干活"。
   */
  apply(beat: ReplayBeat): ReplayAvatar | null {
    if (beat.kind === 'reset') {
      this.reset();
      return null;
    }
    const characterId = beat.characterId;
    if (!characterId) return null;
    const previous = this.avatars.get(characterId);
    if (previous && TERMINAL_PHASES.has(previous.phase)) return previous;
    const avatar: ReplayAvatar = {
      characterId,
      phase: beat.kind,
      slotIndex: this.slotFor(characterId),
      at: beat.at,
      label: beat.label ?? '',
    };
    this.avatars.set(characterId, avatar);
    return avatar;
  }

  /** 角色 → 稳定槽位（首次分配后固定）。 */
  slotFor(characterId: string): number {
    const existing = this.slots.get(characterId);
    if (existing !== undefined) return existing;
    const start = stableHash(characterId) % this.slotCount;
    for (let step = 0; step < this.slotCount; step += 1) {
      const candidate = (start + step) % this.slotCount;
      if (!this.taken.has(candidate)) {
        this.taken.add(candidate);
        this.slots.set(characterId, candidate);
        return candidate;
      }
    }
    // 槽位满了（角色数超网格容量）：复用哈希位（宁可重叠也不丢角色）。
    this.slots.set(characterId, start);
    return start;
  }

  /** 取某个角色当前的状态。 */
  get(characterId: string): ReplayAvatar | undefined {
    return this.avatars.get(characterId);
  }

  /** 全部角色（按槽位序 —— 画的时候位置稳定）。 */
  list(): ReplayAvatar[] {
    return Array.from(this.avatars.values()).sort((a, b) => a.slotIndex - b.slotIndex);
  }

  /** 当前在场角色数（观察口）。 */
  get size(): number {
    return this.avatars.size;
  }
}
