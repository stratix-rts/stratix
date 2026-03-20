import type { WorkflowDefinition } from '../workflow/types';
import { workflowStore } from '../workflow/store';
import { allPresets } from '../workflow/presets';

export function registerWorkflowHandlers(userDataPath: string, fs: any, path: any) {
  const workflowDir = path.join(userDataPath, 'workflows');

  const ensureDir = () => {
    if (!fs.existsSync(workflowDir)) {
      fs.mkdirSync(workflowDir, { recursive: true });
    }
  };

  const getWorkflowPath = (id: string) => path.join(workflowDir, `${id}.json`);

  return {
    'workflow:list': async () => {
      try {
        ensureDir();
        const files = fs.readdirSync(workflowDir);
        const workflows: Array<{ id: string; name: string; updatedAt: number }> = [];
        
        for (const file of files) {
          if (file.endsWith('.json')) {
            const content = fs.readFileSync(path.join(workflowDir, file), 'utf-8');
            const def = JSON.parse(content) as WorkflowDefinition;
            workflows.push({
              id: file.replace('.json', ''),
              name: def.properties.name,
              updatedAt: def.properties.updatedAt || 0,
            });
          }
        }
        
        return { success: true, workflows };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to list' };
      }
    },

    'workflow:load': async (_event: any, id: string) => {
      try {
        ensureDir();
        const filePath = getWorkflowPath(id);
        if (!fs.existsSync(filePath)) {
          return { success: false, error: 'Workflow not found' };
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return { success: true, workflow: JSON.parse(content) };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to load' };
      }
    },

    'workflow:save': async (_event: any, id: string, workflow: WorkflowDefinition) => {
      try {
        ensureDir();
        workflow.properties.updatedAt = Date.now();
        if (!workflow.properties.createdAt) {
          workflow.properties.createdAt = workflow.properties.updatedAt;
        }
        fs.writeFileSync(getWorkflowPath(id), JSON.stringify(workflow, null, 2), 'utf-8');
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to save' };
      }
    },

    'workflow:delete': async (_event: any, id: string) => {
      try {
        const filePath = getWorkflowPath(id);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        return { success: true };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Failed to delete' };
      }
    },

    'workflow:presets': async () => {
      return {
        success: true,
        presets: allPresets.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          category: p.category,
          icon: p.icon,
        })),
      };
    },

    'workflow:presetLoad': async (_event: any, presetId: string) => {
      const preset = allPresets.find((p) => p.id === presetId);
      if (preset) {
        return { success: true, workflow: preset.definition };
      }
      return { success: false, error: 'Preset not found' };
    },
  };
}
