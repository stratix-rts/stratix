/**
 * 文件职责：工具注册表 —— ToolSpec 集合、按名查找、确定性排序（docs/MCP-SPEC.md §4.1）。
 * 输入：registerTool 的 ToolSpec（name / description / inputSchema / handler / errors / readOnly）。
 * 输出：listTools 的有序工具清单（tools/list 的唯一来源）、getTool 的按名查找。
 * 禁止事项：
 *   1. 让返回顺序依赖注册顺序 / 文件顺序 / 对象键序 —— 顺序抖动会让客户端提示词缓存失效；
 *      本实现按 name 的**码位序**排序（不用 localeCompare：locale 相关排序跨环境不稳定）；
 *   2. 允许重名 —— 重名会让 tools/call 的路由变成「先注册者赢」，是查不出来的歧义；
 *   3. 在注册表里放业务逻辑 —— 注册表只管「有哪些工具、怎么找到它们」；
 *   4. 私自改写 ToolSpec —— 注册项是契约，改写等于悄悄改契约。
 */

import type { ToolSpec } from './types';

export interface ToolRegistry {
  /** 注册一条工具；重名抛错（契约歧义必须当场暴露）。 */
  registerTool(spec: ToolSpec): ToolSpec;
  /** 全部工具，按 name 码位序（确定性顺序）。 */
  listTools(): ToolSpec[];
  /** 按名查找；未注册返回 undefined。 */
  getTool(name: string): ToolSpec | undefined;
  /** 已注册工具数（诊断用）。 */
  readonly size: number;
}

/** name 比较：码位序（稳定、跨环境一致、与 locale 无关）。 */
function compareByName(a: ToolSpec, b: ToolSpec): number {
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

/**
 * 构造一张空注册表。
 * why 是工厂而不是全局单例：单测要能各持一张干净表（工具注册是**全局副作用**，
 * 共享单例会让「上一个用例注册的工具」漏进下一个用例的清单）。
 */
export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, ToolSpec>();

  const registerTool = (spec: ToolSpec): ToolSpec => {
    if (tools.has(spec.name)) {
      throw new Error(`MCP 工具重名：${spec.name}（工具名必须全局唯一）`);
    }
    tools.set(spec.name, spec);
    return spec;
  };

  return {
    registerTool,
    listTools: () => [...tools.values()].sort(compareByName),
    getTool: (name: string) => tools.get(name),
    get size() {
      return tools.size;
    },
  };
}

/**
 * 组装一张注册表（按给定顺序注册；返回顺序恒为 name 码位序）。
 * why 注册顺序与返回顺序解耦：注册顺序是**作者视角**（按域文件写），返回顺序是**客户端视角**
 * （提示词缓存要稳定）。两者在本批恰好一致（三个工具按字典序注册），
 * 但契约只承诺「返回顺序稳定」，不承诺「等于注册顺序」。
 */
export function buildToolRegistry(specs: readonly ToolSpec[]): ToolRegistry {
  const registry = createToolRegistry();
  for (const spec of specs) registry.registerTool(spec);
  return registry;
}
