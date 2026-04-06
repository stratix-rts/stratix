<template>
  <div class="agent-status-panel">
    <!-- Cycle Progress Bar -->
    <div class="cycle-progress-section">
      <h3 class="section-title">Cycle 流转</h3>
      <div class="cycle-progress-bar">
        <div
          v-for="(phase, index) in cyclePhases"
          :key="phase.key"
          class="phase-step"
          :class="{
            'is-completed': isPhaseCompleted(phase.key),
            'is-active': isPhaseActive(phase.key),
            'is-blocked': isPhaseBlocked(phase.key),
          }"
        >
          <div class="phase-connector" v-if="index > 0">
            <div class="connector-line" :class="{ 'line-completed': isPhaseCompleted(cyclePhases[index - 1].key) }"></div>
          </div>
          <div class="phase-node">
            <span class="phase-icon">{{ phase.icon }}</span>
            <span class="phase-label">{{ phase.label }}</span>
            <span class="phase-check" v-if="isPhaseCompleted(phase.key)">✓</span>
          </div>
        </div>
      </div>

      <!-- Blocked Warning -->
      <div v-if="currentPhase === 'blocked'" class="blocked-warning">
        <span class="warning-icon">⚠️</span>
        <span>高风险修改需要确认</span>
      </div>

      <!-- Last Cycle Info -->
      <div v-if="lastCycleInfo" class="last-cycle-info">
        <span class="cycle-time">最近一次: {{ lastCycleInfo.time }}</span>
        <span class="cycle-result" :class="`result-${lastCycleInfo.status}`">
          {{ lastCycleInfo.status }}
        </span>
      </div>
    </div>

    <!-- Agent Cards -->
    <div class="agents-grid">
      <div
        v-for="agent in agents"
        :key="agent.id"
        class="agent-card"
        :class="{ 'is-active': isAgentActive(agent.id) }"
      >
        <div class="agent-header">
          <span class="agent-icon">{{ agent.icon }}</span>
          <div class="agent-title">
            <span class="agent-name">{{ agent.name }}</span>
            <span class="agent-status" :class="`status-${agent.status}`">
              {{ agent.status }}
            </span>
          </div>
        </div>
        <p class="agent-description">{{ agent.description }}</p>
        <div class="agent-capabilities">
          <span
            v-for="cap in agent.capabilities"
            :key="cap"
            class="capability-tag"
          >
            {{ cap }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useSystemZoneStore } from '../../stores/systemzone';
import type { CyclePhase } from '../SystemZoneCycle';

const store = useSystemZoneStore();

// Agent definitions
const agents = [
  {
    id: 'sz-observer',
    name: 'Observer',
    icon: '👁️',
    description: '健康分析专家，深度分析项目代码、测试报告、用户输入，输出结构化洞察',
    capabilities: ['观察输入', 'LLM语义提取', '问题发现'],
    status: 'idle' as const,
  },
  {
    id: 'sz-strategist',
    name: 'Strategist',
    icon: '🧠',
    description: '代码改进策略师，基于洞察生成精确的代码修改方案，输出unified diff格式',
    capabilities: ['扫描项目', '生成modifications', '风险评估'],
    status: 'idle' as const,
  },
  {
    id: 'sz-guardian',
    name: 'Guardian',
    icon: '🛡️',
    description: '代码安全守门人，审查代码修改方案的安全性，宁可误拒不可漏放',
    capabilities: ['路径安全', '影响范围', '回滚风险'],
    status: 'idle' as const,
  },
  {
    id: 'sz-executor',
    name: 'Executor',
    icon: '⚡',
    description: '代码执行者，严格按修改方案在沙箱中应用diff，不做额外改动',
    capabilities: ['应用diff', '运行测试', '提交/回滚'],
    status: 'idle' as const,
  },
];

// Cycle phases for the progress bar
const cyclePhases = [
  { key: 'observing', label: 'Observer', icon: '👁️' },
  { key: 'strategizing', label: 'Strategist', icon: '🧠' },
  { key: 'reviewing', label: 'Guardian', icon: '🛡️' },
  { key: 'executing', label: 'Executor', icon: '⚡' },
  { key: 'evaluating', label: 'Fitness', icon: '📊' },
];

