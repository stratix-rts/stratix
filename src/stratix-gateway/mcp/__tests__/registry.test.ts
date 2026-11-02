/**
 * 文件职责：MCP 工具注册表的单测 —— 确定性顺序、重名拒绝、按名查找。
 * 输入：无（纯内存注册表）。
 * 输出：jest 断言。
 * 禁止事项：不引入真实 core 依赖 —— 本用例只关心注册表这一层。
 */

import { buildToolRegistry, createToolRegistry } from '../registry';
import { DEFAULT_MCP_TOOLS } from '../server';
import type { ToolSpec } from '../types';

function stubTool(name: string): ToolSpec {
  return {
    name,
    description: `工具 ${name}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => ({ content: [{ type: 'text', text: name }] }),
    errors: [],
    readOnly: true,
  };
}

describe('MCP 工具注册表', () => {
  it('tools/list 按 name 码位序返回，与注册顺序无关', () => {
    const registry = buildToolRegistry([
      stubTool('stratix_world_snapshot'),
      stubTool('stratix_task_assign'),
      stubTool('stratix_task_status'),
    ]);

    expect(registry.listTools().map((tool) => tool.name)).toEqual([
      'stratix_task_assign',
      'stratix_task_status',
      'stratix_world_snapshot',
    ]);
  });

  it('多次读取返回同一顺序（客户端提示词缓存不能因顺序抖动失效）', () => {
    const registry = buildToolRegistry([
      stubTool('stratix_task_status'),
      stubTool('stratix_world_snapshot'),
      stubTool('stratix_task_assign'),
    ]);

    const first = registry.listTools().map((tool) => tool.name);
    const second = registry.listTools().map((tool) => tool.name);
    expect(first).toEqual(second);
  });

  it('工具面返回顺序与注册顺序一致（顺序写在工具自己的 order 字段里）', () => {
    const registry = buildToolRegistry(DEFAULT_MCP_TOOLS);
    const registered = DEFAULT_MCP_TOOLS.map((tool) => tool.name);
    expect(registry.listTools().map((tool) => tool.name)).toEqual(registered);
  });

  it('工具面按清单位次返回（十二件，顺序固定）', () => {
    const registry = buildToolRegistry(DEFAULT_MCP_TOOLS);
    expect(registry.listTools().map((tool) => tool.name)).toEqual([
      'stratix_world_snapshot', // §2.1
      'stratix_task_assign', //    §2.2
      'stratix_task_status', //    §2.3
      'stratix_task_cancel', //    §2.4
      'stratix_mission_create', // §2.5
      'stratix_mission_status', // §2.6
      'stratix_mission_checkpoint', // §2.9（位次插在 mission 域内）
      'stratix_chat_send', //      §2.7
      'stratix_registry', //      §2.8
      'stratix_session_list', //   §2.10（session 域新开）
      'stratix_session_get', //    §2.11
      'stratix_session_interrupt', // §2.12（session 域写面）
    ]);
  });

  it('session 域的三件工具排在既有九件之后（既有工具相对次序不变）', () => {
    const registry = buildToolRegistry(DEFAULT_MCP_TOOLS);
    const names = registry.listTools().map((tool) => tool.name);
    expect(names.indexOf('stratix_session_list')).toBe(names.indexOf('stratix_registry') + 1);
    expect(names.indexOf('stratix_session_get')).toBe(names.indexOf('stratix_session_list') + 1);
    expect(names.indexOf('stratix_session_interrupt')).toBe(
      names.indexOf('stratix_session_get') + 1
    );
  });

  it('新工具插在 mission_status 之后、registry 之前（mission 域聚拢，既有工具相对次序不变）', () => {
    const registry = buildToolRegistry(DEFAULT_MCP_TOOLS);
    const names = registry.listTools().map((tool) => tool.name);
    expect(names.indexOf('stratix_mission_checkpoint')).toBe(
      names.indexOf('stratix_mission_status') + 1
    );
    expect(names.indexOf('stratix_mission_checkpoint')).toBeLessThan(
      names.indexOf('stratix_registry')
    );
  });

  it('没有显式排序位的工具排在有排序位的之后，仍按 name 码位序（兜底口径）', () => {
    const registry = buildToolRegistry([
      { ...stubTool('stratix_zzz_late') },
      { ...stubTool('stratix_aaa_late') },
      { ...stubTool('stratix_task_status'), order: 3 },
    ]);

    expect(registry.listTools().map((tool) => tool.name)).toEqual([
      'stratix_task_status',
      'stratix_aaa_late',
      'stratix_zzz_late',
    ]);
  });

  it('同名重复注册直接报错（工具名歧义必须当场暴露）', () => {
    const registry = createToolRegistry();
    registry.registerTool(stubTool('stratix_task_assign'));
    expect(() => registry.registerTool(stubTool('stratix_task_assign'))).toThrow(/重名/);
  });

  it('getTool 按名查找，未注册返回 undefined', () => {
    const registry = buildToolRegistry([stubTool('stratix_task_status')]);
    expect(registry.getTool('stratix_task_status')?.name).toBe('stratix_task_status');
    expect(registry.getTool('stratix_task_assign')).toBeUndefined();
  });
});
