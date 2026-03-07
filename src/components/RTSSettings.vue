<template>
  <div class="rts-settings">
    <h3>RTS 渲染设置</h3>
    
    <div class="setting-item">
      <label>渲染模式：</label>
      <select v-model="renderMode" @change="handleRenderModeChange">
        <option value="auto">自动（推荐）</option>
        <option value="full">完整模式</option>
        <option value="thumbnail">缩略图模式</option>
      </select>
    </div>
    
    <div class="setting-item" v-if="renderMode === 'auto'">
      <label>密度阈值：{{ densityThreshold }}</label>
      <input 
        type="range" 
        v-model.number="densityThreshold" 
        min="10" 
        max="100"
        @input="handleDensityChange"
      />
      <span class="hint">视口中超过 {{ densityThreshold }} 个Agent时自动切换缩略图</span>
    </div>
    
    <div class="setting-item">
      <label>
        <input type="checkbox" v-model="showAgentNames" @change="handleShowNamesChange" />
        显示Agent名称
      </label>
    </div>
    
    <div class="setting-item">
      <label>
        <input type="checkbox" v-model="enableCollision" @change="handleCollisionChange" />
        启用碰撞检测
      </label>
    </div>
    
    <div class="setting-item">
      <label>碰撞半径：{{ collisionRadius }}px</label>
      <input 
        type="range" 
        v-model.number="collisionRadius" 
        min="10" 
        max="40"
        @input="handleCollisionRadiusChange"
      />
    </div>
    
    <div class="stats">
      <p>当前统计：</p>
      <ul>
        <li>Agent数量：{{ agentCount }}</li>
        <li>当前模式：{{ currentModeDisplay }}</li>
        <li>视口密度：{{ viewportDensity }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';

const renderMode = ref<'auto' | 'full' | 'thumbnail'>('auto');
const densityThreshold = ref(30);
const showAgentNames = ref(true);
const enableCollision = ref(true);
const collisionRadius = ref(20);

const agentCount = ref(0);
const currentMode = ref<'auto' | 'full' | 'thumbnail'>('auto');
const viewportDensity = ref(0);

const currentModeDisplay = computed(() => {
  const modeMap = {
    auto: '自动',
    full: '完整模式',
    thumbnail: '缩略图模式'
  };
  return modeMap[currentMode.value];
});

const handleRenderModeChange = () => {
  rtsEventBus.emit('settings:render_mode_changed', {
    mode: renderMode.value === 'auto' ? null : renderMode.value,
    threshold: densityThreshold.value,
    showNames: showAgentNames.value
  });
};

const handleDensityChange = () => {
  rtsEventBus.emit('settings:render_density_changed', {
    threshold: densityThreshold.value
  });
};

const handleShowNamesChange = () => {
  rtsEventBus.emit('settings:render_mode_changed', {
    mode: renderMode.value === 'auto' ? null : renderMode.value,
    threshold: densityThreshold.value,
    showNames: showAgentNames.value
  });
};

const handleCollisionChange = () => {
  rtsEventBus.emit('settings:collision_enabled_changed', {
    enabled: enableCollision.value
  });
};

const handleCollisionRadiusChange = () => {
  rtsEventBus.emit('settings:collision_radius_changed', {
    radius: collisionRadius.value
  });
};

const updateStats = () => {
  const gameScene = rtsEventBus.getScene('game') as any;
  if (gameScene) {
    const agents = gameScene.getAgentSprites();
    agentCount.value = agents?.size || 0;
    
    const renderSystem = gameScene.renderModeSystem;
    if (renderSystem) {
      currentMode.value = renderSystem.getCurrentMode();
    }
  }
};

let statsInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  statsInterval = setInterval(updateStats, 1000);
  updateStats();
});

onUnmounted(() => {
  if (statsInterval) {
    clearInterval(statsInterval);
  }
});
</script>

<style scoped>
.rts-settings {
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid #4a4a6a;
  border-radius: 8px;
  padding: 16px;
  color: #ffffff;
  font-size: 14px;
  min-width: 300px;
}

.rts-settings h3 {
  margin: 0 0 16px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid #4a4a6a;
  font-size: 16px;
}

.setting-item {
  margin-bottom: 12px;
}

.setting-item label {
  display: block;
  margin-bottom: 4px;
  color: #cccccc;
}

.setting-item select {
  width: 100%;
  padding: 6px 8px;
  background: #2a2a4a;
  border: 1px solid #4a4a6a;
  border-radius: 4px;
  color: #ffffff;
  font-size: 14px;
}

.setting-item input[type="range"] {
  width: 100%;
  margin-top: 4px;
}

.setting-item input[type="checkbox"] {
  margin-right: 8px;
}

.hint {
  display: block;
  font-size: 12px;
  color: #888888;
  margin-top: 4px;
}

.stats {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #4a4a6a;
}

.stats p {
  margin: 0 0 8px 0;
  font-weight: bold;
}

.stats ul {
  margin: 0;
  padding-left: 20px;
  list-style: disc;
}

.stats li {
  margin: 4px 0;
  font-size: 13px;
  color: #aaaaaa;
}
</style>