// Current phase from store or cycle state
const currentPhase = computed((): CyclePhase => {
  // Try to get from store.status first (status has observer, strategist, guardian)
  if (store.status) {
    // Map store status to phase if we have an active cycle
    if (store.status.observer?.status === 'running') return 'observing';
    if (store.status.strategist?.status === 'running') return 'strategizing';
  }
  return 'idle';
});

// Map store status to agent active state
function isAgentActive(agentId: string): boolean {
  if (!store.status) return false;
  switch (agentId) {
    case 'sz-observer':
      return store.status.observer?.status === 'running';
    case 'sz-strategist':
      return store.status.strategist?.status === 'running';
    case 'sz-guardian':
      return store.status.guardian === 'alert';
    case 'sz-executor':
      return false;
    default:
      return false;
  }
}

function isPhaseCompleted(phaseKey: string): boolean {
  const phaseOrder: CyclePhase[] = ['observing', 'strategizing', 'reviewing', 'executing', 'evaluating', 'completed'];
  const currentIndex = phaseOrder.indexOf(currentPhase.value);
  const phaseIndex = phaseOrder.indexOf(phaseKey as CyclePhase);
  return currentIndex > phaseIndex;
}

function isPhaseActive(phaseKey: string): boolean {
  return currentPhase.value === phaseKey;
}

function isPhaseBlocked(phaseKey: string): boolean {
  return currentPhase.value === 'blocked' && phaseKey === 'reviewing';
}

const lastCycleInfo = computed(() => {
  // TODO: Hook into actual cycle history from store or cycle instance
  // For now, return null - can be enhanced when cycle history is available
  return null;
});
</script>

<style scoped>
.agent-status-panel {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-lg, 24px);
}

/* Section Title */
.section-title {
  font-size: var(--ds-typography-fontSize-sm, 12px);
  font-weight: var(--ds-typography-fontWeight-semibold, 600);
  color: var(--ds-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 var(--ds-spacing-md, 16px) 0;
}

/* Cycle Progress Section */
.cycle-progress-section {
  background: var(--ds-color-surface);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-lg, 8px);
  padding: var(--ds-spacing-lg, 24px);
}

.cycle-progress-bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  position: relative;
  padding: var(--ds-spacing-md, 16px) 0;
}

.phase-step {
  display: flex;
  align-items: flex-start;
  position: relative;
  flex: 1;
}

.phase-connector {
  position: absolute;
  top: 18px;
  right: 50%;
  width: 100%;
  height: 2px;
  z-index: 0;
}

.connector-line {
  height: 100%;
  background: var(--ds-border-subtle);
  transition: background 0.3s;
}

.connector-line.line-completed {
  background: var(--ds-color-primary);
}

.phase-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ds-spacing-xs, 4px);
  position: relative;
  z-index: 1;
  background: var(--ds-color-surface);
  padding: 0 var(--ds-spacing-sm, 8px);
}

.phase-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-secondary);
  border: 2px solid var(--ds-border-default);
  border-radius: 50%;
  font-size: 16px;
  transition: all 0.3s;
}

.phase-label {
  font-size: var(--ds-typography-fontSize-xs, 11px);
  color: var(--ds-text-secondary);
  transition: color 0.3s;
}

.phase-check {
  position: absolute;
  top: -4px;
  right: 0;
  width: 16px;
  height: 16px;
  background: var(--ds-color-success);
  border-radius: 50%;
  color: white;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.phase-step.is-completed .phase-icon {
  background: var(--ds-color-primary);
  border-color: var(--ds-color-primary);
}

.phase-step.is-completed .phase-label {
  color: var(--ds-color-primary);
}

.phase-step.is-active .phase-icon {
  border-color: var(--ds-color-primary);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--ds-color-primary) 20%, transparent);
  animation: pulse 2s infinite;
}

.phase-step.is-blocked .phase-icon {
  border-color: var(--ds-color-danger);
  background: color-mix(in srgb, var(--ds-status-danger) 10%, transparent);
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--ds-color-primary) 20%, transparent); }
  50% { box-shadow: 0 0 0 8px color-mix(in srgb, var(--ds-color-primary) 10%, transparent); }
}

