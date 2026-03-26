/**
 * SoulTemplateRenderer - 角色模板渲染器
 *
 * 负责将 rawContent + soul 配置渲染为最终的 renderedPrompt
 */

import type { SoulTemplate } from '../config/soulTemplates';
import type { StratixSoulConfig } from '@/stratix-core/stratix-protocol';

/**
 * 渲染配置
 */
export interface RenderOptions {
  includeSkills?: boolean;
  installedSkills?: Array<{ name: string; description: string }>;
  learnedSkills?: Array<{ name: string; level: number; description: string }>;
}

/**
 * 默认的渲染模板
 * 使用 {{}} 占位符，由 Handlebars 或简单替换填充
 */
const DEFAULT_RENDER_TEMPLATE = `{{identity}}

{{#if goals}}
## 目标
{{#each goals}}
- {{this}}
{{/each}}
{{/if}}

{{#if personality}}
## 性格特点
{{personality}}
{{/if}}

{{#if evolutionPrompt}}
{{evolutionPrompt}}
{{/if}}
`;

/**
 * 渲染 SoulTemplate 为最终产物
 */
export function renderSoulTemplate(
  template: SoulTemplate,
  soul?: Partial<StratixSoulConfig>,
  options?: RenderOptions
): string {
  // 优先使用 soul 参数，否则用 template 的 soul
  const soulConfig = soul || template.soul || {
    identity: '',
    goals: [],
    personality: '',
  };

  // 如果有 rawContent，直接使用模板结构
  // 否则使用默认模板
  const templateContent = template.rawContent || buildDefaultContent(soulConfig);

  // 构建渲染上下文
  const context = {
    identity: soulConfig.identity || templateContent,
    goals: soulConfig.goals || [],
    personality: soulConfig.personality || '',
    evolutionPrompt: template.evolutionPrompt || '',
    installedSkills: options?.installedSkills || [],
    learnedSkills: options?.learnedSkills || [],
  };

  // 使用 Handlebars 或简单模板引擎渲染
  return renderWithTemplate(DEFAULT_RENDER_TEMPLATE, context);
}

/**
 * 构建默认内容（当没有 rawContent 时）
 */
function buildDefaultContent(soul: Partial<StratixSoulConfig>): string {
  const parts: string[] = [];

  if (soul.identity) {
    parts.push(soul.identity);
  }

  if (soul.goals && soul.goals.length > 0) {
    parts.push('## 目标\n' + soul.goals.map(g => `- ${g}`).join('\n'));
  }

  if (soul.personality) {
    parts.push(`## 性格特点\n${soul.personality}`);
  }

  return parts.join('\n\n');
}

/**
 * 简单模板渲染（不依赖 Handlebars）
 * 支持 {{variable}} 和 {{#each}} 语法
 */
function renderWithTemplate(template: string, context: Record<string, unknown>): string {
  let result = template;

  // 处理 {{#each}} 循环
  const eachRegex = /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
  result = result.replace(eachRegex, (_, key, innerTemplate) => {
    const array = context[key] as unknown[];
    if (!Array.isArray(array)) return '';
    return array.map((item) => {
      if (typeof item === 'object' && item !== null) {
        // 替换对象内的占位符
        let inner = innerTemplate;
        for (const [k, v] of Object.entries(item)) {
          inner = inner.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
        }
        return inner;
      }
      return innerTemplate.replace(/\{\{this\}\}/g, String(item));
    }).join('');
  });

  // 处理条件块 {{#if}}
  const ifRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
  result = result.replace(ifRegex, (_, key, ifContent, elseContent = '') => {
    const value = context[key];
    if (value && (Array.isArray(value) ? value.length > 0 : value !== '')) {
      return ifContent;
    }
    return elseContent;
  });

  // 处理简单变量替换
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'string') {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    } else if (typeof value === 'number') {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
    }
  }

  // 清理未替换的占位符
  result = result.replace(/\{\{[^}]+\}\}/g, '');

  return result.trim();
}

/**
 * 渲染单个模板的最终提示词
 * 用于保存时生成 renderedPrompt
 */
export function renderTemplatePrompt(
  soul: StratixSoulConfig,
  evolutionPrompt?: string
): string {
  const parts: string[] = [];

  // Identity
  if (soul.identity) {
    parts.push(soul.identity);
  }

  // Goals
  if (soul.goals && soul.goals.length > 0) {
    parts.push('## 目标');
    parts.push(soul.goals.map(g => `- ${g}`).join('\n'));
  }

  // Personality
  if (soul.personality) {
    parts.push(`## 性格特点\n${soul.personality}`);
  }

  // Evolution prompt
  if (evolutionPrompt) {
    parts.push(evolutionPrompt);
  }

  return parts.join('\n\n');
}

export default {
  renderSoulTemplate,
  renderTemplatePrompt,
};
