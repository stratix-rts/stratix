/**
 * 单测：当日回放的表现态板（world/objects/replay-board.ts，task_082）——
 *   节拍 → 相位 / 终态不改写 / 清场 / 稳定槽位 / 槽位坐标落在战场内。
 *
 * 本层刻意不依赖渲染引擎（node 单测直接跑）。
 * @jest-environment node
 */

import type { ReplayBeat } from '../../core/types';
import {
  ReplayBoard,
  replayAnchorId,
  replayAvatarPosition,
  replaySlotCount,
  replaySlotPosition,
  stableHash,
} from '../objects/replay-board';

const beat = (partial: Partial<ReplayBeat> & { kind: ReplayBeat['kind'] }): ReplayBeat => ({
  at: 1000,
  characterId: 'char-1',
  taskId: 'task-1',
  label: '干活',
  ...partial,
});

describe('回放相位裁决', () => {
  test('开工 → 干活 → 完成', () => {
    const board = new ReplayBoard();
    expect(board.apply(beat({ kind: 'spawn' }))?.phase).toBe('spawn');
    expect(board.apply(beat({ kind: 'work' }))?.phase).toBe('work');
    expect(board.apply(beat({ kind: 'done' }))?.phase).toBe('done');
    expect(board.size).toBe(1);
  });

  test('完成是终态：后来的节拍不改写它', () => {
    const board = new ReplayBoard();
    board.apply(beat({ kind: 'done' }));
    expect(board.apply(beat({ kind: 'work' }))?.phase).toBe('done');
  });

  test('出错也是终态', () => {
    const board = new ReplayBoard();
    board.apply(beat({ kind: 'error' }));
    expect(board.apply(beat({ kind: 'work' }))?.phase).toBe('error');
  });

  test('reset 清场（拖回早的时刻不叠上一轮残留）', () => {
    const board = new ReplayBoard();
    board.apply(beat({ kind: 'spawn' }));
    expect(board.apply(beat({ kind: 'reset' }))).toBeNull();
    expect(board.size).toBe(0);
    expect(board.list()).toEqual([]);
  });

  test('没有角色的节拍不进板子', () => {
    const board = new ReplayBoard();
    expect(board.apply(beat({ kind: 'spawn', characterId: undefined }))).toBeNull();
    expect(board.size).toBe(0);
  });

  test('不同角色各占一格', () => {
    const board = new ReplayBoard();
    board.apply(beat({ kind: 'spawn', characterId: 'a' }));
    board.apply(beat({ kind: 'spawn', characterId: 'b' }));
    expect(board.size).toBe(2);
    expect(board.get('a')?.slotIndex).not.toBe(board.get('b')?.slotIndex);
  });
});

describe('稳定槽位', () => {
  test('同一角色永远落在同一格（回放之间不跳位）', () => {
    const first = new ReplayBoard();
    const second = new ReplayBoard();
    const a1 = first.apply(beat({ kind: 'spawn', characterId: 'char-x' }))?.slotIndex;
    const a2 = second.apply(beat({ kind: 'spawn', characterId: 'char-x' }))?.slotIndex;
    expect(a1).toBe(a2);
  });

  test('槽位在网格容量内（8×6 = 48）', () => {
    const board = new ReplayBoard();
    for (let i = 0; i < 60; i += 1) {
      const slot = board.apply(beat({ kind: 'spawn', characterId: `char-${i}` }))?.slotIndex;
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(replaySlotCount());
    }
  });

  test('哈希是稳定的（同一串永远同一值）', () => {
    expect(stableHash('char-1')).toBe(stableHash('char-1'));
    expect(stableHash('char-1')).not.toBe(stableHash('char-2'));
  });
});

describe('槽位坐标', () => {
  const bounds = { x: 0, y: 0, width: 800, height: 600 };

  test('槽位坐标落在战场内', () => {
    for (let index = 0; index < replaySlotCount(); index += 1) {
      const point = replaySlotPosition(index, bounds);
      expect(point.x).toBeGreaterThanOrEqual(bounds.x);
      expect(point.x).toBeLessThan(bounds.x + bounds.width);
      expect(point.y).toBeGreaterThanOrEqual(bounds.y);
      expect(point.y).toBeLessThan(bounds.y + bounds.height);
    }
  });

  test('越界槽位号会回绕（不越界）', () => {
    const point = replaySlotPosition(replaySlotCount() + 3, bounds);
    const wrapped = replaySlotPosition(3, bounds);
    expect(point).toEqual(wrapped);
  });
});

describe('化身落位（镜头与气泡的锚）', () => {
  const bounds = { x: 0, y: 0, width: 800, height: 600 };

  test('角色还在战场上 → 站在真实单位的位置（观众认得出是谁）', () => {
    const board = new ReplayBoard();
    const avatar = board.apply(beat({ kind: 'spawn', characterId: 'char-1' }));
    expect(avatar).not.toBeNull();
    const position = replayAvatarPosition(avatar!, { x: 123, y: 456 }, bounds);
    expect(position).toEqual({ x: 123, y: 456 });
  });

  test('角色不在场 → 走稳定槽位（历史角色也得有个落点）', () => {
    const board = new ReplayBoard();
    const avatar = board.apply(beat({ kind: 'spawn', characterId: 'char-1' }));
    const position = replayAvatarPosition(avatar!, null, bounds);
    expect(position).toEqual(replaySlotPosition(avatar!.slotIndex, bounds));
    // 落点仍在战场内（镜头能追到）。
    expect(position.x).toBeGreaterThanOrEqual(bounds.x);
    expect(position.x).toBeLessThan(bounds.x + bounds.width);
  });

  test('锚点 id 带前缀（不与真实单位 id 撞车 —— 冷却与队列各算各的）', () => {
    expect(replayAnchorId('char-1')).toBe('replay:char-1');
    expect(replayAnchorId('char-1')).not.toBe('char-1');
  });
});