/* Blocked Warning */
.blocked-warning {
  display: flex;
  align-items: center;
  gap: var(--ds-spacing-sm, 8px);
  padding: var(--ds-spacing-md, 16px);
  background: color-mix(in srgb, var(--ds-status-danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--ds-status-danger) 30%, transparent);
  border-radius: var(--ds-radius-md, 6px);
  color: var(--ds-status-danger);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  font-weight: var(--ds-typography-fontWeight-medium, 500);
  margin-top: var(--ds-spacing-md, 16px);
}

.warning-icon {
  font-size: 16px;
}

/* Last Cycle Info */
.last-cycle-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--ds-spacing-md, 16px);
  padding-top: var(--ds-spacing-md, 16px);
  border-top: 1px solid var(--ds-border-subtle);
  font-size: var(--ds-typography-fontSize-sm, 12px);
  color: var(--ds-text-secondary);
}

.cycle-result {
  padding: 2px 8px;
  border-radius: var(--ds-radius-sm, 2px);
  font-weight: var(--ds-typography-fontWeight-medium, 500);
}

.cycle-result.result-completed {
  background: color-mix(in srgb, var(--ds-color-success) 15%, transparent);
  color: var(--ds-color-success);
}

.cycle-result.result-failed {
  background: color-mix(in srgb, var(--ds-status-danger) 15%, transparent);
  color: var(--ds-status-danger);
}

.cycle-result.result-blocked {
  background: color-mix(in srgb, var(--ds-status-warning) 15%, transparent);
  color: var(--ds-status-warning);
}

/* Agent Cards Grid */
.agents-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--ds-spacing-md, 16px);
}

.agent-card {
  background: var(--ds-color-surface);
  border: 1px solid var(--ds-border-subtle);
  border-radius: var(--ds-radius-lg, 8px);
  padding: var(--ds-spacing-lg, 24px);
  transition: all 0.2s;
}

.agent-card:hover {
  border-color: var(--ds-border-default);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--ds-shadow-color) 10%, transparent);
}

.agent-card.is-active {
  border-color: var(--ds-color-primary);
  background: color-mix(in srgb, var(--ds-color-primary) 5%, var(--ds-color-surface));
}

.agent-header {
  display: flex;
  align-items: flex-start;
  gap: var(--ds-spacing-md, 16px);
  margin-bottom: var(--ds-spacing-md, 16px);
}

.agent-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ds-bg-secondary);
  border-radius: var(--ds-radius-md, 6px);
  font-size: 20px;
  flex-shrink: 0;
}

.agent-title {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-xs, 4px);
}

.agent-name {
  font-size: var(--ds-typography-fontSize-base, 14px);
  font-weight: var(--ds-typography-fontWeight-semibold, 600);
  color: var(--ds-text-primary);
}

.agent-status {
  font-size: var(--ds-typography-fontSize-xs, 11px);
  padding: 2px 6px;
  border-radius: var(--ds-radius-sm, 2px);
  width: fit-content;
}

.agent-status.status-idle {
  background: var(--ds-bg-secondary);
  color: var(--ds-text-secondary);
}

.agent-status.status-active {
  background: color-mix(in srgb, var(--ds-color-primary) 15%, transparent);
  color: var(--ds-color-primary);
}

.agent-status.status-running {
  background: color-mix(in srgb, var(--ds-color-primary) 15%, transparent);
  color: var(--ds-color-primary);
}

.agent-card.is-active .agent-status {
  background: color-mix(in srgb, var(--ds-color-primary) 15%, transparent);
  color: var(--ds-color-primary);
}

.agent-description {
  font-size: var(--ds-typography-fontSize-sm, 12px);
  color: var(--ds-text-secondary);
  line-height: 1.5;
  margin: 0 0 var(--ds-spacing-md, 16px) 0;
}

.agent-capabilities {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ds-spacing-xs, 4px);
}

.capability-tag {
  font-size: var(--ds-typography-fontSize-xs, 11px);
  padding: 2px 8px;
  background: var(--ds-bg-secondary);
  border-radius: var(--ds-radius-full, 9999px);
  color: var(--ds-text-secondary);
}
</style>
