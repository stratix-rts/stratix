<script setup lang="ts">
/**
 * AgentPowerPanel.vue - Agent 战斗力评估可视化面板
 *
 * 功能：
 * 1. 环形图展示单个 Agent 战斗力 breakdown
 * 2. 雷达图展示多维度评分
 * 3. 排名列表展示多 Agent 对比
 * 4. 战斗力对比功能
 */

import { ref, computed, watch } from 'vue';
import { StratixModal, SvgIcon } from '@/components/ui';
import { CombatPowerCalculator, COMBAT_DIMENSIONS, CombatDimension, CombatPowerScore } from '@/stratix-rts/ui/CombatPowerCalculator';

interface Props {
  visible: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update:visible', value: boolean): void;
}>();

// 模拟 Agent 数据（实际使用时从 store 获取）
const agents = ref<Array<{
  agentId: string;
  name: string;
  attributes: Record<string, number>;
}>>([]);

// 当前选中的 Agent
const selectedAgentId = ref<string | null>(null);

// 战斗力计算结果缓存
const powerScores = computed(() => {
  const scores = new Map<string, CombatPowerScore>();
  for (const agent of agents.value) {
    scores.set(agent.agentId, CombatPowerCalculator.calculate(agent.attributes));
  }
  return scores;
});

// 排名列表
const rankedAgents = computed(() => {
  return agents.value
    .map((agent) => ({
      agentId: agent.agentId,
      name: agent.name,
      score: powerScores.value.get(agent.agentId)!,
    }))
    .sort((a, b) => b.score.overall - a.score.overall)
    .map((agent, index) => ({
      ...agent,
      rank: index + 1,
    }));
});

// 当前选中的 Agent 详情
const selectedAgent = computed(() => {
  if (!selectedAgentId.value) return null;
  return agents.value.find((a) => a.agentId === selectedAgentId.value) ?? null;
});

const selectedAgentScore = computed(() => {
  if (!selectedAgentId.value) return null;
  return powerScores.value.get(selectedAgentId.value) ?? null;
});

// 维度配置
const dimensionConfig: Record<CombatDimension, { label: string; color: string; icon: string }> = {
  Offense: { label: '攻击', color: '#ef4444', icon: 'sword' },
  Defense: { label: '防御', color: '#3b82f6', icon: 'shield' },
  Mobility: { label: '机动', color: '#22c55e', icon: 'zap' },
  Magic: { label: '魔法', color: '#a855f7', icon: 'sparkles' },
  Survivability: { label: '生存', color: '#f59e0b', icon: 'heart' },
  Utility: { label: '辅助', color: '#06b6d4', icon: 'tool' },
};

// 生成 SVG 环形图路径
function generateRingPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  const cos = Math.cos;
  const sin = Math.sin;

  const x1 = cx + innerRadius * cos(startAngle);
  const y1 = cy + innerRadius * sin(startAngle);
  const x2 = cx + outerRadius * cos(startAngle);
  const y2 = cy + outerRadius * sin(startAngle);
  const x3 = cx + outerRadius * cos(endAngle);
  const y3 = cy + outerRadius * sin(endAngle);
  const x4 = cx + innerRadius * cos(endAngle);
  const y4 = cy + innerRadius * sin(endAngle);

  return `M ${x1} ${y1} L ${x2} ${y2} A ${outerRadius} ${outerRadius} 0 0 1 ${x3} ${y3} L ${x4} ${y4} A ${innerRadius} ${innerRadius} 0 0 0 ${x1} ${y1} Z`;
}

// 计算环形图段
const ringSegments = computed(() => {
  if (!selectedAgentScore.value) return [];

  const score = selectedAgentScore.value;
  const total = score.breakdown.Offense + score.breakdown.Defense + score.breakdown.Mobility +
    score.breakdown.Magic + score.breakdown.Survivability + score.breakdown.Utility;

  if (total === 0) return [];

  let currentAngle = -Math.PI / 2; // 从顶部开始
  const gap = 0.03; // 间隙
  const segments: Array<{
    path: string;
    color: string;
    dimension: CombatDimension;
    percentage: number;
  }> = [];

  for (const dim of COMBAT_DIMENSIONS) {
    const value = score.breakdown[dim];
    const sweepAngle = (value / total) * Math.PI * 2;
    const actualSweep = Math.max(0, sweepAngle - gap);

    if (actualSweep > 0) {
      const startAngle = currentAngle + gap / 2;
      const endAngle = currentAngle + actualSweep;

      segments.push({
        path: generateRingPath(80, 80, 50, 70, startAngle, endAngle),
        color: dimensionConfig[dim].color,
        dimension: dim,
        percentage: Math.round((value / total) * 100),
      });

      currentAngle += sweepAngle;
    }
  }

  return segments;
});

