import { TaskExecutor } from '../src/stratix-task-executor/TaskExecutor';
import { ParsedTask, TaskType } from '../src/stratix-ai-service/types';

async function executorExample() {
  console.log('=== Task Executor Example ===\n');

  // 创建示例任务
  const tasks: ParsedTask[] = [
    {
      id: '001-requirement',
      name: '需求分析',
      type: TaskType.REQUIREMENT,
      description: '分析项目需求',
      estimatedTime: 1,
      dependencies: [],
      priority: 1,
    },
    {
      id: '002-design',
      name: '系统设计',
      type: TaskType.DESIGN,
      description: '设计系统架构',
      estimatedTime: 1,
      dependencies: ['001-requirement'],
      priority: 2,
    },
    {
      id: '003-development',
      name: '开发实现',
      type: TaskType.DEVELOPMENT,
      description: '实现核心功能',
      estimatedTime: 1,
      dependencies: ['002-design'],
      priority: 3,
    },
    {
      id: '004-test',
      name: '测试验证',
      type: TaskType.TEST,
      description: '测试功能和质量',
      estimatedTime: 1,
      dependencies: ['003-development'],
      priority: 4,
    },
    {
      id: '005-deploy',
      name: '部署上线',
      type: TaskType.DEPLOY,
      description: '部署和发布',
      estimatedTime: 1,
      dependencies: ['004-test'],
      priority: 5,
    },
  ];

  // 创建执行器
  const projectPath = '/tmp/stratix-example-project';
  const executor = new TaskExecutor('example-project', projectPath, {
    type: 'mock',
    timeout: 60000,
  });

  // 监听事件
  executor.on('task-started', ({ taskId, task }) => {
    console.log(`\n✅ Task started: ${task.name} (${taskId})`);
  });

  executor.on('task-progress', ({ taskId, progress }) => {
    process.stdout.write(`\r   Progress: ${progress.toFixed(0)}%`);
  });

  executor.on('task-completed', ({ taskId, success }) => {
    if (success) {
      console.log(`\n✅ Task completed: ${taskId}`);
    } else {
      console.log(`\n❌ Task failed: ${taskId}`);
    }
  });

  executor.on('project-completed', ({ projectId }) => {
    console.log(`\n\n🎉 Project completed: ${projectId}`);
  });

  // 加载任务
  executor.loadTasks(tasks);

  console.log('Starting execution...\n');

  // 开始执行
  await executor.start();

  // 最终进度
  console.log(`\nFinal progress: ${executor.getProgress()}%`);
  console.log(`Status: ${executor.getStatus()}`);
}

// 运行示例
executorExample().catch(console.error);
