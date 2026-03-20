import type { WorkflowDefinition, WorkflowPreset } from './types';
import { allPresets, getPresetById } from './presets';

const WORKFLOW_STORAGE_KEY = 'stratix_workflows';

export interface StoredWorkflow {
  id: string;
  name: string;
  description?: string;
  definition: WorkflowDefinition;
  createdAt: number;
  updatedAt: number;
  isPreset?: boolean;
}

class WorkflowStore {
  private workflows: Map<string, StoredWorkflow> = new Map();
  private loaded: boolean = false;

  async load(): Promise<void> {
    if (this.loaded) return;

    if (typeof window !== 'undefined' && (window as any).electronAPI?.workflow?.list) {
      try {
        const result = await (window as any).electronAPI.workflow.list();
        if (result.success && result.data) {
          for (const workflow of result.data) {
            this.workflows.set(workflow.id, workflow);
          }
        }
      } catch (error) {
        console.error('[WorkflowStore] Failed to load workflows:', error);
      }
    }

    for (const preset of allPresets) {
      if (!this.workflows.has(preset.id)) {
        this.workflows.set(preset.id, {
          id: preset.id,
          name: preset.name,
          description: preset.description,
          definition: preset.definition,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isPreset: true,
        });
      }
    }

    this.loaded = true;
  }

  getAll(): StoredWorkflow[] {
    return Array.from(this.workflows.values());
  }

  get(id: string): StoredWorkflow | undefined {
    return this.workflows.get(id);
  }

  getUserWorkflows(): StoredWorkflow[] {
    return this.getAll().filter((w) => !w.isPreset);
  }

  getPresets(): StoredWorkflow[] {
    return this.getAll().filter((w) => w.isPreset);
  }

  async save(workflow: StoredWorkflow): Promise<{ success: boolean; error?: string }> {
    const existing = this.workflows.get(workflow.id);
    const toSave: StoredWorkflow = {
      ...workflow,
      updatedAt: Date.now(),
      createdAt: existing?.createdAt ?? Date.now(),
    };

    this.workflows.set(toSave.id, toSave);

    if (typeof window !== 'undefined' && (window as any).electronAPI?.workflow?.save) {
      try {
        const result = await (window as any).electronAPI.workflow.save(toSave);
        if (!result.success) {
          return { success: false, error: result.error };
        }
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    return { success: true };
  }

  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    const workflow = this.workflows.get(id);
    if (workflow?.isPreset) {
      return { success: false, error: 'Cannot delete preset workflow' };
    }

    this.workflows.delete(id);

    if (typeof window !== 'undefined' && (window as any).electronAPI?.workflow?.delete) {
      try {
        const result = await (window as any).electronAPI.workflow.delete(id);
        if (!result.success) {
          return { success: false, error: result.error };
        }
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    return { success: true };
  }

  createFromPreset(presetId: string, newName?: string): StoredWorkflow {
    const preset = getPresetById(presetId);
    if (!preset) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    const id = `workflow_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const workflow: StoredWorkflow = {
      id,
      name: newName ?? `${preset.name} (副本)`,
      description: preset.description,
      definition: JSON.parse(JSON.stringify(preset.definition)),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isPreset: false,
    };

    return workflow;
  }
}

export const workflowStore = new WorkflowStore();
export { WorkflowStore };
