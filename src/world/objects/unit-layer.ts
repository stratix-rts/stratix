/**
 * 文件职责：把 UnitRegistry 里的单位对象画到 Phaser 画面上，并显示选择态。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「world/objects 单位」。
 * 输入：Phaser 场景 + UnitRegistry（单位真相）+ 选择集 / 预览集 id。
 * 输出：屏幕上与单位一一对应的显示对象；命中测试委托给 UnitRegistry。
 * 禁止事项：
 *   1. 持有业务状态 —— 业务真相在 core，本层只读 UnitView 的 status 决定颜色；
 *   2. import hud / vue / legacy(stratix-rts) —— 铁律：world 不认识 hud，HUD 才认识 world；
 *   3. 每帧全量重建 GameObject —— sync() 按 id 增删改，稳定的单位复用同一显示对象（perf）；
 *   4. 现在就画业务态文字 / 徽标 —— 本任务只出最小可辨形体，文字与徽标留给后续任务。
 *
 * 配色：普通单位按业务态上色（idle / busy / offline / error，见下方常量）；
 *   带皮肤的 agent 单位（@since v3.9，角色单位）按**皮肤徽标色**上色 ——
 *   颜色换算在 world/theme.ts（皮肤登记表在 core/theme/skin-registry.ts，world 不认识 hud）。
 */

import Phaser from 'phaser';

import type { UnitStatus } from '../../core/types';
import { resolveUnitColor } from '../theme';

import { UNIT_HIT_RADIUS, type UnitObject } from './unit-object';
import type { UnitRegistry } from './unit-registry';

const UNIT_RADIUS = UNIT_HIT_RADIUS * 0.8;
const RING_RADIUS = UNIT_RADIUS + 5;

const COLOR_BY_STATUS: Record<UnitStatus, number> = {
  idle: 0x4f9cf9,
  busy: 0xf5a524,
  offline: 0x5c6470,
  error: 0xef4444,
};

const DEFAULT_STATUS_COLOR = 0x94a3b8;
const SELECTED_RING = 0xffffff;
const PREVIEW_RING = 0x9ca3af;

interface UnitNode {
  readonly container: Phaser.GameObjects.Container;
  readonly body: Phaser.GameObjects.Arc;
  readonly ring: Phaser.GameObjects.Arc;
}

/**
 * 单位的 Phaser 显示层：把 UnitRegistry 里的单位画出来，并显示选择 / 预览环。
 * 单位状态与命中判定一律取自 UnitRegistry，本类不持有第二份真相。
 */
export class UnitLayer {
  private readonly nodes = new Map<string, UnitNode>();
  private readonly scene: Phaser.Scene;
  private readonly registry: UnitRegistry;
  private selected = new Set<string>();
  private preview = new Set<string>();

  constructor(scene: Phaser.Scene, registry: UnitRegistry) {
    this.scene = scene;
    this.registry = registry;
  }

  /** 对账显示对象：新增建、移除销、位置/状态变化才改属性。 */
  sync(): void {
    const live = new Set<string>();

    for (const object of this.registry.list()) {
      live.add(object.id);
      const node = this.nodes.get(object.id) ?? this.createNode(object.id);
      node.container.setPosition(object.position.x, object.position.y);
      node.body.setFillStyle(this.fillColorOf(object));
      this.refreshRing(node, object.id);
    }

    for (const id of Array.from(this.nodes.keys())) {
      if (live.has(id)) continue;
      this.nodes.get(id)?.container.destroy();
      this.nodes.delete(id);
    }
  }

  /** 选择集与框选预览集分开渲染：预览用弱色，松手前不误导用户以为已经选中。 */
  setSelection(unitIds: readonly string[], previewUnitIds: readonly string[]): void {
    this.selected = new Set(unitIds);
    this.preview = new Set(previewUnitIds);
    for (const [id, node] of this.nodes) {
      this.refreshRing(node, id);
    }
  }

  /** 点击命中：判定规则在 UnitRegistry，这里只做转发，保持命中逻辑可单测。 */
  hitTest(x: number, y: number): UnitObject | null {
    return this.registry.hitTest({ x, y });
  }

  /**
   * 单位填充色（@since v3.9）：带皮肤的 agent 单位按**皮肤徽标色**上色（身份标识），
   * 没有皮肤的普通单位按业务态颜色（idle / busy / offline / error）。
   * 换肤只需改 skinId —— 颜色换算集中在 world/theme.ts，本层只取结果。
   */
  private fillColorOf(object: UnitObject): number {
    const statusColor = COLOR_BY_STATUS[object.status] ?? DEFAULT_STATUS_COLOR;
    return resolveUnitColor(object.skinId, statusColor);
  }

  destroy(): void {
    for (const node of this.nodes.values()) {
      node.container.destroy();
    }
    this.nodes.clear();
    this.selected.clear();
    this.preview.clear();
  }

  private createNode(id: string): UnitNode {
    const body = this.scene.add.circle(0, 0, UNIT_RADIUS, COLOR_BY_STATUS.idle);
    const ring = this.scene.add.circle(0, 0, RING_RADIUS, 0x000000, 0).setStrokeStyle(2, SELECTED_RING);
    const container = this.scene.add.container(0, 0, [body, ring]);
    container.setName(`unit:${id}`);

    const node: UnitNode = { container, body, ring };
    this.nodes.set(id, node);
    this.refreshRing(node, id);
    return node;
  }

  private refreshRing(node: UnitNode, id: string): void {
    if (this.selected.has(id)) {
      node.ring.setStrokeStyle(2, SELECTED_RING, 1).setFillStyle();
      node.ring.setVisible(true);
      return;
    }
    if (this.preview.has(id)) {
      node.ring.setStrokeStyle(1, PREVIEW_RING, 0.8).setFillStyle();
      node.ring.setVisible(true);
      return;
    }
    node.ring.setVisible(false);
  }
}
