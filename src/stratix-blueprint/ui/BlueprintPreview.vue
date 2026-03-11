<template>
  <div class="blueprint-preview">
    <div class="preview-header">
      <h3>任务区预览</h3>
      <div class="preview-actions">
        <button @click="handleZoomIn" class="btn-icon" title="放大">
          🔍+
        </button>
        <button @click="handleZoomOut" class="btn-icon" title="缩小">
          🔍-
        </button>
        <button @click="handleResetView" class="btn-icon" title="重置视图">
          🔄
        </button>
      </div>
    </div>

    <div class="preview-canvas" ref="canvasContainer">
      <div v-if="loading" class="loading-overlay">
        <div class="loading-spinner"></div>
        <p>正在生成蓝图...</p>
      </div>
    </div>

    <div class="preview-sidebar" v-if="selectedNode">
      <div class="sidebar-header">
        <h4>任务详情</h4>
        <button @click="selectedNode = null" class="btn-close">×</button>
      </div>
      <div class="sidebar-body">
        <div class="form-group">
          <label>任务名称</label>
          <input v-model="selectedNode.name" type="text" @change="handleNodeUpdate" />
        </div>
        <div class="form-group">
          <label>任务类型</label>
          <div class="task-type-badge" :class="`type-${selectedNode.type}`">
            {{ getTaskTypeName(selectedNode.type) }}
          </div>
        </div>
        <div class="form-group">
          <label>描述</label>
          <textarea v-model="selectedNode.description" @change="handleNodeUpdate"></textarea>
        </div>
        <div class="form-group">
          <label>优先级</label>
          <select v-model="selectedNode.priority" @change="handleNodeUpdate">
            <option :value="1">P1 (最高)</option>
            <option :value="2">P2 (高)</option>
            <option :value="3">P3 (中)</option>
            <option :value="4">P4 (低)</option>
            <option :value="5">P5 (最低)</option>
          </select>
        </div>
      </div>
    </div>

    <div class="preview-footer">
      <div class="footer-left">
        <span class="task-count">{{ taskCount }} 个任务</span>
      </div>
      <div class="footer-right">
        <button @click="handleCancel" class="btn-secondary">取消</button>
        <button @click="handleConfirm" class="btn-primary">确认蓝图</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import Phaser from 'phaser';
import { BlueprintCanvas, BlueprintNode } from '@/stratix-blueprint';
import { ParsedTask } from '@/stratix-ai-service/types';

interface Props {
  tasks: ParsedTask[];
  projectId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  confirm: [tasks: ParsedTask[]];
  cancel: [];
}>();

const canvasContainer = ref<HTMLDivElement>();
const loading = ref(true);
const selectedNode = ref<BlueprintNode | null>(null);
const taskCount = ref(0);

let game: Phaser.Game | null = null;
let blueprintCanvas: BlueprintCanvas | null = null;

onMounted(() => {
  initializeGame();
});

onUnmounted(() => {
  if (game) {
    game.destroy(true);
  }
});

function initializeGame() {
  if (!canvasContainer.value) return;

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: canvasContainer.value,
    width: canvasContainer.value.clientWidth,
    height: canvasContainer.value.clientHeight,
    backgroundColor: 'var(--ds-bg-secondary)',
    scene: BlueprintCanvas,
  };

  game = new Phaser.Game(config);

  game.events.on('ready', () => {
    blueprintCanvas = game!.scene.getScene('BlueprintCanvas') as BlueprintCanvas;
    
    if (blueprintCanvas) {
      blueprintCanvas.setOnNodeSelected((node) => {
        selectedNode.value = { ...node };
      });

      loadBlueprint();
    }
  });

  window.addEventListener('resize', handleResize);
}

function loadBlueprint() {
  if (!blueprintCanvas) return;

  loading.value = true;
  
  setTimeout(() => {
    blueprintCanvas!.loadBlueprint(props.tasks, props.projectId);
    taskCount.value = props.tasks.length;
    loading.value = false;
  }, 100);
}

function handleNodeUpdate() {
  if (!blueprintCanvas || !selectedNode.value) return;
  
  const node = blueprintCanvas.getBlueprint()?.nodes.find(n => n.id === selectedNode.value!.id);
  if (node) {
    Object.assign(node, selectedNode.value);
  }
}

function handleZoomIn() {
  if (!game) return;
  const camera = game.cameras.main;
  camera.setZoom(Math.min(camera.zoom + 0.2, 2));
}

