import { AIServiceFactory, RequirementParser, TaskSplitter, SplitStrategy } from '../src/stratix-ai-service';

async function example() {
  // 1. 初始化 AI 服务
  const factory = AIServiceFactory.getInstance();
  console.log('AI Config:', factory.getConfig());

  // 2. 检查 Provider 健康状态
  const health = await factory.checkProvidersHealth();
  console.log('Provider Health:', health);

  // 3. 解析需求
  const parser = new RequirementParser();
  
  const requirement = `
    创建一个简单的博客系统：
    - 用户可以注册和登录
    - 用户可以创建、编辑、删除文章
    - 文章支持 Markdown 格式
    - 其他用户可以评论文章
  `;

  console.log('Parsing requirement...');
  const parsed = await parser.parse(requirement, {
    onToken: (token) => process.stdout.write(token),
    onComplete: () => console.log('\n✅ Parsing complete'),
    onError: (error) => console.error('❌ Error:', error)
  });

  console.log('Parsed requirement:', parsed.summary);
  console.log('Found', parsed.tasks.length, 'tasks');

  // 4. 拆分任务（使用不同策略）
  const splitter = new TaskSplitter();
  
  const strategies: SplitStrategy[] = ['sequential', 'by_type', 'by_priority'];
  
  for (const strategy of strategies) {
    console.log(`\n📊 Splitting with strategy: ${strategy}`);
    
    const tasks = await splitter.split(parsed, strategy, {
      onToken: (token) => process.stdout.write(token),
      onComplete: () => console.log('\n✅ Splitting complete'),
      onError: (error) => console.error('❌ Error:', error)
    });

    console.log('Tasks:', tasks.map(t => `${t.name} (P${t.priority})`));
  }

  // 5. 优化任务
  const optimized = splitter.optimize(parsed.tasks);
  console.log('\n✨ Optimized tasks:', optimized.length);
}

// 运行示例
example().catch(console.error);
