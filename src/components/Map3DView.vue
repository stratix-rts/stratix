<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { Map3DView, type Map3DZone, type Map3DAgent } from '@/stratix-rts/ui/Map3DView';
import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';

const props = defineProps<{
  visible: boolean;
  gameScene?: any; // StratixRTSGameScene
}>();

const emit = defineEmits<{
  (e: 'zone-click', zoneId: string): void;
  (e: 'zone-double-click', zoneId: string): void;
  (e: 'agent-click', agentId: string): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
let map3dView: Map3DView | null = null;

const initMap3D = () => {
  if (!containerRef.value) return;

  map3dView = new Map3DView(containerRef.value, {
    onZoneClick: (zoneId) => emit('zone-click', zoneId),
    onZoneDoubleClick: (zoneId) => emit('zone-double-click', zoneId),
    onAgentClick: (agentId) => emit('agent-click', agentId),
  });

  if (!props.visible) {
    map3dView.hide();
  }
};

const updateData = () => {
  if (!map3dView || !props.gameScene) return;

  // Get zones from unifiedZoneManager
  const zones: Map3DZone[] = [];
  const taskZones = props.gameScene.getTaskZones?.();
  if (taskZones) {
    taskZones.forEach((zone: any, zoneId: string) => {
      const bounds = zone.getBounds?.();
      if (bounds) {
        zones.push({
          id: zoneId,
          name: zone.zoneName || zone.name || `Zone ${zoneId.substring(0, 6)}`,
          x: zone.x,
          y: zone.y,
          width: bounds.width,
          height: bounds.height,
          status: zone.getZoneStatus?.() || 'idle',
          agentCount: zone.getAssignedAgents?.() || 0,
        });
      }
    });
  }

  // Get agents
  const agents: Map3DAgent[] = [];
  const agentSprites = props.gameScene.getAgentSprites?.();
  if (agentSprites) {
    agentSprites.forEach((sprite: any, agentId: string) => {
      agents.push({
        id: agentId,
        name: sprite.getAgentName?.() || agentId,
        x: sprite.x,
        y: sprite.y,
        type: sprite.getAgentType?.() || 'dev',
        status: sprite.getCurrentStatus?.() || 'online',
        zoneId: sprite.getCurrentZone?.() || null,
      });
    });
  }

  map3dView.updateZones(zones);
  map3dView.updateAgents(agents);
};

const resetView = () => {
  map3dView?.resetView();
};

// Listen for zone updates from the game
let unsubscribeZoneMoved: (() => void) | null = null;
let unsubscribeZoneCreated: (() => void) | null = null;
let unsubscribeAgentMoved: (() => void) | null = null;

onMounted(() => {
  initMap3D();

  // Subscribe to game events for live updates
  unsubscribeZoneMoved = rtsEventBus.on('zone:moved' as any, () => updateData());
  unsubscribeZoneCreated = rtsEventBus.on('game:ui:project_created' as any, () => updateData());
  unsubscribeAgentMoved = rtsEventBus.on('scene:ui:update_selection' as any, () => updateData());

  // Initial data load after a short delay
  setTimeout(updateData, 500);
});

onUnmounted(() => {
  unsubscribeZoneMoved?.();
  unsubscribeZoneCreated?.();
  unsubscribeAgentMoved?.();
  map3dView?.destroy();
});

// Watch for visibility changes
watch(() => props.visible, (visible) => {
  if (visible) {
    map3dView?.show();
    updateData();
  } else {
    map3dView?.hide();
  }
});

// Watch for game scene changes
watch(() => props.gameScene, () => {
  if (props.visible) {
    updateData();
  }
});

defineExpose({
  resetView,
  updateData,
});
</script>

<template>
  <div
    v-show="visible"
    ref="containerRef"
    class="map3d-view-container"
  >
    <!-- Toggle controls -->
    <div class="map3d-controls">
      <button class="map3d-btn" @click="resetView" title="Reset View">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      </button>
    </div>

    <!-- Instructions overlay -->
    <div class="map3d-instructions">
      <span>Drag to rotate</span>
      <span>•</span>
      <span>Scroll to zoom</span>
    </div>
  </div>
</template>

<style scoped>
.map3d-view-container {
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: auto;
}

.map3d-controls {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  gap: 8px;
  z-index: 101;
}

.map3d-btn {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: rgba(30, 30, 50, 0.9);
  border: 1px solid rgba(100, 100, 200, 0.3);
  color: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);
}

.map3d-btn:hover {
  background: rgba(50, 50, 80, 0.95);
  border-color: rgba(100, 100, 200, 0.5);
  color: white;
}

.map3d-instructions {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 12px;
  padding: 8px 16px;
  background: rgba(20, 20, 40, 0.85);
  border: 1px solid rgba(100, 100, 200, 0.2);
  border-radius: 20px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(8px);
  z-index: 101;
}
</style>
