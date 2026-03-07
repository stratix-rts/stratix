<template>
  <div class="modal-test-page">
    <h1>Stratix Modal 组件测试</h1>
    
    <!-- 基础功能测试 -->
    <section class="test-section">
      <h2>基础功能</h2>
      <div class="button-group">
        <StratixButton @click="showBasic = true">基础弹窗</StratixButton>
        <StratixButton @click="showWithTitle = true">带标题</StratixButton>
        <StratixButton @click="showWithFooter = true">带底部按钮</StratixButton>
      </div>
    </section>
    
    <!-- 尺寸测试 -->
    <section class="test-section">
      <h2>尺寸系统</h2>
      <div class="button-group">
        <StratixButton @click="sizeModal = 'sm'">SM (400px)</StratixButton>
        <StratixButton @click="sizeModal = 'md'">MD (520px)</StratixButton>
        <StratixButton @click="sizeModal = 'lg'">LG (720px)</StratixButton>
        <StratixButton @click="sizeModal = 'xl'">XL (900px)</StratixButton>
        <StratixButton @click="sizeModal = 'fullscreen'">全屏</StratixButton>
      </div>
      <StratixModal v-model:visible="showSizeModal" :size="sizeModal" title="尺寸测试">
        <p>当前尺寸: {{ sizeModal }}</p>
        <p>图标应该自动适配尺寸</p>
        <StratixButton :size="sizeModal" icon="check">按钮图标测试</StratixButton>
      </StratixModal>
    </section>
    
    <!-- 位置测试 -->
    <section class="test-section">
      <h2>位置系统</h2>
      <div class="button-group">
        <StratixButton @click="positionModal = 'center'">居中</StratixButton>
        <StratixButton @click="positionModal = 'bottom'">底部</StratixButton>
        <StratixButton @click="positionModal = 'left'">左侧抽屉</StratixButton>
        <StratixButton @click="positionModal = 'right'">右侧抽屉</StratixButton>
      </div>
      <StratixModal v-model:visible="showPositionModal" :position="positionModal" title="位置测试">
        <p>当前位置: {{ positionModal }}</p>
        <p>观察动画效果</p>
      </StratixModal>
    </section>
    
    <!-- 层级测试 -->
    <section class="test-section">
      <h2>层级管理（重点测试）</h2>
      <div class="button-group">
        <StratixButton @click="openStack(1)">打开弹窗 1</StratixButton>
        <StratixButton @click="openStack(2)">打开弹窗 1+2</StratixButton>
        <StratixButton @click="openStack(3)">打开弹窗 1+2+3</StratixButton>
      </div>
      <p class="hint">后打开的弹窗应该覆盖前面的弹窗，z-index 依次递增</p>
      
      <StratixModal v-model:visible="stack1" title="弹窗 1 (z-index: 3001)">
        <p>这是第一个弹窗</p>
        <StratixButton size="sm" @click="stack2 = true">打开弹窗 2</StratixButton>
      </StratixModal>
      
      <StratixModal v-model:visible="stack2" title="弹窗 2 (z-index: 3002)">
        <p>这是第二个弹窗，应该覆盖弹窗 1</p>
        <StratixButton size="sm" @click="stack3 = true">打开弹窗 3</StratixButton>
      </StratixModal>
      
      <StratixModal v-model:visible="stack3" title="弹窗 3 (z-index: 3003)">
        <p>这是第三个弹窗，应该覆盖弹窗 1 和 2</p>
      </StratixModal>
    </section>
    
    <!-- 拖拽测试 -->
    <section class="test-section">
      <h2>拖拽功能</h2>
      <StratixButton @click="showDraggable = true">可拖拽弹窗</StratixButton>
      <StratixModal v-model:visible="showDraggable" title="拖拽测试" :draggable="true">
        <p>拖拽 Header 区域可以移动弹窗</p>
        <p>拖拽时会被限制在视口范围内</p>
      </StratixModal>
    </section>
    
    <!-- 命令式 API 测试 -->
    <section class="test-section">
      <h2>命令式调用</h2>
      <div class="button-group">
        <StratixButton @click="showInfo">Modal.info()</StratixButton>
        <StratixButton @click="showSuccess">Modal.success()</StratixButton>
        <StratixButton @click="showWarning">Modal.warning()</StratixButton>
        <StratixButton @click="showError">Modal.error()</StratixButton>
        <StratixButton @click="showConfirm">Modal.confirm()</StratixButton>
      </div>
    </section>
    
    <!-- 图标尺寸继承测试 -->
    <section class="test-section">
      <h2>图标尺寸自动继承</h2>
      <div class="button-group">
        <StratixButton @click="iconSizeModal = 'sm'">SM 弹窗 (14px icon)</StratixButton>
        <StratixButton @click="iconSizeModal = 'md'">MD 弹窗 (16px icon)</StratixButton>
        <StratixButton @click="iconSizeModal = 'lg'">LG 弹窗 (18px icon)</StratixButton>
      </div>
      
      <StratixModal v-model:visible="showIconSizeModal" :size="iconSizeModal" title="图标尺寸测试">
        <p>弹窗内的按钮图标应该自动适配弹窗尺寸</p>
        <div class="demo-buttons">
          <StratixButton :size="iconSizeModal" icon="check">确认</StratixButton>
          <StratixButton :size="iconSizeModal" variant="secondary" icon="x">取消</StratixButton>
          <StratixButton :size="iconSizeModal" variant="danger" icon="trash">删除</StratixButton>
        </div>
        
        <h4>其他组件图标测试</h4>
        <div class="demo-components">
          <StratixSelect :size="iconSizeModal" />
          <StratixCheckbox :size="iconSizeModal" label="复选框" />
        </div>
      </StratixModal>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { 
  StratixModal, 
  StratixButton, 
  StratixSelect,
  StratixCheckbox,
  Modal 
} from '@/components/ui';

