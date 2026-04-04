import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Zone, ZoneCreateRequest, ZoneUpdateRequest, ZoneFile, ZoneTask, ZoneMessage } from '@/stratix-project/types';
import { ApiClient } from '@/stratix-gateway/api/client';
import { API_PATHS, isApiError } from '@/stratix-gateway/api/types/api';

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

  // Computed
  const selectedZone = computed(() =>
    selectedZoneId.value ? zones.value.find(z => z.id === selectedZoneId.value) ?? null : null
  );

  const activeZones = computed(() =>
    zones.value.filter(z => z.status === 'active' || z.status === 'busy')
  );

  const zoneCount = computed(() => zones.value.length);

  // Load all zones
  async function loadZones(projectId?: string): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const path = projectId
        ? `${API_PATHS.ZONES}?projectId=${projectId}`
        : API_PATHS.ZONES;

      const result = await client.get<{ zones: Zone[] }>(path, { timeout: 10000 });

      if (result.success) {
        zones.value = result.data.zones || [];
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
    const result = await client.get<{ zone: Zone }>(API_PATHS.ZONE_BY_ID(zoneId), { timeout: 5000 });

    if (!result.success) {
      console.warn(`[ZoneStore] Failed to fetch zone ${zoneId}:`, result.error);
      return null;
    }
    return result.data.zone || null;
  }

  // Create zone
  async function createZone(request: ZoneCreateRequest): Promise<Zone | null> {
    const result = await client.post<{ zone: Zone }>(API_PATHS.ZONES, request);

    if (isApiError(result)) {
      console.warn('[ZoneStore] Failed to create zone:', result.error);
      return null;
    }
    if (result.data.zone) {
      zones.value.push(result.data.zone);
      return result.data.zone;
    }
    return null;
  }

  // Update zone
  async function updateZone(zoneId: string, request: ZoneUpdateRequest): Promise<boolean> {
    const result = await client.put<{ zone: Zone }>(API_PATHS.ZONE_BY_ID(zoneId), request);

    if (isApiError(result)) {
      console.warn('[ZoneStore] Failed to update zone:', result.error);
      return false;
    }
    if (result.data.zone) {
      const index = zones.value.findIndex(z => z.id === zoneId);
      if (index >= 0) {
        zones.value[index] = result.data.zone;
      }
      return true;
    }
    return false;
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
    const result = await client.post<{ file: ZoneFile }>(API_PATHS.ZONE_FILES(zoneId), file);

    if (isApiError(result)) {
      console.warn('[ZoneStore] Failed to add file:', result.error);
      return null;
    }
    if (result.data.file) {
      const zone = zones.value.find(z => z.id === zoneId);
      if (zone) {
        zone.files.push(result.data.file);
      }
      return result.data.file;
    }
    return null;
  }

  // Remove file from zone
  async function removeFile(zoneId: string, fileId: string): Promise<boolean> {
    const result = await client.delete<{ message: string }>(API_PATHS.ZONE_FILE_BY_ID(zoneId, fileId));

    if (isApiError(result)) {
      console.warn('[ZoneStore] Failed to remove file:', result.error);
      return false;
    }
    const zone = zones.value.find(z => z.id === zoneId);
    if (zone) {
      zone.files = zone.files.filter(f => f.id !== fileId);
    }
    return true;
  }

  // Add task to zone
  async function addTask(zoneId: string, title: string): Promise<ZoneTask | null> {
    const result = await client.post<{ task: ZoneTask }>(API_PATHS.ZONE_TASKS(zoneId), { title });

    if (isApiError(result)) {
      console.warn('[ZoneStore] Failed to add task:', result.error);
      return null;
    }
    if (result.data.task) {
      const zone = zones.value.find(z => z.id === zoneId);
      if (zone && zone.tasks) {
        zone.tasks.push(result.data.task);
      }
      return result.data.task;
    }
    return null;
  }

  // Update task
  async function updateTask(zoneId: string, taskId: string, updates: Partial<ZoneTask>): Promise<boolean> {
    const result = await client.put<{ task: ZoneTask }>(API_PATHS.ZONE_TASK(zoneId, taskId), updates);

    if (isApiError(result)) {
      console.warn('[ZoneStore] Failed to update task:', result.error);
      return false;
    }
    if (result.data.task) {
      const zone = zones.value.find(z => z.id === zoneId);
      if (zone && zone.tasks) {
        const taskIndex = zone.tasks.findIndex(t => t.id === taskId);
        if (taskIndex >= 0) {
          zone.tasks[taskIndex] = result.data.task;
        }
      }
      return true;
    }
    return false;
  }

  // Add message to zone
  async function addMessage(zoneId: string, content: string, senderId: string, senderType: 'user' | 'agent'): Promise<ZoneMessage | null> {
    const result = await client.post<{ message: ZoneMessage }>(API_PATHS.ZONE_MESSAGES(zoneId), {
      content,
      senderId,
      senderType
    });

    if (isApiError(result)) {
      console.warn('[ZoneStore] Failed to add message:', result.error);
      return null;
    }
    if (result.data.message) {
      const zone = zones.value.find(z => z.id === zoneId);
      if (zone && zone.messages) {
        zone.messages.push(result.data.message);
      }
      return result.data.message;
    }
    return null;
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
    clear
  };
});
