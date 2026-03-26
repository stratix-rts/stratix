import { WorkflowStore, StoredWorkflow } from '@/agent-platform/workflow/store';
import { WorkflowDefinition } from '@/agent-platform/workflow/types';
import { singleAgentPreset } from '@/agent-platform/workflow/presets';

// Mock electronAPI
const mockElectronAPI = {
  workflow: {
    list: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  },
};

Object.defineProperty(global, 'window', {
  value: {
    electronAPI: mockElectronAPI,
  },
  writable: true,
});

describe('WorkflowStore', () => {
  let store: WorkflowStore;

  const createMockDefinition = (): WorkflowDefinition => ({
    properties: {
      name: 'Test Workflow',
      description: 'A test workflow',
    },
    sequence: [
      {
        id: 'step-1',
        componentType: 'task',
        type: 'llm',
        name: 'Test Step',
        properties: {
          providerId: 'openai',
          model: 'gpt-4o',
        },
      },
    ],
  });

  const createMockWorkflow = (overrides?: Partial<StoredWorkflow>): StoredWorkflow => ({
    id: 'workflow-1',
    name: 'Test Workflow',
    description: 'A test workflow',
    definition: createMockDefinition(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isPreset: false,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    store = new WorkflowStore();
  });

  describe('load', () => {
    test('loads workflows from electronAPI', async () => {
      const mockWorkflows = [
        createMockWorkflow({ id: 'workflow-1' }),
        createMockWorkflow({ id: 'workflow-2' }),
      ];

      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: mockWorkflows,
      });

      await store.load();

      const workflows = store.getAll();
      expect(workflows.length).toBeGreaterThanOrEqual(2);
    });

    test('loads presets on first load', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [],
      });

      await store.load();

      const presets = store.getPresets();
      expect(presets.length).toBe(3); // single-agent, multi-agent-chat, code-review
    });

    test('does not reload if already loaded', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [createMockWorkflow({ id: 'workflow-1' })],
      });

      await store.load();
      await store.load();

      // Should only call list once
      expect(mockElectronAPI.workflow.list).toHaveBeenCalledTimes(1);
    });

    test('handles load error gracefully', async () => {
      mockElectronAPI.workflow.list.mockRejectedValue(new Error('Load failed'));

      // Should not throw
      await expect(store.load()).resolves.not.toThrow();
    });
  });

  describe('getAll', () => {
    test('returns empty array before load', () => {
      const workflows = store.getAll();
      expect(workflows).toEqual([]);
    });

    test('returns all workflows after load', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [createMockWorkflow({ id: 'workflow-1' })],
      });

      await store.load();
      const workflows = store.getAll();

      expect(Array.isArray(workflows)).toBe(true);
    });
  });

  describe('get', () => {
    test('returns undefined before load', () => {
      const workflow = store.get('workflow-1');
      expect(workflow).toBeUndefined();
    });

    test('returns workflow by id', async () => {
      const mockWorkflow = createMockWorkflow({ id: 'workflow-1' });
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [mockWorkflow],
      });

      await store.load();
      const workflow = store.get('workflow-1');

      expect(workflow).toBeDefined();
      expect(workflow!.id).toBe('workflow-1');
    });

    test('returns undefined for unknown id', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [],
      });

      await store.load();
      const workflow = store.get('unknown');

      expect(workflow).toBeUndefined();
    });
  });

  describe('getUserWorkflows', () => {
    test('returns only non-preset workflows', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [],
      });

      await store.load();
      const userWorkflows = store.getUserWorkflows();

      userWorkflows.forEach(w => {
        expect(w.isPreset).toBe(false);
      });
    });
  });

  describe('getPresets', () => {
    test('returns only preset workflows', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [],
      });

      await store.load();
      const presets = store.getPresets();

      expect(presets.length).toBe(3);
      presets.forEach(p => {
        expect(p.isPreset).toBe(true);
      });
    });
  });

  describe('save', () => {
    test('saves workflow successfully', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [],
      });
      mockElectronAPI.workflow.save.mockResolvedValue({ success: true });

      await store.load();

      const workflow = createMockWorkflow({ id: 'new-workflow' });
      const result = await store.save(workflow);

      expect(result.success).toBe(true);
      expect(store.get('new-workflow')).toBeDefined();
    });

    test('updates existing workflow', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [],
      });
      mockElectronAPI.workflow.save.mockResolvedValue({ success: true });

      await store.load();

      const original = createMockWorkflow({ id: 'workflow-1', name: 'Original' });
      await store.save(original);

      const updated = createMockWorkflow({ id: 'workflow-1', name: 'Updated' });
      await store.save(updated);

      expect(store.get('workflow-1')!.name).toBe('Updated');
    });

    test('sets createdAt for new workflows', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [],
      });
      mockElectronAPI.workflow.save.mockResolvedValue({ success: true });

      await store.load();

      const beforeSave = Date.now();
      const workflow = createMockWorkflow({ id: 'new-workflow', createdAt: 0 });
      await store.save(workflow);
      const afterSave = Date.now();

      const saved = store.get('new-workflow')!;
      expect(saved.createdAt).toBeGreaterThanOrEqual(beforeSave);
      expect(saved.createdAt).toBeLessThanOrEqual(afterSave);
    });

    test('uses updated createdAt when provided', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [],
      });
      mockElectronAPI.workflow.save.mockResolvedValue({ success: true });

      await store.load();

      const originalTime = 1000000000000;
      const newTime = 2000000000000;
      const workflow = createMockWorkflow({ id: 'workflow-1', createdAt: originalTime });
      await store.save(workflow);

      // Update with a new createdAt - the implementation uses updated.createdAt if set
      const updated = createMockWorkflow({ id: 'workflow-1', createdAt: newTime, name: 'Updated' });
      await store.save(updated);

      // The implementation uses updated.createdAt when it's set
      expect(store.get('workflow-1')!.createdAt).toBe(newTime);
    });

    test('returns error when save fails', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [],
      });
      mockElectronAPI.workflow.save.mockResolvedValue({
        success: false,
        error: 'Save failed',
      });

      await store.load();

      const workflow = createMockWorkflow({ id: 'workflow-1' });
      const result = await store.save(workflow);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Save failed');
    });
  });

  describe('delete', () => {
    test('deletes workflow successfully', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [createMockWorkflow({ id: 'workflow-1' })],
      });
      mockElectronAPI.workflow.delete.mockResolvedValue({ success: true });

      await store.load();
      const result = await store.delete('workflow-1');

      expect(result.success).toBe(true);
      expect(store.get('workflow-1')).toBeUndefined();
    });

    test('cannot delete preset workflow', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [],
      });

      await store.load();
      const result = await store.delete('single-agent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot delete preset workflow');
    });

    test('returns error when delete fails', async () => {
      mockElectronAPI.workflow.list.mockResolvedValue({
        success: true,
        data: [createMockWorkflow({ id: 'workflow-1' })],
      });
      mockElectronAPI.workflow.delete.mockResolvedValue({
        success: false,
        error: 'Delete failed',
      });

      await store.load();
      const result = await store.delete('workflow-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Delete failed');
    });
  });

  describe('createFromPreset', () => {
    test('creates workflow from preset', () => {
      const workflow = store.createFromPreset('single-agent');

      expect(workflow.id).toMatch(/^workflow_/);
      expect(workflow.name).toContain(singleAgentPreset.name);
      expect(workflow.description).toBe(singleAgentPreset.description);
      expect(workflow.isPreset).toBe(false);
    });

    test('creates workflow with custom name', () => {
      const workflow = store.createFromPreset('single-agent', 'My Custom Workflow');

      expect(workflow.name).toBe('My Custom Workflow');
    });

    test('deep copies definition', () => {
      const workflow = store.createFromPreset('single-agent');

      // Modify the original preset
      singleAgentPreset.definition.sequence[0].properties.model = 'modified';

      // Workflow should not be affected
      expect(workflow.definition.sequence[0].properties.model).not.toBe('modified');
    });

    test('throws error for unknown preset', () => {
      expect(() => store.createFromPreset('unknown-preset')).toThrow(
        'Preset not found: unknown-preset'
      );
    });

    test('generates unique ids for multiple copies', () => {
      const workflow1 = store.createFromPreset('single-agent');
      const workflow2 = store.createFromPreset('single-agent');

      expect(workflow1.id).not.toBe(workflow2.id);
    });
  });
});
