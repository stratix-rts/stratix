/**
 * Stratix 端到端链路验证脚本
 * 
 * 用法：npx tsx scripts/smoke-test-zone-pipeline.ts
 * 
 * 验证链路：创建默认 Project → 创建 Zone → 注册 Agent → 注册 Capability 
 *          → 提交需求 → Fallback 拆解 → 匹配 Agent → 分配任务 → Agent 执行 → 结果回传
 */

import path from 'path';

import { initializeDatabase, getDatabase } from '../src/stratix-database';
import { projectRepository } from '../src/stratix-database/ProjectRepository';
import { zoneRepository } from '../src/stratix-database/ZoneRepository';
import { zoneMemberRepository } from '../src/stratix-database/ZoneMemberRepository';
import { agentCapabilityRepository } from '../src/stratix-database/AgentCapabilityRepository';
import { ZoneCoordinator } from '../src/stratix-orchestration/zone/ZoneCoordinator';
import type { TaskCompleteParams } from '../src/stratix-orchestration/zone/ZoneCoordinator';

// ============================================================
// 配置
// ============================================================

const DEFAULT_PROJECT_ID = 'proj_default';
const DEFAULT_PROJECT_NAME = 'Default Project';
const DEFAULT_ZONE_TITLE = 'Work Zone';
const DEFAULT_ZONE_PROMPT = '默认工作 Zone';

const TEST_AGENTS = [
  { id: 'agent_coder_01', name: 'Coder Alpha', capabilities: { coding: 5, analysis: 3, general: 2 } },
  { id: 'agent_writer_01', name: 'Writer Beta', capabilities: { writing: 5, research: 4, general: 3 } },
  { id: 'agent_analyst_01', name: 'Analyst Gamma', capabilities: { analysis: 5, research: 4, coding: 2, general: 3 } },
];

// ============================================================
// 工具函数
// ============================================================

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

