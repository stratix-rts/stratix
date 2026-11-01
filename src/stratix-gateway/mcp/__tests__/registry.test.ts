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

  it('第一期三件工具的返回顺序与注册顺序一致', () => {
    const registry = buildToolRegistry(DEFAULT_MCP_TOOLS);
    const registered = DEFAULT_MCP_TOOLS.map((tool) => tool.name);
    expect(registry.listTools().map((tool) => tool.name)).toEqual(registered);
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
