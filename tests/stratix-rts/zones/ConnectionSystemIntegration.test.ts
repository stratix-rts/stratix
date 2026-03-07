import { ZoneConnectionManager } from '@/stratix-rts/zones/ZoneConnectionManager';
import { WorkflowVisualizer } from '@/stratix-rts/zones/WorkflowVisualizer';
import { ConnectionCreateAction, ConnectionDeleteAction } from '@/stratix-rts/zones/ConnectionActions';
import { ZoneHistory } from '@/stratix-rts/history/ZoneHistory';

describe('Zone Connection System Integration', () => {
  let connectionManager: ZoneConnectionManager;
  let workflowVisualizer: WorkflowVisualizer;
  let history: ZoneHistory;

  beforeEach(() => {
    connectionManager = new ZoneConnectionManager();
    workflowVisualizer = new WorkflowVisualizer(connectionManager);
    history = new ZoneHistory();
  });

  afterEach(() => {
    connectionManager.clear();
    workflowVisualizer.clear();
    history.destroy();
  });

  describe('Connection Types', () => {
    it('should support all 5 connection types', () => {
      const types = ['sequential', 'parallel', 'conditional', 'loop', 'branch'] as const;
      
      types.forEach((type, index) => {
        const conn = connectionManager.createConnection(
          `zone-${index}`,
          `zone-${index + 1}`,
          type
        );
        expect(conn?.type).toBe(type);
      });

      expect(connectionManager.getAllConnections().length).toBe(5);
    });

    it('should visualize different connection types with different styles', () => {
      connectionManager.createConnection('zone-1', 'zone-2', 'sequential');
      connectionManager.createConnection('zone-2', 'zone-3', 'parallel');
      connectionManager.createConnection('zone-3', 'zone-4', 'conditional');
      connectionManager.createConnection('zone-4', 'zone-1', 'loop');

      const connections = connectionManager.getAllConnections();
      expect(connections.length).toBe(4);
    });
  });

  describe('Workflow with Connections', () => {
    it('should create workflow from zone connections', () => {
      connectionManager.createConnection('zone-1', 'zone-2', 'sequential');
      connectionManager.createConnection('zone-2', 'zone-3', 'sequential');

      const workflow = workflowVisualizer.createWorkflow(
        'test-workflow',
        'Test Workflow',
        ['zone-1', 'zone-2', 'zone-3']
      );

      expect(workflow.steps.length).toBe(3);
      expect(workflow.status).toBe('idle');
    });

    it('should execute workflow and track progress', async () => {
      const workflow = workflowVisualizer.createWorkflow(
        'execution-test',
        'Execution Test',
        ['zone-1', 'zone-2', 'zone-3']
      );

      expect(workflowVisualizer.startWorkflow('execution-test')).toBe(true);
      expect(workflowVisualizer.getWorkflowProgress('execution-test')).toBe(0);

      workflowVisualizer.completeStep('execution-test', 'zone-1');
      expect(workflowVisualizer.getWorkflowProgress('execution-test')).toBeCloseTo(33.33, 1);

      workflowVisualizer.completeStep('execution-test', 'zone-2');
      expect(workflowVisualizer.getWorkflowProgress('execution-test')).toBeCloseTo(66.67, 1);

      workflowVisualizer.completeStep('execution-test', 'zone-3');
      expect(workflowVisualizer.getWorkflowProgress('execution-test')).toBe(100);
      expect(workflow.status).toBe('completed');
    });

    it('should support workflow pause and resume', () => {
      workflowVisualizer.createWorkflow('pause-test', 'Pause Test', ['zone-1', 'zone-2']);
      
      workflowVisualizer.startWorkflow('pause-test');
      expect(workflowVisualizer.getWorkflow('pause-test')?.status).toBe('running');

      workflowVisualizer.pauseWorkflow('pause-test');
      expect(workflowVisualizer.getWorkflow('pause-test')?.status).toBe('paused');

      workflowVisualizer.resumeWorkflow('pause-test');
      expect(workflowVisualizer.getWorkflow('pause-test')?.status).toBe('running');
    });
  });

  describe('History and Undo/Redo', () => {
    it('should support undo/redo for connection creation', async () => {
      const action = new ConnectionCreateAction(
        connectionManager,
        'zone-1',
        'zone-2',
        'sequential',
        { label: 'Test Connection' }
      );

      await history.execute(action);
      expect(connectionManager.getAllConnections().length).toBe(1);

      await history.undo();
      expect(connectionManager.getAllConnections().length).toBe(0);

      await history.redo();
      expect(connectionManager.getAllConnections().length).toBe(1);
    });

    it('should support undo/redo for connection deletion', async () => {
      const connection = connectionManager.createConnection('zone-1', 'zone-2');
      expect(connection).toBeDefined();

      const deleteAction = new ConnectionDeleteAction(connectionManager, connection!.id);
      await history.execute(deleteAction);
      expect(connectionManager.getAllConnections().length).toBe(0);

      await history.undo();
      expect(connectionManager.getAllConnections().length).toBe(1);

      await history.redo();
      expect(connectionManager.getAllConnections().length).toBe(0);
    });
  });

  describe('Complex Workflows', () => {
    it('should handle parallel branches', () => {
      connectionManager.createConnection('start', 'branch-1', 'parallel');
      connectionManager.createConnection('start', 'branch-2', 'parallel');
      connectionManager.createConnection('branch-1', 'end', 'sequential');
      connectionManager.createConnection('branch-2', 'end', 'sequential');

      const startOutgoing = connectionManager.getOutgoingConnections('start');
      expect(startOutgoing.length).toBe(2);
      expect(startOutgoing.every(c => c.type === 'parallel')).toBe(true);
    });

    it('should handle conditional branches', () => {
      connectionManager.createConnection('decision', 'path-a', 'conditional', {
        condition: 'conditionA'
      });
      connectionManager.createConnection('decision', 'path-b', 'conditional', {
        condition: 'conditionB'
      });

      const decisionOutgoing = connectionManager.getOutgoingConnections('decision');
      expect(decisionOutgoing.length).toBe(2);
      expect(decisionOutgoing[0].metadata.condition).toBe('conditionA');
    });

    it('should handle loops', () => {
      connectionManager.createConnection('start', 'process', 'sequential');
      connectionManager.createConnection('process', 'check', 'sequential');
      connectionManager.createConnection('check', 'process', 'loop', {
        condition: 'retryNeeded'
      });
      connectionManager.createConnection('check', 'end', 'conditional');

      const loopConnections = connectionManager.getAllConnections()
        .filter(c => c.type === 'loop');
      expect(loopConnections.length).toBe(1);
      expect(loopConnections[0].sourceZoneId).toBe('check');
      expect(loopConnections[0].targetZoneId).toBe('process');
    });
  });

  describe('Connection Graph Operations', () => {
    it('should build connection graph', () => {
      connectionManager.createConnection('A', 'B', 'sequential');
      connectionManager.createConnection('B', 'C', 'sequential');
      connectionManager.createConnection('A', 'D', 'parallel');

      const graph = connectionManager.getGraph();

      expect(graph.nodes).toContain('A');
      expect(graph.nodes).toContain('B');
      expect(graph.nodes).toContain('C');
      expect(graph.nodes).toContain('D');
      expect(graph.edges.length).toBe(3);
    });

    it('should find paths in connection graph', () => {
      connectionManager.createConnection('start', 'middle', 'sequential');
      connectionManager.createConnection('middle', 'end', 'sequential');

      const path = connectionManager.findPath('start', 'end');
      expect(path).toEqual(['start', 'middle', 'end']);
    });

    it('should detect cycles when needed', () => {
      const cyclicManager = new ZoneConnectionManager({ allowCyclicConnections: false });
      
      cyclicManager.createConnection('A', 'B');
      cyclicManager.createConnection('B', 'C');

      const wouldCreateCycle = cyclicManager.wouldCreateCycle('C', 'A');
      expect(wouldCreateCycle).toBe(true);

      const result = cyclicManager.validateConnection('C', 'A', 'sequential');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('This connection would create a cycle');
    });
  });

  describe('Serialization', () => {
    it('should serialize and restore complete system state', () => {
      connectionManager.createConnection('zone-1', 'zone-2', 'sequential', { label: 'Main Flow' });
      connectionManager.createConnection('zone-2', 'zone-3', 'parallel');

      const serialized = connectionManager.serialize();

      const newManager = new ZoneConnectionManager();
      newManager.deserialize(serialized);

      const restored = newManager.getAllConnections();
      expect(restored.length).toBe(2);
      expect(restored[0].metadata.label).toBe('Main Flow');
    });
  });
});