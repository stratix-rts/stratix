<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import type { SkillNode } from '@/stratix-character-creator/types';
import { SKILL_CATEGORIES, ATTRIBUTE_LABELS } from '@/stratix-character-creator/config/skillTreeConfig';

const props = defineProps<{
  skillTree: InstanceType<typeof import('@/stratix-character-creator/core/SkillTree').SkillTree>;
}>();

const emit = defineEmits<{
  'select-node': [nodeId: string];
  'deselect-node': [nodeId: string];
  reset: [];
}>();

// State
const tooltip = ref<{ node: SkillNode; x: number; y: number } | null>(null);

// Derived state from skillTree
const state = computed(() => props.skillTree.getState());
const allNodes = computed(() => props.skillTree.getAllNodes());
const remainingPoints = computed(() => props.skillTree.getRemainingPoints());
const maxPoints = computed(() => props.skillTree.getMaxPoints());
const attributes = computed(() => props.skillTree.calculateAttributes());

// Grid layout constants
const NODE_WIDTH = 80;
const NODE_HEIGHT = 60;
const SPACING = 100;
const OFFSET_X = 40;
const OFFSET_Y = 60;

// Get node position in grid
function getNodePosition(node: SkillNode) {
  return {
    x: node.position.x * SPACING + OFFSET_X,
    y: node.position.y * SPACING + OFFSET_Y
  };
}

// Check node states
function isNodeSelected(nodeId: string): boolean {
  return props.skillTree.isNodeSelected(nodeId);
}

function isNodeUnlocked(nodeId: string): boolean {
  return props.skillTree.isNodeUnlocked(nodeId);
}

// Get category config for a node
function getNodeCategory(node: SkillNode): keyof typeof SKILL_CATEGORIES {
  const attrs = Object.keys(node.attributes);
  if (attrs.some(a => a.includes('attack') || a.includes('damage'))) return 'combat';
  if (attrs.some(a => a.includes('defense') || a.includes('armor') || a.includes('block'))) return 'defense';
  if (attrs.some(a => a.includes('speed') || a.includes('dodge'))) return 'mobility';
  if (attrs.some(a => a.includes('mana') || a.includes('magic'))) return 'magic';
  return 'utility';
}

// Generate connection lines for SVG
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

      const fromPos = getNodePosition(prereq);
      const toPos = getNodePosition(node);

      lines.push({
        from: prereqId,
        to: node.nodeId,
        x1: fromPos.x + NODE_WIDTH / 2,
        y1: fromPos.y + NODE_HEIGHT / 2,
        x2: toPos.x + NODE_WIDTH / 2,
        y2: toPos.y + NODE_HEIGHT / 2,
        active: isNodeSelected(prereqId) && isNodeSelected(node.nodeId)
      });
    }
  }

  return lines;
});

// Calculate SVG viewBox dimensions
const svgDimensions = computed(() => {
  let maxX = 0;
  let maxY = 0;
  for (const node of allNodes.value) {
    const pos = getNodePosition(node);
    maxX = Math.max(maxX, pos.x + NODE_WIDTH);
    maxY = Math.max(maxY, pos.y + NODE_HEIGHT);
  }
  return { width: maxX + 40, height: maxY + 80 };
});

// Handle node click
function handleNodeClick(node: SkillNode) {
  if (!isNodeUnlocked(node.nodeId)) {
    return;
  }

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

// Handle reset
function handleReset() {
  props.skillTree.reset();
  emit('reset');
}

// Tooltip handlers
function showTooltip(node: SkillNode, event: MouseEvent) {
  tooltip.value = { node, x: event.clientX, y: event.clientY };
}

function hideTooltip() {
  tooltip.value = null;
}

// Attribute display helpers
function formatAttributeValue(attr: string, value: number): string {
  if (attr.includes('Chance') || attr.includes('Damage') || attr.includes('chance') || attr.includes('damage')) {
    return `${value}%`;
  }
  return `+${value}`;
}

const attributeEntries = computed(() => Object.entries(attributes.value));

// State change listener
let unsubscribe: (() => void) | null = null;

onMounted(() => {
  props.skillTree.setOnStateChange(() => {
    // Force reactivity update - Vue will handle re-render via computed
  });
});

onUnmounted(() => {
  if (unsubscribe) {
    unsubscribe();
  }
});
</script>

<template>
  <div class="skill-tree-panel">
    <!-- Header -->
    <div class="panel-header">
      <span class="panel-title">技能树</span>
      <div class="points-info">
        <span class="points-label">可用点数:</span>
        <span class="points-value">{{ remainingPoints }}</span>
        <span class="points-separator">/</span>
        <span class="points-max">{{ maxPoints }}</span>
      </div>
    </div>

    <!-- Tree Content -->
    <div class="tree-content">
      <svg
        class="connections"
        :viewBox="`0 0 ${svgDimensions.width} ${svgDimensions.height}`"
        preserveAspectRatio="xMidYMin meet"
      >
        <line
          v-for="line in connectionLines"
          :key="`${line.from}-${line.to}`"
          class="connection-line"
          :class="{ active: line.active }"
          :x1="line.x1"
          :y1="line.y1"
          :x2="line.x2"
          :y2="line.y2"
        />
      </svg>

      <div
        v-for="node in allNodes"
        :key="node.nodeId"
        class="skill-node"
        :class="{
          selected: isNodeSelected(node.nodeId),
          locked: !isNodeUnlocked(node.nodeId)
        }"
        :style="{
          left: `${getNodePosition(node).x}px`,
          top: `${getNodePosition(node).y}px`,
          width: `${NODE_WIDTH}px`,
          height: `${NODE_HEIGHT}px`,
          '--node-color': SKILL_CATEGORIES[getNodeCategory(node)]?.color ?? 'var(--ds-text-muted)'
        }"
        @click="handleNodeClick(node)"
        @mouseenter="showTooltip(node, $event)"
        @mouseleave="hideTooltip"
      >
        <div class="node-icon">
          {{ SKILL_CATEGORIES[getNodeCategory(node)]?.icon ?? '🔧' }}
        </div>
        <div class="node-name">{{ node.name }}</div>
      </div>
    </div>

    <!-- Attributes Panel -->
    <div class="attributes-panel">
      <div v-if="attributeEntries.length === 0" class="attributes-empty">
        选择技能节点以查看属性加成
      </div>
      <div v-else class="attributes-list">
        <div
          v-for="[attr, value] in attributeEntries"
          :key="attr"
          class="attr-item"
        >
          <span class="attr-name">{{ ATTRIBUTE_LABELS[attr] ?? attr }}</span>
          <span class="attr-value">{{ formatAttributeValue(attr, value) }}</span>
        </div>
      </div>
    </div>

    <!-- Reset Button -->
    <div class="panel-footer">
      <button class="reset-button" @click="handleReset">
        重置
      </button>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltip"
        class="skill-tooltip"
        :style="{
          left: `${tooltip.x + 10}px`,
          top: `${tooltip.y + 10}px`
        }"
      >
        <div class="tooltip-title">{{ tooltip.node.name }}</div>
        <div class="tooltip-desc">{{ tooltip.node.description }}</div>
        <div class="tooltip-attrs">
          {{ Object.entries(tooltip.node.attributes).map(([k, v]) => `${ATTRIBUTE_LABELS[k] ?? k}: +${v}`).join(' | ') }}
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.skill-tree-panel {
  display: flex;
  flex-direction: column;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  overflow: hidden;
  font-family: system-ui, sans-serif;
  color: var(--ds-text-primary);
  height: 100%;
  min-height: 400px;
}

