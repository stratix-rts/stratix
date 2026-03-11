<template>
  <StratixModal
    :visible="visible"
    title="项目需求与AI规划"
    width="700px"
    :maskClosable="false"
    @close="handleClose"
    @cancel="handleClose"
  >
    <div class="requirement-panel">
      <!-- 步骤指示器 -->
      <div class="steps-indicator">
        <div class="step" :class="{ active: currentStep >= 1, completed: currentStep > 1 }">
          <div class="step-number">1</div>
          <div class="step-label">提交需求</div>
        </div>
        <div class="step-line" :class="{ active: currentStep > 1 }"></div>
        <div class="step" :class="{ active: currentStep >= 2, completed: currentStep > 2 }">
          <div class="step-number">2</div>
          <div class="step-label">AI规划</div>
        </div>
        <div class="step-line" :class="{ active: currentStep > 2 }"></div>
        <div class="step" :class="{ active: currentStep >= 3 }">
          <div class="step-number">3</div>
          <div class="step-label">预览确认</div>
        </div>
      </div>

      <!-- 步骤1: 提交需求 -->
      <div v-if="currentStep === 1" class="step-content">
        <StratixFormField label="需求描述" required>
          <StratixTextarea
            v-model="requirement"
            placeholder="请描述您的项目需求，例如：创建一个用户登录系统..."
            :rows="6"
            @blur="validateRequirement"
          />
          <div v-if="errors.requirement" class="error-message">{{ errors.requirement }}</div>
        </StratixFormField>

        <StratixFormField label="或上传文档">
          <div class="file-upload">
            <input
              type="file"
              ref="fileInput"
              @change="handleFileUpload"
              accept=".md,.txt"
              style="display: none"
            />
            <StratixButton @click="$refs.fileInput.click()">
              📁 选择文件
            </StratixButton>
            <span v-if="uploadedFileName" class="file-name">{{ uploadedFileName }}</span>
          </div>
        </StratixFormField>

        <StratixFormField label="拆分策略">
          <div class="strategy-options">
            <label class="strategy-option">
              <input type="radio" v-model="strategy" value="sequential" />
              <span class="option-label">
                <strong>按流程顺序</strong>
                <small>分析 → 设计 → 开发 → 测试 → 部署</small>
              </span>
            </label>
            <label class="strategy-option">
              <input type="radio" v-model="strategy" value="by_type" />
              <span class="option-label">
                <strong>按任务类型</strong>
                <small>前端、后端、测试等分类</small>
              </span>
            </label>
            <label class="strategy-option">
              <input type="radio" v-model="strategy" value="by_priority" />
              <span class="option-label">
                <strong>按优先级</strong>
                <small>P1核心 → P2重要 → P3优化</small>
              </span>
            </label>
          </div>
        </StratixFormField>
      </div>

      <!-- 步骤2: AI规划中 -->
      <div v-if="currentStep === 2" class="step-content">
        <div class="ai-processing">
          <div class="processing-animation">
            <div class="spinner"></div>
          </div>
          <h3>AI 正在规划您的项目...</h3>
          <div class="streaming-output" ref="streamingOutput">
            <pre>{{ streamingText }}</pre>
          </div>
          <div class="progress-info">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
            </div>
            <span class="progress-text">{{ progressText }}</span>
          </div>
        </div>
      </div>

      <!-- 步骤3: 预览蓝图 -->
      <div v-if="currentStep === 3" class="step-content">
        <div class="blueprint-summary">
          <div class="summary-item">
            <span class="label">任务总数:</span>
            <span class="value">{{ tasks.length }} 个</span>
          </div>
          <div class="summary-item">
            <span class="label">预计时长:</span>
            <span class="value">{{ totalEstimatedTime }} 小时</span>
          </div>
        </div>

        <div class="task-preview">
          <h4>任务列表预览</h4>
          <div class="task-list">
            <div v-for="task in tasks" :key="task.id" class="task-item">
              <div class="task-priority">P{{ task.priority }}</div>
              <div class="task-info">
                <div class="task-name">{{ task.name }}</div>
                <div class="task-type" :class="`type-${task.type}`">
                  {{ getTaskTypeName(task.type) }}
                </div>
              </div>
              <div class="task-time">{{ task.estimatedTime }}分钟</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <StratixButton v-if="currentStep > 1" @click="handlePrevious">上一步</StratixButton>
        <StratixButton @click="handleClose">取消</StratixButton>
        <StratixButton
          v-if="currentStep === 1"
          type="primary"
          @click="handleStartAI"
          :disabled="!canProceed"
        >
          开始AI规划
        </StratixButton>
        <StratixButton
          v-if="currentStep === 3"
          type="primary"
          @click="handleConfirm"
        >
          确认并创建任务区
        </StratixButton>
      </div>
    </template>
  </StratixModal>

  <!-- 蓝图预览 (全屏) -->
  <BlueprintPreview
    v-if="showBlueprintPreview"
    :tasks="tasks"
    :projectId="projectId"
    @confirm="handleBlueprintConfirm"
    @cancel="showBlueprintPreview = false"
  />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import StratixFormField from '@/components/ui/StratixFormField.vue';