// 基础
const showBasic = ref(false);
const showWithTitle = ref(false);
const showWithFooter = ref(false);

// 尺寸
const showSizeModal = ref(false);
const sizeModal = ref<'sm' | 'md' | 'lg' | 'xl' | 'fullscreen'>('md');

// 位置
const showPositionModal = ref(false);
const positionModal = ref<'center' | 'bottom' | 'left' | 'right'>('center');

// 层级
const stack1 = ref(false);
const stack2 = ref(false);
const stack3 = ref(false);

const openStack = (count: number) => {
  stack1.value = count >= 1;
  if (count >= 2) stack2.value = count >= 2;
  if (count >= 3) stack3.value = count >= 3;
}

// 拖拽
const showDraggable = ref(false);

// 图标尺寸
const showIconSizeModal = ref(false);
const iconSizeModal = ref<'sm' | 'md' | 'lg'>('md');

// 命令式
const showInfo = () => {
  Modal.info({ title: '信息提示', content: '这是一条信息提示' });
};

const showSuccess = () => {
  Modal.success({ title: '操作成功', content: '您的操作已成功完成' });
};

const showWarning = () => {
  Modal.warning({ title: '警告', content: '请注意这个操作可能存在的风险' });
};

const showError = () => {
  Modal.error({ title: '错误', content: '操作失败，请稍后重试' });
};

const showConfirm = () => {
  Modal.confirm({
    title: '确认操作',
    content: '确定要执行此操作吗？此操作不可撤销',
    onOk: async () => {
      await new Promise(resolve => setTimeout(500, 1000));
      console.log('确认操作');
    },
  });
});
</script>

<style scoped>
.modal-test-page {
  padding: 40px;
  max-width: 1200px;
  margin: 0 auto;
}

h1 {
  font-size: 32px;
  margin-bottom: 40px;
  color: #00d4ff;
}

.test-section {
  margin-bottom: 40px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.test-section h2 {
  font-size: 18px;
  margin-bottom: 16px;
  color: #fff;
}

.button-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.hint {
  margin-top: 12px;
  font-size: 13px;
  color: #6a6a8a;
}

.demo-buttons,
.demo-components {
  display: flex;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}
</style>