// 处理关闭
const handleClose = () => {
  emit('update:visible', false);
};

// 选择 Agent
const selectAgent = (agentId: string) => {
  selectedAgentId.value = agentId;
};

// 获取等级信息
const getPowerLevel = (score: number) => CombatPowerCalculator.getPowerLevel(score);

// 初始化模拟数据
const initMockData = () => {
  agents.value = [
    {
      agentId: 'agent-001',
      name: 'Alpha Developer',
      attributes: { health: 80, attack: 15, defense: 12, speed: 7, mana: 30, critChance: 25, critDamage: 150, blockChance: 20, dodgeChance: 15, armor: 8, regen: 3, manaRegen: 5, magicDamage: 10 },
    },
    {
      agentId: 'agent-002',
      name: 'Beta Coder',
      attributes: { health: 60, attack: 12, defense: 8, speed: 9, mana: 40, critChance: 15, critDamage: 120, blockChance: 10, dodgeChance: 25, armor: 5, regen: 2, manaRegen: 7, magicDamage: 20 },
    },
    {
      agentId: 'agent-003',
      name: 'Gamma Mage',
      attributes: { health: 40, attack: 8, defense: 5, speed: 6, mana: 50, critChance: 10, critDamage: 100, blockChance: 5, dodgeChance: 10, armor: 3, regen: 1, manaRegen: 8, magicDamage: 30 },
    },
    {
      agentId: 'agent-004',
      name: 'Delta Tank',
      attributes: { health: 100, attack: 10, defense: 20, speed: 4, mana: 20, critChance: 5, critDamage: 80, blockChance: 35, dodgeChance: 5, armor: 15, regen: 5, manaRegen: 3, magicDamage: 5 },
    },
    {
      agentId: 'agent-005',
      name: 'Epsilon Scout',
      attributes: { health: 50, attack: 8, defense: 6, speed: 10, mana: 25, critChance: 20, critDamage: 130, blockChance: 8, dodgeChance: 35, armor: 4, regen: 2, manaRegen: 4, magicDamage: 8 },
    },
  ];

  // 默认选中第一个
  if (agents.value.length > 0) {
    selectedAgentId.value = agents.value[0].agentId;
  }
};

// 监听 visible 变化，初始化数据
watch(
  () => props.visible,
  (newVal) => {
    if (newVal && agents.value.length === 0) {
      initMockData();
    }
  },
  { immediate: true }
);
</script>