.panel-header {
  padding: 10px 12px;
  background: var(--ds-bg-tertiary);
  border-bottom: 1px solid var(--ds-border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.panel-title {
  font-size: 14px;
  font-weight: bold;
}

.points-info {
  font-size: 12px;
  color: var(--ds-text-muted);
  display: flex;
  align-items: center;
  gap: 2px;
}

.points-value {
  color: var(--ds-status-success);
  font-weight: bold;
}

.points-separator {
  color: var(--ds-text-muted);
}

.points-max {
  color: var(--ds-text-muted);
}

.tree-content {
  flex: 1;
  position: relative;
  overflow: auto;
  padding: 20px;
  min-height: 200px;
}

.connections {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  min-width: 100%;
  min-height: 100%;
}

.connection-line {
  stroke: var(--ds-border);
  stroke-width: 2;
  transition: stroke 0.2s;
}

.connection-line.active {
  stroke: var(--ds-status-success);
}

.skill-node {
  position: absolute;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  user-select: none;
  background: linear-gradient(135deg, color-mix(in srgb, var(--node-color) 15%, transparent), color-mix(in srgb, var(--node-color) 30%, transparent));
  border: 2px solid var(--node-color);
}

.skill-node:hover:not(.locked) {
  transform: scale(1.05);
  box-shadow: 0 0 15px var(--node-color);
}

.skill-node.selected {
  box-shadow: 0 0 10px var(--ds-status-success);
  border-color: var(--ds-status-success) !important;
  background: linear-gradient(135deg, color-mix(in srgb, var(--ds-status-success) 20%, transparent), color-mix(in srgb, var(--ds-status-success) 35%, transparent));
}

.skill-node.locked {
  opacity: 0.4;
  cursor: not-allowed;
}

.skill-node.locked:hover {
  transform: none;
  box-shadow: none;
}

.node-icon {
  font-size: 16px;
  margin-bottom: 2px;
}

.node-name {
  font-size: 10px;
  text-align: center;
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
}

.attributes-panel {
  padding: 10px 12px;
  background: var(--ds-bg-tertiary);
  border-top: 1px solid var(--ds-border);
  max-height: 80px;
  overflow-y: auto;
}

.attributes-empty {
  color: var(--ds-text-muted);
  font-size: 12px;
  text-align: center;
  padding: 4px 0;
}

.attributes-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attr-item {
  padding: 4px 8px;
  background: var(--ds-bg-secondary);
  border-radius: 4px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.attr-name {
  color: var(--ds-text-muted);
}

.attr-value {
  color: var(--ds-status-success);
  font-weight: bold;
}

.panel-footer {
  padding: 8px 12px;
  background: var(--ds-bg-tertiary);
  border-top: 1px solid var(--ds-border);
  display: flex;
  justify-content: flex-end;
}

.reset-button {
  padding: 6px 16px;
  font-size: 12px;
  background: var(--ds-bg-secondary);
  color: var(--ds-text-primary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.reset-button:hover {
  background: var(--ds-bg-tertiary);
  border-color: var(--ds-status-danger);
  color: var(--ds-status-danger);
}

.skill-tooltip {
  position: fixed;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  padding: 10px;
  font-size: 12px;
  color: var(--ds-text-primary);
  z-index: 10000;
  max-width: 200px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

.tooltip-title {
  font-weight: bold;
  margin-bottom: 4px;
}

.tooltip-desc {
  font-size: 11px;
  color: var(--ds-text-muted);
  margin-bottom: 6px;
}

.tooltip-attrs {
  font-size: 10px;
  color: var(--ds-status-success);
}
</style>