import StratixTextarea from '@/components/ui/StratixTextarea.vue';
import BlueprintPreview from '@/stratix-blueprint/ui/BlueprintPreview.vue';
import { BlueprintIntegration } from '@/stratix-blueprint/BlueprintIntegration';
import { ParsedTask, SplitStrategy } from '@/stratix-ai-service/types';

interface Props {
  visible: boolean;
  projectId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  close: [];
  confirm: [tasks: ParsedTask[]];
}>();

const currentStep = ref(1);
const requirement = ref('');
const uploadedFileName = ref('');
const strategy = ref<SplitStrategy>('sequential');
const errors = ref({ requirement: '' });
const streamingText = ref('');
const progress = ref(0);
const progressText = ref('准备中...');
const tasks = ref<ParsedTask[]>([]);
const showBlueprintPreview = ref(false);

const integration = new BlueprintIntegration();

const canProceed = computed(() => {
  return requirement.value.trim() !== '';
});

const totalEstimatedTime = computed(() => {
  const total = tasks.value.reduce((sum, task) => sum + (task.estimatedTime || 0), 0);
  return Math.ceil(total / 60);
});

function validateRequirement() {
  if (!requirement.value || requirement.value.trim() === '') {
    errors.value.requirement = '需求描述不能为空';
    return false;
  }
  errors.value.requirement = '';
  return true;
}

function handleFileUpload(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  
  if (file) {
    uploadedFileName.value = file.name;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      requirement.value = e.target?.result as string;
    };
    reader.readAsText(file);
  }
}

async function handleStartAI() {
  if (!validateRequirement()) return;
  
  currentStep.value = 2;
  streamingText.value = '';
  progress.value = 0;
  
  try {
    const result = await integration.generateBlueprint(
      requirement.value,
      strategy.value,
      {
        onToken: (token) => {
          streamingText.value += token;
          progress.value = Math.min(progress.value + 1, 90);
          
          if (streamingText.value.includes('summary')) {
            progressText.value = '正在解析需求...';
          } else if (streamingText.value.includes('tasks')) {
            progressText.value = '正在拆分任务...';
          }
        },
        onComplete: () => {
          progress.value = 100;
          progressText.value = '规划完成！';
        },
        onError: (error) => {
          console.error('AI Error:', error);
          progressText.value = '发生错误，正在重试...';
        },
      }
    );
    
    if (result.success && result.tasks) {
      tasks.value = result.tasks;
      
      setTimeout(() => {
        currentStep.value = 3;
      }, 500);
    } else {
      throw new Error(result.error || 'AI规划失败');
    }
  } catch (error) {
    console.error('Blueprint generation failed:', error);
    alert('AI规划失败，请重试');
    currentStep.value = 1;
  }
}

function handlePrevious() {
  currentStep.value--;
}

function handleConfirm() {
  showBlueprintPreview.value = true;
}

function handleBlueprintConfirm(confirmedTasks: ParsedTask[]) {
  showBlueprintPreview.value = false;
  emit('confirm', confirmedTasks);
  handleClose();
}

