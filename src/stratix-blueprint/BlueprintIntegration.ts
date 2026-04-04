import { RequirementParser } from '../stratix-ai-service/parsers/RequirementParser';
import { TaskSplitter } from '../stratix-ai-service/parsers/TaskSplitter';
import { ParsedTask, SplitStrategy, AIStreamCallback, TaskType } from '../stratix-ai-service/types';
import { LayoutEngine } from '../stratix-blueprint/core/LayoutEngine';

export interface BlueprintGenerationResult {
  success: boolean;
  tasks?: ParsedTask[];
  nodes?: any[];
  edges?: any[];
  error?: string;
}

export class BlueprintIntegration {
  private requirementParser: RequirementParser;
  private taskSplitter: TaskSplitter;
  private layoutEngine: LayoutEngine;
  
  constructor() {
    this.requirementParser = new RequirementParser();
    this.taskSplitter = new TaskSplitter();
    this.layoutEngine = new LayoutEngine();
  }
  
  async generateBlueprint(
    requirement: string,
    strategy: SplitStrategy = 'sequential',
    streamCallback?: AIStreamCallback
  ): Promise<BlueprintGenerationResult> {
    try {
      // 1. Parse requirement
      console.log('[BlueprintIntegration] Parsing requirement...');
      const parsed = await this.requirementParser.parse(requirement, streamCallback);
      
      // 2. Validate parsed result
      await this.requirementParser.validate(parsed);
      
      // 3. Split tasks
      console.log('[BlueprintIntegration] Splitting tasks with strategy:', strategy);
      const tasks = await this.taskSplitter.split(parsed, strategy, streamCallback);
      
      // 4. Optimize tasks
      const optimizedTasks = this.taskSplitter.optimize(tasks);
      
      // 5. Generate layout
      console.log('[BlueprintIntegration] Generating layout...');
      const { nodes, edges } = this.layoutEngine.layout(optimizedTasks);
      
      return {
        success: true,
        tasks: optimizedTasks,
        nodes,
        edges,
      };
    } catch (error) {
      console.error('[BlueprintIntegration] Failed to generate blueprint:', error);
      
      // Try fallback strategies
      return this.handleFallback(requirement, strategy, error, streamCallback);
    }
  }
  
  private async handleFallback(
    requirement: string,
    strategy: SplitStrategy,
    originalError: any,
    streamCallback?: AIStreamCallback
  ): Promise<BlueprintGenerationResult> {
    console.log('[BlueprintIntegration] Attempting fallback...');
    
    // Fallback 1: Try different strategy
    const strategies: SplitStrategy[] = ['sequential', 'by_type', 'by_priority'];
    const otherStrategies = strategies.filter(s => s !== strategy);
    
    for (const fallbackStrategy of otherStrategies) {
      try {
        console.log('[BlueprintIntegration] Trying fallback strategy:', fallbackStrategy);
        return await this.generateBlueprint(requirement, fallbackStrategy, streamCallback);
      } catch (error) {
        console.log('[BlueprintIntegration] Fallback strategy failed:', fallbackStrategy);
        continue;
      }
    }
    
    // Fallback 2: Manual mode - create simple task list
    console.log('[BlueprintIntegration] Using manual mode');
    const manualTasks = this.createManualTasks(requirement);
    const { nodes, edges } = this.layoutEngine.layout(manualTasks);
    
    return {
      success: true,
      tasks: manualTasks,
      nodes,
      edges,
    };
  }
  
  private createManualTasks(_requirement: string): ParsedTask[] {
    return [
      {
        id: 'task_1',
        name: '需求分析',
        type: TaskType.REQUIREMENT,
        description: '分析和理解需求内容',
        estimatedTime: 120,
        dependencies: [],
        priority: 1,
      },
      {
        id: 'task_2',
        name: '设计和规划',
        type: TaskType.DESIGN,
        description: '设计系统架构和实现方案',
        estimatedTime: 180,
        dependencies: ['task_1'],
        priority: 2,
      },
      {
        id: 'task_3',
        name: '开发实现',
        type: TaskType.DEVELOPMENT,
        description: '实现核心功能',
        estimatedTime: 480,
        dependencies: ['task_2'],
        priority: 3,
      },
      {
        id: 'task_4',
        name: '测试验证',
        type: TaskType.TEST,
        description: '测试功能和质量保证',
        estimatedTime: 240,
        dependencies: ['task_3'],
        priority: 4,
      },
      {
        id: 'task_5',
        name: '部署上线',
        type: TaskType.DEPLOY,
        description: '部署和发布系统',
        estimatedTime: 120,
        dependencies: ['task_4'],
        priority: 5,
      },
    ];
  }
  
  updateTaskPosition(
    tasks: ParsedTask[],
    taskId: string,
    x: number,
    y: number
  ): { nodes: any[]; edges: any[] } {
    const { nodes, edges } = this.layoutEngine.layout(tasks);
    const updatedNodes = this.layoutEngine.updateNodePosition(nodes, taskId, x, y);
    
    return { nodes: updatedNodes, edges };
  }
}