<template>
  <StratixModal
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    title="Agent 战斗力评估"
    size="lg"
    @close="handleClose"
  >
    <div class="power-panel">
      <!-- 左侧：单个 Agent 详情 -->
      <div class="agent-detail">
        <div class="section-header">
          <SvgIcon name="radar" :size="18" />
          <span>战力分析</span>
        </div>

        <!-- 环形图 -->
        <div class="ring-chart-container" v-if="selectedAgent">
          <svg viewBox="0 0 160 160" class="ring-chart">
            <!-- 背景环 -->
            <circle cx="80" cy="80" r="60" fill="none" stroke="#374151" stroke-width="20" opacity="0.3" />
            <!-- 数据环 -->
            <path
              v-for="segment in ringSegments"
              :key="segment.dimension"
              :d="segment.path"
              :fill="segment.color"
              opacity="0.85"
            />
            <!-- 中心分数 -->
            <text x="80" y="75" text-anchor="middle" class="center-score">
              {{ selectedAgentScore?.overall ?? 0 }}
            </text>
            <text x="80" y="92" text-anchor="middle" class="center-label">
              {{ getPowerLevel(selectedAgentScore?.overall ?? 0).level }}
            </text>
          </svg>
        </div>

        <!-- 维度详情 -->
        <div class="dimension-list" v-if="selectedAgentScore">
          <div
            v-for="dim in COMBAT_DIMENSIONS"
            :key="dim"
            class="dimension-item"
          >
            <div class="dimension-info">
              <span
                class="dimension-dot"
                :style="{ background: dimensionConfig[dim].color }"
              ></span>
              <span class="dimension-name">{{ dimensionConfig[dim].label }}</span>
            </div>
            <div class="dimension-bar-container">
              <div
                class="dimension-bar"
                :style="{
                  width: `${selectedAgentScore.breakdown[dim]}%',
                  background: dimensionConfig[dim].color,
                }"
              ></div>
            </div>
            <span class="dimension-value">{{ selectedAgentScore.breakdown[dim] }}</span>
          </div>
        </div>

        <!-- 无选中 Agent -->
        <div v-else class="empty-selection">
          <span>选择一个 Agent 查看详情</span>
        </div>
      </div>

      <!-- 右侧：排名列表 -->
      <div class="agent-ranking">
        <div class="section-header">
          <SvgIcon name="trophy" :size="18" />
          <span>战力排行</span>
        </div>

        <div class="ranking-list">
          <div
            v-for="agent in rankedAgents"
            :key="agent.agentId"
            class="ranking-item"
            :class="{ selected: agent.agentId === selectedAgentId }"
            @click="selectAgent(agent.agentId)"
          >
            <!-- 排名 -->
            <div class="rank-badge" :class="`rank-${agent.rank}`">
              <template v-if="agent.rank <= 3">
                <SvgIcon :name="agent.rank === 1 ? 'crown' : 'medal'" :size="14" />
              </template>
              <template v-else>
                {{ agent.rank }}
              </template>
            </div>

            <!-- Agent 信息 -->
            <div class="agent-info">
              <span class="agent-name">{{ agent.name }}</span>
              <span
                class="agent-level"
                :style="{ color: getPowerLevel(agent.score.overall).color }"
              >
                {{ getPowerLevel(agent.score.overall).level }}
              </span>
            </div>

            <!-- 分数 -->
            <div class="agent-score">
              <span
                class="score-value"
                :style="{ color: getPowerLevel(agent.score.overall).color }"
              >
                {{ agent.score.overall }}
              </span>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-if="rankedAgents.length === 0" class="empty-ranking">
            <SvgIcon name="users" :size="32" />
            <span>暂无 Agent 数据</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 图例 -->
    <div class="legend">
      <div
        v-for="dim in COMBAT_DIMENSIONS"
        :key="dim"
        class="legend-item"
      >
        <span class="legend-dot" :style="{ background: dimensionConfig[dim].color }"></span>
        <span class="legend-label">{{ dimensionConfig[dim].label }}</span>
      </div>
    </div>
  </StratixModal>
</template>

<style scoped>
.power-panel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  min-height: 400px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ds-text-primary);
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--ds-border);
}

.section-header svg {
  color: var(--ds-color-primary);
}

/* Agent 详情 */
.agent-detail {
  padding: 16px;
  background: var(--ds-bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--ds-border);
}

.ring-chart-container {
  display: flex;
  justify-content: center;
  margin-bottom: 20px;
}

.ring-chart {
  width: 160px;
  height: 160px;
}

.center-score {
  font-size: 28px;
  font-weight: 700;
  fill: var(--ds-text-primary);
}

.center-label {
  font-size: 12px;
  fill: var(--ds-text-muted);
}

.dimension-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dimension-item {
  display: grid;
  grid-template-columns: 70px 1fr 30px;
  align-items: center;
  gap: 8px;
}

.dimension-info {
  display: flex;
  align-items: center;
  gap: 6px;
}

.dimension-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.dimension-name {
  font-size: 12px;
  color: var(--ds-text-secondary);
}

.dimension-bar-container {
  height: 6px;
  background: var(--ds-bg-primary);
  border-radius: 3px;
  overflow: hidden;
}

.dimension-bar {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease;
}

.dimension-value {
  font-size: 12px;
  font-weight: 600;
  color: var(--ds-text-primary);
  text-align: right;
}

.empty-selection {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--ds-text-muted);
  font-size: 13px;
}

/* 排名列表 */
.agent-ranking {
  padding: 16px;
  background: var(--ds-bg-tertiary);
  border-radius: 8px;
  border: 1px solid var(--ds-border);
}

.ranking-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ranking-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--ds-bg-secondary);
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ranking-item:hover {
  border-color: var(--ds-border);
  background: var(--ds-bg-primary);
}

.ranking-item.selected {
  border-color: var(--ds-color-primary);
  background: var(--ds-bg-primary);
}

.rank-badge {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  background: var(--ds-bg-tertiary);
  color: var(--ds-text-secondary);
}

.rank-badge.rank-1 {
  background: linear-gradient(135deg, #ffd700, #ffb700);
  color: #1a1a1a;
}

.rank-badge.rank-2 {
  background: linear-gradient(135deg, #c0c0c0, #a8a8a8);
  color: #1a1a1a;
}

.rank-badge.rank-3 {
  background: linear-gradient(135deg, #cd7f32, #b8692a);
  color: #fff;
}

.rank-badge svg {
  color: inherit;
}

.agent-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--ds-text-primary);
}

.agent-level {
  font-size: 11px;
  font-weight: 500;
}

.agent-score {
  display: flex;
  align-items: center;
}

.score-value {
  font-size: 16px;
  font-weight: 700;
}

.empty-ranking {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px;
  color: var(--ds-text-muted);
}

.empty-ranking svg {
  opacity: 0.5;
}

/* 图例 */
.legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 16px;
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--ds-border);
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.legend-label {
  font-size: 12px;
  color: var(--ds-text-secondary);
}
</style>
