import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { Zone, ZoneCreateRequest, ZoneUpdateRequest, ZoneFile, ZoneTask, ZoneMessage } from '@/stratix-project/types';

interface ZoneState {
  zones: Zone[];
  selectedZoneId: string | null;
  isLoading: boolean;
  error: string | null;
}

export const useZoneStore = defineStore('zone', () => {
  // State
  const zones = ref<Zone[]>([]);
  const selectedZoneId = ref<string | null>(null);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Computed
  const selectedZone = computed(() =>
    selectedZoneId.value ? zones.value.find(z => z.id === selectedZoneId.value) ?? null : null
  );

  const activeZones = computed(() =>
    zones.value.filter(z => z.status === 'active' || z.status === 'busy')
  );

  const zoneCount = computed(() => zones.value.length);

  // API Base URL
  const getApiBase = () => process.env.GATEWAY_URL || 'http://127.0.0.1:7524';

  // Load all zones
  async function loadZones(projectId?: string): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const url = projectId
        ? `${getApiBase()}/api/zones?projectId=${projectId}`
        : `${getApiBase()}/api/zones`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`Failed to load zones: ${response.status}`);
      }

      const data = await response.json();
      if (data.success && Array.isArray(data.zones)) {
        zones.value = data.zones;
      } else if (Array.isArray(data)) {
        // Some APIs return array directly
        zones.value = data;
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
      const response = await fetch(`${getApiBase()}/api/zones/${zoneId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.success && data.zone ? data.zone : null;
    } catch (e) {
      console.warn(`[ZoneStore] Failed to fetch zone ${zoneId}:`, e);
      return null;
    }
  }

  // Create zone
  async function createZone(request: ZoneCreateRequest): Promise<Zone | null> {
    try {
      const response = await fetch(`${getApiBase()}/api/zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      const data = await response.json();
      if (data.success && data.zone) {
        zones.value.push(data.zone);
        return data.zone;
      }
      return null;
    } catch (e) {
      console.warn('[ZoneStore] Failed to create zone:', e);
      return null;
    }
  }

  // Update zone
  async function updateZone(zoneId: string, request: ZoneUpdateRequest): Promise<boolean> {
    try {
      const response = await fetch(`${getApiBase()}/api/zones/${zoneId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });

      const data = await response.json();
      if (data.success && data.zone) {
        const index = zones.value.findIndex(z => z.id === zoneId);
        if (index >= 0) {
          zones.value[index] = data.zone;
        }
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[ZoneStore] Failed to update zone:', e);
      return false;
    }
  }

  // Delete zone
  async function deleteZone(zoneId: string): Promise<boolean> {
    try {
      const response = await fetch(`${getApiBase()}/api/zones/${zoneId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();
      if (data.success) {
        zones.value = zones.value.filter(z => z.id !== zoneId);
        if (selectedZoneId.value === zoneId) {
          selectedZoneId.value = null;
        }
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[ZoneStore] Failed to delete zone:', e);
      return false;
    }
  }

  // Select zone
  function selectZone(zoneId: string | null): void {
    selectedZoneId.value = zoneId;
  }

  // Add file to zone
  async function addFile(zoneId: string, file: Omit<ZoneFile, 'id' | 'zoneId' | 'createdAt' | 'updatedAt'>): Promise<ZoneFile | null> {
    try {
      const response = await fetch(`${getApiBase()}/api/zones/${zoneId}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(file),
      });

      const data = await response.json();
      if (data.success && data.file) {
        const zone = zones.value.find(z => z.id === zoneId);
        if (zone) {
          zone.files.push(data.file);
        }
        return data.file;
      }
      return null;
    } catch (e) {
      console.warn('[ZoneStore] Failed to add file:', e);
      return null;
    }
  }

  // Remove file from zone
  async function removeFile(zoneId: string, fileId: string): Promise<boolean> {
    try {
      const response = await fetch(`${getApiBase()}/api/zones/${zoneId}/files/${fileId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();
      if (data.success) {
        const zone = zones.value.find(z => z.id === zoneId);
        if (zone) {
          zone.files = zone.files.filter(f => f.id !== fileId);
        }
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[ZoneStore] Failed to remove file:', e);
      return false;
    }
  }

  // Add task to zone
  async function addTask(zoneId: string, title: string): Promise<ZoneTask | null> {
    try {
      const response = await fetch(`${getApiBase()}/api/zones/${zoneId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });

      const data = await response.json();
      if (data.success && data.task) {
        const zone = zones.value.find(z => z.id === zoneId);
        if (zone && zone.tasks) {
          zone.tasks.push(data.task);
        }
        return data.task;
      }
      return null;
    } catch (e) {
      console.warn('[ZoneStore] Failed to add task:', e);
      return null;
    }
  }

  // Update task
  async function updateTask(zoneId: string, taskId: string, updates: Partial<ZoneTask>): Promise<boolean> {
    try {
      const response = await fetch(`${getApiBase()}/api/zones/${zoneId}/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data = await response.json();
      if (data.success && data.task) {
        const zone = zones.value.find(z => z.id === zoneId);
        if (zone && zone.tasks) {
          const taskIndex = zone.tasks.findIndex(t => t.id === taskId);
          if (taskIndex >= 0) {
            zone.tasks[taskIndex] = data.task;
          }
        }
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[ZoneStore] Failed to update task:', e);
      return false;
    }
  }

  // Add message to zone
  async function addMessage(zoneId: string, content: string, senderId: string, senderType: 'user' | 'agent'): Promise<ZoneMessage | null> {
    try {
      const response = await fetch(`${getApiBase()}/api/zones/${zoneId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, senderId, senderType }),
      });

      const data = await response.json();
      if (data.success && data.message) {
        const zone = zones.value.find(z => z.id === zoneId);
        if (zone && zone.messages) {
          zone.messages.push(data.message);
        }
        return data.message;
      }
      return null;
    } catch (e) {
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
    clear
  };
});
