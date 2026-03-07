import { type ConnectionType } from './ZoneConnection';
import { ZoneConnectionManager } from './ZoneConnectionManager';

export type WorkflowStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface WorkflowStep {
  zoneId: string;
  stepName?: string;
  status: 'pending' | 'active' | 'completed' | 'failed' | 'skipped';
  order: number;
  data?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  connections: string[];
  status: WorkflowStatus;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface WorkflowExecutionState {
  workflowId: string;
  currentStepIndex: number;
  completedSteps: string[];
  failedSteps: string[];
  startTime: number | null;
  endTime: number | null;
  status: WorkflowStatus;
  error?: string;
}

export class WorkflowVisualizer {
  private connectionManager: ZoneConnectionManager;
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private executionStates: Map<string, WorkflowExecutionState> = new Map();

  constructor(connectionManager: ZoneConnectionManager) {
    this.connectionManager = connectionManager;
  }

  createWorkflow(
    id: string,
    name: string,
    zoneIds: string[],
    description?: string
  ): WorkflowDefinition {
    const steps: WorkflowStep[] = zoneIds.map((zoneId, index) => ({
      zoneId,
      stepName: `Step ${index + 1}`,
      status: 'pending',
      order: index,
    }));

    const connections = this.generateWorkflowConnections(zoneIds);

    const workflow: WorkflowDefinition = {
      id,
      name,
      description,
      steps,
      connections,
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.workflows.set(id, workflow);
    this.initializeExecutionState(id);

    return workflow;
  }

  deleteWorkflow(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    this.workflows.delete(workflowId);
    this.executionStates.delete(workflowId);

    return true;
  }

  getWorkflow(workflowId: string): WorkflowDefinition | undefined {
    return this.workflows.get(workflowId);
  }

  getAllWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  updateWorkflowStep(
    workflowId: string,
    zoneId: string,
    updates: Partial<WorkflowStep>
  ): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    const step = workflow.steps.find(s => s.zoneId === zoneId);
    if (!step) return false;

    Object.assign(step, updates);
    workflow.updatedAt = Date.now();

    return true;
  }

  startWorkflow(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    const state = this.executionStates.get(workflowId);

    if (!workflow || !state) return false;
    if (workflow.status !== 'idle') return false;

    workflow.status = 'running';
    state.status = 'running';
    state.startTime = Date.now();
    state.currentStepIndex = 0;

    const firstStep = workflow.steps[0];
    if (firstStep) {
      firstStep.status = 'active';
    }

    return true;
  }

  pauseWorkflow(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    const state = this.executionStates.get(workflowId);

    if (!workflow || !state) return false;
    if (workflow.status !== 'running') return false;

    workflow.status = 'paused';
    state.status = 'paused';

    return true;
  }

  resumeWorkflow(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    const state = this.executionStates.get(workflowId);

    if (!workflow || !state) return false;
    if (workflow.status !== 'paused') return false;

    workflow.status = 'running';
    state.status = 'running';

    return true;
  }

  completeStep(workflowId: string, zoneId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    const state = this.executionStates.get(workflowId);

    if (!workflow || !state) return false;
    if (workflow.status !== 'running') return false;

    const stepIndex = workflow.steps.findIndex(s => s.zoneId === zoneId);
    if (stepIndex === -1) return false;

    const step = workflow.steps[stepIndex];
    if (step.status !== 'active') return false;

    step.status = 'completed';
    state.completedSteps.push(zoneId);
    workflow.updatedAt = Date.now();

    if (stepIndex < workflow.steps.length - 1) {
      state.currentStepIndex = stepIndex + 1;
      workflow.steps[stepIndex + 1].status = 'active';
    } else {
      this.completeWorkflow(workflowId);
    }

    return true;
  }

  failStep(workflowId: string, zoneId: string, error?: string): boolean {
    const workflow = this.workflows.get(workflowId);
    const state = this.executionStates.get(workflowId);

    if (!workflow || !state) return false;
    if (workflow.status !== 'running') return false;

    const step = workflow.steps.find(s => s.zoneId === zoneId);
    if (!step || step.status !== 'active') return false;

    step.status = 'failed';
    state.failedSteps.push(zoneId);
    workflow.status = 'failed';
    state.status = 'failed';
    state.endTime = Date.now();
    state.error = error;
    workflow.updatedAt = Date.now();

    return true;
  }

  getExecutionState(workflowId: string): WorkflowExecutionState | undefined {
    return this.executionStates.get(workflowId);
  }

  getWorkflowProgress(workflowId: string): number {
    const state = this.executionStates.get(workflowId);
    const workflow = this.workflows.get(workflowId);

    if (!state || !workflow) return 0;

    const totalSteps = workflow.steps.length;
    if (totalSteps === 0) return 0;

    const completedSteps = state.completedSteps.length;
    return (completedSteps / totalSteps) * 100;
  }

  getActiveStep(workflowId: string): WorkflowStep | null {
    const workflow = this.workflows.get(workflowId);
    const state = this.executionStates.get(workflowId);

    if (!workflow || !state || state.status === 'idle') return null;

    return workflow.steps[state.currentStepIndex] || null;
  }

  getNextSteps(workflowId: string, zoneId: string): WorkflowStep[] {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return [];

    const stepIndex = workflow.steps.findIndex(s => s.zoneId === zoneId);
    if (stepIndex === -1 || stepIndex >= workflow.steps.length - 1) return [];

    const nextConnections = this.connectionManager.getOutgoingConnections(zoneId);
    const nextZoneIds = nextConnections.map(c => c.targetZoneId);

    return workflow.steps.filter(s => 
      nextZoneIds.includes(s.zoneId) && s.order > stepIndex
    );
  }

  visualizeWorkflow(workflowId: string): {
    nodes: Array<{ id: string; name: string; status: string; position: { x: number; y: number } }>;
    edges: Array<{ from: string; to: string; type: ConnectionType }>;
  } {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return { nodes: [], edges: [] };

    const nodes = workflow.steps.map((step, index) => ({
      id: step.zoneId,
      name: step.stepName || `Zone ${step.zoneId}`,
      status: step.status,
      position: { x: index * 200, y: 0 },
    }));

    const edges = workflow.connections
      .map(connId => {
        const conn = this.connectionManager.getConnection(connId);
        if (!conn) return null;
        return {
          from: conn.sourceZoneId,
          to: conn.targetZoneId,
          type: conn.type,
        };
      })
      .filter((edge): edge is NonNullable<typeof edge> => edge !== null);

    return { nodes, edges };
  }

  resetWorkflow(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    workflow.steps.forEach(step => {
      step.status = 'pending';
    });

    workflow.status = 'idle';
    workflow.updatedAt = Date.now();

    this.initializeExecutionState(workflowId);

    return true;
  }

  cloneWorkflow(sourceWorkflowId: string, newId: string, newName: string): WorkflowDefinition | null {
    const sourceWorkflow = this.workflows.get(sourceWorkflowId);
    if (!sourceWorkflow) return null;

    const cloned: WorkflowDefinition = {
      ...sourceWorkflow,
      id: newId,
      name: newName,
      steps: sourceWorkflow.steps.map(step => ({ ...step })),
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.workflows.set(newId, cloned);
    this.initializeExecutionState(newId);

    return cloned;
  }

  clear(): void {
    this.workflows.clear();
    this.executionStates.clear();
  }

  private completeWorkflow(workflowId: string): void {
    const workflow = this.workflows.get(workflowId);
    const state = this.executionStates.get(workflowId);

    if (!workflow || !state) return;

    workflow.status = 'completed';
    state.status = 'completed';
    state.endTime = Date.now();
    workflow.updatedAt = Date.now();
  }

  private initializeExecutionState(workflowId: string): void {
    const state: WorkflowExecutionState = {
      workflowId,
      currentStepIndex: 0,
      completedSteps: [],
      failedSteps: [],
      startTime: null,
      endTime: null,
      status: 'idle',
    };

    this.executionStates.set(workflowId, state);
  }

  private generateWorkflowConnections(zoneIds: string[]): string[] {
    const connections: string[] = [];

    for (let i = 0; i < zoneIds.length - 1; i++) {
      const existing = this.connectionManager.getConnectionsByZone(zoneIds[i]);
      const outgoing = existing.find(c => 
        c.sourceZoneId === zoneIds[i] && c.targetZoneId === zoneIds[i + 1]
      );

      if (outgoing) {
        connections.push(outgoing.id);
      } else {
        const conn = this.connectionManager.createConnection(
          zoneIds[i],
          zoneIds[i + 1],
          'sequential',
          { label: `Step ${i + 1} -> ${i + 2}` }
        );
        if (conn) {
          connections.push(conn.id);
        }
      }
    }

    return connections;
  }
}