/**
 * 文件职责：**气泡说话系统的 dev 验收场景**（task_076）—— 摆几个样例单位，
 *   用按钮触发四类事件气泡 / 原话气泡 / 事件风暴（看同屏 ≤3 与排队），
 *   人眼直接验收：圆角黑底 85% + 白字 13px + 指向单位的尾巴、
 *   入场 Back.Out 250ms（锚点在尾巴）、出场上浮 10px + 淡出 300ms、存活 4s 自动收。
 *   方案来源：docs/DEMO-PLAN.md §3。
 * 输入：DOM 按钮（由 speech-main.ts 接到本场景的方法上）。
 * 输出：气泡显示对象 + 一个状态快照方法（供按钮条显示「同屏几个 / 排队几个」）。
 * 禁止事项：
 *   1. import hud / app / vue / legacy(stratix-rts) —— 与 world 层同一条铁律；
 *   2. 在本场景里实现频率规则 —— 规则全在 objects/speech-bubble.ts 的板子上；
 *   3. 连真实总线 —— dev 页是**沙盒**（与 animation-dev 同性质），不接 core，
 *      免得为一个验收页拉起整套 runtime；
 *   4. 每个气泡各开一个定时器 —— 频率与相位都由 SpeechBubbleLayer 的**全场单 tick**推进。
 *
 * @since v3.3（task_076）。
 */

import Phaser from 'phaser';

import type { Point, UnitView } from '../../core/types';
import { SpeechBubbleBoard } from '../objects/speech-bubble';
import { SpeechBubbleLayer } from '../objects/speech-bubble-layer';
import { UnitRegistry } from '../objects/unit-registry';
import type { SpeechKind } from '../speech-templates';
import { WORLD_PALETTE } from '../theme';

/** 场景 key（main.ts 用它取场景实例）。 */
export const SPEECH_DEV_SCENE_KEY = 'speech-dev';

/** 样例单位（dev 沙盒里的假单位 —— 不接总线，不碰业务真相）。 */
const SAMPLE_UNITS: readonly { id: string; name: string }[] = [
  { id: 'u1', name: '阿柯' },
  { id: 'u2', name: '小竹' },
  { id: 'u3', name: '老陈' },
  { id: 'u4', name: '咚咚' },
  { id: 'u5', name: '米粒' },
];

/** dev 验收场景。 */
export class SpeechDevScene extends Phaser.Scene {
  private unitRegistry!: UnitRegistry;
  private board!: SpeechBubbleBoard;
  private layer!: SpeechBubbleLayer;
  /** 轮转指针：每次点「说一句」换一个单位（绕开同单位 5s 冷却）。 */
  private rotate = 0;

  constructor() {
    super(SPEECH_DEV_SCENE_KEY);
  }

  create(): void {
    const width = this.scale.gameSize.width;
    const height = this.scale.gameSize.height;

    // —— 样例单位：位置手工摆（不靠注册表的网格落位，验收时更好看）——
    const positions = new Map<string, Point>();
    const step = width / (SAMPLE_UNITS.length + 1);
    SAMPLE_UNITS.forEach((unit, index) => {
      positions.set(unit.id, { x: step * (index + 1), y: height * 0.66 });
    });
    this.unitRegistry = new UnitRegistry({
      worldBounds: { x: 0, y: 0, width, height },
      restoredPositions: positions,
    });
    this.unitRegistry.sync(
      SAMPLE_UNITS.map(
        (unit): UnitView => ({
          id: unit.id,
          name: unit.name,
          status: 'idle',
          missionId: null,
          power: 1,
        })
      )
    );
    this.drawSamples();

    // —— 气泡系统本体（与战场同一套：板子 + 渲染层）——
    this.board = new SpeechBubbleBoard({ now: () => this.time.now });
    this.layer = new SpeechBubbleLayer(this, this.unitRegistry, this.board);
  }

  /** 让某个单位按类别说一句（kind → 离线句库抽句）。 */
  speak(kind: SpeechKind): void {
    const unit = this.nextUnit();
    if (!unit) return;
    this.layer.speak(unit.id, kind);
  }

  /** 让某个单位说一句指定的话（走 unit.bubble 那条路的同款入口）。 */
  speakText(text: string): void {
    const unit = this.nextUnit();
    if (!unit) return;
    this.layer.speakText(unit.id, text);
  }

  /** 轮转取下一个样例单位（绕开同单位 5s 冷却，也便于一眼看清是谁在说话）。 */
  private nextUnit(): { id: string } | undefined {
    const list = this.unitRegistry.list();
    if (list.length === 0) return undefined;
    const unit = list[this.rotate % list.length];
    this.rotate += 1;
    return unit;
  }

  /** 事件风暴：五个单位同时开口 —— 用来人眼验收「同屏 ≤3 + 新的排队 + 旧的优先收」。 */
  burst(): void {
    const kinds: SpeechKind[] = ['start', 'complete', 'error', 'assigned', 'support'];
    this.unitRegistry.list().forEach((unit, index) => {
      this.layer.speak(unit.id, kinds[index % kinds.length] ?? 'start');
    });
  }

  /** 全部收掉（重看一遍入场）。 */
  clear(): void {
    this.board.clear();
  }

  /** 当前状态快照（给按钮条显示）。 */
  stats(): { onScreen: number; pending: number } {
    return {
      onScreen: this.board.count(),
      pending: this.board.pendingCount(),
    };
  }

  /** 画样例单位的占位形体（气泡要有东西指着）。 */
  private drawSamples(): void {
    for (const unit of this.unitRegistry.list()) {
      const { x, y } = unit.position;
      const body = this.add.graphics();
      body.fillStyle(WORLD_PALETTE.unit, 0.9);
      body.fillRoundedRect(x - 22, y - 16, 44, 32, 8);
      body.lineStyle(2, WORLD_PALETTE.grid, 1);
      body.strokeRoundedRect(x - 22, y - 16, 44, 32, 8);
      this.add
        .text(x, y + 30, unit.name, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#cbd5e1',
        })
        .setOrigin(0.5, 0);
    }
  }
}
