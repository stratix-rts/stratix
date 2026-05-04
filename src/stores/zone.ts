import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

import { ApiClient } from '@/stratix-gateway/api/client';
import { API_PATHS, isApiError } from '@/stratix-gateway/api/types/api';
import type { Zone, ZoneCreateRequest, ZoneUpdateRequest, ZoneFile, ZoneTask, ZoneMessage } from '@/stratix-project/types';
import { StratixEventBus } from '@/stratix-core';

// Create zone store API client with frontend base URL
const createZoneApiClient = () => new ApiClient({
  baseURL: typeof window !== 'undefined' && (window as unknown as { GATEWAY_URL?: string }).GATEWAY_URL
    ? (window as unknown as { GATEWAY_URL: string }).GATEWAY_URL
    : 'http://127.0.0.1:7524'
});

export const useZoneStore = defineStore('zone', () => {
  // State
  const zones = ref<Zone[]>([]);
  const selectedZoneId = ref<string | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // API client for zone operations
  const client = createZoneApiClient();

  // Event bus for real-time updates
  const eventBus = StratixEventBus.getInstance();

  // Track if event bus has been initialized (singleton)
  let eventBusInitialized = false;

  // Computed
  const selectedZone = computed(() =>
    selectedZoneId.value ? zones.value.find(z => z.id === selectedZoneId.value) ?? null : null
  );

  const activeZones = computed(() =>
    zones.value.filter(z => z.status === 'active' || z.status === 'busy')
  );

  const zoneCount = computed(() => zones.value.length);

  // ==================== WebSocket Event Handlers ====================

  interface ZoneEventPayload {
    zoneId?: string;
    file?: ZoneFile;
    fileId?: string;
    agentId?: string;
    [key: string]: unknown;
  }

  interface ZoneEvent {
    payload?: ZoneEventPayload;
  }

  function handleZoneCreated(event: ZoneEvent) {
    const { zoneId } = event.payload || {};
    if (!zoneId) return;
    // Fetch full zone data and add to store
    fetchZone(zoneId).then(zone => {
      if (zone && !zones.value.find(z => z.id === zoneId)) {
        zones.value.push(zone);
      }
    }).catch(e => {
      console.warn('[ZoneStore] Failed to fetch created zone:', e);
    });
  }

  function handleZoneUpdated(event: ZoneEvent) {
    const { zoneId, ...updates } = event.payload || {};
    if (!zoneId) return;
    const zone = zones.value.find(z => z.id === zoneId);
    if (zone) {
      Object.assign(zone, updates);
    }
  }

  function handleZoneDeleted(event: ZoneEvent) {
    const { zoneId } = event.payload || {};
    if (!zoneId) return;
    zones.value = zones.value.filter(z => z.id !== zoneId);
    if (selectedZoneId.value === zoneId) {
      selectedZoneId.value = null;
    }
  }

  function handleZoneFileAdded(event: ZoneEvent) {
    const { zoneId, file } = event.payload || {};
    if (!zoneId || !file) return;
    const zone = zones.value.find(z => z.id === zoneId);
    if (zone) {
      zone.files = zone.files || [];
      zone.files.push(file);
    }
  }

  function handleZoneFileRemoved(event: ZoneEvent) {
    const { zoneId, fileId } = event.payload || {};
    if (!zoneId || !fileId) return;
    const zone = zones.value.find(z => z.id === zoneId);
    if (zone) {
      zone.files = (zone.files || []).filter(f => f.id !== fileId);
    }
  }

  function handleZoneMemberJoined(event: ZoneEvent) {
    const { zoneId, agentId } = event.payload || {};
    if (!zoneId || !agentId) return;
    const zone = zones.value.find(z => z.id === zoneId);
    if (zone) {
      zone.members = zone.members || [];
      if (!zone.members.includes(agentId)) {
        zone.members.push(agentId);
      }
    }
  }

  function handleZoneMemberLeft(event: ZoneEvent) {
    const { zoneId, agentId } = event.payload || {};
    if (!zoneId || !agentId) return;
    const zone = zones.value.find(z => z.id === zoneId);
    if (zone) {
      zone.members = (zone.members || []).filter(m => m !== agentId);
    }
  }

  // ==================== Initialize WebSocket Subscriptions ====================

  // Store event handlers for cleanup
  const eventHandlers = {
    handleZoneCreated,
    handleZoneUpdated,
    handleZoneDeleted,
    handleZoneFileAdded,
    handleZoneFileRemoved,
    handleZoneMemberJoined,
    handleZoneMemberLeft,
  };

  function initializeEventBus(): void {
    if (typeof window === 'undefined') return;  // SSR guard
    if (eventBusInitialized) return;  // Already initialized

    eventBus.subscribe('stratix:zone_created', eventHandlers.handleZoneCreated);
    eventBus.subscribe('stratix:zone_updated', eventHandlers.handleZoneUpdated);
    eventBus.subscribe('stratix:zone_deleted', eventHandlers.handleZoneDeleted);
    eventBus.subscribe('stratix:zone_file_added', eventHandlers.handleZoneFileAdded);
    eventBus.subscribe('stratix:zone_file_removed', eventHandlers.handleZoneFileRemoved);
    eventBus.subscribe('stratix:zone_member_joined', eventHandlers.handleZoneMemberJoined);
    eventBus.subscribe('stratix:zone_member_left', eventHandlers.handleZoneMemberLeft);
    eventBusInitialized = true;
    console.log('[ZoneStore] Subscribed to zone events');
  }

  function cleanupEventBus(): void {
    eventBus.unsubscribe('stratix:zone_created', eventHandlers.handleZoneCreated);
    eventBus.unsubscribe('stratix:zone_updated', eventHandlers.handleZoneUpdated);
    eventBus.unsubscribe('stratix:zone_deleted', eventHandlers.handleZoneDeleted);
    eventBus.unsubscribe('stratix:zone_file_added', eventHandlers.handleZoneFileAdded);
    eventBus.unsubscribe('stratix:zone_file_removed', eventHandlers.handleZoneFileRemoved);
    eventBus.unsubscribe('stratix:zone_member_joined', eventHandlers.handleZoneMemberJoined);
    eventBus.unsubscribe('stratix:zone_member_left', eventHandlers.handleZoneMemberLeft);
    eventBusInitialized = false;
    console.log('[ZoneStore] Unsubscribed from zone events');
  }

  // Load all zones
  async function loadZones(projectId?: string): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const path = projectId
        ? `${API_PATHS.ZONES}?projectId=${projectId}`
        : API_PATHS.ZONES;

      const result = await client.get<Zone[]>(path, { timeout: 10000 });

      if (result.success) {
        zones.value = result.data || [];
      } else {
        error.value = result.error;
        console.warn('[ZoneStore] Failed to load zones:', result.error);
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载 Zone 失败';
      console.warn('[ZoneStore] Failed to load zones:', e);
    } finally {
      isLoading.value = false;
    }
  }

  // Get zone by ID
  async function fetchZone(zoneId: string): Promise<Zone | null> {
    try {
      const result = await client.get<Zone>(API_PATHS.ZONE_BY_ID(zoneId), { timeout: 5000 });

      if (!result.success) {
        console.warn(`[ZoneStore] Failed to fetch zone ${zoneId}:`, result.error);
        return null;
      }
      return result.data || null;
    } catch (e) {
      console.warn(`[ZoneStore] Failed to fetch zone ${zoneId}:`, e);
      return null;
    }
  }

  // Create zone
  async function createZone(request: ZoneCreateRequest): Promise<Zone | null> {
    try {
      const result = await client.post<Zone>(API_PATHS.ZONES, request);

      if (isApiError(result)) {
        console.warn('[ZoneStore] Failed to create zone:', result.error);
        return null;
      }
      if (result.data) {
        zones.value.push(result.data);
        return result.data;
      }
      return null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '创建 Zone 失败';
      console.warn('[ZoneStore] Failed to create zone:', e);
      return null;
    }
  }

  // Update zone
  async function updateZone(zoneId: string, request: ZoneUpdateRequest): Promise<boolean> {
    try {
      const result = await client.put<Zone>(API_PATHS.ZONE_BY_ID(zoneId), request);

      if (isApiError(result)) {
        console.warn('[ZoneStore] Failed to update zone:', result.error);
        return false;
      }
      if (result.data) {
        const index = zones.value.findIndex(z => z.id === zoneId);
        if (index >= 0) {
          zones.value[index] = result.data;
        }
        return true;
      }
      return false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新 Zone 失败';
      console.warn('[ZoneStore] Failed to update zone:', e);
      return false;
    }
  }

  // Delete zone
  async function deleteZone(zoneId: string): Promise<boolean> {
    let result;
    try {
      result = await client.delete<{ message: string }>(API_PATHS.ZONE_BY_ID(zoneId));
    } catch (e) {
      console.warn('[ZoneStore] Failed to delete zone:', e);
      return false;
    }

    if (isApiError(result)) {
      console.warn('[ZoneStore] Failed to delete zone:', result.error);
      return false;
    }
    zones.value = zones.value.filter(z => z.id !== zoneId);
    if (selectedZoneId.value === zoneId) {
      selectedZoneId.value = null;
    }
    return true;
  }

  // Select zone
  function selectZone(zoneId: string | null): void {
    selectedZoneId.value = zoneId;
  }

  // Add file to zone
  async function addFile(zoneId: string, file: Omit<ZoneFile, 'id' | 'zoneId' | 'createdAt' | 'updatedAt'>): Promise<ZoneFile | null> {
    try {
      const result = await client.post<ZoneFile>(API_PATHS.ZONE_FILES(zoneId), file);

      if (isApiError(result)) {
        console.warn('[ZoneStore] Failed to add file:', result.error);
        return null;
      }
      if (result.data) {
        const zone = zones.value.find(z => z.id === zoneId);
        if (zone) {
          zone.files = zone.files || [];
          zone.files.push(result.data);
        }
        return result.data;
      }
      return null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '添加文件失败';
      console.warn('[ZoneStore] Failed to add file:', e);
      return null;
    }
  }

  // Remove file from zone
  async function removeFile(zoneId: string, fileId: string): Promise<boolean> {
    try {
      const result = await client.delete<{ message: string }>(API_PATHS.ZONE_FILE_BY_ID(zoneId, fileId));

      if (isApiError(result)) {
        console.warn('[ZoneStore] Failed to remove file:', result.error);
        return false;
      }
      const zone = zones.value.find(z => z.id === zoneId);
      if (zone) {
        zone.files = (zone.files || []).filter(f => f.id !== fileId);
      }
      return true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '删除文件失败';
      console.warn('[ZoneStore] Failed to remove file:', e);
      return false;
    }
  }

  // Add task to zone
  async function addTask(zoneId: string, title: string): Promise<ZoneTask | null> {
    try {
      const result = await client.post<ZoneTask>(API_PATHS.ZONE_TASKS(zoneId), { title });

      if (isApiError(result)) {
        console.warn('[ZoneStore] Failed to add task:', result.error);
        return null;
      }
      if (result.data) {
        const zone = zones.value.find(z => z.id === zoneId);
        if (zone && zone.tasks) {
          zone.tasks.push(result.data);
        }
        return result.data;
      }
      return null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '添加任务失败';
      console.warn('[ZoneStore] Failed to add task:', e);
      return null;
    }
  }

  // Update task
  async function updateTask(zoneId: string, taskId: string, updates: Partial<ZoneTask>): Promise<boolean> {
    try {
      const result = await client.put<ZoneTask>(API_PATHS.ZONE_TASK(zoneId, taskId), updates);

      if (isApiError(result)) {
        console.warn('[ZoneStore] Failed to update task:', result.error);
        return false;
      }
      if (result.data) {
        const zone = zones.value.find(z => z.id === zoneId);
        if (zone && zone.tasks) {
          const taskIndex = zone.tasks.findIndex(t => t.id === taskId);
          if (taskIndex >= 0) {
            zone.tasks[taskIndex] = result.data;
          }
        }
        return true;
      }
      return false;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '更新任务失败';
      console.warn('[ZoneStore] Failed to update task:', e);
      return false;
    }
  }

  // Add message to zone
  async function addMessage(zoneId: string, content: string, senderId: string, senderType: 'user' | 'agent'): Promise<ZoneMessage | null> {
    try {
      const result = await client.post<ZoneMessage>(API_PATHS.ZONE_MESSAGES(zoneId), {
        content,
        senderId,
        senderType
      });

      if (isApiError(result)) {
        console.warn('[ZoneStore] Failed to add message:', result.error);
        return null;
      }
      if (result.data) {
        const zone = zones.value.find(z => z.id === zoneId);
        if (zone && zone.messages) {
          zone.messages.push(result.data);
        }
        return result.data;
      }
      return null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '添加消息失败';
      console.warn('[ZoneStore] Failed to add message:', e);
      return null;
    }
  }

  // Get zone by ID (local)
  function getZoneById(zoneId: string): Zone | undefined {
    return zones.value.find(z => z.id === zoneId);
  }

  // Clear all zones
  function clear(): void {
    zones.value = [];
    selectedZoneId.value = null;
    error.value = null;
  }

  return {
    // State
    zones,
    selectedZoneId,
    isLoading,
    error,

    // Computed
    selectedZone,
    activeZones,
    zoneCount,

    // Actions
    loadZones,
    fetchZone,
    createZone,
    updateZone,
    deleteZone,
    selectZone,
    addFile,
    removeFile,
    addTask,
    updateTask,
    addMessage,
    getZoneById,
    clear,

    // Event bus lifecycle
    initializeEventBus,
    cleanupEventBus
  };
});