function handleZoomOut() {
  if (!game) return;
  const camera = game.cameras.main;
  camera.setZoom(Math.max(camera.zoom - 0.2, 0.5));
}

function handleResetView() {
  if (!game) return;
  const camera = game.cameras.main;
  camera.setZoom(1);
  if (blueprintCanvas) {
    const bounds = blueprintCanvas.getBlueprint()?.nodes;
    if (bounds && bounds.length > 0) {
      const centerX = bounds.reduce((sum, n) => sum + n.x, 0) / bounds.length;
      const centerY = bounds.reduce((sum, n) => sum + n.y, 0) / bounds.length;
      camera.centerOn(centerX, centerY);
    }
  }
}

function handleResize() {
  if (!game || !canvasContainer.value) return;
  game.scale.resize(
    canvasContainer.value.clientWidth,
    canvasContainer.value.clientHeight
  );
}

function handleConfirm() {
  if (!blueprintCanvas) return;
  
  const blueprint = blueprintCanvas.getBlueprint();
  if (blueprint) {
    const tasks: ParsedTask[] = blueprint.nodes.map(node => ({
      id: node.id,
      name: node.name,
      type: node.type,
      description: node.description,
      estimatedTime: 60,
      dependencies: node.dependencies,
      priority: node.priority,
    }));
    
    emit('confirm', tasks);
  }
}

function handleCancel() {
  emit('cancel');
}

function getTaskTypeName(type: string): string {
  const names: Record<string, string> = {
    requirement: '需求分析',
    design: '设计',
    development: '开发',
    test: '测试',
    deploy: '部署',
    writing: '写作',
    research: '研究',
    custom: '自定义',
  };
  return names[type] || '未知';
}
</script>

<style scoped>
.blueprint-preview {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--ds-bg-primary);
  display: flex;
  flex-direction: column;
  z-index: 2000;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: var(--ds-bg-secondary);
  border-bottom: 1px solid var(--ds-border);
}

.preview-header h3 {
  margin: 0;
  color: var(--ds-text-primary);
  font-size: 18px;
}

.preview-actions {
  display: flex;
  gap: 8px;
}

.btn-icon {
  width: 32px;
  height: 32px;
  border: 1px solid var(--ds-border);
  background: var(--ds-bg-secondary);
  color: var(--ds-text-primary);
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
}

.btn-icon:hover {
  background: var(--ds-bg-tertiary);
  border-color: var(--ds-brand-primary);
}

.preview-canvas {
  flex: 1;
  position: relative;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--ds-bg-overlay);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--ds-text-primary);
}

.loading-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid var(--ds-border);
  border-top-color: var(--ds-brand-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.preview-sidebar {
  position: absolute;
  top: 60px;
  right: 20px;
  width: 300px;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  box-shadow: var(--ds-shadow-lg);
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ds-border);
}

.sidebar-header h4 {
  margin: 0;
  color: var(--ds-text-primary);
  font-size: 14px;
}

.btn-close {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--ds-text-muted);
  font-size: 24px;
  cursor: pointer;
}

.btn-close:hover {
  color: var(--ds-text-primary);
}

.sidebar-body {
  padding: 16px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  color: var(--ds-text-muted);
  font-size: 12px;
  text-transform: uppercase;
}

.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  padding: 8px 12px;
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-primary);
  font-size: 14px;
}

.form-group textarea {
  min-height: 80px;
  resize: vertical;
}

.task-type-badge {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
}

.type-requirement { background: #4A90E2; }
.type-design { background: #9B59B6; }
.type-development { background: #2ECC71; }
.type-test { background: #E67E22; }
.type-deploy { background: #E74C3C; }
.type-writing { background: #1ABC9C; }
.type-research { background: #F1C40F; color: #000; }
.type-custom { background: #95A5A6; }

.preview-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: var(--ds-bg-secondary);
  border-top: 1px solid var(--ds-border);
}

.footer-left {
  color: var(--ds-text-muted);
  font-size: 14px;
}

.footer-right {
  display: flex;
  gap: 12px;
}

.btn-secondary {
  padding: 8px 16px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  color: var(--ds-text-primary);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.btn-secondary:hover {
  background: var(--ds-bg-hover);
}

.btn-primary {
  padding: 8px 16px;
  background: var(--ds-brand-primary);
  border: none;
  color: var(--ds-text-inverse);
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: bold;
}

.btn-primary:hover {
  background: var(--ds-brand-secondary);
}
</style>
