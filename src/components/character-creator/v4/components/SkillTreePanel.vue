<script setup lang="ts">
/**
 * SkillTreePanel.vue — 技能树面板 (V4)
 *
 * 可视化技能树：网格布局节点 + SVG 连线 + 属性加成 + 剩余点数 + 重置。
 * 所有交互通过 SkillTree 实例方法完成，状态通过 getState() 读取。
 *
 * Props:
 *   skillTree: SkillTree 实例
 *
 * Emits:
 *   select-node: [nodeId: string]
 *   deselect-node: [nodeId: string]
 *   reset: []
 *
 * 美学约束: A1-A8，全部使用 var(--ds-*) tokens
 * 注意: getSelectedNodeIds() 不存在，使用 getState().selectedNodes
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { SkillNode } from '@/stratix-character-creator/types';
import { SKILL_CATEGORIES, ATTRIBUTE_LABELS } from '@/stratix-character-creator/config/skillTreeConfig';
import { SkillTree } from '@/stratix-character-creator/core/SkillTree';

// ============================================================================
// Props & Emits
// ============================================================================

const props = defineProps<{
  skillTree: InstanceType<typeof SkillTree>;
}>();

const emit = defineEmits<{
  'select-node': [nodeId: string];
  'deselect-node': [nodeId: string];
  reset: [];
}>();

// ============================================================================
// 常量 — 布局
// ============================================================================

const NODE_WIDTH = 80;
const NODE_HEIGHT = 64;
const COL_SPACING = 104;
const ROW_SPACING = 96;
const OFFSET_X = 32;
const OFFSET_Y = 24;

// ============================================================================
// 状态
// ============================================================================

/** 强制刷新计数器 — 在 SkillTree 回调中递增以触发 computed 重算 */
const refreshKey = ref(0);

const tooltip = ref<{ node: SkillNode; x: number; y: number } | null>(null);

// ============================================================================
// 计算属性 — 从 skillTree 读取状态
// ============================================================================

const allNodes = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  refreshKey.value;
  return props.skillTree.getAllNodes();
});

const remainingPoints = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  refreshKey.value;
  return props.skillTree.getRemainingPoints();
});

const maxPoints = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  refreshKey.value;
  return props.skillTree.getMaxPoints();
});

const attributes = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  refreshKey.value;
  return props.skillTree.calculateAttributes();
});

const selectedCount = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  refreshKey.value;
  return props.skillTree.getSelectedCount();
});

/** 属性条目列表（过滤零值） */
const attributeEntries = computed(() =>
  Object.entries(attributes.value).filter(([, v]) => v > 0)
);

// ============================================================================
// 布局辅助
// ============================================================================

function getNodePosition(node: SkillNode) {
  return {
    x: node.position.x * COL_SPACING + OFFSET_X,
    y: node.position.y * ROW_SPACING + OFFSET_Y,
  };
}

function isNodeSelected(nodeId: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  refreshKey.value;
  return props.skillTree.isNodeSelected(nodeId);
}

function isNodeUnlocked(nodeId: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  refreshKey.value;
  return props.skillTree.isNodeUnlocked(nodeId);
}

function getNodeCategory(node: SkillNode): keyof typeof SKILL_CATEGORIES {
  const attrs = Object.keys(node.attributes);
  if (attrs.some(a => a.includes('attack') || a.includes('damage'))) return 'combat';
  if (attrs.some(a => a.includes('defense') || a.includes('armor') || a.includes('block'))) return 'defense';
  if (attrs.some(a => a.includes('speed') || a.includes('dodge'))) return 'mobility';
  if (attrs.some(a => a.includes('mana') || a.includes('magic'))) return 'magic';
  return 'utility';
}

/** SVG 连线数据 */
const connectionLines = computed(() => {
  const lines: Array<{
    from: string;
    to: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    active: boolean;
  }> = [];

  for (const node of allNodes.value) {
    for (const prereqId of node.prerequisites) {
      const prereq = props.skillTree.getNode(prereqId);
      if (!prereq) continue;

      const from = getNodePosition(prereq);
      const to = getNodePosition(node);

      lines.push({
        from: prereqId,
        to: node.nodeId,
        x1: from.x + NODE_WIDTH / 2,
        y1: from.y + NODE_HEIGHT,
        x2: to.x + NODE_WIDTH / 2,
        y2: to.y,
        active: isNodeSelected(prereqId) && isNodeSelected(node.nodeId),
      });
    }
  }

  return lines;
});

