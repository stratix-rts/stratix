/**
 * 文件职责：**把气泡说话系统画到战场上**（task_076 / DEMO-PLAN.md §3）——
 *   单位头顶冒出的圆角气泡：黑底 85% + 白字 13px + 指向单位的小尾巴，
 *   入场从尾巴那点「长」出来（scale 0→1 Back.Out 250ms），出场上浮 10px + 淡出（300ms），
 *   存活 4s 自动收起；同屏 ≤3 个、同单位 5s 不重复（规则在 objects/speech-bubble.ts 的板子上）。
 * 输入：Phaser 场景 + UnitRegistry（单位位置真相）+ SpeechBubbleBoard（气泡相位真相）。
 * 输出：气泡显示对象（Container：圆角底衬 Graphics + 尾巴 + 文字 Text）+ 一个全场共用的 tick 定时器。
 * 禁止事项：
 *   1. 在本层做频率判断 —— 规则在 SpeechBubbleBoard（纯逻辑，可穷举测试）；
 *   2. import hud / app / vue —— 铁律：world 不认识 hud；
 *   3. 每个气泡各开一个定时器 —— 全场一个 tick（同 unit-layer / task-fx-layer 的纪律，perf 硬约束）；
 *   4. 场景 shutdown 后继续操作显示对象 —— destroyed 置位后一律早退；
 *   5. 在这里写尺寸 / 时长字面量 —— 全部取自 world/speech-spec.ts（SPEECH_BUBBLE_SPEC）。
 *
 * ★ 为什么尾巴是「锚点」而不是装饰：
 *   规格写的是「入场 scale 0→1，锚点在尾巴」—— 气泡从**尾巴尖**那一点长出来，
 *   观感上就像那句话是从单位头顶冒出来的，而不是从天上掉下来。
 *   实现上：容器摆在尾巴尖的位置，气泡体画在容器的**局部负 y 方向**，
 *   缩放容器的 pivot 就是容器原点（尾巴尖）—— 缩放时尾巴尖不动，气泡体向上下左右长开。
 *
 * @since v3.3（task_076）。
 */

import Phaser from 'phaser';

import type { Point } from '../../core/types';
import { SPEECH_BUBBLE_SPEC } from '../speech-spec';
import type { SpeechKind } from '../speech-templates';
import { hexToNumber } from '../visual-spec';

import {
  bubbleAnimationAt,
  layoutSpeechText,
  type SpeechBubble,
  type SpeechBubbleBoard,
  type SpeechRequestOutcome,
} from './speech-bubble';
import type { UnitRegistry } from './unit-registry';

/** 气泡所在深度：压在单位（0）与任务浮标（5）之上。 */
export const SPEECH_BUBBLE_DEPTH = 20;

/** 全场 tick 间隔（ms）：30fps 足够入场 / 退场动画的平滑度。 */
const TICK_MS = 33;

/** 一枚气泡的显示对象。 */
interface SpeechBubbleNode {
  readonly container: Phaser.GameObjects.Container;
  readonly graphic: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
}

/**
 * 气泡渲染层：板子说什么就画什么。
 *
 * 生命周期：场景 create() 里建，shutdown 时 destroy()（定时器 / 显示对象 / 隐藏量尺一并回收）。
 */
export class SpeechBubbleLayer {
  private readonly scene: Phaser.Scene;
  private readonly registry: UnitRegistry;
  private readonly board: SpeechBubbleBoard;
  private readonly nodes = new Map<number, SpeechBubbleNode>();
  /**
   * 锚点覆盖表（@since v3.3，task_082）：说话方**没有真实单位**时的落位坐标。
   * why 需要它：当日回放演的是**历史**角色 —— 那个人今天可能已经不在战场上了，
   *   而气泡必须挂在说话方头上（凭空造单位 = 骗观众）。所以回放化身用
   *   `replay:<characterId>` 当说话方 id，位置由回放化身自己给（锚点覆盖）。
   */
  private readonly anchors = new Map<string, Point>();
  /** 隐藏量尺：量一段文字有多宽（排版按字断行要用）。 */
  private readonly measurer: Phaser.GameObjects.Text;
  private timer: Phaser.Time.TimerEvent | null = null;
  private destroyed = false;

  constructor(scene: Phaser.Scene, registry: UnitRegistry, board: SpeechBubbleBoard) {
    this.scene = scene;
    this.registry = registry;
    this.board = board;
    this.measurer = scene.add
      .text(0, 0, '', {
        fontFamily: SPEECH_BUBBLE_SPEC.fontFamily,
        fontSize: `${SPEECH_BUBBLE_SPEC.fontSizePx}px`,
        color: SPEECH_BUBBLE_SPEC.textColor,
      })
      .setVisible(false);
    this.timer = scene.time.addEvent({ delay: TICK_MS, loop: true, callback: () => this.tick() });
  }

  /**
   * 让某个单位冒一句话（总线事件的落点）。
   * @returns 'shown' 立刻冒泡 / 'queued' 排队 / 'cooldown' 5s 冷却挡下
   */
  speak(unitId: string, kind: SpeechKind): SpeechRequestOutcome {
    if (this.destroyed) return 'dropped';
    const outcome = this.board.request(unitId, kind, this.scene.time.now);
    this.reconcile();
    return outcome;
  }

  /**
   * 让某个单位冒**指定的一句**（总线上的 unit.bubble 事件的落点 —— 原话已经定好）。
   * 频率规则与模板气泡完全一致（同屏 ≤3 / 同单位 5s 冷却）。
   */
  speakText(unitId: string, text: string): SpeechRequestOutcome {
    if (this.destroyed) return 'dropped';
    const outcome = this.board.requestText(unitId, text, this.scene.time.now);
    this.reconcile();
    return outcome;
  }