function handleClose() {
  currentStep.value = 1;
  requirement.value = '';
  uploadedFileName.value = '';
  streamingText.value = '';
  progress.value = 0;
  tasks.value = [];
  emit('close');
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
.requirement-panel {
  min-height: 400px;
}

.steps-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 32px;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.step-number {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--ds-bg-tertiary);
  color: var(--ds-text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 16px;
  transition: all 0.3s;
}

.step.active .step-number {
  background: var(--ds-brand-primary);
  color: var(--ds-text-inverse);
}

.step.completed .step-number {
  background: var(--ds-status-success);
  color: var(--ds-text-inverse);
}

.step-label {
  font-size: 12px;
  color: var(--ds-text-muted);
}

.step.active .step-label {
  color: var(--ds-brand-primary);
}

.step-line {
  width: 60px;
  height: 2px;
  background: var(--ds-border);
  margin: 0 16px;
  margin-bottom: 24px;
}

.step-line.active {
  background: var(--ds-brand-primary);
}

.step-content {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.file-upload {
  display: flex;
  align-items: center;
  gap: 12px;
}

.file-name {
  color: var(--ds-brand-primary);
  font-size: 14px;
}

.strategy-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.strategy-option {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.strategy-option:hover {
  border-color: var(--ds-brand-primary);
  background: var(--ds-bg-secondary);
}

.strategy-option input[type="radio"] {
  margin-top: 2px;
}

.option-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.option-label strong {
  color: var(--ds-text-primary);
  font-size: 14px;
}

.option-label small {
  color: var(--ds-text-muted);
  font-size: 12px;
}

.ai-processing {
  text-align: center;
  padding: 40px 20px;
}

.processing-animation {
  margin-bottom: 24px;
}

.spinner {
  width: 64px;
  height: 64px;
  margin: 0 auto;
  border: 4px solid var(--ds-border);
  border-top-color: var(--ds-brand-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.ai-processing h3 {
  color: var(--ds-text-primary);
  font-size: 18px;
  margin-bottom: 24px;
}

.streaming-output {
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 24px;
  max-height: 200px;
  overflow-y: auto;
  text-align: left;
}

.streaming-output pre {
  margin: 0;
  color: var(--ds-text-muted);
  font-size: 12px;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.progress-info {
  max-width: 400px;
  margin: 0 auto;
}

.progress-bar {
  height: 8px;
  background: var(--ds-bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: var(--ds-brand-primary);
  transition: width 0.3s;
}

.progress-text {
  font-size: 14px;
  color: var(--ds-text-muted);
}

.blueprint-summary {
  display: flex;
  gap: 24px;
  margin-bottom: 24px;
}

.summary-item {
  display: flex;
  gap: 8px;
}

.summary-item .label {
  color: var(--ds-text-muted);
  font-size: 14px;
}

.summary-item .value {
  color: var(--ds-brand-primary);
  font-size: 14px;
  font-weight: bold;
}

.task-preview h4 {
  color: var(--ds-text-primary);
  font-size: 14px;
  margin-bottom: 12px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.task-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--ds-bg-primary);
  border: 1px solid var(--ds-border);
  border-radius: 6px;
}

.task-priority {
  padding: 4px 8px;
  background: var(--ds-bg-tertiary);
  border-radius: 4px;
  color: var(--ds-text-primary);
  font-size: 12px;
  font-weight: bold;
}

.task-info {
  flex: 1;
}

.task-name {
  color: var(--ds-text-primary);
  font-size: 14px;
  margin-bottom: 4px;
}

.task-type {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
  display: inline-block;
}

.type-requirement { background: #4A90E2; color: #fff; }
.type-design { background: #9B59B6; color: #fff; }
.type-development { background: #2ECC71; color: #fff; }
.type-test { background: #E67E22; color: #fff; }
.type-deploy { background: #E74C3C; color: #fff; }
.type-writing { background: #1ABC9C; color: #fff; }
.type-research { background: #F1C40F; color: #000; }
.type-custom { background: #95A5A6; color: #fff; }

.task-time {
  color: var(--ds-text-muted);
  font-size: 12px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.error-message {
  color: var(--ds-status-danger);
  font-size: 12px;
  margin-top: 4px;
}
</style>