/** SVG viewBox 尺寸 */
const svgDimensions = computed(() => {
  let maxX = 0;
  let maxY = 0;
  for (const node of allNodes.value) {
    const pos = getNodePosition(node);
    maxX = Math.max(maxX, pos.x + NODE_WIDTH);
    maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
  }
  return { width: maxX + OFFSET_X, height: maxY + OFFSET_Y * 2 };
});

// ============================================================================
// 方法
// ============================================================================

function handleNodeClick(node: SkillNode): void {
  if (!isNodeUnlocked(node.nodeId)) return;

  if (isNodeSelected(node.nodeId)) {
    props.skillTree.deselectNode(node.nodeId);
    emit('deselect-node', node.nodeId);
  } else {
    const { canSelect } = props.skillTree.canSelectNode(node.nodeId);
    if (canSelect) {
      props.skillTree.selectNode(node.nodeId);
      emit('select-node', node.nodeId);
    }
  }
}

function handleReset(): void {
  props.skillTree.reset();
  emit('reset');
}

function showTooltip(node: SkillNode, event: MouseEvent): void {
  tooltip.value = { node, x: event.clientX, y: event.clientY };
}

function hideTooltip(): void {
  tooltip.value = null;
}

function formatAttributeValue(attr: string, value: number): string {
  const pctKeys = ['critChance', 'blockChance', 'dodgeChance', 'critDamage'];
  if (pctKeys.includes(attr)) return `${value}%`;
  return `+${value}`;
}

// ============================================================================
// 生命周期 — 监听 SkillTree 状态变更
// ============================================================================

onMounted(() => {
  props.skillTree.setOnStateChange(() => {
    refreshKey.value++;
  });
});
</script>

