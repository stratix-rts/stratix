/**
 * Agency-Agents Markdown 解析器
 * 将 agency-agents 仓库的 .md 文件解析为 AgentTemplate
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  AgentTemplate,
  AgentDomain,
  MixinType,
  WorkflowDefinition,
  WorkflowStep,
  AgentRule,
  TemplateSkill,
  SuccessMetric,
  RulePriority,
} from '../types/template';

interface ParsedSection {
  title: string;
  content: string;
  level: number;
}

interface ParseResult {
  sections: Map<string, ParsedSection>;
  frontmatter: Record<string, unknown>;
}

/**
 * 从 agency-agents 仓库解析 Markdown 文件
 */
export class AgencyAgentsParser {
  private static readonly SECTION_PATTERNS = [
    /^(#{1,6})\s+(.+)$/gm,
  ];

  /**
   * 解析 Markdown 文件内容
   */
  parse(markdown: string, filePath: string): AgentTemplate {
    const parsed = this.parseMarkdownStructure(markdown);
    const domain = this.extractDomain(filePath);
    const id = this.extractId(filePath, parsed);

    return {
      id,
      name: this.extractName(parsed, filePath),
      version: '1.0.0',
      description: this.extractDescription(parsed),
      domain,
      tags: this.extractTags(parsed, filePath),
      mixins: this.extractMixins(parsed),

      identity: this.extractIdentity(parsed),
      personality: this.extractPersonality(parsed),
      tone: this.extractTone(parsed),

      mission: this.extractMission(parsed),
      workflows: this.extractWorkflows(parsed),

      rules: this.extractRules(parsed),
      constraints: this.extractConstraints(parsed),
      forbiddenActions: this.extractForbiddenActions(parsed),

      skills: this.extractSkills(parsed),
      workflowSteps: this.extractWorkflowSteps(parsed),
      successMetrics: this.extractSuccessMetrics(parsed),

      resourceLimits: undefined,
      compliance: undefined,

      metadata: {
        source: 'agency-agents',
        createdAt: new Date().toISOString(),
        language: this.detectLanguage(parsed),
      },
    };
  }

  /**
   * 解析文件并返回 AgentTemplate
   */
  async parseFile(filePath: string): Promise<AgentTemplate> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return this.parse(content, filePath);
  }

  /**
   * 批量导入目录中的所有模板
   */
  async importDirectory(directoryPath: string): Promise<AgentTemplate[]> {
    const templates: AgentTemplate[] = [];
    const errors: string[] = [];

    const files = await this.findMarkdownFiles(directoryPath);

    for (const file of files) {
      try {
        const template = await this.parseFile(file);
        templates.push(template);
      } catch (error) {
        errors.push(`Failed to parse ${file}: ${error}`);
        console.error(`Failed to parse ${file}:`, error);
      }
    }

    console.log(`Imported ${templates.length} templates, ${errors.length} failures`);
    return templates;
  }

