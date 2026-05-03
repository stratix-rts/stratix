import { AIServiceFactory } from '../core/AIServiceFactory';
import { getRequirementParsingPrompt } from '../prompts/requirement-parsing';
import { ParsedRequirement, ParsedTask, AIStreamCallback, TaskType } from '../types';

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
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.trim());
      } catch {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          throw new Error('No JSON found in response');
        }
        parsed = JSON.parse(jsonMatch[0]);
      }

      const parsedObj = parsed as Record<string, unknown>;

      // Validate and transform
      const rawTasks = (parsedObj.tasks as unknown[] || []);
      const tasks: ParsedTask[] = rawTasks.map((task: unknown) => {
        const t = task as Record<string, unknown>;
        return {
          id: (t.id as string) || `task_${Date.now()}`,
          name: (t.name as string) || '未命名任务',
          type: ((t.type as string) || 'custom') as TaskType,
          description: (t.description as string) || '',
          estimatedTime: t.estimatedTime as number | undefined,
          dependencies: (t.dependencies as string[]) || [],
          priority: (t.priority as number) || 3,
        };
      });

      const metadataObj = (parsedObj.metadata as Record<string, unknown>) || {};

      return {
        summary: (parsedObj.summary as string) || '需求解析结果',
        tasks,
        metadata: {
          originalRequirement: requirement ?? '',
          parseTime: new Date(),
          model: model || '',
          provider: provider || '',
          ...metadataObj,
        },
      };
    } catch (error) {
      throw new Error(`Failed to parse AI response: ${error instanceof Error ? error.message : String(error)}`);
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