<template>
  <div class="stp">
    <!-- ================================================================
         头部 — 标题 + 点数
    ================================================================ -->
    <div class="stp-header">
      <div class="stp-header__title-group">
        <span class="stp-header__title">技能树</span>
        <span class="stp-header__subtitle">SKILL TREE</span>
      </div>

      <div class="stp-points">
        <span class="stp-points__label">可用点数</span>
        <span class="stp-points__value">{{ remainingPoints }}</span>
        <span class="stp-points__sep">/</span>
        <span class="stp-points__max">{{ maxPoints }}</span>
        <span class="stp-points__used">已选 {{ selectedCount }}</span>
      </div>
    </div>

    <!-- ================================================================
         树内容区 — SVG 连线 + 节点
    ================================================================ -->
    <div class="stp-tree">
      <svg
        class="stp-tree__svg"
        :viewBox="`0 0 ${svgDimensions.width} ${svgDimensions.height}`"
        preserveAspectRatio="xMidYMin meet"
      >
        <line
          v-for="line in connectionLines"
          :key="`${line.from}-${line.to}`"
          class="stp-line"
          :class="{ 'stp-line--active': line.active }"
          :x1="line.x1"
          :y1="line.y1"
          :x2="line.x2"
          :y2="line.y2"
        />
      </svg>

      <div
        v-for="node in allNodes"
        :key="node.nodeId"
        class="stp-node"
        :class="{
          'stp-node--selected': isNodeSelected(node.nodeId),
          'stp-node--locked': !isNodeUnlocked(node.nodeId),
        }"
        :style="{
          left: `${getNodePosition(node).x}px`,
          top: `${getNodePosition(node).y}px`,
          width: `${NODE_WIDTH}px`,
          height: `${NODE_HEIGHT}px`,
          '--node-color': SKILL_CATEGORIES[getNodeCategory(node)]?.color ?? 'var(--ds-text-muted)',
        }"
        @click="handleNodeClick(node)"
        @mouseenter="showTooltip(node, $event)"
        @mouseleave="hideTooltip"
      >
        <div class="stp-node__icon">
          {{ SKILL_CATEGORIES[getNodeCategory(node)]?.icon ?? '?' }}
        </div>
        <div class="stp-node__name">{{ node.name }}</div>
      </div>
    </div>

    <!-- ================================================================
         属性加成
    ================================================================ -->
    <div class="stp-attrs">
      <div v-if="attributeEntries.length === 0" class="stp-attrs__empty">
        选择技能节点以查看属性加成
      </div>
      <div v-else class="stp-attrs__list">
        <div
          v-for="[attr, value] in attributeEntries"
          :key="attr"
          class="stp-attr"
        >
          <span class="stp-attr__name">{{ ATTRIBUTE_LABELS[attr] ?? attr }}</span>
          <span class="stp-attr__value">{{ formatAttributeValue(attr, value) }}</span>
        </div>
      </div>
    </div>

    <!-- ================================================================
         底部 — 重置
    ================================================================ -->
    <div class="stp-footer">
      <button class="stp-reset-btn" @click="handleReset">
        重置技能
      </button>
    </div>

    <!-- ================================================================
         Tooltip（Teleport 到 body）
    ================================================================ -->
    <Teleport to="body">
      <div
        v-if="tooltip"
        class="stp-tooltip"
        :style="{
          left: `${tooltip.x + 12}px`,
          top: `${tooltip.y + 12}px`,
        }"
      >
        <div class="stp-tooltip__title">{{ tooltip.node.name }}</div>
        <div class="stp-tooltip__desc">{{ tooltip.node.description }}</div>
        <div class="stp-tooltip__attrs">
          {{
            Object.entries(tooltip.node.attributes)
              .map(([k, v]) => `${ATTRIBUTE_LABELS[k] ?? k}: +${v}`)
              .join(' · ')
          }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* ==========================================================================
   根容器
   A2: flex column, A4: height 100%, A1: spacing tokens
========================================================================== */
.stp {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--ds-bg-secondary, #1a1a2e);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-lg, 8px);
  overflow: hidden;
  color: var(--ds-text-primary, #eee);
}

/* ==========================================================================
   头部 — 标题 + 点数
   A5: 标题左上，信息层级 ≤ 3 层
========================================================================== */
.stp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--ds-spacing-sm, 8px) var(--ds-spacing-md, 16px);
  border-bottom: 1px solid var(--ds-border, #333);
  background: var(--ds-bg-tertiary, #252540);
  flex-shrink: 0;
}

.stp-header__title-group {
  display: flex;
  align-items: baseline;
  gap: var(--ds-spacing-xs, 4px);
}

.stp-header__title {
  font-size: var(--ds-typography-fontSize-md, 14px);
  font-weight: var(--ds-typography-fontWeight-bold, 700);
  color: var(--ds-color-primary, #00d4ff);
}

.stp-header__subtitle {
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-text-muted, #666);
  letter-spacing: 0.1em;
}

.stp-points {
  display: flex;
  align-items: baseline;
  gap: var(--ds-spacing-xs, 4px);
  font-size: var(--ds-typography-fontSize-sm, 12px);
}

.stp-points__label {
  color: var(--ds-text-muted, #666);
}

.stp-points__value {
  color: var(--ds-status-success, #4ade80);
  font-weight: var(--ds-typography-fontWeight-bold, 700);
  font-size: var(--ds-typography-fontSize-lg, 16px);
}

.stp-points__sep {
  color: var(--ds-text-muted, #666);
}

.stp-points__max {
  color: var(--ds-text-secondary, #aaa);
}

.stp-points__used {
  color: var(--ds-text-muted, #666);
  font-size: var(--ds-typography-fontSize-xs, 10px);
  margin-left: var(--ds-spacing-xs, 8px);
}

/* ==========================================================================
   树内容区 — SVG + 节点
   A2: position relative for absolute children (SVG + nodes)
========================================================================== */
.stp-tree {
  flex: 1;
  position: relative;
  overflow: auto;
  padding: var(--ds-spacing-md, 16px);
  min-height: 0;
}

.stp-tree__svg {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* 连线 */
.stp-line {
  stroke: var(--ds-border, #444);
  stroke-width: 2;
  transition: stroke 0.2s ease;
}

.stp-line--active {
  stroke: var(--ds-status-success, #4ade80);
  stroke-width: 2;
}

/* ==========================================================================
   技能节点
   A3: var(--ds-*) colors, A6: ≤ 15 props per selector
========================================================================== */
.stp-node {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
  border: 2px solid var(--node-color, var(--ds-border, #444));
  border-radius: var(--ds-radius-lg, 8px);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--node-color, var(--ds-border)) 10%, transparent),
    color-mix(in srgb, var(--node-color, var(--ds-border)) 25%, transparent)
  );
  transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
}

.stp-node:hover:not(.stp-node--locked) {
  transform: scale(1.06);
  box-shadow: 0 0 12px var(--node-color, var(--ds-border));
}

.stp-node--selected {
  border-color: var(--ds-status-success, #4ade80) !important;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--ds-status-success, #4ade80) 15%, transparent),
    color-mix(in srgb, var(--ds-status-success, #4ade80) 30%, transparent)
  );
  box-shadow: 0 0 8px var(--ds-status-success, #4ade80);
}

.stp-node--locked {
  opacity: 0.35;
  cursor: not-allowed;
}

.stp-node--locked:hover {
  transform: none;
  box-shadow: none;
}

.stp-node__icon {
  font-size: var(--ds-typography-fontSize-lg, 16px);
  line-height: 1;
  margin-bottom: var(--ds-spacing-xs, 4px);
}

.stp-node__name {
  font-size: var(--ds-typography-fontSize-xs, 10px);
  font-weight: var(--ds-typography-fontWeight-medium, 500);
  text-align: center;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 var(--ds-spacing-xs, 4px);
  color: var(--ds-text-primary, #eee);
}

/* ==========================================================================
   属性加成面板
========================================================================== */
.stp-attrs {
  padding: var(--ds-spacing-sm, 8px) var(--ds-spacing-md, 16px);
  border-top: 1px solid var(--ds-border, #333);
  background: var(--ds-bg-tertiary, #252540);
  max-height: 80px;
  overflow-y: auto;
  flex-shrink: 0;
}

.stp-attrs__empty {
  text-align: center;
  padding: var(--ds-spacing-xs, 4px) 0;
  color: var(--ds-text-muted, #666);
  font-size: var(--ds-typography-fontSize-xs, 10px);
}

.stp-attrs__list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-spacing-xs, 8px);
}

.stp-attr {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-xs, 4px);
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-sm, 8px);
  background: var(--ds-bg-secondary, #1a1a2e);
  border-radius: var(--ds-radius-md, 4px);
  font-size: var(--ds-typography-fontSize-xs, 10px);
}

.stp-attr__name {
  color: var(--ds-text-muted, #666);
}

.stp-attr__value {
  color: var(--ds-status-success, #4ade80);
  font-weight: var(--ds-typography-fontWeight-bold, 700);
}

/* ==========================================================================
   底部 — 重置按钮
   A5: CTA 在末端
========================================================================== */
.stp-footer {
  display: flex;
  justify-content: flex-end;
  padding: var(--ds-spacing-sm, 8px) var(--ds-spacing-md, 16px);
  border-top: 1px solid var(--ds-border, #333);
  background: var(--ds-bg-tertiary, #252540);
  flex-shrink: 0;
}

.stp-reset-btn {
  padding: var(--ds-spacing-xs, 4px) var(--ds-spacing-md, 16px);
  background: var(--ds-bg-secondary, #1a1a2e);
  color: var(--ds-text-secondary, #aaa);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-md, 4px);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.stp-reset-btn:hover {
  border-color: var(--ds-status-danger, #f87171);
  color: var(--ds-status-danger, #f87171);
}

/* ==========================================================================
   Tooltip
========================================================================== */
.stp-tooltip {
  position: fixed;
  background: var(--ds-bg-tertiary, #252540);
  border: 1px solid var(--ds-border, #333);
  border-radius: var(--ds-radius-lg, 8px);
  padding: var(--ds-spacing-sm, 8px) var(--ds-spacing-md, 12px);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  color: var(--ds-text-primary, #eee);
  z-index: 10000;
  max-width: 220px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}

.stp-tooltip__title {
  font-weight: var(--ds-typography-fontWeight-bold, 700);
  margin-bottom: var(--ds-spacing-xs, 4px);
}

.stp-tooltip__desc {
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-text-muted, #666);
  margin-bottom: var(--ds-spacing-xs, 4px);
  line-height: 1.5;
}

.stp-tooltip__attrs {
  font-size: var(--ds-typography-fontSize-xs, 10px);
  color: var(--ds-status-success, #4ade80);
}

/* ==========================================================================
   滚动条
========================================================================== */
.stp-tree::-webkit-scrollbar,
.stp-attrs::-webkit-scrollbar {
  width: 6px;
}

.stp-tree::-webkit-scrollbar-track,
.stp-attrs::-webkit-scrollbar-track {
  background: var(--ds-bg-base, #111);
}

.stp-tree::-webkit-scrollbar-thumb,
.stp-attrs::-webkit-scrollbar-thumb {
  background: var(--ds-border, #333);
  border-radius: 3px;
}

.stp-tree::-webkit-scrollbar-thumb:hover,
.stp-attrs::-webkit-scrollbar-thumb:hover {
  background: var(--ds-color-primary, #00d4ff);
}
</style>
