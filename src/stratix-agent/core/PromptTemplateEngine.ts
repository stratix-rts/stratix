/**
 * PromptTemplateEngine - 提示词模板引擎
 *
 * 支持 {{variable}} 和 {{#each items}} {{/each}} 语法
 * 用于渲染 Zone Context、Agent 提示词等动态内容
 */

export interface TemplateContext {
  [key: string]: unknown;
}

type TemplateFunction = (...args: unknown[]) => string;

export class PromptTemplateEngine {
  private functions: Map<string, TemplateFunction> = new Map();

  constructor() {
    // 注册内置函数
    this.registerBuiltinFunctions();
  }

  /**
   * 注册内置函数
   */
  private registerBuiltinFunctions(): void {
    // date 函数 - 格式化日期
    this.registerFunction('date', (..._args: unknown[]) => {
      const now = new Date();
      return now.toISOString().split('T')[0];
    });

    // upper 函数 - 转大写
    this.registerFunction('upper', (...args: unknown[]) => {
      const str = args[0];
      return String(str || '').toUpperCase();
    });

    // lower 函数 - 转小写
    this.registerFunction('lower', (...args: unknown[]) => {
      const str = args[0];
      return String(str || '').toLowerCase();
    });

    // len 函数 - 获取长度
    this.registerFunction('len', (...args: unknown[]) => {
      const arr = args[0];
      if (Array.isArray(arr)) return String(arr.length);
      if (typeof arr === 'string') return String(arr.length);
      return '0';
    });
  }

  /**
   * 注册自定义函数
   */
  registerFunction(name: string, fn: TemplateFunction): void {
    this.functions.set(name, fn);
  }

  /**
   * 渲染模板
   */
  render(template: string, context: TemplateContext): string {
    let result = template;

    // 处理 {{#each}} 块
    result = this.renderEachBlocks(result, context);

    // 处理 {{#if}} 块
    result = this.renderIfBlocks(result, context);

    // 处理 {{variable}} 插值
    result = this.renderInterpolations(result, context);

    // 处理 {{function()}} 函数调用
    result = this.renderFunctionCalls(result);

    return result;
  }

  /**
   * 渲染插值 {{variable}}
   */
  private renderInterpolations(template: string, context: TemplateContext): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (_match, path) => {
      const value = this.getNestedValue(context, path.trim());
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
      }
      return String(value);
    });
  }

  /**
   * 渲染 {{#each}} 块
   * 格式: {{#each items}} {{name}} {{/each}}
   */
  private renderEachBlocks(template: string, context: TemplateContext): string {
    const eachBlockRegex = /\{\{#each\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)\{\{\/each\}\}/g;

    return template.replace(eachBlockRegex, (_match, arrayPath, innerTemplate) => {
      const array = this.getNestedValue(context, arrayPath.trim());

      if (!Array.isArray(array) || array.length === 0) {
        return '';
      }

      return array.map((item, index) => {
        const itemContext: TemplateContext = {
          ...context,
          this: item,
          index: index,
        };

        // 如果 item 是对象，展开其属性
        if (typeof item === 'object' && item !== null) {
          Object.assign(itemContext, item);
        }

        // 渲染内部模板
        let result = innerTemplate;

        // 处理 {{.}} 表示当前元素
        if (typeof item === 'string') {
          result = result.replace(/\{\{\.\}\}/g, item);
        }

        // 处理 {{index}} 表示索引
        result = result.replace(/\{\{index\}\}/g, String(index));

        return result;
      }).join('');
    });
  }

  /**
   * 渲染 {{#if}} 块
   * 格式: {{#if variable}} content {{/if}} 或 {{#if variable}} content {{else}} alt {{/if}}
   */
  private renderIfBlocks(template: string, context: TemplateContext): string {
    const ifBlockRegex = /\{\{#if\s+(\w+(?:\.\w+)*)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;

    return template.replace(ifBlockRegex, (_match, path, ifContent, elseContent = '') => {
      const value = this.getNestedValue(context, path.trim());

      if (this.isTruthy(value)) {
        return ifContent;
      }
      return elseContent;
    });
  }

  /**
   * 渲染函数调用 {{functionName(arg1, arg2)}}
   */
  private renderFunctionCalls(template: string): string {
    const functionCallRegex = /\{\{(\w+)\(([^)]*)\)\}\}/g;

    return template.replace(functionCallRegex, (match, name, argsStr) => {
      const fn = this.functions.get(name);
      if (!fn) {
        return match; // 保留原样
      }

      const args: string[] = argsStr
        .split(',')
        .map((arg: string) => arg.trim())
        .filter((arg: string) => arg.length > 0)
        .map((arg: string) => {
          // 去掉引号
          if ((arg.startsWith('"') && arg.endsWith('"')) ||
              (arg.startsWith("'") && arg.endsWith("'"))) {
            return arg.slice(1, -1);
          }
          return arg;
        });

      try {
        return fn(...args) || '';
      } catch (e) {
        console.warn(`[PromptTemplateEngine] Function ${name} failed:`, e);
        return '';
      }
    });
  }

  /**
   * 获取嵌套对象的值
   */
  private getNestedValue(obj: TemplateContext, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * 判断值是否为真
   */
  private isTruthy(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object' && value !== null) return true;
    if (typeof value === 'string') return value.length > 0;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'boolean') return value;
    return false;
  }

  /**
   * 编译模板为函数（可选，用于性能优化）
   */
  compile(template: string): (context: TemplateContext) => string {
    return (context: TemplateContext) => this.render(template, context);
  }
}

// 单例导出
export const promptTemplateEngine = new PromptTemplateEngine();

export default PromptTemplateEngine;
