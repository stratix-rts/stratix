import { allPresets } from '../workflow/presets';
import type { WorkflowDefinition } from '../workflow/types';

export function registerWorkflowHandlers(userDataPath: string, fs: any, path: any) {
  const workflowDir = path.join(userDataPath, 'workflows');

  const ensureDir = () => {
    if (!fs.existsSync(workflowDir)) {
      fs.mkdirSync(workflowDir, { recursive: true });
    }
  };

  const getWorkflowPath = (id: string) => {
    // Prevent directory traversal attacks
    if (!id || /[/\\]|\.\./.test(id)) {
      throw new Error('Invalid workflow ID');
    }
    return path.join(workflowDir, `${id}.json`);
  };

  return {
    'workflow:list': async () => {
      try {
        ensureDir();
        const files = fs.readdirSync(workflowDir);
        const workflows: Array<{ id: string; name: string; updatedAt: number }> = [];

        for (const file of files) {
          if (file.endsWith('.json')) {
            const filePath = path.join(workflowDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            let def: WorkflowDefinition;
            try {
              def = JSON.parse(content) as WorkflowDefinition;
            } catch {
              // Skip corrupted files
              continue;
            }
            workflows.push({
              id: file.replace('.json', ''),
              name: def.properties.name || 'Unnamed Workflow',
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
        let workflow: WorkflowDefinition;
        try {
          workflow = JSON.parse(content);
        } catch {
          return { success: false, error: 'Corrupted workflow file' };
        }
        return { success: true, workflow };
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid workflow ID') {
          return { success: false, error: error.message };
        }
        return { success: false, error: error instanceof Error ? error.message : 'Failed to load' };
      }
    },

    'workflow:save': async (_event: any, id: string, workflow: WorkflowDefinition) => {
      try {
        ensureDir();
        // Validate id before using it
        getWorkflowPath(id); // Will throw if invalid
        workflow.properties.updatedAt = Date.now();
        if (!workflow.properties.createdAt) {
          workflow.properties.createdAt = workflow.properties.updatedAt;
        }
        fs.writeFileSync(getWorkflowPath(id), JSON.stringify(workflow, null, 2), 'utf-8');
        return { success: true };
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid workflow ID') {
          return { success: false, error: error.message };
        }
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
        if (error instanceof Error && error.message === 'Invalid workflow ID') {
          return { success: false, error: error.message };
        }
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
