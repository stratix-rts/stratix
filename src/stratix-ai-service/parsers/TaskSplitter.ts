import { AIServiceFactory } from '../core/AIServiceFactory';
import { getTaskSplittingPrompt } from '../prompts/task-splitting';
import { ParsedRequirement, ParsedTask, SplitStrategy, AIStreamCallback, TaskType } from '../types';

export class TaskSplitter {
  private aiFactory: AIServiceFactory;
  
  constructor() {
    this.aiFactory = AIServiceFactory.getInstance();
  }
  
  async split(
    parsedRequirement: ParsedRequirement,
    strategy: SplitStrategy = 'sequential',
    streamCallback?: AIStreamCallback
  ): Promise<ParsedTask[]> {
    const provider = this.aiFactory.getDefaultProvider();
    const prompt = getTaskSplittingPrompt(
      strategy,
      parsedRequirement.summary,
      JSON.stringify(parsedRequirement.tasks, null, 2)
    );
    
    let response: string;
    
    if (streamCallback && this.aiFactory.getConfig().streaming) {
      let fullContent = '';
      
      await provider.chatStream(
        [
          {
            role: 'system',
            content: '你是一个项目规划专家，擅长按照不同策略拆分和组织任务。请始终返回有效的 JSON 格式。',
          },
          { role: 'user', content: prompt },
        ],
        {
          onToken: (token) => {
            fullContent += token;
            streamCallback.onToken(token);
          },
          onComplete: (result) => {
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
          content: '你是一个项目规划专家，擅长按照不同策略拆分和组织任务。请始终返回有效的 JSON 格式。',
        },
        { role: 'user', content: prompt },
      ]);
      
      response = result.content;
    }
    
    return this.parseTasks(response);
  }
  
  private parseTasks(response: string): ParsedTask[] {
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
      const rawTasks = (parsedObj.tasks as unknown[]) || [];
      
      return rawTasks.map((task: unknown) => {
        const t = task as Record<string, unknown>;
        return {
          id: (t.id as string) || `task_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          name: (t.name as string) || '未命名任务',
          type: ((t.type as string) || 'custom') as TaskType,
          description: (t.description as string) || '',
          estimatedTime: t.estimatedTime as number | undefined,
          dependencies: (t.dependencies as string[]) || [],
          priority: (t.priority as number) || 3,
        };
      });
    } catch (error) {
      throw new Error(`Failed to parse split tasks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  optimize(tasks: ParsedTask[]): ParsedTask[] {
    // Remove duplicate tasks
    const uniqueTasks = this.removeDuplicates(tasks);
    
    // Sort by priority
    const sorted = uniqueTasks.sort((a, b) => a.priority - b.priority);
    
    // Validate dependencies
    return this.validateDependencies(sorted);
  }
  
  private removeDuplicates(tasks: ParsedTask[]): ParsedTask[] {
    const seen = new Map<string, ParsedTask>();
    
    for (const task of tasks) {
      const key = task.name.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, task);
      } else {
        // Merge dependencies
        const existing = seen.get(key)!;
        existing.dependencies = [
          ...new Set([...existing.dependencies, ...task.dependencies]),
        ];
      }
    }
    
    return Array.from(seen.values());
  }
  
  private validateDependencies(tasks: ParsedTask[]): ParsedTask[] {
    const taskIds = new Set(tasks.map(t => t.id));
    
    return tasks.map(task => ({
      ...task,
      dependencies: task.dependencies.filter(dep => taskIds.has(dep))
    }));
  }
}
