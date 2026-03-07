import { WorkflowVisualizer } from '@/stratix-rts/zones/WorkflowVisualizer';
import { ZoneConnectionManager } from '@/stratix-rts/zones/ZoneConnectionManager';

describe('WorkflowVisualizer', () => {
  let connectionManager: ZoneConnectionManager;
  let visualizer: WorkflowVisualizer;

  beforeEach(() => {
    connectionManager = new ZoneConnectionManager();
    visualizer = new WorkflowVisualizer(connectionManager);
  });

  afterEach(() => {
    visualizer.clear();
    connectionManager.clear();
  });

  describe('createWorkflow', () => {
    it('should create a workflow with multiple steps', () => {
      const workflow = visualizer.createWorkflow(
        'wf-1',
        'Test Workflow',
        ['zone-1', 'zone-2', 'zone-3']
      );
      
      expect(workflow).toBeDefined();
      expect(workflow.id).toBe('wf-1');
      expect(workflow.name).toBe('Test Workflow');
      expect(workflow.steps.length).toBe(3);
      expect(workflow.status).toBe('idle');
    });

    it('should initialize all steps as pending', () => {
      const workflow = visualizer.createWorkflow(
        'wf-1',
        'Test',
        ['zone-1', 'zone-2']
      );
      
      workflow.steps.forEach(step => {
        expect(step.status).toBe('pending');
      });
    });

    it('should create connections between zones', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2', 'zone-3']);
      
      const connections = connectionManager.getAllConnections();
      expect(connections.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('startWorkflow', () => {
    it('should start a workflow', () => {
      const workflow = visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      
      const result = visualizer.startWorkflow('wf-1');
      
      expect(result).toBe(true);
      expect(workflow.status).toBe('running');
    });

    it('should set first step as active', () => {
      const workflow = visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      
      visualizer.startWorkflow('wf-1');
      
      expect(workflow.steps[0].status).toBe('active');
    });

    it('should not start already running workflow', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      visualizer.startWorkflow('wf-1');
      
      const result = visualizer.startWorkflow('wf-1');
      
      expect(result).toBe(false);
    });
  });

  describe('pauseWorkflow', () => {
    it('should pause a running workflow', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      visualizer.startWorkflow('wf-1');
      
      const result = visualizer.pauseWorkflow('wf-1');
      
      expect(result).toBe(true);
      
      const workflow = visualizer.getWorkflow('wf-1');
      expect(workflow?.status).toBe('paused');
    });

    it('should not pause non-running workflow', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      
      const result = visualizer.pauseWorkflow('wf-1');
      
      expect(result).toBe(false);
    });
  });

  describe('resumeWorkflow', () => {
    it('should resume a paused workflow', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      visualizer.startWorkflow('wf-1');
      visualizer.pauseWorkflow('wf-1');
      
      const result = visualizer.resumeWorkflow('wf-1');
      
      expect(result).toBe(true);
      
      const workflow = visualizer.getWorkflow('wf-1');
      expect(workflow?.status).toBe('running');
    });
  });

  describe('completeStep', () => {
    it('should complete current step and activate next', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2', 'zone-3']);
      visualizer.startWorkflow('wf-1');
      
      const result = visualizer.completeStep('wf-1', 'zone-1');
      
      expect(result).toBe(true);
      
      const workflow = visualizer.getWorkflow('wf-1');
      expect(workflow?.steps[0].status).toBe('completed');
      expect(workflow?.steps[1].status).toBe('active');
    });

    it('should complete workflow when last step is done', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      visualizer.startWorkflow('wf-1');
      
      visualizer.completeStep('wf-1', 'zone-1');
      visualizer.completeStep('wf-1', 'zone-2');
      
      const workflow = visualizer.getWorkflow('wf-1');
      expect(workflow?.status).toBe('completed');
    });
  });

  describe('failStep', () => {
    it('should fail current step and stop workflow', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      visualizer.startWorkflow('wf-1');
      
      const result = visualizer.failStep('wf-1', 'zone-1', 'Test error');
      
      expect(result).toBe(true);
      
      const workflow = visualizer.getWorkflow('wf-1');
      expect(workflow?.status).toBe('failed');
      expect(workflow?.steps[0].status).toBe('failed');
    });
  });

  describe('getWorkflowProgress', () => {
    it('should return 0 for new workflow', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      
      const progress = visualizer.getWorkflowProgress('wf-1');
      
      expect(progress).toBe(0);
    });

    it('should return correct progress after steps completed', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2', 'zone-3']);
      visualizer.startWorkflow('wf-1');
      
      visualizer.completeStep('wf-1', 'zone-1');
      
      const progress = visualizer.getWorkflowProgress('wf-1');
      
      expect(progress).toBeCloseTo(33.33, 1);
    });

    it('should return 100 for completed workflow', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      visualizer.startWorkflow('wf-1');
      
      visualizer.completeStep('wf-1', 'zone-1');
      visualizer.completeStep('wf-1', 'zone-2');
      
      const progress = visualizer.getWorkflowProgress('wf-1');
      
      expect(progress).toBe(100);
    });
  });

  describe('getActiveStep', () => {
    it('should return null for idle workflow', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      
      const activeStep = visualizer.getActiveStep('wf-1');
      
      expect(activeStep).toBeNull();
    });

    it('should return current active step', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      visualizer.startWorkflow('wf-1');
      
      const activeStep = visualizer.getActiveStep('wf-1');
      
      expect(activeStep?.zoneId).toBe('zone-1');
    });
  });

  describe('visualizeWorkflow', () => {
    it('should return nodes and edges for visualization', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2', 'zone-3']);
      
      const viz = visualizer.visualizeWorkflow('wf-1');
      
      expect(viz.nodes.length).toBe(3);
      expect(viz.edges.length).toBeGreaterThan(0);
    });

    it('should include step status in nodes', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      visualizer.startWorkflow('wf-1');
      
      const viz = visualizer.visualizeWorkflow('wf-1');
      
      expect(viz.nodes[0].status).toBe('active');
      expect(viz.nodes[1].status).toBe('pending');
    });
  });

  describe('resetWorkflow', () => {
    it('should reset workflow to initial state', () => {
      visualizer.createWorkflow('wf-1', 'Test', ['zone-1', 'zone-2']);
      visualizer.startWorkflow('wf-1');
      visualizer.completeStep('wf-1', 'zone-1');
      
      const result = visualizer.resetWorkflow('wf-1');
      
      expect(result).toBe(true);
      
      const workflow = visualizer.getWorkflow('wf-1');
      expect(workflow?.status).toBe('idle');
      workflow?.steps.forEach(step => {
        expect(step.status).toBe('pending');
      });
    });
  });

  describe('cloneWorkflow', () => {
    it('should create a copy of workflow', () => {
      visualizer.createWorkflow('wf-1', 'Original', ['zone-1', 'zone-2']);
      
      const cloned = visualizer.cloneWorkflow('wf-1', 'wf-2', 'Cloned');
      
      expect(cloned).toBeDefined();
      expect(cloned?.id).toBe('wf-2');
      expect(cloned?.name).toBe('Cloned');
      expect(cloned?.steps.length).toBe(2);
    });

    it('should clone with independent state', () => {
      visualizer.createWorkflow('wf-1', 'Original', ['zone-1', 'zone-2']);
      visualizer.startWorkflow('wf-1');
      
      const cloned = visualizer.cloneWorkflow('wf-1', 'wf-2', 'Cloned');
      
      expect(cloned?.status).toBe('idle');
      
      const original = visualizer.getWorkflow('wf-1');
      expect(original?.status).toBe('running');
    });
  });
});