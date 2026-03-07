import { BlueprintIntegration } from '@/stratix-blueprint/BlueprintIntegration';
import { SplitStrategy, ParsedTask } from '@/stratix-ai-service/types';

async function blueprintExample() {
  console.log('=== Blueprint Integration Example ===\n');

  const integration = new BlueprintIntegration();

  // 示例需求
  const requirement = `
    创建一个简单的待办事项应用：
    - 用户可以添加、编辑、删除待办事项
    - 支持标记完成状态
    - 数据保存到本地存储
    - 界面简洁美观
  `;

  console.log('需求:', requirement);
  console.log('\n--- 开始生成蓝图 ---\n');

  try {
    // 策略1: 按流程顺序
    console.log('策略1: 按流程顺序拆分');
    const result1 = await integration.generateBlueprint(
      requirement,
      'sequential',
      {
        onToken: (token) => process.stdout.write(token),
        onComplete: () => console.log('\n✅ 完成'),
        onError: (error) => console.error('❌ 错误:', error),
      }
    );

    if (result1.success) {
      console.log('\n生成的任务:');
      result1.tasks?.forEach((task, index) => {
        console.log(`${index + 1}. ${task.name} (P${task.priority})`);
        console.log(`   类型: ${task.type}`);
        console.log(`   描述: ${task.description}`);
        console.log(`   依赖: ${task.dependencies.join(', ') || '无'}`);
        console.log('');
      });

      console.log(`总任务数: ${result1.tasks?.length}`);
      console.log(`节点数: ${result1.nodes?.length}`);
      console.log(`连线数: ${result1.edges?.length}`);
    }

    console.log('\n--- 尝试其他策略 ---\n');

    // 策略2: 按任务类型
    console.log('策略2: 按任务类型拆分');
    const result2 = await integration.generateBlueprint(requirement, 'by_type');
    console.log(`任务数: ${result2.tasks?.length}`);

    // 策略3: 按优先级
    console.log('\n策略3: 按优先级拆分');
    const result3 = await integration.generateBlueprint(requirement, 'by_priority');
    console.log(`任务数: ${result3.tasks?.length}`);

    console.log('\n=== 测试降级策略 ===\n');

    // 测试错误处理
    console.log('测试: 使用无效需求触发降级');
    const fallbackResult = await integration.generateBlueprint(
      '',
      'sequential',
      {
        onToken: () => {},
        onComplete: () => {},
        onError: (error) => console.log('预期错误:', error.message),
      }
    );

    if (fallbackResult.success) {
      console.log('✅ 降级成功，使用手动模式');
      console.log('手动任务:', fallbackResult.tasks?.map(t => t.name));
    }

  } catch (error) {
    console.error('示例运行失败:', error);
  }
}

// 运行示例
blueprintExample().catch(console.error);
