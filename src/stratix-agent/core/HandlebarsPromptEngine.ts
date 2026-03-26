/**
 * HandlebarsPromptEngine - 基于 Handlebars 的提示词模板引擎
 *
 * 支持 Jinja2 风格的模板语法：
 * - {{variable}} 变量插值
 * - {{#if}} / {{else}} / {{/if}} 条件
 * - {{#each}} / {{/each}} 循环
 * - {{> partial_name}} 模板复用
 * - {{{unescaped}}} 不转义输出
 *
 * 目录结构：
 * templates/
 *   partials/
 *     meta/header.hbs, footer.hbs
 *     layers/layer1-role.hbs, layer2-mission.hbs, ...
 *   helpers/index.ts
 *   layouts/full-prompt.hbs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { registerHelpers } from '../templates/helpers';

export interface PromptRenderContext {
  // Agent identity
  agent: {
    name: string;
    identity?: string;
    personality?: string;
    tone?: string;
    values?: string[];
    workingMode?: 'autonomous' | 'collaborative' | 'supervised';
  };

  // Soul config
  soul: {
    identity?: string;
    personality?: string;
    goals?: string[];
    constraints?: string[];
    speakingStyle?: string;
    mission?: string;
    tone?: string;
    values?: string[];
    workingMode?: 'autonomous' | 'collaborative' | 'supervised';
  };

  // Template
  template?: {
    name?: string;
    mission?: string;
    successMetrics?: string;
  };

  // Dynamic content
  memoryContext?: string;
  skills?: Array<{
    name: string;
    description: string;
    level?: number;
  }>;
  learnedSkillsContext?: string;
  recentHistory?: Array<{
    role: string;
    content: string;
  }>;

  // Configuration flags
  config: {
    includeReflection: boolean;
    includeWorkflow: boolean;
    includeSuccessMetrics: boolean;
    includeHistory: boolean;
    includeLearnedSkills: boolean;
    includeZoneContext: boolean;
    maxHistoryLength: number;
    maxContextLength: number;
  };

  // Zone context
  zone?: {
    inZone: boolean;
    currentZone?: {
      zoneId: string;
      title: string;
      prompt: string;
      files: Array<{
        name: string;
        content?: string;
      }>;
      members: string[];
    };
    availableZones?: Array<{
      zoneId: string;
      name: string;
      title?: string;
      prompt?: string;
      agentCount: number;
    }>;
    idlePrompt?: string;
  };

  // Utility
  now?: Date;
}

export class HandlebarsPromptEngine {
  private handlebars: typeof Handlebars;
  private templatesDir: string;
  private compiledTemplates: Map<string, Handlebars.TemplateDelegate> = new Map();

  constructor(templatesDir?: string) {
    this.handlebars = Handlebars.create();
    this.templatesDir = templatesDir || this.getDefaultTemplatesDir();

    // Register helpers
    registerHelpers(this.handlebars);

    // Register partials
    this.registerPartials();
  }

  /**
   * Get default templates directory
   */
  private getDefaultTemplatesDir(): string {
    // This file is at src/stratix-agent/core/HandlebarsPromptEngine.ts
    // Templates are at src/stratix-agent/templates/
    return path.join(__dirname, '..', 'templates');
  }

  /**
   * Register all partials from the partials directory
   */
  private registerPartials(): void {
    const partialsDir = path.join(this.templatesDir, 'partials');

    if (!fs.existsSync(partialsDir)) {
      console.warn(`[HandlebarsPromptEngine] Partials directory not found: ${partialsDir}`);
      return;
    }

    this.registerPartialsRecursive(partialsDir, '');
  }

  /**
   * Recursively register partials from directory
   */
  private registerPartialsRecursive(dir: string, relativePath: string): void {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (stat.isDirectory()) {
        this.registerPartialsRecursive(filePath, relativePath + file + '/');
      } else if (file.endsWith('.hbs')) {
        const partialName = (relativePath + file.replace('.hbs', '')).replace(/\\/g, '/').replace(/\//g, '-');
        const content = fs.readFileSync(filePath, 'utf-8');

        try {
          this.handlebars.registerPartial(partialName, content);
        } catch (e) {
          console.warn(`[HandlebarsPromptEngine] Failed to register partial "${partialName}":`, e);
        }
      }
    }
  }

  /**
   * Compile and cache a template
   */
  private getTemplate(name: string): Handlebars.TemplateDelegate {
    if (this.compiledTemplates.has(name)) {
      return this.compiledTemplates.get(name)!;
    }

    const templatePath = path.join(this.templatesDir, `${name}.hbs`);

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }

    const content = fs.readFileSync(templatePath, 'utf-8');
    const template = this.handlebars.compile(content);

    this.compiledTemplates.set(name, template);
    return template;
  }

  /**
   * Render a named template with context
   */
  render(templateName: string, context: PromptRenderContext): string {
    const template = this.getTemplate(templateName);
    return template({
      ...context,
      now: context.now || new Date(),
    });
  }

  /**
   * Render a template string directly
   */
  renderString(templateString: string, context: PromptRenderContext): string {
    const template = this.handlebars.compile(templateString);
    return template({
      ...context,
      now: context.now || new Date(),
    });
  }

  /**
   * Register a new partial
   */
  registerPartial(name: string, content: string): void {
    this.handlebars.registerPartial(name, content);
  }

  /**
   * Register a custom helper
   */
  registerHelper(name: string, fn: (...args: unknown[]) => unknown): void {
    this.handlebars.registerHelper(name, fn);
  }

  /**
   * Clear compiled template cache
   */
  clearCache(): void {
    this.compiledTemplates.clear();
  }

  /**
   * Get template source for debugging
   */
  getTemplateSource(name: string): string | null {
    const templatePath = path.join(this.templatesDir, `${name}.hbs`);
    if (fs.existsSync(templatePath)) {
      return fs.readFileSync(templatePath, 'utf-8');
    }
    return null;
  }
}

// Singleton instance
let engineInstance: HandlebarsPromptEngine | null = null;

export function getHandlebarsEngine(): HandlebarsPromptEngine {
  if (!engineInstance) {
    engineInstance = new HandlebarsPromptEngine();
  }
  return engineInstance;
}

export default HandlebarsPromptEngine;
