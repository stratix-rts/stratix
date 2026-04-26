import { AIServiceFactory } from '../core/AIServiceFactory';
import { getRequirementParsingPrompt } from '../prompts/requirement-parsing';
import { ParsedRequirement, ParsedTask, AIStreamCallback } from '../types';

export class RequirementParser {
  private aiFactory: AIServiceFactory;

  constructor() {
    this.aiFactory = AIServiceFactory.getInstance();
  }

  async parse(
    requirement: string,
    streamCallback?: AIStreamCallback
  ): Promise<ParsedRequirement> {
    const provider = this.aiFactory.getDefaultProvider();
    const prompt = getRequirementParsingPrompt(requirement);

    let response: string;
    let model = '';
    let prov = '';

    if (streamCallback && this.aiFactory.getConfig().streaming) {
      let fullContent = '';

      await provider.chatStream(
        [
          {
            role: 'system',
            content: '你是一个专业的项目需求分析师，擅长将需求拆分为可执行的任务。请始终返回有效的 JSON 格式。',
          },
          { role: 'user', content: prompt },
        ],
        {
          onToken: (token) => {
            fullContent += token;
            streamCallback.onToken(token);
          },
          onComplete: (result) => {
            model = result.model;
            prov = result.provider;
            streamCallback.onComplete(result);
          },
          onError: (error) => {
            streamCallback.onError(error);
          },
        }
      );

      response = fullContent;
    } else {
      const result = await provider.chat([
        {
          role: 'system',
          content: '你是一个专业的项目需求分析师，擅长将需求拆分为可执行的任务。请始终返回有效的 JSON 格式。',
        },
        { role: 'user', content: prompt },
      ]);

      response = result.content;
      model = result.model;
      prov = result.provider;
    }

    return this.parseResponse(response, model, prov, requirement);
  }

  private parseResponse(response: string, model: string, provider: string, requirement?: string): ParsedRequirement {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and transform
      const tasks: ParsedTask[] = (parsed.tasks || []).map((task: any) => ({
        id: task.id || `task_${Date.now()}`,
        name: task.name || '未命名任务',
        type: task.type || 'custom',
        description: task.description || '',
        estimatedTime: task.estimatedTime,
        dependencies: task.dependencies || [],
        priority: task.priority || 3,
      }));

      return {
        summary: parsed.summary || '需求解析结果',
        tasks,
        metadata: {
          originalRequirement: requirement,
          parseTime: new Date(),
          model: model || '',
          provider: provider || '',
          ...parsed.metadata,
        },
      };
    } catch (error) {
      throw new Error(`Failed to parse AI response: ${error}`);
    }
  }
  
  async validate(parsed: ParsedRequirement): Promise<boolean> {
    // Check for circular dependencies
    const taskIds = new Set(parsed.tasks.map(t => t.id));
    
    for (const task of parsed.tasks) {
      // Validate dependencies exist
      for (const dep of task.dependencies) {
        if (!taskIds.has(dep)) {
          throw new Error(`Task ${task.id} depends on non-existent task ${dep}`);
        }
      }
      
      // Validate priority
      if (task.priority < 1 || task.priority > 5) {
        throw new Error(`Task ${task.id} has invalid priority ${task.priority}`);
      }
    }
    
    // Check for cycles
    this.detectCycle(parsed.tasks);
    
    return true;
  }
  
  private detectCycle(tasks: ParsedTask[]): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    const hasCycle = (taskId: string): boolean => {
      if (recursionStack.has(taskId)) {
        return true;
      }
      
      if (visited.has(taskId)) {
        return false;
      }
      
      visited.add(taskId);
      recursionStack.add(taskId);
      
      const task = tasks.find(t => t.id === taskId);
      if (task) {
        for (const dep of task.dependencies) {
          if (hasCycle(dep)) {
            return true;
          }
        }
      }
      
      recursionStack.delete(taskId);
      return false;
    };
    
    for (const task of tasks) {
      if (hasCycle(task.id)) {
        throw new Error('Circular dependency detected in tasks');
      }
    }
  }
}