  /**
   * 递归查找所有 .md 文件
   */
  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const mdFiles: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('_') && entry.name !== 'node_modules') {
          const subFiles = await this.findMarkdownFiles(fullPath);
          mdFiles.push(...subFiles);
        }
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
        mdFiles.push(fullPath);
      }
    }

    return mdFiles;
  }

  /**
   * 解析 Markdown 结构
   */
  private parseMarkdownStructure(markdown: string): ParseResult {
    const sections = new Map<string, ParsedSection>();
    const lines = markdown.split('\n');

    let currentSection: ParsedSection | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headerMatch) {
        // 保存上一个 section
        if (currentSection) {
          currentSection.content = currentContent.join('\n').trim();
          sections.set(currentSection.title.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, ''), currentSection);
        }

        // 开始新的 section
        const level = headerMatch[1].length;
        const title = headerMatch[2].trim();
        currentSection = { title, content: '', level };
        currentContent = [];
      } else {
        currentContent.push(line);
      }
    }

    // 保存最后一个 section
    if (currentSection) {
      currentSection.content = currentContent.join('\n').trim();
      sections.set(
        currentSection.title.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, ''),
        currentSection
      );
    }

    return {
      sections,
      frontmatter: this.parseFrontmatter(markdown),
    };
  }

  /**
   * 解析 YAML frontmatter
   */
  private parseFrontmatter(markdown: string): Record<string, unknown> {
    const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) return {};

    const frontmatter: Record<string, unknown> = {};
    const lines = match[1].split('\n');

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        frontmatter[key] = value;
      }
    }

    return frontmatter;
  }

  /**
   * 提取领域分类
   */
  private extractDomain(filePath: string): AgentDomain {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const match = normalizedPath.match(/\/([a-z-]+)\/[^/]+\.md/);
    if (match) {
      const domain = match[1] as AgentDomain;
      const validDomains: AgentDomain[] = [
        'engineering', 'design', 'paid-media', 'sales', 'marketing',
        'product', 'project-management', 'testing', 'support',
        'spatial-computing', 'specialized', '_mixins'
      ];
      if (validDomains.includes(domain)) {
        return domain;
      }
    }
    return 'specialized';
  }

  /**
   * 提取 ID
   */
  private extractId(filePath: string, _parsed: ParseResult): string {
    const domain = this.extractDomain(filePath);
    const filename = path.basename(filePath, path.extname(filePath));
    return `${domain}/${filename.toLowerCase().replace(/\s+/g, '-')}`;
  }

  /**
   * 提取名称
   */
  private extractName(parsed: ParseResult, filePath: string): string {
    // 尝试从 identity section 提取
    const identitySection = this.findSection(parsed, ['identity', 'identity & personality', 'identity and personality']);
    if (identitySection) {
      const nameMatch = identitySection.content.match(/\*\*Name:\*\*\s*(.+)/i);
      if (nameMatch) return nameMatch[1].trim();

      const lines = identitySection.content.split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        const firstLine = lines[0].replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim();
        if (firstLine && firstLine.length < 100) {
          return firstLine;
        }
      }
    }

    // 使用文件名
    return path.basename(filePath, path.extname(filePath))
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * 提取描述
   */
  private extractDescription(parsed: ParseResult): string {
    const missionSection = this.findSection(parsed, ['mission', 'core mission', 'overview', 'summary']);
    if (missionSection) {
      const lines = missionSection.content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      if (lines.length > 0) {
        return lines.slice(0, 3).join(' ').substring(0, 500);
      }
    }
    return '';
  }

  /**
   * 提取标签
   */
  private extractTags(parsed: ParseResult, filePath: string): string[] {
    const tags: string[] = [];

    // 从文件名提取
    const filename = path.basename(filePath, path.extname(filePath));
    const words = filename.split(/[-_]/).filter(w => w.length > 2 && w.length < 20);
    tags.push(...words.map(w => w.toLowerCase()));

    // 从 domain 提取
    const domain = this.extractDomain(filePath);
    tags.push(domain);

    // 去重并限制数量
    return [...new Set(tags)].slice(0, 10);
  }

  /**
   * 提取 mixins
   */
  private extractMixins(parsed: ParseResult): MixinType[] {
    const mixins: MixinType[] = [];

    // 检查是否包含安全相关内容
    const rulesSection = this.findSection(parsed, ['rules', 'critical rules', 'guidelines']);
    if (rulesSection?.content.toLowerCase().includes('security')) {
      mixins.push('base');
    }

    // 检查是否包含资源限制
    if (rulesSection?.content.toLowerCase().includes('rate limit')) {
      mixins.push('resource');
    }

    // 检查是否包含合规内容
    if (rulesSection?.content.toLowerCase().includes('gdpr') ||
        rulesSection?.content.toLowerCase().includes('hipaa')) {
      mixins.push('compliance');
    }

    return mixins.length > 0 ? mixins : ['base'];
  }

  /**
   * 提取身份定义
   */
  private extractIdentity(parsed: ParseResult): string {
    const section = this.findSection(parsed, ['identity', 'identity & personality', 'identity and personality']);
    if (!section) return '';

    const lines = section.content.split('\n');
    const identityLines: string[] = [];
    let skipNext = false;

    for (const line of lines) {
      if (line.startsWith('## ') || line.startsWith('**')) {
        if (line.match(/\*\*(Identity|Name)\*\*/i)) {
          skipNext = true;
          continue;
        }
        if (line.startsWith('## ') && identityLines.length > 0) {
          break;
        }
      }
      if (skipNext) {
        skipNext = false;
        continue;
      }
      const cleaned = line.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim();
      if (cleaned && !cleaned.startsWith('#')) {
        identityLines.push(cleaned);
      }
    }

    return identityLines.join(' ').trim().substring(0, 1000);
  }

  /**
   * 提取个性特征
   */
  private extractPersonality(parsed: ParseResult): string {
    const section = this.findSection(parsed, ['personality', 'personality traits', 'characteristics']);
    if (!section) return '';

    const lines = section.content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    return lines.join(' ').substring(0, 500);
  }

  /**
   * 提取语气风格
   */
  private extractTone(parsed: ParseResult): string {
    const section = this.findSection(parsed, ['tone', 'communication style', 'speaking style']);
    if (!section) return '';

    const lines = section.content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    return lines.join(' ').substring(0, 200);
  }

  /**
   * 提取核心使命
   */
  private extractMission(parsed: ParseResult): string {
    const section = this.findSection(parsed, ['mission', 'core mission', 'purpose', 'overview']);
    if (!section) return '';

    const lines = section.content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    return lines.join(' ').substring(0, 500);
  }

  /**
   * 提取工作流
   */
  private extractWorkflows(parsed: ParseResult): WorkflowDefinition[] {
    const workflows: WorkflowDefinition[] = [];

    // 查找 workflows section
    const workflowsSection = this.findSection(parsed, ['workflow', 'workflows', 'process', 'workflow process']);

    if (workflowsSection) {
      const lines = workflowsSection.content.split('\n');
      let currentWorkflow: WorkflowDefinition | null = null;
      let currentStepOrder = 0;

      for (const line of lines) {
        const stepMatch = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*/);
        if (stepMatch) {
          if (currentWorkflow) {
            workflows.push(currentWorkflow);
          }
          currentWorkflow = {
            id: `workflow-${workflows.length + 1}`,
            name: stepMatch[2].trim(),
            description: '',
            steps: [],
          };
          currentStepOrder = parseInt(stepMatch[1]);
          continue;
        }

        if (currentWorkflow && line.match(/^-/)) {
          const stepContent = line.replace(/^-\s*/, '').trim();
          currentWorkflow.steps.push({
            id: `step-${currentWorkflow.steps.length + 1}`,
            order: currentStepOrder++,
            name: stepContent.substring(0, 50),
            description: stepContent,
            expectedOutput: '',
          });
        }
      }

      if (currentWorkflow) {
        workflows.push(currentWorkflow);
      }
    }

    return workflows;
  }

  /**
   * 提取工作流步骤
   */
  private extractWorkflowSteps(_parsed: ParseResult): WorkflowStep[] {
    const workflows = this.extractWorkflows(_parsed);
    const steps: WorkflowStep[] = [];

    for (const workflow of workflows) {
      steps.push(...workflow.steps);
    }

    return steps;
  }

  /**
   * 提取规则
   */
  private extractRules(parsed: ParseResult): AgentRule[] {
    const rules: AgentRule[] = [];

    const section = this.findSection(parsed, ['rules', 'critical rules', 'guidelines', 'principles']);
    if (!section) return rules;

    const lines = section.content.split('\n');

    for (const line of lines) {
      const ruleMatch = line.match(/\[(CRITICAL|HIGH|MEDIUM|LOW)\]\s*(.+)/i);
      if (ruleMatch) {
        rules.push({
          id: `rule-${rules.length + 1}`,
          priority: ruleMatch[1].toLowerCase() as RulePriority,
          rule: ruleMatch[2].trim(),
        });
      } else if (line.match(/^[-*]\s*.+/)) {
        const ruleText = line.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim();
        if (ruleText && !ruleText.startsWith('#')) {
          rules.push({
            id: `rule-${rules.length + 1}`,
            priority: 'medium',
            rule: ruleText,
          });
        }
      }
    }

    return rules;
  }

  /**
   * 提取约束
   */
  private extractConstraints(parsed: ParseResult): string[] {
    const section = this.findSection(parsed, ['constraints', 'limitations', 'boundaries']);
    if (!section) return [];

    return section.content
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.replace(/^[-*]\s*/, '').trim())
      .filter(l => l.length > 0);
  }

  /**
   * 提取禁止行为
   */
  private extractForbiddenActions(parsed: ParseResult): string[] {
    const section = this.findSection(parsed, ['never do', 'forbidden', 'prohibited', "don't"]);
    if (!section) return [];

    return section.content
      .split('\n')
      .filter(l => l.trim() && !l.startsWith('#'))
      .map(l => l.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim())
      .filter(l => l.length > 0);
  }

  /**
   * 提取技能
   */
  private extractSkills(parsed: ParseResult): TemplateSkill[] {
    const skills: TemplateSkill[] = [];

    const section = this.findSection(parsed, ['technical deliverables', 'skills', 'capabilities', 'tools']);
    if (!section) return skills;

    // 提取代码块作为技能示例
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let match;
    let lastIndex = 0;

    while ((match = codeBlockRegex.exec(section.content)) !== null) {
      const beforeBlock = section.content.slice(lastIndex, match.index);
      const language = match[1] || 'text';
      const code = match[2].trim();
      const skillName = this.extractSkillName(beforeBlock, skills.length);

      skills.push({
        skillId: `skill-${skills.length + 1}`,
        name: skillName,
        description: this.extractSkillDescription(beforeBlock),
        codeExamples: [{
          language,
          code,
          description: this.extractCodeDescription(beforeBlock),
        }],
        parameters: [],
      });

      lastIndex = match.index + match[0].length;
    }

    // 如果没有代码块，尝试从标题提取
    if (skills.length === 0) {
      const headings = section.content.match(/^#{1,4}\s+(.+)/gm);
      if (headings) {
        for (let i = 0; i < headings.length; i++) {
          const name = headings[i].replace(/^#+\s*/, '').trim();
          if (name && name.length < 50) {
            skills.push({
              skillId: `skill-${i + 1}`,
              name,
              description: `执行 ${name} 相关任务`,
              parameters: [],
            });
          }
        }
      }
    }

    return skills;
  }

  /**
   * 提取技能名称
   */
  private extractSkillName(context: string, index: number): string {
    const lines = context.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const lastLine = lines[lines.length - 1].replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim();
      if (lastLine && lastLine.length < 100) {
        return lastLine;
      }
    }
    return `Skill ${index + 1}`;
  }

  /**
   * 提取技能描述
   */
  private extractSkillDescription(context: string): string {
    const lines = context.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    return lines.join(' ').substring(0, 200);
  }

  /**
   * 提取代码描述
   */
  private extractCodeDescription(context: string): string {
    const lines = context.split('\n').filter(l => l.trim());
    for (const line of lines.reverse()) {
      const cleaned = line.replace(/^[-*]\s*/, '').replace(/\*\*/g, '').trim();
      if (cleaned && !cleaned.startsWith('```')) {
        return cleaned.substring(0, 100);
      }
    }
    return '';
  }

  /**
   * 提取成功指标
   */
  private extractSuccessMetrics(parsed: ParseResult): SuccessMetric[] {
    const metrics: SuccessMetric[] = [];

    const section = this.findSection(parsed, ['success metrics', 'metrics', 'kpis', 'success criteria']);
    if (!section) return metrics;

    const lines = section.content.split('\n');

    for (const line of lines) {
      const metricMatch = line.match(/\*\*(.+?)\*\*:\s*(.+)/);
      if (metricMatch) {
        metrics.push({
          name: metricMatch[1].trim(),
          description: metricMatch[2].trim(),
          measurement: '',
        });
      } else if (line.match(/^[-*]\s*.+/) && metrics.length > 0) {
        const lastMetric = metrics[metrics.length - 1];
        if (!lastMetric.measurement) {
          lastMetric.measurement = line.replace(/^[-*]\s*/, '').trim();
        }
      }
    }

    return metrics;
  }

  /**
   * 检测语言
   */
  private detectLanguage(parsed: ParseResult): string {
    const content = Array.from(parsed.sections.values())
      .map(s => s.content)
      .join(' ')
      .toLowerCase();

    if (content.includes('typescript') || content.includes('javascript')) {
      return 'typescript';
    }
    if (content.includes('python')) {
      return 'python';
    }
    if (content.includes('rust')) {
      return 'rust';
    }
    if (content.includes('go ')) {
      return 'go';
    }
    if (content.includes('java ')) {
      return 'java';
    }
    if (content.includes('c#') || content.includes('csharp')) {
      return 'csharp';
    }

    return 'en';
  }

  /**
   * 查找 section
   */
  private findSection(parsed: ParseResult, names: string[]): ParsedSection | undefined {
    for (const name of names) {
      const normalizedName = name.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '');

      for (const [key, section] of parsed.sections) {
        const normalizedKey = key.replace(/[^\w]/g, '');
        if (normalizedKey.includes(normalizedName) || normalizedName.includes(normalizedKey)) {
          return section;
        }
      }
    }

    return undefined;
  }
}

export default AgencyAgentsParser;