  /** 单位离场：收掉它的气泡（表现不许悬在已不存在的单位头顶）。 */
  clearUnit(unitId: string): void {
    if (this.destroyed) return;
    this.board.clearUnit(unitId);
    this.reconcile();
  }

  /**
   * 锚点覆盖（@since v3.3，task_082）：给「没有真实单位」的说话方一个坐标。
   * 谁在用：当日回放 —— 历史角色不在战场上，气泡挂在**回放化身**头上。
   */
  setAnchor(unitId: string, position: Point): void {
    if (this.destroyed) return;
    this.anchors.set(unitId, { x: position.x, y: position.y });
  }

  /** 收回锚点覆盖（角色离场 / 清场 —— 别让气泡悬在空处）。 */
  clearAnchor(unitId: string): void {
    this.anchors.delete(unitId);
  }

  /** 场景 shutdown：定时器与全部显示对象一并回收（perf：资源必须可清理）。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.timer?.remove(false);
    this.timer = null;
    for (const node of this.nodes.values()) node.container.destroy();
    this.nodes.clear();
    this.anchors.clear();
    this.measurer.destroy();
  }

  /** 全场唯一的 tick：推进板子 → 对账节点 → 把动画帧写进显示对象。 */
  private tick(): void {
    if (this.destroyed) return;
    const now = this.scene.time.now;
    this.board.tick(now);
    this.reconcile();
    this.applyFrames(now);
  }

  /** 对账：板上有、屏幕没有 → 建；屏幕上有、板上没有 → 销。 */
  private reconcile(): void {
    if (this.destroyed) return;
    const entries = this.board.bubbles();
    const alive = new Set<number>();
    for (const entry of entries) {
      alive.add(entry.id);
      if (!this.nodes.has(entry.id)) this.nodes.set(entry.id, this.createNode(entry));
    }
    for (const [id, node] of [...this.nodes]) {
      if (alive.has(id)) continue;
      node.container.destroy();
      this.nodes.delete(id);
    }
  }

  /** 建一枚气泡的显示对象（排版 → 量尺寸 → 画圆角底衬 + 尾巴 → 摆文字）。 */
  private createNode(entry: SpeechBubble): SpeechBubbleNode {
    const spec = SPEECH_BUBBLE_SPEC;
    const container = this.scene.add.container(0, 0);
    const graphic = this.scene.add.graphics();
    const label = this.scene.add
      .text(0, 0, '', {
        fontFamily: spec.fontFamily,
        fontSize: `${spec.fontSizePx}px`,
        color: spec.textColor,
        align: 'left',
        lineSpacing: spec.lineSpacingPx,
      })
      .setOrigin(0, 0);
    container.add([graphic, label]);
    container.setDepth(SPEECH_BUBBLE_DEPTH);

    // —— 排版：最多 2 行、单行不超过「最大宽 - 两边内边距」——
    const maxContentWidth = spec.maxWidthPx - spec.paddingPx * 2;
    const layout = layoutSpeechText(
      entry.text,
      (candidate) => this.measure(candidate),
      maxContentWidth,
      spec.maxLines
    );
    label.setText(layout.lines.join('\n'));

    const boxWidth = Math.min(spec.maxWidthPx, label.width + spec.paddingPx * 2);
    const boxHeight = label.height + spec.paddingPx * 2;
    const bodyTop = -(spec.tailHeightPx + boxHeight);

    // —— 形状（局部坐标：尾巴尖在原点，气泡体在其上方）——
    graphic.clear();
    graphic.fillStyle(hexToNumber(spec.backdropColor), spec.backdropAlpha);
    graphic.fillRoundedRect(-boxWidth / 2, bodyTop, boxWidth, boxHeight, spec.cornerRadiusPx);
    graphic.fillPoints(
      [
        { x: -spec.tailWidthPx / 2, y: -spec.tailHeightPx },
        { x: spec.tailWidthPx / 2, y: -spec.tailHeightPx },
        { x: 0, y: 0 },
      ],
      true
    );

    label.setPosition(-boxWidth / 2 + spec.paddingPx, bodyTop + spec.paddingPx);
    return { container, graphic, label };
  }

  /** 量一段文字的像素宽（隐藏量尺；只在建节点时调用，频率极低）。 */
  private measure(candidate: string): number {
    this.measurer.setText(candidate);
    return this.measurer.width;
  }

  /** 把动画帧写进显示对象：位置跟单位走，缩放 / 透明度按曲线。 */
  private applyFrames(now: number): void {
    const spec = SPEECH_BUBBLE_SPEC;
    for (const entry of this.board.bubbles()) {
      const node = this.nodes.get(entry.id);
      if (!node) continue;
      const unit = this.registry.get(entry.unitId);
      // 单位已经不在战场上了（离场清理由场景负责）：这一帧先不画，等对账时销掉。
      // 锚点覆盖优先于「查无此单位」—— 回放化身没有真实单位，但气泡仍要挂在它头上。
      const position = unit ? unit.position : this.anchors.get(entry.unitId);
      if (!position) continue;
      const elapsed =
        entry.phase === 'exiting' ? now - (entry.exitAtMs ?? now) : now - entry.shownAtMs;
      const frame = bubbleAnimationAt(entry.phase, elapsed, {
        enterDurationMs: this.board.enterDurationMs,
        exitDurationMs: this.board.exitDurationMs,
        exitRisePx: spec.exitRisePx,
      });
      node.container.setPosition(position.x, position.y + spec.anchorOffsetY + frame.riseY);
      node.container.setScale(frame.scale);
      node.container.setAlpha(frame.alpha);
    }
  }
}