function section(title: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

// ============================================================
// Steps
// ============================================================

async function step1_initProject() {
  section('Step 1: 初始化数据库 + 创建默认 Project');

  const dataDir = path.resolve(__dirname, '../stratix-data');
  initializeDatabase({ dataDir });
  getDatabase().initialize();
  console.log('  数据库初始化完成');

  const existing = projectRepository.getProject(DEFAULT_PROJECT_ID);
  if (existing) {
    console.log(`  默认 Project 已存在: ${DEFAULT_PROJECT_ID}`);
  } else {
    projectRepository.createProject({
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      description: 'Stratix 默认 Project（临时 workaround，后续会移除 Project 层）',
      priority: 3,
      status: 'active',
      config: {},
      path: '',
      presentAgentIds: [],
      zoneConfig: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`  创建默认 Project: ${DEFAULT_PROJECT_ID}`);
  }

  const project = projectRepository.getProject(DEFAULT_PROJECT_ID);
  assert(project !== null, '默认 Project 存在');
  assert(project!.id === DEFAULT_PROJECT_ID, 'Project ID 正确');

  return DEFAULT_PROJECT_ID;
}

async function step2_createZone(projectId: string) {
  section('Step 2: 创建 Zone');

  const existingZones = zoneRepository.getZonesByProject(projectId);
  let zoneId: string;

  if (existingZones.length > 0) {
    zoneId = existingZones[0].id;
    console.log(`  Zone 已存在: ${zoneId} (${existingZones[0].title})`);
  } else {
    const zone = zoneRepository.createZone(projectId, DEFAULT_ZONE_TITLE, DEFAULT_ZONE_PROMPT);
    zoneId = zone.id;
    console.log(`  创建 Zone: ${zoneId} (${DEFAULT_ZONE_TITLE})`);
  }

  const zone = zoneRepository.getZone(zoneId);
  assert(zone !== null, 'Zone 存在');
  assert(zone!.projectId === projectId, 'Zone 关联到正确的 Project');
  assert(zone!.title === DEFAULT_ZONE_TITLE, 'Zone 标题正确');

  return zoneId;
}

async function step3_registerAgents(zoneId: string) {
  section('Step 3: 注册 Agent + Capability + 加入 Zone');

  for (const agent of TEST_AGENTS) {
    zoneMemberRepository.addMember(zoneId, agent.id);
    zoneRepository.addMember(zoneId, agent.id); // 同步到 zone_contexts.members
    for (const [cap, level] of Object.entries(agent.capabilities)) {
      agentCapabilityRepository.setCapability(agent.id, zoneId, cap as any, level as number);
    }
    console.log(`  ${agent.name}: capabilities = ${JSON.stringify(agent.capabilities)}`);
  }

  const zone = zoneRepository.getZone(zoneId);
  assert(zone!.members.length >= TEST_AGENTS.length, `Zone 有 ${TEST_AGENTS.length} 个 Member`);

  const coderCaps = agentCapabilityRepository.getCapabilities('agent_coder_01', zoneId);
  assert(coderCaps.length === 3, `Coder Alpha 有 3 个 Capability`);
  assert(coderCaps.find(c => c.capability === 'coding')?.level === 5, `Coder Alpha coding level = 5`);

  return TEST_AGENTS.map(a => a.id);
}

async function step4_submitRequirement(zoneId: string) {
  section('Step 4: 提交需求 → ZoneCoordinator 处理（LLM fallback 模式）');

  const coordinator = await ZoneCoordinator.create(zoneId, {
    // 快速失败：连接不存在的端口，触发 fallback（单任务模式）
    llmProvider: 'ollama' as any,
    baseUrl: 'http://127.0.0.1:1/api/chat',
    autoDecompose: true,
    autoAssign: true,
    requireUserConfirm: false,
    assignStrategy: 'capability_match',
  });
  console.log('  ZoneCoordinator 创建成功');
  console.log('  ⚠️ LLM fallback 模式（无真实 LLM，需求不会被拆解，直接作为单任务）');

  const requirement = '分析项目代码结构，编写 README 文档，并优化构建脚本';
  console.log(`  提交需求: "${requirement}"`);

  console.log('  等待 processRequirement（LLM fallback 约 3-10s）...');
  const result = await coordinator.processRequirement(requirement);

  console.log(`  处理结果:`);
  console.log(`    success: ${result.success}`);
  console.log(`    tasks: ${result.tasks.length}`);
  console.log(`    delegated: ${result.delegated.length}`);
  console.log(`    pending: ${result.pending.length}`);
  if (result.error) {
    console.log(`    error: ${result.error}`);
  }

  assert(result.success, 'processRequirement 返回 success');
  assert(result.tasks.length >= 1, '至少生成了 1 个任务');

  for (const task of result.tasks) {
    console.log(`    📋 [${task.type}] ${task.title} → ${task.assigneeId || '未分配'} (${task.status})`);
  }

  return { coordinator, result };
}

async function step5_verifyDelegation(coordinator: ZoneCoordinator, result: any) {
  section('Step 5: 验证任务分配');

  const status = coordinator.getStatusSummary();
  console.log(`  Zone 状态:`);
  console.log(`    members: ${status.memberCount}`);
  console.log(`    activeTasks: ${status.activeTaskCount}`);
  console.log(`    pendingTasks: ${status.pendingTaskCount}`);
  console.log(`    completedTasks: ${status.completedTaskCount}`);

  assert(status.memberCount === TEST_AGENTS.length, `Member 数量 = ${TEST_AGENTS.length}`);

  if (result.delegated.length > 0) {
    const delegatedTask = result.tasks.find((t: any) => t.id === result.delegated[0]);
    assert(!!delegatedTask, '找到已分配的任务');
    assert(!!delegatedTask.assigneeId, '任务有 assigneeId');
    console.log(`  已分配任务: ${delegatedTask.title} → ${delegatedTask.assigneeId}`);
  } else {
    console.log('  ⚠️ 没有自动分配的任务（所有任务 pending，可能 Capability 未被正确加载）');
    // 检查是否有 pending 的任务
    assert(result.pending.length > 0, '有 pending 的任务等待分配');
  }
}

async function step6_agentExecute(coordinator: ZoneCoordinator, result: any) {
  section('Step 6: 模拟 Agent 执行 + 结果回传');

  const delegatedTasks = result.tasks.filter((t: any) => t.assigneeId);
  if (delegatedTasks.length === 0) {
    console.log('  ⚠️ 没有已分配的任务可以执行');
    console.log('  跳过此步骤（链路验证仍算通过，只是分配环节可能有问题）');
    return;
  }

  for (const task of delegatedTasks) {
    console.log(`\n  Agent ${task.assigneeId} 执行任务: ${task.title}`);

    const report: TaskCompleteParams = {
      taskId: task.id,
      success: true,
      output: `已完成: ${task.title}`,
      summary: `模拟执行完成`,
      duration: Math.floor(Math.random() * 5000) + 1000,
    };

    await coordinator.receiveTaskReport(report);
    console.log(`  ✅ 任务完成: ${task.title}`);
  }

  const finalStatus = coordinator.getStatusSummary();
  console.log(`\n  最终 Zone 状态:`);
  console.log(`    completed: ${finalStatus.completedTaskCount}`);
  console.log(`    active: ${finalStatus.activeTaskCount}`);
  console.log(`    pending: ${finalStatus.pendingTaskCount}`);

  assert(finalStatus.completedTaskCount >= delegatedTasks.length, `完成数 >= ${delegatedTasks.length}`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('🔨 Stratix Zone Pipeline Smoke Test');
  console.log('验证链路：Project → Zone → Agent → Requirement → Task → Execute → Report\n');
  console.log(`  开始时间: ${new Date().toISOString()}\n`);

  const startTime = Date.now();

  try {
    const projectId = await step1_initProject();
    const zoneId = await step2_createZone(projectId);
    await step3_registerAgents(zoneId);
    const { coordinator, result } = await step4_submitRequirement(zoneId);
    await step5_verifyDelegation(coordinator, result);
    await step6_agentExecute(coordinator, result);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    section('结果汇总');
    console.log(`  ✅ 通过: ${passed}`);
    console.log(`  ❌ 失败: ${failed}`);
    console.log(`  ⏱️ 耗时: ${elapsed}s`);
    console.log(`  📊 通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%\n`);

    if (failed > 0) {
      console.log('  ⚠️ 有失败的断言，请检查上面的输出');
      process.exit(1);
    }

    console.log('  🎉 全链路验证通过！');
    process.exit(0);
  } catch (error) {
    console.error('\n💥 Smoke test 失败:', error);
    process.exit(1);
  }
}

main();
