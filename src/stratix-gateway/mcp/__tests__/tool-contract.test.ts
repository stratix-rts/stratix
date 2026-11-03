/**
 * 文件职责：工具面**契约自洽性**的单测 —— 两条与实现无关、只与"契约本身"有关的铁律：
 *   ① 工具描述里提到的每个 `stratix_*` 工具名都必须真实存在（悬空引用会让 agent 按图索骥扑空：
 *      描述叫它去用一个没有的工具，agent 会浪费轮次去找、猜、或者自己编一个）；
 *   ② inputSchema 里带 `default` 的属性，其 `default` 必须落在自己的 `enum` 内
 *      （default 不在 enum 里 = 契约自相矛盾，严格模式的 schema 校验器会直接拒收这张 schema）。
 * 输入：默认工具清单（DEFAULT_MCP_TOOLS —— 与 tools/list 同一份来源，不是另抄一份）。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不在这里替实现兜底 —— 本文件只断言"契约自洽"，发现不自洽就应当改 schema / 描述本身；
 *   2. 不用正则去匹配整份文档 —— 只断言 tools/list 里暴露给客户端的那一层（描述 + inputSchema）；
 *   3. 不抄一份工具名清单当白名单 —— 白名单必须来自注册表本身，否则新工具一上线就要改两处。
 */

import { buildToolRegistry } from '../registry';
import { DEFAULT_MCP_TOOLS } from '../server';

const registry = buildToolRegistry(DEFAULT_MCP_TOOLS);
const TOOL_NAMES = new Set(registry.listTools().map((tool) => tool.name));

/** 从一段文本里抠出 `stratix_*` 形态的工具名（描述里的交叉指路）。 */
function referencedToolNames(text: string): string[] {
  return [...new Set(text.match(/stratix_[a-z_]+/g) ?? [])];
}

describe('工具面契约自洽', () => {
  it('每件工具的描述里提到的工具名都真实存在（无悬空引用）', () => {
    const dangling: string[] = [];
    for (const tool of registry.listTools()) {
      for (const referenced of referencedToolNames(tool.description)) {
        if (!TOOL_NAMES.has(referenced)) {
          dangling.push(`${tool.name} → ${referenced}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it('chat_send 的描述不再指向不存在的读历史工具', () => {
    const chatSend = registry.getTool('stratix_chat_send');
    expect(chatSend).toBeDefined();
    expect(chatSend?.description).not.toContain('stratix_chat_history');
  });

  it('所有带 default 的枚举参数：default 必须在自己的 enum 内', () => {
    const offenders: string[] = [];
    for (const tool of registry.listTools()) {
      for (const [property, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
        if (!schema.enum || schema.default === undefined) continue;
        if (!schema.enum.includes(schema.default as string)) {
          offenders.push(`${tool.name}.${property}: default=${String(schema.default)} ∉ enum`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('task_assign 的 origin：enum 含 mcp（与 default 同值），且不含 ui', () => {
    const taskAssign = registry.getTool('stratix_task_assign');
    const origin = taskAssign?.inputSchema.properties?.origin;
    expect(origin?.default).toBe('mcp');
    expect(origin?.enum).toEqual(['mcp', 'agent', 'script']);
  });
});
