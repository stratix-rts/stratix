# Stratix StratixAgent 设计方案
**版本**: 1.0  
**创建日期**: 2026-03-15  
**状态**: 设计文档
---
## 1. 背景与目标
### 1.1 背景
当前 Stratix 项目中存在两种 Agent 运行模式：
1. **OpenClaw 模式**: 通过复杂的Gateway 连接远程 OpenClaw 实例
2. **Direct LLM 模式**: 仅完成服务层，尚未集成完整的 Agent 功能
用户需要一个轻量级的、类似 OpenClaw 机制的 Agent 解决方案，无需复杂的 Gateway，直接在本地运行，具备配置、记忆、技能等完整能力。
### 1.2 设计目标
| 目标 | 描述 | 优先级|
|------|------|--------|
| **轻量** | 无 Gateway 依赖，直接运行 | P0 |
| **可移植** | 类似 OpenClaw 的文件结构| P0 |
| **持久化** | 本地存储配置 + 记忆 | P0 |
| **可扩展** | 支持 Skills 动加载 | P1 |
| **可配置** | 支持多 Provider (OpenAI/Anthropic/Ollama) | P0 |
| **记忆管理** | 短期记忆 + 长期记忆 | P1 |
### 1.3 非目标
- 不实现 WebSocket 实时通信（与 Stratix Gateway 区分）
- 不实现多实例管理（单个 Agent 运行）
- 不实现复杂的任务队列（简单对话 + 技能执行）
---
## 2. 架构设计
### 2.1 系统架构
```
┌─────────────────────────────────────────────────────────────┐
│                      StratixAgent                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Chat API   │  │  Skill API   │  │  Memory API      │  │
│  └───────┬──────┘  └───────┬──────┘  └──────────┬─────────┘  │
└──────────┼──────────────────┼──────────────────┼────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                   Agent Engine                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │ PromptBuilder│ │ LLMConnector │ │ SkillExecutor│          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  Storage Layer                               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐     │
│  │ Config  │  │  Soul   │  │ Memory  │  │  Skills     │     │
│  └─────────┘  └─────────┘  └─────────┘  └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
```
### 2.2 目录结构
```
stratix-data/                         # Agent 数据根目录
├── agents/                           # Agent 实例目录
│  └── {agentId}/
│      ├── config.json               # Agent 基础配置
│      ├── soul.json                 # 角色设定
│      ├── memory/
│      │  ├── short-term.json       # 短期记忆 (会话历史)
│      │  └── long-term.json        # 长期记忆
│      ├── skills/
│      │  ├── enabled.json          # 已启用的技能列表
│      │  └── {skillId}.json        # 技能配置
│      ├── rules.json                # 行为规则
│      └── sessions/
│          └── {timestamp}.json      # 会话历史
├── skills-lib/                       # 技能库 (系统预置)
│  ├── index.json                   # 技能索引
│  ├── web_search.json
│  ├── file_read.json
│  ├── execute_code.json
│  └── ...
└── config.json                       # 全局配置
```
### 2.3 模块设计
#### 2.3.1 StratixAgent (主类)
```typescript
// src/stratix-agent/StratixAgent.ts
export class StratixAgent {
  // 属性  agentId: string;
  config: AgentConfig;
  soul: SoulConfig;
  memory: MemoryManager;
  skills: SkillRegistry;
  llm: LLMConnector;
  // 生命周期
  async initialize(agentId: string): Promise<void>
  async dispose(): Promise<void>
  // 核心API
  async chat(message: string, sessionId?: string): Promise<AgentResponse>
  async executeSkill(skillId: string, params: Record<string, any>): Promise<SkillResult>
  // 配置管理
  async updateConfig(config: Partial<AgentConfig>): Promise<void>
  async updateSoul(soul: Partial<SoulConfig>): Promise<void>
  // 记忆管理
  async addLongTermMemory(content: string): Promise<void>
  async searchMemory(query: string): Promise<string[]>
  async clearShortTerm(): Promise<void>
}
```
#### 2.3.2 LLMConnector (LLM 连接器
基于 MemoryOS 的 OpenAIClient 设计，支持多 Provider。
**重要**: Anthropic 需要使用独立的 `anthropic` SDK，不能通过 OpenAI SDK 兼容。
```typescript
// src/stratix-agent/core/LLMConnector.ts
import { OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'deepseek' | 'qwen' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;           // 自定义端点
  temperature?: number;
  maxTokens?: number;
  // Anthropic 专用
  anthropicVersion?: string;  // 默认: '2023-06-01'
}
#### 2.3.2.1 Token 上下文管理器
  // 转换消息格式 (OpenAI -> Anthropic)
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'error';
}
export class LLMConnector {
  private config: LLMConfig;
  private openaiClient: OpenAI | null;
  private anthropicClient: Anthropic | null;
  constructor(config: LLMConfig) {
    this.config = config;
    this.openaiClient = null;
    this.anthropicClient = null;
  }
  // 获取 OpenAI 兼容客户端
  private getOpenAIClient(): OpenAI {
    if (!this.openaiClient) {
      const baseUrl = this.config.baseUrl || this.getDefaultBaseUrl();
      this.openaiClient = new OpenAI({
        apiKey: this.config.apiKey,
        baseURL: baseUrl,
      });
    }
    return this.openaiClient;
  }
  // 获取 Anthropic 客户端
  private getAnthropicClient(): Anthropic {
    if (!this.anthropicClient) {
      this.anthropicClient = new Anthropic({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseUrl, // 可选代理
      });
    }
    return this.anthropicClient;
  }
  // 判断是否使用 Anthropic
  private isAnthropic(): boolean {
    return this.config.provider === 'anthropic';
  }
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface GenerateResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'error';
}
export class LLMConnector {
  private config: LLMConfig;
  private client: OpenAI | Anthropic | null;
  constructor(config: LLMConfig) {
    this.config = config;
    this.client = this.createClient();
  }
  private createClient(): any {
    const baseUrl = this.config.baseUrl || this.getDefaultBaseUrl();
    // 统一使用 OpenAI SDK，过 baseUrl 切换 Provider
    return new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: baseUrl,
    });
  }
  private getDefaultBaseUrl(): string {
    switch (this.config.provider) {
      case 'openai':
        return 'https://api.openai.com/v1';
      case 'anthropic':
        return 'https://api.anthropic.com';
      case 'ollama':
        return 'http://localhost:11434/v1';
      case 'deepseek':
        return 'https://api.deepseek.com/v1';
      case 'qwen':
        return 'https://dashscope.aliyuncs.com/compatible-mode/v1';
      default:
        return 'https://api.openai.com/v1';
    }
  }
  // 转换消息格式 (OpenAI -> Anthropic)
  // 注：Anthropic API 直接支持 system 参数，无需转换 system 消息
  private convertToAnthropicFormat(messages: ChatMessage[]): { role: string; content: string }[] {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  }
  async generate(messages: ChatMessage[]): Promise<GenerateResult> {
    if (this.isAnthropic()) {
      return this.generateAnthropic(messages);
    }
    return this.generateOpenAICompatible(messages);
  }
  // Anthropic 专用生成方法
  private async generateAnthropic(messages: ChatMessage[]): Promise<GenerateResult> {
    const client = this.getAnthropicClient();
    // 分离 system 消息
    const systemMessage = messages.find(m => m.role === 'system');
    const conversationMessages = messages.filter(m => m.role !== 'system');
    const response = await client.messages.create({
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0.7,
      system: systemMessage?.content,
      messages: this.convertToAnthropicFormat(conversationMessages),
    });
    const content = response.content[0]?.type === 'text' 
      ? response.content[0].text 
      : '';
    return {
      content,
      usage: response.usage ? {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      } : undefined,
      finishReason: response.stop_reason === 'end_turn' ? 'stop' : 'length',
    };
  }
  // OpenAI 兼容 API 生成方法
  private async generateOpenAICompatible(messages: ChatMessage[]): Promise<GenerateResult> {
    const client = this.getOpenAIClient();
    const response = await client.chat.completions.create({
      model: this.config.model,
      messages: messages as any,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
    });
    return {
      content: response.choices[0]?.message?.content || '',
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      finishReason: response.choices[0]?.finish_reason || 'stop',
    };
  }
  async generateStream(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void
  ): Promise<GenerateResult> {
    if (this.isAnthropic()) {
      // Anthropic 不支持流式返回格式完全兼容，这里简化处理
      const result = await this.generate(messages);
      // 模拟流式输出
      for (const char of result.content) {
        onChunk(char);
        await new Promise(r => setTimeout(r, 10));
      }
      return result;
    }
    const client = this.getOpenAIClient();
    const stream = await client.chat.completions.create({
      model: this.config.model,
      messages: messages as any,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 4096,
      stream: true,
    });
    let fullContent = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullContent += content;
        onChunk(content);
      }
    }
    return { content: fullContent, finishReason: 'stop' };
  }
  async testConnection(): Promise<{ success: boolean; message: string; latency?: number }> {
    const start = Date.now();
    try {
      const result = await this.generate([
        { role: 'user', content: 'Hi' }
      ]);
      const latency = Date.now() - start;
      if (result.content) {
        return { success: true, message: `Connected to ${this.config.provider}`, latency };
      }
      return { success: false, message: 'No response from model' };
    } catch (error) {
      return { 
        success: false, 
        message: error instanceof Error ? error.message : 'Connection failed' 
      };
    }
    }
  }
}
```
**支持多 Provider**。
| Provider | baseUrl | SDK | 说明 |
|----------|---------|-----|------|
| OpenAI | `https://api.openai.com/v1` | openai | GPT-4, GPT-3.5 |
| Anthropic | `https://api.anthropic.com` | @anthropic-ai/sdk | Claude 系列 |
| DeepSeek | `https://api.deepseek.com/v1` | openai | DeepSeek-R1 |
| 阿里 Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | openai | Qwen 系列 |
| Ollama | `http://localhost:11434/v1` | openai | 本地模型 |
| 自定义| 任意 | openai | 兼容 OpenAI API 的端点|
#### 2.3.2.1 Token 上下文管理器
防止对话超出模型上下文窗口限制。
```typescript
// src/stratix-agent/core/TokenManager.ts
export interface TokenLimit {
  maxTokens: number;        // 模型最大上下文
  reservedForResponse: number; // 预留响应空间
}
export class TokenManager {
  private modelLimits: Map<string, TokenLimit> = new Map([
    ['gpt-4', { maxTokens: 8192, reservedForResponse: 2048 }],
    ['gpt-4-turbo', { maxTokens: 128000, reservedForResponse: 4096 }],
    ['gpt-3.5-turbo', { maxTokens: 16385, reservedForResponse: 2048 }],
    ['claude-3-opus', { maxTokens: 200000, reservedForResponse: 4096 }],
    ['claude-3-sonnet', { maxTokens: 200000, reservedForResponse: 4096 }],
    ['claude-3-haiku', { maxTokens: 200000, reservedForResponse: 4096 }],
    ['deepseek-chat', { maxTokens: 32768, reservedForResponse: 4096 }],
  ]);
  constructor(private model: string) {}
  // 估算 token 数量 (简单实现，建议使用 tiktoken)
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
  // 计算消息列表的总 token 数
  calculateMessagesTokenCount(messages: ChatMessage[]): number {
    return messages.reduce((sum, msg) => {
      return sum + this.estimateTokens(msg.content) + 4; // +4 每条消息 overhead
    }, 0);
  }
  // 裁剪消息以适应上下文限制
  truncateMessages(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
    const limit = this.getTokenLimit();
    const availableTokens = limit.maxTokens - limit.reservedForResponse - maxTokens;
    if (this.calculateMessagesTokenCount(messages) <= availableTokens) {
      return messages;
    }
    // 保留 system 消息，从后向前裁剪
    const systemMsg = messages.find(m => m.role === 'system');
    let truncated: ChatMessage[] = systemMsg ? [systemMsg] : [];
    const nonSystem = messages.filter(m => m.role !== 'system');
    // 从最新的消息开始添加
    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msg = nonSystem[i];
      const currentTokens = this.calculateMessagesTokenCount(truncated);
      const msgTokens = this.estimateTokens(msg.content) + 4;
      if (currentTokens + msgTokens <= availableTokens) {
        truncated.unshift(msg);
      } else {
        break; // 达到限制
      }
    }
    return truncated;
  }
  private getTokenLimit(): TokenLimit {
    return this.modelLimits.get(this.model) || { maxTokens: 4096, reservedForResponse: 1024 };
  }
}
#### 2.3.3 MemoryManager (记忆管理器
轻量化设计，参考MemoryOS 的分层架构，但去掉重型向量依赖。
```typescript
// src/stratix-agent/core/MemoryManager.ts
// ========== 数据结构 ==========
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}
export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  importance: 1 | 2 | 3;        // 1:低 2:中 3:高
  tags?: string[];
  createdAt: string;
}
// 记忆表
export interface MemoryLayers {
  shortTerm: ChatMessage[];      // 短期：最近对话
  midTerm: MemoryEntry[];        // 中期：重要对话摘要
  longTerm: MemoryEntry[];       // 长期：用户画像知识
}
// ========== 轻量记忆管理器==========
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
export class MemoryManager {
  // 配置
  private maxShortTerm: number;   // 最大短期记忆条目
  private maxMidTerm: number;     // 最大中期记忆条目
  private maxLongTerm: number;    // 最大长期记忆条目
  
  // 存储
  private shortTerm: ChatMessage[] = [];
  private midTerm: MemoryEntry[] = [];
  private longTerm: MemoryEntry[] = [];
  // 文件存储
  private storagePath: string;
  constructor(options: {
    maxShortTerm?: number;      // 默认: 20
    maxMidTerm?: number;        // 默认: 50
    maxLongTerm?: number;       // 默认: 100
    storagePath?: string;       // 存储路径
  } = {}) {
    this.maxShortTerm = options.maxShortTerm ?? 20;
    this.maxMidTerm = options.maxMidTerm ?? 50;
    this.maxLongTerm = options.maxLongTerm ?? 100;
    this.storagePath = options.storagePath || './memory';
  }
  // ========== 短期记忆 (FIFO 队列) ==========
  addMessage(role: 'user' | 'assistant', content: string): void {
    const message: ChatMessage = {
      role,
      content,
      timestamp: new Date().toISOString(),
    };
    this.shortTerm.push(message);
    // 超过上限时移除最旧的
    if (this.shortTerm.length > this.maxShortTerm) {
      const removed = this.shortTerm.shift();
      // 可：将移除的转为中期记忆
      if (removed) {
        this.promoteToMidTerm(removed);
      }
    }
  }
  getRecentMessages(count?: number): ChatMessage[] {
    if (count) {
      return this.shortTerm.slice(-count);
    }
    return [...this.shortTerm];
  }
  clearShortTerm(): void {
    this.shortTerm = [];
  }
  // ========== 中期记忆 (可择实现) ==========
  private promoteToMidTerm(message: ChatMessage): void {
    // 简单策略：保留重要对话的摘要    const entry: MemoryEntry = {
      id: this.generateId(),
      title: this.extractTitle(message.content),
      content: message.content,
      importance: 2,
      createdAt: message.timestamp || new Date().toISOString(),
    };
    this.midTerm.push(entry);
    // 超过上限移除最旧的
    if (this.midTerm.length > this.maxMidTerm) {
      this.midTerm.shift();
    }
  }
  // ========== 长期记忆 (用户画像/知识) ==========
  addLongTermMemory(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): void {
    const newEntry: MemoryEntry = {
      ...entry,
      id: this.generateId(),
      createdAt: new Date().toISOString(),
    };
    this.longTerm.push(newEntry);
    // 超过上限移除最低优先级的
    if (this.longTerm.length > this.maxLongTerm) {
      this.longTerm.sort((a, b) => b.importance - a.importance);
      this.longTerm.pop();
    }
  }
  // 关键词搜索(轻量化，无需向量)
  searchLongTerm(query: string): MemoryEntry[] {
    const keywords = query.toLowerCase().split(/\s+/);
    return this.longTerm.filter(entry => {
      const text = `${entry.title} ${entry.content} ${entry.tags?.join(' ')}`.toLowerCase();
      return keywords.some(kw => text.includes(kw));
    });
  }
  // 获取用户画像 (?importance 排序)
  getUserProfile(): MemoryEntry[] {
    return this.longTerm
      .filter(e => e.importance >= 2)
      .sort((a, b) => b.importance - a.importance);
  }
  // ========== 持久化==========
  private async ensureStoragePath(): Promise<void> {
    if (!existsSync(this.storagePath)) {
      await mkdir(this.storagePath, { recursive: true });
    }
  }
  async save(): Promise<void> {
    await this.ensureStoragePath();
    const data: MemoryLayers = {
      shortTerm: this.shortTerm,
      midTerm: this.midTerm,
      longTerm: this.longTerm,
    };
    await writeFile(
      `${this.storagePath}/memory.json`,
      JSON.stringify(data, null, 2)
    );
  }
  async load(): Promise<void> {
    try {
      await this.ensureStoragePath();
      const content = await readFile(`${this.storagePath}/memory.json`, 'utf-8');
      const data: MemoryLayers = JSON.parse(content);
      this.shortTerm = data.shortTerm || [];
      this.midTerm = data.midTerm || [];
      this.longTerm = data.longTerm || [];
    } catch {
      // 文件不存在，使用空内存
    }
  }
  // ========== 工具方法 ==========
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
  private extractTitle(content: string): string {
    // 简单提取：取前 30 个字符
    return content.slice(0, 30) + (content.length > 30 ? '...' : '');
  }
  // 构建上下文用于 LLM
  buildContext(): string {
    const parts: string[] = [];
    // 长期记忆 (用户画像)
    const profile = this.getUserProfile();
    if (profile.length > 0) {
      parts.push('## User Profile\n' + profile.map(p => `- ${p.title}: ${p.content}`).join('\n'));
    }
    // 长期记忆 (知识)
    const knowledge = this.longTerm.filter(e => e.importance >= 2);
    if (knowledge.length > 0) {
      parts.push('## Knowledge\n' + knowledge.map(k => `- ${k.title}: ${k.content}`).join('\n'));
    }
    // 中期记忆
    if (this.midTerm.length > 0) {
      parts.push('## Recent Context\n' + this.midTerm.slice(-5).map(m => m.content).join('\n'));
    }
    return parts.join('\n\n');
  }
}
```
**设计说明**：
| 层级 | 存储方式 | 搜索方式 | 容量 |
|------|----------|----------|------|
| **短期** | 数组 (FIFO) | 顺序访问 | 默认 20 条 |
| **中期** | 数组 | 关键词 | 默认 50 条 |
| **长期** | 数组 | 关键词匹配 | 默认 100 条 |

**轻量化策略**：
- 不使用向量数据库 (faiss/chroma)
- 不使用 embedding 模型
- 使用简单的关键词搜索
- JSON 文件持久化（可升级 SQLite）

#### 2.3.4 PromptBuilder (提示词构建器)

负责将 Soul、Memory、Skills、Rules 组合成完整的 System Prompt。
```typescript
// src/stratix-agent/core/PromptBuilder.ts
export class PromptBuilder {
  buildSystemPrompt(
    soul: SoulConfig,
    memoryContext: string,      // MemoryManager.buildContext() 的结构
    skills: SkillDefinition[],
    rules: string[]
  ): ChatMessage[] {
    const parts: string[] = [];
    // 1. Identity (身份)
    if (soul.identity) {
      parts.push(`# 身份\n${soul.identity}`);
    }
    // 2. Personality (性格)
    if (soul.personality) {
      parts.push(`# 性格\n${soul.personality}`);
    }
    // 3. Goals (目标)
    if (soul.goals && soul.goals.length > 0) {
      parts.push(`# 目标\n${soul.goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}`);
    }
    // 4. Constraints (约束)
    if (soul.constraints && soul.constraints.length > 0) {
      parts.push(`# 约束\n${soul.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}`);
    }
    // 5. Speaking Style (说话风格)
    if (soul.speakingStyle) {
      parts.push(`# 说话风格\n${soul.speakingStyle}`);
    }
    // 6. Memory Context (记忆上下文
    if (memoryContext) {
      parts.push(`# 上下文\n${memoryContext}`);
    }
    // 7. Available Skills (可用技能
    if (skills.length > 0) {
      const skillList = skills.map(s => 
        `- **${s.name}**: ${s.description}`
      ).join('\n');
      parts.push(`# 可用技能\n${skillList}`);
    }
    // 8. Rules (规则)
    if (rules.length > 0) {
      parts.push(`# 规则\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
    }
    return [{
      role: 'system',
      content: parts.join('\n\n')
    }];
  }
  buildSkillPrompt(skill: SkillDefinition, params: Record<string, any>): string {
    let prompt = skill.description;
    if (skill.parameters.length > 0) {
      prompt += '\n\n**参数:**\n';
      for (const param of skill.parameters) {
        const value = params[param.name] ?? param.default ?? '(未提供)';
        prompt += `- ${param.name}: ${value}\n`;
      }
    }
    if (skill.prompt) {
      prompt += `\n\n**执行指引:**\n${skill.prompt}`;
    }
    return prompt;
  }
}
```
#### 2.3.5 SkillRegistry (技能注册表)
技能注册与执п，支持动态加载和执行。
```typescript
// src/stratix-agent/core/SkillRegistry.ts
export interface ExecutionContext {
  agentId: string;
  sessionId?: string;
  userId?: string;
  variables?: Record<string, any>;
}
export interface SkillResult {
  success: boolean;
  skillId: string;
  result?: any;
  error?: string;
  executionTime: number;
}
export class SkillRegistry {
  private availableSkills: Map<string, SkillDefinition> = new Map();
  private enabledSkills: Set<string> = new Set();
  private executors: Map<string, SkillExecutor> = new Map();
  // 注册技能  registerSkill(skill: SkillDefinition): void {
    this.availableSkills.set(skill.skillId, skill);
  }
  // 批量注册
  registerSkills(skills: SkillDefinition[]): void {
    skills.forEach(s => this.registerSkill(s));
  }
  // 启用技能  enableSkill(skillId: string): boolean {
    if (this.availableSkills.has(skillId)) {
      this.enabledSkills.add(skillId);
      return true;
    }
    return false;
  }
  // 禁用技能  disableSkill(skillId: string): void {
    this.enabledSkills.delete(skillId);
  }
  // 获取已启用的技能
  getEnabledSkills(): SkillDefinition[] {
    return Array.from(this.enabledSkills)
      .map(id => this.availableSkills.get(id)!)
      .filter(Boolean);
  }
  // 注册执行器
  registerExecutor(name: string, executor: SkillExecutor): void {
    this.executors.set(name, executor);
  }
  // 执行技能
  async execute(
    skillId: string,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<SkillResult> {
    const startTime = Date.now();
    // 检查技能是否启用
    if (!this.enabledSkills.has(skillId)) {
      return {
        success: false,
        skillId,
        error: `Skill ${skillId} is not enabled`,
        executionTime: Date.now() - startTime
      };
    }
    const skill = this.availableSkills.get(skillId);
    if (!skill) {
      return {
        success: false,
        skillId,
        error: `Skill ${skillId} not found`,
        executionTime: Date.now() - startTime
      };
    }
    // 验证参数
    const validationError = this.validateParams(skill, params);
    if (validationError) {
      return {
        success: false,
        skillId,
        error: validationError,
        executionTime: Date.now() - startTime
      };
    }
    try {
      // 获取执行器
      const executor = this.executors.get(skill.executor);
      if (!executor) {
        throw new Error(`Executor ${skill.executor} not found`);
      }
      // 执行技能
      const result = await executor.execute(skill, params, context);
      return {
        success: true,
        skillId,
        result,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        skillId,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    }
  }
  // 参数验证
  private validateParams(skill: SkillDefinition, params: Record<string, any>): string | null {
    for (const param of skill.parameters) {
      if (param.required && !(param.name in params) && param.default === undefined) {
        return `Missing required parameter: ${param.name}`;
      }
    }
    return null;
  }
}
// 技能执行器接口
export interface SkillExecutor {
  execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any>;
}
#### 2.3.5.1 Skill 触发机制
LLM 判断并触发技能执行的机制。
```typescript
// src/stratix-agent/core/SkillTrigger.ts
export interface SkillCall {
  skillId: string;
  params: Record<string, any>;
  reasoning?: string;
}
export class SkillTrigger {
  // 从 LLM 响应中解析技能调用
  parseSkillCalls(llmResponse: string, availableSkills: SkillDefinition[]): SkillCall[] {
    const calls: SkillCall[] = [];
    // 方式1: JSON 格式 (推荐)
    const jsonMatch = llmResponse.match(/```json\s*(\[[\s\S]*?\])\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return parsed.filter((p: any) => this.isValidSkillCall(p, availableSkills));
      } catch {}
    }
    // 方式2: XML 标签格式
    const xmlMatches = llmResponse.matchAll(/<skill_call\s+skillId="([^"]+)"[^>]*>([\s\S]*?)<\/skill_call>/g);
    for (const match of xmlMatches) {
      const skillId = match[1];
      if (this.skillExists(skillId, availableSkills)) {
        const params = this.parseXmlParams(match[2]);
        calls.push({ skillId, params });
      }
    }
    // 方式3: 文本指令 (简单匹配)
    const textPatterns = availableSkills.map(s => ({
      skillId: s.skillId,
      pattern: new RegExp(`(?:使用?|调用?|执行?)(${s.name}|${s.skillId})`, 'i')
    }));
    for (const { skillId, pattern } of textPatterns) {
      if (pattern.test(llmResponse)) {
        const params = this.extractParamsFromText(llmResponse, skillId);
        calls.push({ skillId, params });
      }
    }
    return calls;
  }
  private isValidSkillCall(call: any, skills: SkillDefinition[]): boolean {
    return (
      typeof call.skillId === 'string' &&
      this.skillExists(call.skillId, skills) &&
      typeof call.params === 'object'
    );
  }
  private skillExists(skillId: string, skills: SkillDefinition[]): boolean {
    return skills.some(s => s.skillId === skillId);
  }
  private parseXmlParams(xmlContent: string): Record<string, any> {
    const params: Record<string, any> = {};
    const paramMatches = xmlContent.matchAll(/<param\s+name="([^"]+)">([^<]+)<\/param>/g);
    for (const match of paramMatches) {
      params[match[1]] = match[2];
    }
    return params;
  }
  private extractParamsFromText(text: string, skillId: string): Record<string, any> {
    // 简单参数提取实现
    return {};
  }
}
```
#### 2.3.6 SessionManager (会话管理器)
> 使用独立的 `agent_sessions` 表，不与项目 messages 表混用
管理会话生命周期，支持多会话并行
```typescript
// src/stratix-agent/core/SessionManager.ts
// 数据库表定义 (需添加到 StratixDatabase)
const CREATE_SESSIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id   TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    title       TEXT,
    status      TEXT DEFAULT 'active',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS agent_session_messages (
    message_id  TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    tokens      INTEGER,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(session_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_agent ON agent_sessions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON agent_session_messages(session_id);
`;
export interface Session {
  sessionId: string;
  agentId: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  metadata?: Record<string, any>;
  status?: 'active' | 'closed';
  messageCount?: number;
}
// Session 存储: 独立的 agent_sessions 表 (不复用 messages 表)
import { getDatabase } from '../stratix-database/StratixDatabase';
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private db: any;
  private maxSessions: number;
  private maxMessagesPerSession: number;
  constructor(options: {
    maxSessions?: number;
    maxMessagesPerSession?: number;
  } = {}) {
    this.db = getDatabase().getDatabase();
    this.maxSessions = options.maxSessions || 50;
    this.maxMessagesPerSession = options.maxMessagesPerSession || 100;
  }
  // 创建会话 (session_key 即 sessionId)
  async createSession(agentId: string, projectId?: string): Promise<Session> {
    const sessionId = this.generateSessionId();
    const now = Date.now();
    const session: Session = {
      sessionId,
      agentId,
      projectId,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      messages: [],
      status: 'active',
      messageCount: 0
    };
    this.sessions.set(sessionId, session);
    return session;
  }
  // 获取会话
  async getSession(sessionId: string): Promise<Session | null> {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;
    // 从 agent_session_messages 表加载
    const rows = this.db.prepare(`
      SELECT * FROM agent_session_messages WHERE session_id = ? ORDER BY created_at ASC
    `).all(sessionId) as any[];
    if (rows.length === 0) return null;
    const session: Session = {
      sessionId,
      agentId: rows[0].agent_id || '',
      createdAt: new Date(rows[0].created_at).toISOString(),
      updatedAt: new Date(rows[rows.length - 1].created_at).toISOString(),
      messages: rows.map(r => ({
        role: r.role as 'user' | 'assistant' | 'system',
        content: r.content,
        timestamp: new Date(r.created_at).toISOString()
      })),
      status: 'active',
      messageCount: rows.length
    };
    this.sessions.set(sessionId, session);
    return session;
  }
  // 获取或创建会话
  async getOrCreateSession(agentId: string, sessionId?: string, projectId?: string): Promise<Session> {
    if (sessionId) {
      const existing = await this.getSession(sessionId);
      if (existing && existing.agentId === agentId) return existing;
    }
    return this.createSession(agentId, projectId);
  }
  // 添加消息
  async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
    let session = await this.getSession(sessionId);
    if (!session) {
      session = await this.createSession(sessionId);
    }
    session.messages.push({
      ...message,
      timestamp: message.timestamp || new Date().toISOString()
    });
    session.updatedAt = new Date().toISOString();
    session.messageCount = session.messages.length;
    // 超过上限裁剪
    if (session.messages.length > this.maxMessagesPerSession) {
      session.messages = session.messages.slice(-this.maxMessagesPerSession);
    }
    this.sessions.set(sessionId, session);
    // 持久化到 agent_session_messages 表
    this.db.prepare(`
      INSERT INTO agent_session_messages (message_id, session_id, role, content, tokens, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      sessionId,
      message.role,
      message.content,
      null,  // tokens
      Date.now(),
      Date.now()
    );
  }
  // 获取会话消息
  async getMessages(sessionId: string, count?: number): Promise<ChatMessage[]> {
    const session = await this.getSession(sessionId);
    if (!session) return [];
    if (count) return session.messages.slice(-count);
    return [...session.messages];
  }
  // 关闭会话
  async closeSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      session.status = 'closed';
      this.sessions.set(sessionId, session);
    }
  }
  // 生成会话 ID
  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
  // 加载会话 (按 agentId)
  async loadSessions(agentId: string): Promise<void> {
    const rows = this.db.prepare(`
      SELECT session_id FROM agent_sessions 
      WHERE agent_id = ? ORDER BY updated_at DESC LIMIT ?
    `).all(agentId, this.maxSessions) as any[];
    for (const row of rows) {
      await this.getSession(row.session_id);
    }
  }
  // 释放资源
  async dispose(): Promise<void> {
    this.sessions.clear();
  }
}
#### 2.3.6.1 HealthChecker (健康检查)
监控 Agent 运行状态。
```typescript
// src/stratix-agent/core/HealthChecker.ts
export interface HealthStatus {
  agentId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  lastRequestAt: number;
  memoryUsage: number;
  errorRate: number;
  llmStatus: 'connected' | 'disconnected' | 'error';
}
export class HealthChecker {
  private startTime: number;
  private requestCount: number = 0;
  private errorCount: number = 0;
  private lastRequestTime: number;
  private readonly HEALTHY_THRESHOLD = 0.05;
  private readonly DEGRADED_THRESHOLD = 0.02;
  constructor(private agent: StratixAgent) {
    this.startTime = Date.now();
    this.lastRequestTime = Date.now();
  }
  recordRequest(): void {
    this.requestCount++;
    this.lastRequestTime = Date.now();
  }
  recordError(): void {
    this.errorCount++;
  }
  async check(): Promise<HealthStatus> {
    const uptime = Date.now() - this.startTime;
    const errorRate = this.requestCount > 0 ? this.errorCount / this.requestCount : 0;
    let llmStatus: HealthStatus['llmStatus'] = 'connected';
    try {
      const result = await this.agent.llm.testConnection();
      if (!result.success) llmStatus = 'error';
    } catch {
      llmStatus = 'disconnected';
    }
    let status: HealthStatus['status'] = 'healthy';
    if (errorRate > this.HEALTHY_THRESHOLD || llmStatus === 'disconnected') {
      status = 'unhealthy';
    } else if (errorRate > this.DEGRADED_THRESHOLD || llmStatus === 'error') {
      status = 'degraded';
    }
    return {
      agentId: this.agent.config.agentId,
      status,
      uptime,
      lastRequestAt: this.lastRequestTime,
      memoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      errorRate,
      llmStatus
    };
  }
}
#### 2.3.6.2 RateLimiter (速率限制)
```typescript
export interface RateLimitConfig {
  maxRequestsPerMinute: number;
  maxTokensPerMinute: number;
  maxConcurrent: number;
}
export class RateLimiter {
  private requestTimestamps: number[] = [];
  private tokenCount: number = 0;
  private tokenTimestamps: number[] = [];
  private concurrentCount: number = 0;
  private waitingQueue: Array<() => void> = [];
  constructor(private config: RateLimitConfig) {}
  async acquire(tokens: number = 1): Promise<void> {
    if (this.concurrentCount >= this.config.maxConcurrent) {
      await new Promise<void>(resolve => this.waitingQueue.push(resolve));
      return this.acquire(tokens);
    }
    this.cleanupTimestamps();
    if (this.requestTimestamps.length >= this.config.maxRequestsPerMinute) {
      const waitTime = 60000 - (Date.now() - this.requestTimestamps[0]);
      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime));
        return this.acquire(tokens);
      }
    }
    this.cleanupTokenTimestamps();
    if (this.tokenCount + tokens > this.config.maxTokensPerMinute) {
      const waitTime = 60000 - (Date.now() - this.tokenTimestamps[0]);
      if (waitTime > 0) {
        await new Promise(r => setTimeout(r, waitTime));
        return this.acquire(tokens);
      }
    }
    this.concurrentCount++;
    this.requestTimestamps.push(Date.now());
    this.tokenCount += tokens;
    this.tokenTimestamps.push(Date.now());
  }
  release(): void {
    this.concurrentCount--;
    const next = this.waitingQueue.shift();
    if (next) next();
  }
  private cleanupTimestamps(): void {
    const cutoff = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t > cutoff);
  }
  private cleanupTokenTimestamps(): void {
    const cutoff = Date.now() - 60000;
    this.tokenTimestamps = this.tokenTimestamps.filter(t => t > cutoff);
    this.tokenCount = this.tokenTimestamps.length;
  }
}
#### 2.3.6.3 MetricsCollector (指标收集)
```typescript
export interface AgentMetrics {
  agentId: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  totalTokens: number;
  avgTokensPerRequest: number;
  uptime: number;
  lastRequestAt: number;
}
export class MetricsCollector {
  private metrics: Map<string, AgentMetrics> = new Map();
  private responseTimes: Map<string, number[]> = new Map();
  recordRequest(agentId: string, durationMs: number, tokens: number, success: boolean): void {
    let m = this.metrics.get(agentId);
    if (!m) {
      m = { agentId, totalRequests: 0, successfulRequests: 0, failedRequests: 0,
            avgResponseTime: 0, p95ResponseTime: 0, totalTokens: 0,
            avgTokensPerRequest: 0, uptime: Date.now(), lastRequestAt: 0 };
      this.metrics.set(agentId, m);
    }
    m.totalRequests++;
    if (success) m.successfulRequests++; else m.failedRequests++;
    const times = this.responseTimes.get(agentId) || [];
    times.push(durationMs);
    if (times.length > 100) times.shift();
    this.responseTimes.set(agentId, times);
    m.avgResponseTime = times.reduce((a, b) => a + b, 0) / times.length;
    times.sort((a, b) => a - b);
    m.p95ResponseTime = times[Math.floor(times.length * 0.95)] || 0;
    m.totalTokens += tokens;
    m.avgTokensPerRequest = m.totalTokens / m.totalRequests;
    m.lastRequestAt = Date.now();
  }
  getMetrics(agentId: string): AgentMetrics | null {
    return this.metrics.get(agentId) || null;
  }
}
#### 2.3.6.4 AgentExporter (数据导出)
```typescript
export interface ExportOptions {
  includeMemory: boolean;
  includeSessions: boolean;
  includeConfig: boolean;
  includeSoul: boolean;
  minify: boolean;
}
export class AgentExporter {
  constructor(
    private agent: StratixAgent,
    private storage: StorageManager
  ) {}
  async export(options: Partial<ExportOptions> = {}): Promise<{ success: boolean; filePath?: string; size?: number; error?: string }> {
    const opts = { includeMemory: true, includeSessions: true, includeConfig: true, includeSoul: true, minify: false, ...options };
    try {
      const data: any = {};
      if (opts.includeConfig) data.config = this.agent.config;
      if (opts.includeSoul) data.soul = this.agent.soul;
      if (opts.includeMemory) data.memory = await this.agent.memory.getUserProfile();
      data.exportedAt = new Date().toISOString();
      data.version = '1.0';
      const json = opts.minify ? JSON.stringify(data) : JSON.stringify(data, null, 2);
      const fileName = `${this.agent.config.agentId}_${Date.now()}.json`;
      const filePath = `./exports/${fileName}`;
      await this.storage.saveExport(filePath, json);
      return { success: true, filePath, size: Buffer.byteLength(json, 'utf-8') };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Export failed' };
    }
  }
}
#### 2.3.7 StratixAgentManager (多 Agent 管理器
```typescript
// src/stratix-agent/StratixAgentManager.ts
export interface AgentManagerStats {
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
  memoryUsage: number;
  llmConnections: number;
}
export class StratixAgentManager {
  private agents: Map<string, StratixAgent> = new Map();
  private llmPool: LLMConnectionPool;
  private lifecycleManager: AgentLifecycleManager;
  private scheduler: AgentScheduler;
  private sharedCache: SharedMemoryCache;
  constructor(options: {
    maxConcurrent?: number;
    maxLLMConnections?: number;
    idleTimeoutMs?: number;
  } = {}) {
    this.llmPool = new LLMConnectionPool(options.maxLLMConnections || 5);
    this.lifecycleManager = new AgentLifecycleManager();
    this.scheduler = new AgentScheduler(options.maxConcurrent || 10);
    this.sharedCache = new SharedMemoryCache();
  }
  // 创建 Agent
  async createAgent(config: AgentConfig, soul: SoulConfig): Promise<StratixAgent> {
    const agent = new StratixAgent(config, soul, {
      llmPool: this.llmPool,
      sharedCache: this.sharedCache
    });
    await agent.initialize();
    this.agents.set(config.agentId, agent);
    return agent;
  }
  // 获取 Agent
  async getAgent(agentId: string): Promise<StratixAgent | null> {
    return this.agents.get(agentId) || null;
  }
  // 删除 Agent
  async deleteAgent(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.dispose();
      this.agents.delete(agentId);
    }
  }
  // 列出所有 Agent
  listAgents(): AgentInfo[] {
    return Array.from(this.agents.values()).map(a => ({
      agentId: a.config.agentId,
      name: a.config.name,
      status: a.isActive() ? 'active' : 'idle'
    }));
  }
  // 获取统计信息
  getStats(): AgentManagerStats {
    const activeCount = Array.from(this.agents.values()).filter(a => a.isActive()).length;
    return {
      totalAgents: this.agents.size,
      activeAgents: activeCount,
      idleAgents: this.agents.size - activeCount,
      memoryUsage: this.calculateTotalMemory(),
      llmConnections: this.llmPool.getActiveCount()
    };
  }
  private calculateTotalMemory(): number {
    let total = 0;
    for (const agent of this.agents.values()) {
      total += agent.getMemoryUsage();
    }
    return total;
  }
}
```
#### 2.3.8 StratixAgent (主类 - 完整版
整合所有模块的核心类。
```typescript
// src/stratix-agent/StratixAgent.ts
import { readFileSync, existsSync } from 'fs';
import { join as pathJoin } from 'path';
import { HealthChecker } from './core/HealthChecker';
import { RateLimiter } from './core/RateLimiter';
import { MetricsCollector } from './core/MetricsCollector';

export interface AgentResponse {
  sessionId: string;
  response: string;
  skillExecutions?: SkillResult[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
export class StratixAgent {
  // 核心模块
  public config: AgentConfig;
  public soul: SoulConfig;
  public memory: MemoryManager;
  public skills: SkillRegistry;
  public sessions: SessionManager;
  // 内部组件
  private llm: LLMConnector;
  private promptBuilder: PromptBuilder;
  private storage: StorageManager;
  private tokenManager?: TokenManager;
  private skillTrigger?: SkillTrigger;
  // 运维组件
  private healthChecker?: HealthChecker;
  private rateLimiter?: RateLimiter;
  private metricsCollector?: MetricsCollector;
  private backgroundTasks: NodeJS.Timeout[] = [];
  // 状态
  private initialized: boolean = false;
  constructor(config: AgentConfig, soul: SoulConfig) {
    this.config = config;
    this.soul = soul;
    // 初始化组件
    this.llm = new LLMConnector({
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      baseUrl: config.endpoint,
      temperature: config.temperature,
      maxTokens: config.maxTokens
    });
    this.memory = new MemoryManager({
      maxShortTerm: config.maxShortTerm || 20,
      maxLongTerm: config.enableLongTerm ? 100 : 0,
      storagePath: `./stratix-data/agents/${config.agentId}/memory`
    });
    this.skills = new SkillRegistry();
    this.sessions = new SessionManager({
      storagePath: `./stratix-data/agents/${config.agentId}/sessions`
    });
    this.promptBuilder = new PromptBuilder();
    this.storage = new StorageManager();
    // 初始化 Token 管理器
    this.tokenManager = new TokenManager(config.model);
    // 初始化 Skill 触发器
    this.skillTrigger = new SkillTrigger();
    // 初始化运维组件
    this.healthChecker = new HealthChecker();
    this.rateLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60000 });
    this.metricsCollector = new MetricsCollector();
  }
  async initialize(): Promise<void> {
    if (this.initialized) return;
    // 加载记忆
    await this.memory.load();
    // 加载会话
    await this.sessions.loadSessions(this.config.agentId);
    // 注册内置技能    this.registerBuiltinSkills();
    this.initialized = true;
  }
  async chat(
    message: string,
    options?: {
      sessionId?: string;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
    }
  ): Promise<AgentResponse> {
    const { sessionId, stream, onChunk } = options || {};
    // 获取或创建会话    const session = this.sessions.getOrCreateSession(this.config.agentId, sessionId);
    // 添加用户消息到会话    this.sessions.addMessage(session.sessionId, {
      role: 'user',
      content: message
    });
    // 添加用户消息到记忆
    this.memory.addMessage('user', message);
    // 构建 System Prompt
    const systemMessages = this.promptBuilder.buildSystemPrompt(
      this.soul,
      this.memory.buildContext(),
      this.skills.getEnabledSkills(),
      []
    );
    // 获取对话历史 (最近 N 条
    const historyMessages = await this.sessions.getMessages(session.sessionId, 10);
    // Token 管理：裁剪消息以适应上下文限制
    const truncatedMessages = this.tokenManager
      ? this.tokenManager.truncateMessages(allMessages, this.config.maxTokens || 4096)
      : allMessages;
    // 调用 LLM
    let responseContent: string;
    let usage: AgentResponse['usage'];
    if (stream && onChunk) {
      const result = await this.llm.generateStream(truncatedMessages, onChunk);
      responseContent = result.content;
      usage = result.usage;
    } else {
      const result = await this.llm.generate(truncatedMessages);
      responseContent = result.content;
      usage = result.usage;
    }
    // 添加助手消息到会话
    this.sessions.addMessage(session.sessionId, {
      role: 'assistant',
      content: responseContent
    });
    // 添加助手消息到记忆
    this.memory.addMessage('assistant', responseContent);
    // Skill 触发：从 LLM 响应中解析技能调用
    let skillResults: SkillResult[] = [];
    if (this.skillTrigger && !stream) {
      const skillCalls = this.skillTrigger.parseSkillCalls(
        responseContent,
        this.skills.getEnabledSkills()
      );
      if (skillCalls.length > 0) {
        for (const call of skillCalls) {
          const result = await this.skills.execute(call.skillId, call.params, {
            agentId: this.config.agentId,
            sessionId: session.sessionId
          });
          skillResults.push(result);
        }
        if (skillResults.length > 0) {
          const skillSummary = skillResults
            .filter(r => r.success)
            .map(r => `[${r.skillId}]: ${JSON.stringify(r.result)}`)
            .join('\n');
          responseContent += `\n\n---\n技能执行结果:\n${skillSummary}`;
        }
      }
    }
    // 自动保存
    await this.memory.save();
    return {
      sessionId: session.sessionId,
      response: responseContent,
      usage
    };
  }
  // 注册内置技能
  private registerBuiltinSkills(): void {
    const skillsLibPath = pathJoin(process.cwd(), 'stratix-data', 'skills-lib');
    const indexFile = pathJoin(skillsLibPath, 'index.json');
    
    if (!existsSync(indexFile)) {
      return;
    }
    
    try {
      const index = JSON.parse(readFileSync(indexFile, 'utf-8'));
      const skillsDir = skillsLibPath;
      
      for (const skillFile of index.skills || []) {
        const skillPath = pathJoin(skillsDir, skillFile);
        if (existsSync(skillPath)) {
          const skillDef = JSON.parse(readFileSync(skillPath, 'utf-8'));
          this.skills.registerSkill(skillDef);
        }
      }
    } catch (error) {
      console.warn('Failed to load builtin skills:', error);
    }
  }
  // 更新 Soul
  async updateSoul(updates: Partial<SoulConfig>): Promise<void> {
    Object.assign(this.soul, updates);
    await this.storage.saveSoul(this.config.agentId, this.soul);
  }
  // 启动后台任务 (自动保存 + 健康检查)
  startBackgroundTasks(): void {
    // 自动保存记忆 (每 5 分钟)
    const saveTask = setInterval(async () => {
      try {
        await this.memory.save();
        await this.sessions.saveSessions(this.config.agentId);
      } catch (error) {
        console.error('Background save failed:', error);
      }
    }, 5 * 60 * 1000);
    this.backgroundTasks.push(saveTask);
    // 健康检查 (每 1 分钟)
    const healthTask = setInterval(() => {
      this.healthChecker?.check();
    }, 60 * 1000);
    this.backgroundTasks.push(healthTask);
  }
  // 释放资源
  async dispose(): Promise<void> {
    // 停止后台任务
    for (const task of this.backgroundTasks) {
      clearInterval(task);
    }
    this.backgroundTasks = [];
    // 保存数据
    await this.memory.save();
    await this.sessions.saveSessions(this.config.agentId);
    // 清理缓存
    this.tokenManager = undefined;
    this.skillTrigger = undefined;
    this.healthChecker = undefined;
    this.rateLimiter = undefined;
    this.metricsCollector = undefined;
    this.initialized = false;
  }
}
```
---
## 3. 数据结构
### 3.1 Agent 配置 (config.json)
```typescript
interface AgentConfig {
  // 基础信息
  agentId: string;
  name: string;
  type: 'dev' | 'writer' | 'analyst' | 'custom';
  // LLM 配置
  provider: 'openai' | 'anthropic' | 'ollama' | 'custom';
  model: string;
  endpoint?: string;           // 自定义端点(Ollama/自定义API)
  apiKey?: string;             // API Key (可选，加密存储)
  // 模型参数
  temperature: number;          // 默认: 0.7
  maxTokens: number;           // 默认: 4096
  // 记忆配置
  maxShortTerm: number;         // 最大短期忆条数，默认: 20
  enableLongTerm: boolean;     // 是否启用长期记忆，默认 true
  // 元数据  createdAt: string;
  updatedAt: string;
}
```
**示例**:
```json
{
  "agentId": "dev-hero-001",
  "name": "开发英雄",
  "type": "dev",
  "provider": "openai",
  "model": "gpt-4",
  "temperature": 0.7,
  "maxTokens": 4096,
  "maxShortTerm": 20,
  "enableLongTerm": true,
  "createdAt": "2026-03-15T00:00:00Z",
  "updatedAt": "2026-03-15T00:00:00Z"
}
```
### 3.2 Soul 配置 (soul.json)
```typescript
interface SoulConfig {
  // 角色定义
  identity: string;             // 角色身份描述
  goals: string[];              // 目标列表
  personality: string;           // 性格特征
  speakingStyle?: string;        // 说话风格 (可选
  // 背景故事 (可选
  backstory?: string;
  // 约束 (可选
  constraints?: string[];
}
```
**示例**:
```json
{
  "identity": "你是一个专业的软件开发工程师，擅长 TypeScript、Python 和系统设计",
  "goals": [
    "帮助用户编写高质量可维护的代码",
    "解释复杂的技术概念",
    "提供最佳实践建议",
  ],
  "personality": "严谨、简洁、逻辑性强、乐于助人",
  "speakingStyle": "直接给出解决方案，适当解释关键决策",
  "constraints": [
    "不直接给出完整代码解决方案，而是引导用户自己完成",
    "优先推荐标准库和主流方案"
  ]
}
```
### 3.3 技能定?(skills/{skillId}.json)
```typescript
interface SkillDefinition {
  skillId: string;
  name: string;
  description: string;
  // 执行配置
  type: 'tool' | 'prompt' | 'code';
  executor: string;             // 执行器标识  
  // 参数定义
  parameters: SkillParameter[];
  // 权限 (可选
  requiresConfirmation?: boolean;
  dangerous?: boolean;
  // 元数据  version?: string;
  author?: string;
  tags?: string[];
}
interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: any;
  validation?: string;          // JSON Schema 或正则}
```
**示例**:
```json
{
  "skillId": "web_search",
  "name": "网络搜索",
  "description": "使用搜索引擎获取最新信息,
  "type": "tool",
  "executor": "mcporter:minimax.web_search",
  "parameters": [
    {
      "name": "query",
      "type": "string",
      "description": "搜索关键词,
      "required": true
    },
    {
      "name": "count",
      "type": "number",
      "description": "返回结果数量",
      "required": false,
      "default": 5
    }
  ],
  "requiresConfirmation": false,
  "tags": ["信息获取", "搜索"]
}
```
### 3.4 记忆存储 (数据库 + 缓存)
#### 3.4.1 完整数据库表结构
```sql
-- =============================================================================
-- Agent 表(轻量，只存引用和状态
-- =============================================================================
CREATE TABLE agents (
  agent_id        TEXT PRIMARY KEY,           -- Agent 唯一 ID
  name            TEXT NOT NULL,             -- Agent 名称
  type            TEXT NOT NULL,             -- dev | writer | analyst | custom
  status          TEXT DEFAULT 'idle',       -- idle | active | suspended
  -- 配置文件路径 (指向文件系统)
  config_path     TEXT NOT NULL,             -- agents/{id}/config.json
  soul_path       TEXT NOT NULL,             -- agents/{id}/soul.json
  skills_path     TEXT NOT NULL,             -- agents/{id}/skills.json
  rules_path      TEXT NOT NULL,             -- agents/{id}/rules.json
  -- 统计信息
  total_requests  INTEGER DEFAULT 0,         -- 总请求数
  total_sessions  INTEGER DEFAULT 0,         -- 总会话数
  total_errors    INTEGER DEFAULT 0,         -- 总错误数
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_active_at  INTEGER
);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_type ON agents(type);
-- =============================================================================
-- 记忆表(核心)
-- =============================================================================
CREATE TABLE memory (
  id              TEXT PRIMARY KEY,           -- 记忆唯一 ID (mem_xxx)
  agent_id        TEXT NOT NULL,             -- Agent ID (外键)
  type            TEXT NOT NULL,             -- short-term | mid-term | long-term
  role            TEXT,                      -- user | assistant | system
  content         TEXT NOT NULL,             -- 记忆内容
  title           TEXT,                     -- 标题 (长期记忆表
  importance      INTEGER DEFAULT 2,         -- 1:?2:?3:?  tags            TEXT,                      -- JSON 数组 ["tag1", "tag2"]
  metadata        TEXT,                     -- JSON 额外数据
  created_at      INTEGER NOT NULL,          -- 创建时间戳  updated_at      INTEGER NOT NULL,         -- 更新时间戳  accessed_at     INTEGER                    -- 最后访问时间(LRU)
);
CREATE INDEX idx_memory_agent ON memory(agent_id);
CREATE INDEX idx_memory_type ON memory(agent_id, type);
CREATE INDEX idx_memory_importance ON memory(agent_id, importance);
CREATE INDEX idx_memory_created ON memory(agent_id, created_at);
CREATE INDEX idx_memory_accessed ON memory(accessed_at);
-- =============================================================================
-- 会话表(对话历史)
-- =============================================================================
CREATE TABLE sessions (
  session_id      TEXT PRIMARY KEY,           -- 会话 ID (sess_xxx)
  agent_id        TEXT NOT NULL,             -- Agent ID
  title           TEXT,                      -- 会话标题
  status          TEXT DEFAULT 'active',    -- active | closed
  messages        TEXT NOT NULL,             -- JSON 数组存储消息
  message_count   INTEGER DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  closed_at       INTEGER
);
CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_sessions_status ON sessions(agent_id, status);
CREATE INDEX idx_sessions_updated ON sessions(agent_id, updated_at);
-- =============================================================================
-- 技能执行日?(可选
-- =============================================================================
CREATE TABLE skill_executions (
  id              TEXT PRIMARY KEY,           -- exec_xxx
  agent_id        TEXT NOT NULL,
  session_id      TEXT,
  skill_id        TEXT NOT NULL,
  params          TEXT,                      -- JSON
  result          TEXT,                      -- JSON
  status          TEXT NOT NULL,             -- success | failed | timeout
  execution_time  INTEGER,                   -- 毫秒
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_skill_agent ON skill_executions(agent_id);
CREATE INDEX idx_skill_session ON skill_executions(session_id);
-- =============================================================================
-- 指标统计 (可选
-- =============================================================================
CREATE TABLE metrics (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        TEXT NOT NULL,
  metric_type     TEXT NOT NULL,            -- request_count | error_count | latency
  value           REAL NOT NULL,
  period          TEXT NOT NULL,            -- minute | hour | day
  recorded_at     INTEGER NOT NULL
);
CREATE INDEX idx_metrics_agent ON metrics(agent_id, period, recorded_at);
```
#### 3.4.2 数据结构
```typescript
// 记忆条目
interface MemoryEntry {
  id: string;                    // mem_xxx
  agentId: string;               // agent_xxx
  type: 'short-term' | 'mid-term' | 'long-term';
  role?: 'user' | 'assistant';   // 对话角色
  content: string;               // 内容
  title?: string;               // 标题 (可选
  importance: 1 | 2 | 3;        // 重要性
  tags?: string[];              // 标签
  metadata?: Record<string, any>; // 额外数据
  createdAt: number;            // 时间戳  updatedAt: number;
  accessedAt?: number;           // 最后访问(用于 LRU)
}
// 对话消息
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    tokens?: number;
    skillExecutions?: string[];
  };
}
// 会话
interface Session {
  sessionId: string;              // sess_xxx
  agentId: string;
  title?: string;
  messages: ChatMessage[];
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  lastActiveAt?: number;
}
```
#### 3.4.3 访问层设计
```typescript
// src/stratix-agent/storage/MemoryStore.ts
export class MemoryStore {
  private cache: Map<string, MemoryEntry[]> = new Map();
  private cacheTTL = 60000; // 1 分钟缓存
  private maxCacheSize = 100; // 最大缓存条?  
  constructor(private db: Database) {}
  // ========== 写入操作 ==========
  // 添加记忆
  async addMemory(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt'>): Promise<MemoryEntry> {
    const id = this.generateId();
    const now = Date.now();
    await this.db.run(`
      INSERT INTO memory (id, agent_id, type, role, content, title, importance, tags, metadata, created_at, updated_at, accessed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, entry.agentId, entry.type, entry.role || null,
      entry.content, entry.title || null, entry.importance,
      JSON.stringify(entry.tags || []), JSON.stringify(entry.metadata || {}),
      now, now, now
    ]);
    // 清除该 Agent 缓存
    this.invalidateCache(entry.agentId);
    return { ...entry, id, createdAt: now, updatedAt: now, accessedAt: now };
  }
  // 添加对话消息 (短期记忆)
  async addMessage(agentId: string, sessionId: string, message: ChatMessage): Promise<void> {
    const now = Date.now();
    // 写入 sessions 表
    await this.db.run(`
      INSERT INTO memory (id, agent_id, type, role, content, created_at, updated_at, accessed_at)
      VALUES (?, ?, 'short-term', ?, ?, ?, ?, ?)
    `, [this.generateId(), agentId, message.role, message.content, now, now, now]);
    // 更新会话
    await this.updateSessionMessages(sessionId, message);
  }
  // ========== 读取操作 ==========
  // 获取短期记忆 (最近 N 条
  async getRecentMemory(agentId: string, count: number = 20): Promise<MemoryEntry[]> {
    const cacheKey = `recent:${agentId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;
    const rows = await this.db.all(`
      SELECT * FROM memory 
      WHERE agent_id = ? AND type = 'short-term'
      ORDER BY created_at DESC
      LIMIT ?
    `, [agentId, count]);
    const entries = rows.map(this.mapRowToMemory);
    this.setCache(cacheKey, entries);
    return entries;
  }
  // 获取长期记忆 (按重要性
  async getLongTermMemory(agentId: string, minImportance: number = 1): Promise<MemoryEntry[]> {
    const rows = await this.db.all(`
      SELECT * FROM memory 
      WHERE agent_id = ? AND type = 'long-term' AND importance >= ?
      ORDER BY importance DESC, created_at DESC
    `, [agentId, minImportance]);
    return rows.map(this.mapRowToMemory);
  }
  // 搜索记忆 (关键词
  async searchMemory(agentId: string, query: string, limit: number = 10): Promise<MemoryEntry[]> {
    const rows = await this.db.all(`
      SELECT * FROM memory 
      WHERE agent_id = ? AND (
        content LIKE ? OR title LIKE ? OR tags LIKE ?
      )
      ORDER BY importance DESC, created_at DESC
      LIMIT ?
    `, [agentId, `%${query}%`, `%${query}%`, `%${query}%`, limit]);
    return rows.map(this.mapRowToMemory);
  }
  // 获取用户画像
  async getUserProfile(agentId: string): Promise<MemoryEntry[]> {
    // importance >= 2 的忆视为用户画像    return this.getLongTermMemory(agentId, 2);
  }
  // ========== 维护操作 ==========
  // 清理短期记忆 (超过上限时
  async cleanupShortTerm(agentId: string, maxCount: number = 20): Promise<number> {
    const result = await this.db.run(`
      DELETE FROM memory 
      WHERE id IN (
        SELECT id FROM memory 
        WHERE agent_id = ? AND type = 'short-term'
        ORDER BY created_at ASC
        LIMIT ?
      )
    `, [agentId, maxCount]);
    this.invalidateCache(agentId);
    return result.changes;
  }
  // 提升到长期记忆  async promoteToLongTerm(memoryId: string, importance: number = 2): Promise<void> {
    await this.db.run(`
      UPDATE memory SET type = 'long-term', importance = ?, updated_at = ?
      WHERE id = ?
    `, [importance, Date.now(), memoryId]);
    // 获取 agentId 并清除缓存
    const row = await this.db.get('SELECT agent_id FROM memory WHERE id = ?', [memoryId]);
    if (row) this.invalidateCache(row.agent_id);
  }
  // 更新访问时间 (用于 LRU)
  private async updateAccessTime(memoryId: string): Promise<void> {
    await this.db.run('UPDATE memory SET accessed_at = ? WHERE id = ?', [Date.now(), memoryId]);
  }
  // ========== 缓存 ==========
  private getFromCache(key: string): MemoryEntry[] | null {
    // 简单的缓存查找（已实现 LRU 淘汰）
    return this.cache.get(key) || null;
  }
  private setCache(key: string, entries: MemoryEntry[]): void {
    if (this.cache.size >= this.maxCacheSize) {
      // LRU 淘汰
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, entries);
  }
  private invalidateCache(agentId: string): void {
    this.cache.delete(`recent:${agentId}`);
    this.cache.delete(`longterm:${agentId}`);
  }
  private mapRowToMemory(row: any): MemoryEntry {
    return {
      id: row.id,
      agentId: row.agent_id,
      type: row.type,
      role: row.role,
      content: row.content,
      title: row.title,
      importance: row.importance,
      tags: JSON.parse(row.tags || '[]'),
      metadata: JSON.parse(row.metadata || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      accessedAt: row.accessed_at
    };
  }
  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
```
#### 3.4.4 缓存策略
| 层级 | 策略 | TTL | 大小限制 |
|------|------|-----|---------|
| **短期记忆** | LRU 缓存 | 1 分钟 | 100 ?|
| **长期记忆** | 按需加载 | 5 分钟 | 50 ?|
| **搜索结果** | 不缓存| - | - |
#### 3.4.5 读写流程
```
写入流程:
  addMemory() -> 写入 DB -> 清除缓存 -> 返回
读取流程:
  getRecentMemory() -> 检查缓存
    -> 返回缓存
    -> 查询 DB -> 写入缓存 -> 返回
搜索流程:
  searchMemory() -> 直接查 DB -> 返回 (不缓存)
```
### 3.5 规则配置 (rules.json)
```typescript
interface RulesConfig {
  agentId: string;
  rules: string[];
  customInstructions?: string;
}
```
**示例**:
```json
{
  "agentId": "dev-hero-001",
  "rules": [
    "始终使用 TypeScript，除非用户指定其他语訢",
    "代码需要包含类型标?,
    "优先使用函数式编程风?,
    "重要决策需要解释原?
  ],
  "customInstructions": "你可以当使用 emoji 让回复更生动"
}
```
---
## 4. API 设
> 扢?API 响应格式统一为：
> ```typescript
> // 成功
> { success: true, data: T, requestId: string, timestamp: string }
> 
> // 失败
> { success: false, error: { code: string, message: string, details?: any }, requestId: string, timestamp: string }
> ```
### 4.1 Agent 生命周期
#### 创建 Agent
```
POST /api/agents
Content-Type: application/json
{
  "name": "开发英雄",
  "type": "dev",
  "provider": "openai",
  "model": "gpt-4",
  "apiKey": "sk-...",
  "soul": {
    "identity": "...",
    "goals": [...],
    "personality": "..."
  }
}
Response: 201 Created
{
  "agentId": "agent-xxx",
  "config": {...},
  "soul": {...}
}
```
#### 获取 Agent
```
GET /api/agents/:agentId
Response: 200 OK
{
  "agentId": "agent-xxx",
  "config": {...},
  "soul": {...},
  "status": "ready"
}
```
#### 更新 Agent
```
PATCH /api/agents/:agentId
Content-Type: application/json
{
  "config": { "temperature": 0.8 },
  "soul": { "goals": ["新目?] }
}
Response: 200 OK
```
#### 删除 Agent
```
DELETE /api/agents/:agentId
Response: 204 No Content
```
### 4.2 对话 API
#### 发消?
```
POST /api/agents/:agentId/chat
Content-Type: application/json
{
  "message": "帱ꈑ写一个排序算?,
  "sessionId": "可的会话ID"
}
Response: 200 OK
{
  "sessionId": "session-xxx",
  "response": "我可以帮你实现几种排序算?..",
  "skillExecutions": [
    { "skillId": "code_execute", "result": "..." }
  ],
  "tokens": { "input": 100, "output": 200 }
}
```
#### 流式响应
```
POST /api/agents/:agentId/chat/stream
Content-Type: application/json
{
  "message": "帱ꈑ写一个排序算?
}
Response: text/event-stream
data: {"chunk": "我可选}
data: {"chunk": "帮你"}
data: {"chunk": "实现"}
...
data: {"done": true, "totalTokens": 300}
```
### 4.3 抢?API
#### 列出可用技能
```
GET /api/agents/:agentId/skills
Response: 200 OK
{
  "enabled": ["web_search", "file_read"],
  "available": ["web_search", "file_read", "code_execute"]
}
```
#### 启用/禁用技能
```
POST /api/agents/:agentId/skills/:skillId/enable
POST /api/agents/:agentId/skills/:skillId/disable
```
#### 执行技能
```
POST /api/agents/:agentId/skills/:skillId/execute
Content-Type: application/json
{
  "params": { "query": "TypeScript best practices" }
}
Response: 200 OK
{
  "result": "...",
  "executionTime": 1500
}
```
### 4.4 记忆 API
#### 添加长期记忆
```
POST /api/agents/:agentId/memory
Content-Type: application/json
{
  "title": "用户偏好",
  "content": "用户喜欢箢洁的代码风格",
  "importance": 3,
  "tags": ["偏好", "重要"]
}
Response: 201 Created
{
  "memoryId": "mem-xxx"
}
```
#### 搜索记忆
```
GET /api/agents/:agentId/memory?query=代码风格
Response: 200 OK
{
  "results": [
    { "id": "mem-xxx", "title": "用户偏好", "content": "用户喜欢箢洁的代码风格", "score": 0.95 }
  ]
}
```
#### 清空短期记忆
```
DELETE /api/agents/:agentId/memory/short-term
Response: 204 No Content
```
### 4.5 连接测试
```
POST /api/agents/test-connection
Content-Type: application/json
{
  "provider": "openai",
  "model": "gpt-4",
  "apiKey": "sk-...",
  "endpoint": "可选
}
Response: 200 OK
{
  "success": true,
  "message": "Connected to OpenAI GPT-4",
  "latency": 150
}
```
---
## 5. 实现计划
### 5.1 阶段划分
| 阶段 | 内容 | 预估工作量|
|------|------|-----------|
| **Phase 1** | 核心框架 + 基础对话 | 3 天|
| **Phase 2** | 记忆管理系统 | 2 天|
| **Phase 3** | 技能系?| 3 天|
| **Phase 4** | 持久化+ API | 2 天|
| **Phase 5** | 单元测试 + 文档 | 1 天|
**总**: ~11 个工作日
### 5.2 Phase 1: 核心框架
#### 目标
- 创建 StratixAgent 主类
- 实现基础对话功能
- 集成 DirectLLMService
#### 任务清单
- [ ] 创建 `src/stratix-agent/` 目录结构
- [ ] 实现 `LLMConnector` ?(支持多 Provider)
- [ ] 实现 `LLMConnectionPool` (连接?
- [ ] 实现 `PromptBuilder` ?- [ ] 实现 `SessionManager` ?- [ ] 实现 `StratixAgent` 主类
- [ ] 实现 `StratixAgentManager` (多 Agent 管理器
- [ ] 实现 `AgentLifecycleManager` (生命周期管理)
- [ ] 实现 `AgentScheduler` (任务调度)
- [ ] 实现基础 `chat()` 方法
- [ ] 实现错误处理机制
- [ ] 实现重试策略
- [ ] 编写单元测试 (覆盖?> 80%)
#### 验收标准
- [ ] 可以创建 Agent 实例
- [ ] 可以发对话并获得响应
- [ ] 支持流式响应
- [ ] 支持 OpenAI/Anthropic/Ollama 三种 Provider
- [ ] 错误处理正常工作
- [ ] 重试机制正常工作
- [ ] 单元测试通过?> 80%
### 5.3 Phase 2: 记忆管理
#### 目标
- 实现短期记忆（会话历史）
- 实现长期记忆（重要信息）
- 实现记忆压缩
#### 任务清单
- [ ] 创建 `MemoryManager` ?- [ ] 实现短期记忆存储（最?N 条）
- [ ] 实现长期记忆存储
- [ ] 实现 `addLongTermMemory()` 方法
- [ ] 实现 `searchLongTerm()` 方法
- [ ] 实现 `summarizeAndCompress()` 方法
- [ ] 集成?`PromptBuilder`
#### 验收标准
- [ ] 对话历史自动保存
- [ ] 可以手动添加长期记忆
- [ ] 可以搜索长期记忆
- [ ] 超过上限时自动压缩历?
### 5.4 Phase 3: 技能系?
#### 目标
- 实现技能注册表
- 实现技能执行器
- 内置基础抢?
#### 任务清单
- [ ] 创建 `SkillRegistry` ?- [ ] 定义抢?JSON Schema
- [ ] 实现技能执行器接口
- [ ] 实现 mcporter 适配?- [ ] 内置基础技能：
  - [ ] `web_search` (网络搜索)
  - [ ] `file_read` (文件读取)
  - [ ] `file_write` (文件写入)
  - [ ] `execute_code` (代码执)
- [ ] 实现技能参数验?
#### 验收标准
- [ ] 可以注册/启用/禁用技能- [ ] 响应Џ以包含技能执行结构- [ ] 技能参数自动验?
### 5.5 Phase 4: 持久化+ API
#### 目标
- 实现文件系统存储
- 实现 HTTP API
- 支持配置加密
#### 任务清单
- [ ] 创建 `StorageManager` ?- [ ] 实现 JSON 文件读写
- [ ] 实现自动保存（变更后 N 秒）
- [ ] 创建 API 路由 (`/api/agents/*`)
- [ ] 实现 API 认证（可选）
- [ ] 实现敏感信息加密（可选）
- [ ] **性能优化**:
  - [ ] 实现 `ResponseCache` 缓存
  - [ ] 实现 `BatchWriter` 批量写入
  - [ ] 实现 `ConcurrencyLimiter` 并发控制
  - [ ] 实现 `LazyLoader` 延迟加载
#### 验收标准
- [ ] Agent 配置自动持久化- [ ] 记忆自动保存
- [ ] API 完整覆盖扢有功?- [ ] 首次响应延迟 < 100ms
- [ ] 内存占用符合预期
### 5.6 Phase 5: 测试 + 文档
#### 目标
- 完善单元测试
- 编写使用文档
#### 任务清单
- [ ] 补充单元测试（覆盖率 > 90%?- [ ] 编写 README.md
- [ ] 编写 API 文档
- [ ] 编写示例代码
---
## 6. 可量化目?
### 6.1 功能指标
| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 支持?LLM Provider | ?4 ?| 手动测试 |
| 基础内置抢?| ?5 ?| 代码审查 |
| API 覆盖?| 100% | 路径覆盖 |
| 支持的数捱꠼?| JSON | 代码审查 |
| 错误代码覆盖 | 100% | 代码审查 |
| 重试机制 | 支持 | 单元测试 |
### 6.2 性能指标 (10+ Agents 目标)
| 指标 | 目标 | 测量方式 |
|------|------|---------|
| **?Agent** |
| 首次响应延迟 (不含 LLM) | < 50ms | 性能测试 |
| ?Agent 内存占用 (idle) | < 50MB | 内存监控 |
| ?Agent 内存 (活跃会话) | < 100MB | 内存监控 |
| **?Agent (10-20)** |
| 总体内存占用 | < 500MB | 内存监控 |
| 并发对话处理 | 30+ 并发 | 压力测试 |
| LLM 连接池复?| 5-10 丸?| 连接统 |
| 技能执行并?| 10+ 并发 | 压力测试 |
| **系统?* |
| 启动时间 (10 agents) | < 3s | 计时测试 |
| 批量写入延迟 | < 500ms | 日志统 |
| API 响应 P99 | < 200ms | 性能测试 |
### 6.3 质量指标
| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 单元测试覆盖?| > 90% | Jest/Istanbul |
| 测试通过?| 100% | CI |
| TypeScript 编译 | 0 错误 | tsc |
| 文档完整版| 100% API 有注?| 代码审查 |
### 6.4 兼容?
| 平台 | 目标 |
|------|------|
| Node.js | ?18.0 |
| Windows | ?支持 |
| macOS | ?支持 |
| Linux | ?支持 |
### 6.5 轻量化依赖
| 依赖 | 用途 | 重量 |
|------|------|------|
| `openai` | LLM SDK | 轻 |
| `fs` (Node.js 内置) | 文件存储 | 轻 |
| `uuid` | ID 生成 | 轻 |
**总计**: ~2 个 npm 包，无重型 ML 依赖
---
## 7. 与现有代码的集成
### 7.1 ?Agent 架构设计
针对 10+ Agent 管理场景，需要重新设计架构：
#### 7.1.1 核心架构
```
┌─────────────────────────────────────────────────────────────────┐
│                   StratixAgentManager                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐    │
│  │ Agent Pool  │  │ LLM Pool    │  │ Shared Storage      │    │
│  │             │  │             │  │                     │    │
│  │ [Agent 1]  │  │[Connection] │  │ ┌───────────────┐   │    │
│  │ [Agent 2]  │  │[Connection] │  │ │Config Store   │   │    │
│  │ [Agent 3]  │  │[Connection] │  │ │Memory Store   │   │    │
│  │   ...      │  │[Connection] │  │ │Session Store  │   │    │
│  │ [Agent N]  │  │[Connection] │  │ └───────────────┘   │    │
│  └─────────────┘  └─────────────┘  └─────────────────────┘    │
│        │               │                   │                     │
│        └───────────────┴───────────────────┘                     │
│                   Resource Manager                                │
│  - Agent 生命周期管理                                            │
│  - LLM 连接器                                                   │
│  - 共享内存缓存                                                 │
│  - 优先级调度                                                   │
└─────────────────────────────────────────────────────────────────┘
```
#### 7.1.2 LLM 连接器
```typescript
// LLMConnectionPool.ts
export class LLMConnectionPool {
  private pool: Map<string, LLMConnector[]> = new Map();
  private activeConnections: Map<string, Set<LLMConnector> = new Map();
  constructor(
    private maxConnectionsPerModel: number = 5
  ) {}
  // 获取连接 (复用或创?
  async acquire(config: LLMConfig): Promise<LLMConnector> {
    const key = `${config.provider}:${config.model}`;
    // 尝试获取空闲连接
    const available = this.pool.get(key) || [];
    while (available.length > 0) {
      const conn = available.pop()!;
      if (this.isHealthy(conn)) {
        this.trackActive(key, conn);
        return conn;
      }
    }
    // 创建新连?(不超过上?
    const active = this.activeConnections.get(key) || new Set();
    if (active.size < this.maxConnectionsPerModel) {
      const conn = new LLMConnector(config);
      this.trackActive(key, conn);
      return conn;
    }
    // 等待可用连接
    return this.waitForConnection(key);
  }
  // 释放连接
  release(conn: LLMConnector): void {
    const key = `${conn.config.provider}:${conn.config.model}`;
    this.activeConnections.get(key)?.delete(conn);
    this.pool.get(key)?.push(conn);
  }
  private isHealthy(conn: LLMConnector): boolean {
    // 检查连接健康状态    return conn.isConnected() && !conn.isStale();
  }
}
```
#### 7.1.3 共享内存缓存
```typescript
// SharedMemoryCache.ts - 多 Agent 共享缓存
interface CacheEntry {
  value: any;
  timestamp: number;
  accessCount: number;
}
export class SharedMemoryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private agentAccessCount: Map<string, Map<string, number>> = new Map();
  constructor(
    private maxSize: number = 1000,
    private ttl: number = 5 * 60 * 1000
  ) {}
  // 从缓存获取 (LRU + TTL)
  getFromCache(key: string): any {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    entry.accessCount++;
    return entry.value;
  }
  // 设置缓存 (LRU 淘汰)
  set(key: string, value: any): void {
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 0
    });
  }
  // Agent 共享记忆
  shareMemory(agentId: string, memoryKey: string): void {
    const key = `shared:${memoryKey}`;
  }
  // 记录访问
  private trackAccess(agentId: string, key: string): void {
    if (!this.agentAccessCount.has(agentId)) {
      this.agentAccessCount.set(agentId, new Map());
    }
    const counts = this.agentAccessCount.get(agentId)!;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  private evictLRU(): void {
    let minScore = Infinity;
    let evictKey: string | null = null;
    for (const [key, entry] of this.cache) {
      const score = entry.accessCount / (Date.now() - entry.timestamp);
      if (score < minScore) {
        minScore = score;
        evictKey = key;
      }
    }
    if (evictKey) this.cache.delete(evictKey);
  }
}
```
#### 7.1.4 Agent 优先级调?
```typescript
// AgentScheduler.ts - ?Agent 调度
export class AgentScheduler {
  private queue: PriorityQueue<Task>;
  private running: Map<string, Task> = new Map();
  constructor(
    private maxConcurrent: number = 10
  ) {}
  // 提交任务 (带优先级)
  async submit(agentId: string, task: Task, priority: number = 5): Promise<any> {
    const taskItem = { task, priority, agentId, submittedAt: Date.now() };
    if (this.running.size < this.maxConcurrent) {
      return this.execute(taskItem);
    }
    return new Promise((resolve, reject) => {
      this.queue.enqueue(taskItem);
      taskItem.resolve = resolve;
      taskItem.reject = reject;
    });
  }
  private async execute(item: TaskItem): Promise<any> {
    this.running.set(item.agentId, item.task);
    try {
      const result = await item.task.execute();
      item.resolve?.(result);
    } catch (error) {
      item.reject?.(error);
    } finally {
      this.running.delete(item.agentId);
      this.processNext();
    }
  }
}
```
#### 7.1.5 Agent 生命周期管理
```typescript
// AgentLifecycleManager.ts
export class AgentLifecycleManager {
  private agents: Map<string, StratixAgent> = new Map();
  private idleTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000; // 5 分钟空闲
  // 获取或创?Agent
  async getOrCreate(config: AgentConfig): Promise<StratixAgent> {
    let agent = this.agents.get(config.agentId);
    if (!agent) {
      agent = new StratixAgent(config);
      await agent.initialize();
      this.agents.set(config.agentId, agent);
    }
    // 重置空闲计时?    this.resetIdleTimer(config.agentId);
    return agent;
  }
  // Agent 空闲自动释放
  private resetIdleTimer(agentId: string): void {
    const existing = this.idleTimers.get(agentId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(async () => {
      await this.suspend(agentId);
    }, this.IDLE_TIMEOUT);
    this.idleTimers.set(agentId, timer);
  }
  // 挂起 Agent (释放资源但保留状态
  async suspend(agentId: string): Promise<void> {
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.save();
      await agent.releaseResources(); // 释放 LLM 连接器      console.log(`[Lifecycle] Agent ${agentId} suspended`);
    }
  }
  // 恢复 Agent
  async resume(agentId: string): Promise<StratixAgent> {
    const agent = this.agents.get(agentId);
    if (agent) {
      await agent.restoreResources();
      return agent;
    }
    throw new Error(`Agent ${agentId} not found`);
  }
  // 获取统计信息
  getStats(): AgentManagerStats {
    return {
      totalAgents: this.agents.size,
      activeAgents: this.idleTimers.size,
      memoryUsage: this.calculateMemoryUsage()
    };
  }
}
```
#### 7.1.6 性能指标 (更新)
| 优化?| 方案 | 预期收益 |
|--------|------|---------|
| LLM 连接 | 连接池复?| 减少 80% 连接?|
| 内存 | 共享缓存 + 懒加?| ?Agent < 50MB |
| 并发 | 优先级调?| 10+ Agent 并发 |
| 空闲释放 | 自动挂起/恢复 | 节省 70% 内存 |
| 启动 | 延迟初始?| 3s 启动 10 Agent |
### 7.2 目录结构与复?
```
src/stratix-agent/
├── index.ts                    # 导出入口
├── StratixAgent.ts              # 单个 Agent
├── StratixAgentManager.ts       # 多 Agent 管理器├── types.ts                   # 类型定义
├── config.ts                  # 默认配置
├── core/
│  ├── LLMConnector.ts       # LLM 连接器
│  ├── LLMConnectionPool.ts  # LLM 连接池
│  ├── MemoryManager.ts       # 记忆管理器
│  ├── SharedMemoryCache.ts   # 共享内存缓存
│  ├── SkillRegistry.ts       # 技能注册表
│  ├── PromptBuilder.ts      # 提示词构建器
│  ├── StorageManager.ts     # 存储管理器
│  ├── AgentScheduler.ts     # 任务调度器
│  └── AgentLifecycleManager.ts # 生命周期管理
├── storage/                    # 存储层
│  ├── Database.ts           # SQLite 操作
│  └── FileSystem.ts         # 文件系统操作
├── security/                  # 安全模块
│  ├── CredentialManager.ts  # 凭据管理 (环境变量)
│  └── PermissionManager.ts  # 权限控制
├── metrics/                   # 监控模块
│  └── MetricsCollector.ts   # 指标收集
├── skills/
│  ├── index.ts              # 技能加载器
│  ├── adapters/
│  │  └── mcporter.ts      # mcporter 适配器
│  └── definitions/          # 技能定义
│      ├── web_search.json   # 网页搜索
│      └── ...
└── api/
    └── routes.ts             # API 路由
```
**存储策略** (区分数据?vs 文件系统):
| 数据类型 | 存储方式 |
|----------|----------|
| Agent 列表 | SQLite |
| Sessions | SQLite |
| Memory | SQLite |
| Agent 配置 | **文件系统** |
| Soul 配置 | **文件系统** |
| Skill 定义 | **文件系统** |
| Rules | **文件系统** |
| 全局配置 | **文件系统** |
### 7.3 抢术参考
本设计参考了以下项目?
| 项目 | 参内?|
|------|---------|
| **MemoryOS** | LLM Client 设、分层忆架?|
| **OpenClaw** | 配置文件结构、Agent 生命周期 |
### 7.4 ?Stratix Gateway 的关?
| 特?| StratixAgent | Stratix Gateway |
|------|-----------|-----------------|
| 运模式 | 进程?| 独立服务 |
| 通信方式 | 直接调用 | WebSocket |
| 复杂?| 轻量 | 完整 |
| ?Agent | 单个 | 多个 |
| 适用场景 | 个人轻量使用 | 团队协作 |
### 7.5 错误处理策略
```typescript
// 统一错误类型
export class StratixAgentError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'StratixAgentError';
  }
}
export enum ErrorCode {
  // 初始化错?  AGENT_NOT_INITIALIZED = 'AGENT_NOT_INITIALIZED',
  // LLM 错误
  LLM_CONNECTION_FAILED = 'LLM_CONNECTION_FAILED',
  LLM_RESPONSE_ERROR = 'LLM_RESPONSE_ERROR',
  LLM_TIMEOUT = 'LLM_TIMEOUT',
  // 技能错?  SKILL_NOT_FOUND = 'SKILL_NOT_FOUND',
  SKILL_DISABLED = 'SKILL_DISABLED',
  SKILL_EXECUTION_FAILED = 'SKILL_EXECUTION_FAILED',
  SKILL_PARAM_VALIDATION_FAILED = 'SKILL_PARAM_VALIDATION_FAILED',
  // 会话错误
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  // 存储错误
  STORAGE_ERROR = 'STORAGE_ERROR',
  STORAGE_FULL = 'STORAGE_FULL'
}
// API 错误响应格式
export interface ApiErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: any;
  };
  requestId: string;
  timestamp: string;
}
// 成功响应格式
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  requestId: string;
  timestamp: string;
}
```
### 7.6 性能优化策略
#### 7.6.1 内存管理
```typescript
// 内存管理策略
class MemoryOptimizer {
  // 限制最大内存使?  private readonly MAX_MEMORY_MB = 256;
  // 监控内存使用
  getMemoryUsage(): { used: number; limit: number; percentage: number } {
    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    return {
      used: Math.round(used),
      limit: this.MAX_MEMORY_MB,
      percentage: Math.round((used / this.MAX_MEMORY_MB) * 100)
    };
  }
  // 内存压力时触发清?  async handleMemoryPressure(): Promise<void> {
    console.warn('[MemoryOptimizer] Memory pressure detected, cleaning up...');
    // 1. 清空不活跃的会话缓存
    // 2. 强制垃圾回收 (如果可用)
    // 3. 减少最大会话数
  }
}
// ?StratixAgent 中集?export class StratixAgent {
  private memoryOptimizer: MemoryOptimizer;
  constructor(/* ... */) {
    this.memoryOptimizer = new MemoryOptimizer();
    // 定期检查内?    setInterval(() => {
      const { percentage } = this.memoryOptimizer.getMemoryUsage();
      if (percentage > 80) {
        this.memoryOptimizer.handleMemoryPressure();
      }
    }, 60000); // 每分钟检?  }
}
```
#### 7.6.2 并发控制
```typescript
// 并发请求限制
class ConcurrencyLimiter {
  private running: number = 0;
  private queue: Array<() => void> = [];
  constructor(private maxConcurrent: number = 5) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.maxConcurrent) {
      // 进入等待队列
      await new Promise<void>(resolve => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      // 释放丢个等待中的任?      const next = this.queue.shift();
      if (next) next();
    }
  }
}
// 使用示例
class StratixAgent {
  private limiter = new ConcurrencyLimiter(3); // 朢?3 个并?  
  async chat(message: string): Promise<AgentResponse> {
    return this.limiter.run(() => this.executeChat(message));
  }
}
```
#### 7.6.3 响应缓存
```typescript
// LLM 响应缓存 (用于重复请求)
class ResponseCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly TTL = 1000 * 60 * 5; // 5 分钟
  private readonly MAX_ENTRIES = 100;
  private generateKey(messages: ChatMessage[]): string {
    // 简单实现：用消息内?hash
    const content = messages.map(m => `${m.role}:${m.content}`).join('|');
    return Buffer.from(content).toString('base64').slice(0, 64);
  }
  get(messages: ChatMessage[]): string | null {
    const key = this.generateKey(messages);
    const entry = this.cache.get(key);
    if (!entry) return null;
    // 检查是否过?    if (Date.now() - entry.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }
    return entry.response;
  }
  set(messages: ChatMessage[], response: string): void {
    // 限制缓存大小
    if (this.cache.size >= this.MAX_ENTRIES) {
      // LRU: 删除朢早的
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    const key = this.generateKey(messages);
    this.cache.set(key, {
      response,
      timestamp: Date.now()
    });
  }
}
```
#### 7.6.4 延迟加载
```typescript
// 按需加载组件
class LazyLoader<T> {
  private instance: T | null = null;
  private loading: Promise<T> | null = null;
  constructor(private factory: () => Promise<T>) {}
  async get(): Promise<T> {
    if (this.instance) return this.instance;
    if (!this.loading) {
      this.loading = this.factory().then(instance => {
        this.instance = instance;
        return instance;
      });
    }
    return this.loading;
  }
  isLoaded(): boolean {
    return this.instance !== null;
  }
}
// 使用示例：延迟加载不常用的组?export class StratixAgent {
  // 常用组件立即加载
  private llm: LLMConnector;
  private memory: MemoryManager;
  // 不常用组件延迟加?  private skillRegistryLazy = new LazyLoader(async () => {
    const { SkillRegistry } = await import('./core/SkillRegistry');
    return new SkillRegistry();
  });
  private sessionManagerLazy = new LazyLoader(async () => {
    const { SessionManager } = await import('./core/SessionManager');
    return new SessionManager();
  });
  async executeSkill(skillId: string, params: any): Promise<SkillResult> {
    // 首次使用时才加载
    const registry = await this.skillRegistryLazy.get();
    return registry.execute(skillId, params, {});
  }
}
```
#### 7.6.5 批量写入优化
```typescript
// 批量写入缓冲
class BatchWriter {
  private buffer: Map<string, any> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushInterval = 1000; // 1 秒批量写?  private readonly maxBufferSize = 50;
  constructor(private storage: StorageManager) {}
  async write(key: string, data: any): Promise<void> {
    this.buffer.set(key, data);
    // 达到批量大小立即写入
    if (this.buffer.size >= this.maxBufferSize) {
      await this.flush();
    }
    // 启动定时 flush
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.size === 0) return;
    // 批量写入
    const entries = Array.from(this.buffer.entries());
    this.buffer.clear();
    await Promise.all(
      entries.map(([key, data]) => this.storage.write(key, data))
    );
  }
}
```
#### 7.6.6 技能并行执?
```typescript
// 并执多个抢?async function executeSkillsParallel(
  skills: SkillExecution[],
  maxConcurrency: number = 3
): Promise<SkillResult[]> {
  const limiter = new ConcurrencyLimiter(maxConcurrency);
  const tasks = skills.map(skill => 
    limiter.run(() => executeSkill(skill))
  );
  return Promise.all(tasks);
}
// ?chat 中的应用
async chat(message: string): Promise<AgentResponse> {
  // 1. 初步 LLM 调用
  const llmResponse = await this.llm.generate(messages);
  // 2. 棢测是否需要执行技?(从响应中解析)
  const neededSkills = this.parseSkillRequests(llmResponse.content);
  // 3. 并执行技能(如果?
  let skillResults: SkillResult[] = [];
  if (neededSkills.length > 0) {
    skillResults = await executeSkillsParallel(neededSkills);
  }
  // 4. 返回结果
  return { response: llmResponse.content, skillResults };
}
```
#### 7.6.7 性能指标 (更新)
| 指标 | 目标 | 测量方式 |
|------|------|---------|
| 首次响应延迟 (不含 LLM) | < 100ms | 性能测试 |
| 并发处理 | 3 个对话并?| 压力测试 |
| 内存占用 (idle) | < 100MB | 内存监控 |
| 内存占用 (10 会话) | < 200MB | 内存监控 |
| 缓存命中?(重复请求) | > 30% | 缓存统 |
| 批量写入延迟 | < 1s | 日志统 |
### 7.7 存储层设?
区分数据库存储和文件系统存储?
```typescript
// storage/StorageManager.ts
import { readFile, writeFile, readdir, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
// ========== 存储策略 ==========
export enum StorageType {
  DATABASE = 'database',   // SQLite
  FILESYSTEM = 'filesystem'  // JSON 文件
}
// ========== 存储项配?==========
export interface StorageConfig {
  key: string;
  type: StorageType;
  path?: string;  // 文件系统路径
  table?: string; // 数据库表?}
// ========== 存储配置 ==========
const STORAGE_CONFIG: StorageConfig[] = [
  // 数据库存?(适合频繁读写、查?
  { key: 'agents', type: StorageType.DATABASE, table: 'agents' },
  { key: 'sessions', type: StorageType.DATABASE, table: 'sessions' },
  { key: 'memory', type: StorageType.DATABASE, table: 'memory' },
  // 文件系统存储 (适合配置、导出版本控?
  { key: 'agent-config', type: StorageType.FILESYSTEM, path: 'agents/{agentId}/config.json' },
  { key: 'agent-soul', type: StorageType.FILESYSTEM, path: 'agents/{agentId}/soul.json' },
  { key: 'agent-skills', type: StorageType.FILESYSTEM, path: 'agents/{agentId}/skills.json' },
  { key: 'agent-rules', type: StorageType.FILESYSTEM, path: 'agents/{agentId}/rules.json' },
  { key: 'skill-definitions', type: StorageType.FILESYSTEM, path: 'skills-lib/{skillId}.json' },
  { key: 'global-config', type: StorageType.FILESYSTEM, path: 'config.json' },
];
export class StorageManager {
  private db: Database;
  private basePath: string;
  constructor(basePath: string) {
    this.basePath = basePath;
    this.db = new Database(`${basePath}/stratix-agent.db`);
    this.initialize();
  }
  private initialize(): void {
    // 初始化数据库?    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        messages TEXT,
        created_at INTEGER,
        updated_at INTEGER,
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
      );
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT,  -- short-term, mid-term, long-term
        content TEXT,
        importance INTEGER,
        created_at INTEGER,
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_memory_agent ON memory(agent_id);
      CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(type);
    `);
  }
  // ========== 数据库操?==========
  async saveAgent(agentId: string, config: AgentConfig): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO agents (agent_id, config, updated_at) VALUES (?, ?, ?)`,
      [agentId, JSON.stringify(config), Date.now()]
    );
  }
  async getAgent(agentId: string): Promise<AgentConfig | null> {
    const row = await this.db.get(
      'SELECT config FROM agents WHERE agent_id = ?',
      [agentId]
    );
    return row ? JSON.parse(row.config) : null;
  }
  async saveSession(session: Session): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO sessions (session_id, agent_id, messages, updated_at) VALUES (?, ?, ?, ?)`,
      [session.sessionId, session.agentId, JSON.stringify(session.messages), Date.now()]
    );
  }
  async getSessions(agentId: string): Promise<Session[]> {
    const rows = await this.db.all(
      'SELECT * FROM sessions WHERE agent_id = ? ORDER BY updated_at DESC',
      [agentId]
    );
    return rows.map(r => ({
      ...r,
      messages: JSON.parse(r.messages)
    }));
  }
  async saveMemory(agentId: string, memory: MemoryEntry): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO memory (id, agent_id, type, content, importance, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [memory.id, agentId, memory.type || 'long-term', memory.content, memory.importance || 2, Date.now()]
    );
  }
  async searchMemory(agentId: string, query: string): Promise<MemoryEntry[]> {
    // 简单关键词搜索
    const rows = await this.db.all(
      `SELECT * FROM memory WHERE agent_id = ? AND content LIKE ?`,
      [agentId, `%${query}%`]
    );
    return rows.map(r => ({
      id: r.id,
      content: r.content,
      importance: r.importance,
      createdAt: r.created_at
    }));
  }
  // ========== 文件系统操作 ==========
  private async ensurePath(path: string): Promise<void> {
    if (!existsSync(path)) {
      await mkdir(path, { recursive: true });
    }
  }
  async saveConfig(agentId: string, config: AgentConfig): Promise<void> {
    const dir = `${this.basePath}/agents/${agentId}`;
    await this.ensurePath(dir);
    const path = `${dir}/config.json`;
    await writeFile(path, JSON.stringify(config, null, 2));
  }
  async loadConfig(agentId: string): Promise<AgentConfig | null> {
    const path = `${this.basePath}/agents/${agentId}/config.json`;
    try {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  async saveSoul(agentId: string, soul: SoulConfig): Promise<void> {
    const dir = `${this.basePath}/agents/${agentId}`;
    await this.ensurePath(dir);
    const path = `${dir}/soul.json`;
    await writeFile(path, JSON.stringify(soul, null, 2));
  }
  async loadSoul(agentId: string): Promise<SoulConfig | null> {
    const path = `${this.basePath}/agents/${agentId}/soul.json`;
    try {
      const data = await readFile(path, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  async saveSkills(agentId: string, skills: string[]): Promise<void> {
    const dir = `${this.basePath}/agents/${agentId}`;
    await this.ensurePath(dir);
    const path = `${dir}/skills.json`;
    await writeFile(path, JSON.stringify(skills, null, 2));
  }
  async loadSkillDefinitions(): Promise<SkillDefinition[]> {
    const path = `${this.basePath}/skills-lib`;
    try {
      const files = await readdir(path);
      const skills: SkillDefinition[] = [];
      for (const file of files) {
        if (file.endsWith('.json')) {
          const data = await readFile(`${path}/${file}`, 'utf-8');
          skills.push(JSON.parse(data));
        }
      }
      return skills;
    } catch {
      return [];
    }
  }
}
```
**存储策略汇?*:
| 数据类型 | 存储方式 | 原因 |
|----------|----------|------|
| Agent 列表 | SQLite | 频繁查询、关联查?|
| Sessions | SQLite | 大量读写、按时序 |
| Memory | SQLite | 搜索霢求关联查?|
| **Agent 配置** | **文件系统** | 霢导出、版本控?|
| **Soul 配置** | **文件系统** | 手动编辑、版本控?|
| **Skill 定义** | **文件系统** | 目录结构、手动维?|
| **Rules** | **文件系统** | 霢导出、共?|
| **全局配置** | **文件系统** | 手动编辑 |
### 7.8 安全机制
```typescript
// security/CredentialManager.ts
export class CredentialManager {
  // 支持从环境变量读取敏感信?  resolveApiKey(config: AgentConfig): string {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }
    // 支持环境变量格式: ${ENV_VAR_NAME}
    if (config.apiKey.startsWith('${') && config.apiKey.endsWith('}')) {
      const envVar = config.apiKey.slice(2, -1);
      const value = process.env[envVar];
      if (!value) {
        throw new Error(`Environment variable ${envVar} is not set`);
      }
      return value;
    }
    return config.apiKey;
  }
  // 配置文件示例:
  // {
  //   "provider": "openai",
  //   "apiKey": "${OPENAI_API_KEY}"  // 从环境变量读?  // }
}
// 权限控制
export class PermissionManager {
  private permissions: Map<string, Set<string> = new Map();
  check(agentId: string, action: string): boolean {
    const agentPerms = this.permissions.get(agentId);
    return agentPerms?.has(action) ?? false;
  }
  grant(agentId: string, action: string): void {
    if (!this.permissions.has(agentId)) {
      this.permissions.set(agentId, new Set());
    }
    this.permissions.get(agentId)!.add(action);
  }
}
```
### 7.9 热更新支?
```typescript
// HotReloadManager.ts
import { watch } from 'fs';
import { readFile } from 'fs/promises';
export class HotReloadManager {
  private watchers: Map<string, fs.FSWatcher> = new Map();
  watchConfig(agentId: string, callback: (config: AgentConfig) => void): void {
    const path = `${this.basePath}/agents/${agentId}/config.json`;
    watch(path, async (eventType) => {
      if (eventType === 'change') {
        try {
          const data = await readFile(path, 'utf-8');
          const config = JSON.parse(data);
          callback(config);
        } catch (error) {
          console.error('[HotReload] Failed to load config:', error);
        }
      }
    });
  }
  unwatch(agentId: string): void {
    this.watchers.get(agentId)?.close();
    this.watchers.delete(agentId);
  }
}
// 使用
manager.watchConfig('agent-001', (newConfig) => {
  agent.updateConfig(newConfig);
  console.log('[HotReload] Agent config updated:', newConfig);
});
```
### 7.10 监控指标
```typescript
// metrics/MetricsCollector.ts
export interface AgentMetrics {
  agentId: string;
  totalRequests: number;
  activeSessions: number;
  avgResponseTime: number;
  errorCount: number;
  memoryUsage: number;
}
export class MetricsCollector {
  private metrics: Map<string, AgentMetrics> = new Map();
  recordRequest(agentId: string, durationMs: number): void {
    const m = this.metrics.get(agentId) || this.createMetrics(agentId);
    m.totalRequests++;
    m.avgResponseTime = (m.avgResponseTime * (m.totalRequests - 1) + durationMs) / m.totalRequests;
    this.metrics.set(agentId, m);
  }
  recordError(agentId: string): void {
    const m = this.metrics.get(agentId);
    if (m) m.errorCount++;
  }
  getMetrics(agentId: string): AgentMetrics | null {
    return this.metrics.get(agentId) || null;
  }
  getAllMetrics(): AgentMetrics[] {
    return Array.from(this.metrics.values());
  }
  private createMetrics(agentId: string): AgentMetrics {
    return {
      agentId,
      totalRequests: 0,
      activeSessions: 0,
      avgResponseTime: 0,
      errorCount: 0,
      memoryUsage: 0
    };
  }
}
```
### 7.11 重试策略
```typescript
// 重试配置
interface RetryConfig {
  maxRetries: number;           // 最大重试次数，默认 3
  initialDelayMs: number;       // 初始延迟，默认1000ms
  maxDelayMs: number;           // 最大延迟，默认 10000ms
  backoffMultiplier: number;    // 逢避数，默认2
  retryableErrors: ErrorCode[]; // 可重试的错误?}
// 默认重试配置
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    ErrorCode.LLM_CONNECTION_FAILED,
    ErrorCode.LLM_TIMEOUT
  ]
};
// 重试装饰?function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const result = await fn();
        resolve(result);
        return;
      } catch (error) {
        lastError = error as Error;
        // 检查是否可重试
        if (error instanceof StratixAgentError) {
          if (!config.retryableErrors.includes(error.code)) {
            reject(error);
            return;
          }
        } else if (attempt === config.maxRetries) {
          reject(lastError);
          return;
        }
        // 计算延迟
        const delay = Math.min(
          config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs
        );
        console.log(`Retry attempt ${attempt + 1} after ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    reject(lastError);
  });
}
```
### 7.12 自动保存策略
```typescript
// 防抖自动保存
class AutoSaver {
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number = 5000; // 5 秒防?  
  constructor(
    private onSave: () => Promise<void>
  ) {}
  // 触发保存 (防抖)
  trigger(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(async () => {
      try {
        await this.onSave();
        console.log('[AutoSaver] Saved successfully');
      } catch (error) {
        console.error('[AutoSaver] Save failed:', error);
      }
    }, this.debounceMs);
  }
  // 立即保存
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.onSave();
  }
}
// ?StratixAgent 中使?export class StratixAgent {
  private memorySaver: AutoSaver;
  private sessionSaver: AutoSaver;
  constructor(/* ... */) {
    // ...
    this.memorySaver = new AutoSaver(() => this.memory.save());
    this.sessionSaver = new AutoSaver(() => this.persistSessions());
  }
  // 对话后自动保?  async chat(message: string, options?: ChatOptions): Promise<AgentResponse> {
    const result = await this.executeChat(message, options);
    // 触发自动保存 (防抖)
    this.memorySaver.trigger();
    this.sessionSaver.trigger();
    return result;
  }
  // 优雅逢出时强制保存
  async dispose(): Promise<void> {
    await this.memorySaver.flush();
    await this.sessionSaver.flush();
  }
}
```
---
## 8. 风险与缓?
### 8.1 风险识别
| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| API Key 明文存储 | 安全 | 实现加密存储 |
| 记忆无限增长 | 性能 | 自动压缩 + 限制 |
| LLM 调用失败 | 可用?| 重试 + 降级 |
| 技能执行超?| 响应?| 超时控制 + 取消 |
### 8.2 安全建议
1. **API Key**: 使用环境变量或加密存?2. **文件权限**: 配置文件仅对当前用户可读?3. **敏感操作**: 技能执行需确认（如文件写入?4. **日志**: 不录敏感信?
---
## 10. 与现有系统集?
### 10.1 集成架构
```
┌─────────────────────────────────────────────────────────────────────────??                        Stratix 主应?                                  ?├─────────────────────────────────────────────────────────────────────────??                                                                        ?? ┌─────────────────?   ┌─────────────────?   ┌─────────────────?  ?? ? RTS 指挥界面   ?   ? 角色设?    ?   ? Command Panel  ?  ?? └────────┬────────?   └────────┬────────?   └────────┬────────?  ??          ?                    ?                    ?              ?│          └─────────────────────┼─────────────────────?              ??                                ?                                      ??                   ┌─────────────────────────?                       ??                   ?   Agent Bridge         ?                       ??                   ? (统一入口)            ?                       ??                   └────────────┬────────────?                       ??                                ?                                      ??        ┌───────────────────────┼───────────────────────?             ??        ?                      ?                      ?             ?? ┌─────────────?     ┌───────────────?    ┌───────────────?   ?? ?StratixAgent  ?     ?OpenClaw Bridge ?    ? Direct LLM   ?   ?? ?  Mode      ?     ?    Mode        ?    ?   Mode       ?   ?? └─────────────?     └─────────────────?    └────────────────?   ??                                                                        ?└─────────────────────────────────────────────────────────────────────────?```
### 10.2 Agent Bridge (统一入口)
```typescript
// src/stratix-agent/AgentBridge.ts
// 统一?Agent 类型
export type AgentMode = 'stratix' | 'openclaw' | 'direct';
// 统一响应格式
export interface UnifiedAgentResponse {
  success: boolean;
  response: string;
  agentId: string;
  mode: AgentMode;
  sessionId: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
  skillExecutions?: SkillResult[];
}
// Agent Bridge - 统一入口
export class AgentBridge {
  private StratixAgentManager: StratixAgentManager | null = null;
  private openclawBridge: OpenClawBridge | null = null;
  // 初始?  async initialize(): Promise<void> {
    // 初始?StratixAgent (按需)
    this.StratixAgentManager = new StratixAgentManager();
    // 初始?OpenClaw Bridge
    this.openclawBridge = new OpenClawBridge();
    await this.openclawBridge.initialize();
  }
  // 统一聊天接口
  async chat(
    agentId: string,
    message: string,
    options?: {
      sessionId?: string;
      mode?: AgentMode;  // 指定模式，不指定则自动择
    }
  ): Promise<UnifiedAgentResponse> {
    // 获取 Agent 配置，确定使用哪个模?    const mode = options?.mode || await this.detectAgentMode(agentId);
    switch (mode) {
      case 'stratix':
        return this.chatWithStratixAgent(agentId, message, options);
      case 'openclaw':
        return this.chatWithOpenClaw(agentId, message, options);
      case 'direct':
        return this.chatWithDirectLLM(agentId, message, options);
      default:
        throw new Error(`Unknown agent mode: ${mode}`);
    }
  }
  // 棢?Agent 使用的模?  private async detectAgentMode(agentId: string): Promise<AgentMode> {
    // 从数据库/配置读取
    const config = await this.getAgentConfig(agentId);
    return config.backendType === 'direct' ? 'direct' : 'openclaw';
  }
  // StratixAgent 模式
  private async chatWithStratixAgent(...): Promise<UnifiedAgentResponse> {
    const agent = await this.StratixAgentManager.getAgent(agentId);
    const result = await agent.chat(message, options);
    return { ...result, mode: 'stratix' };
  }
  // OpenClaw 模式
  private async chatWithOpenClaw(...): Promise<UnifiedAgentResponse> {
    const result = await this.openclawBridge.sendMessage(agentId, message);
    return { ...result, mode: 'openclaw' };
  }
  // Direct LLM 模式
  private async chatWithDirectLLM(...): Promise<UnifiedAgentResponse> {
    // 使用现有?DirectLLMService
    const result = await this.directLLMService.chat(agentId, message);
    return { ...result, mode: 'direct' };
  }
}
```
### 10.3 角色设?(Hero Designer) 调整
#### 10.3.1 新增后端选择
```typescript
// 角色设器中的后端择
interface AgentBackendConfig {
  // 后端类型选择
  backendType: 'stratix' | 'openclaw' | 'direct';
  // StratixAgent 配置 (新增)
  stratixConfig?: {
    provider: 'openai' | 'anthropic' | 'ollama' | 'custom';
    model: string;
    apiKey?: string;
    endpoint?: string;
  };
  // OpenClaw 配置 (现有)
  openclawConfig?: {
    endpoint: string;
    deviceToken?: string;
  };
  // Direct LLM 配置 (现有)
  directConfig?: {
    provider: string;
    model: string;
    apiKey?: string;
  };
}
```
#### 10.3.2 UI 流程调整
```
- Step 1: 基础信息 (名称、类型、描述)
- Step 2: 后端选择 (StratixAgent / OpenClaw / Direct LLM)
- Step 3: Soul 配置 (Identity / Goals / Personality)
- Step 4: Skills 配置 (技能树 / OpenClaw Skills / 简单列表)
- Step 5: 记忆配置 (短期/长期记忆 / 无)
- Step 6: Rules (与现有模式共用)
```
#### 10.3.3 配置表单对比
| 配置项 | StratixAgent | OpenClaw | Direct LLM |
|--------|------------|----------|------------|
| Provider | 必填 | 必填 | 必填 |
| Model | 必填 | 必填 | 必填 |
| API Key | 必填 | 必填 | 必填 |
| Endpoint | 可选 | 可选 | 可选 |
| Skills | 技能树 | OpenClaw Skills | 简单列表 |
| Memory | 短期+长期 | 无 | 无 |
| Rules | 必填 | 必填 | 必填 |
| Soul | 必填 | 必填 | 必填 |
### 10.4 共存机制
#### 10.4.1 并行运行
```typescript
// Stratix 主应用同时支持多种模式
class StratixApp {
  private bridge: AgentBridge;
  async initialize(): Promise<void> {
    // 初始化所有模式
    await this.bridge.initialize();
    // 加载所有 Agent (不同模式)
    const agents = await this.loadAllAgents();
    for (const agent of agents) {
      switch (agent.backendType) {
        case 'stratix':
          await this.bridge.StratixAgentManager.createAgent(agent.config, agent.soul);
          break;
        case 'openclaw':
          await this.bridge.openclawBridge.connect(agent.openclawConfig);
          break;
        // Direct LLM 不需要预加载
      }
    }
  }
}
```
#### 10.4.2 模式切换
```typescript
// Agent 可以在不同模式间切换 (通过更新配置)
async switchAgentMode(agentId: string, newMode: AgentMode): Promise<void> {
  // 1. 停止旧模?  await this.stopAgent(agentId);
  // 2. 更新配置
  await this.updateAgentConfig(agentId, { backendType: newMode });
  // 3. 启动新模?  await this.startAgent(agentId);
}
```
### 10.5 配置数据结构
```typescript
// 统一?Agent 配置
interface UnifiedAgentConfig {
  // 通用配置
  agentId: string;
  name: string;
  type: 'dev' | 'writer' | 'analyst' | 'custom';
  // 后端选择
  backendType: 'stratix' | 'openclaw' | 'direct';
  // StratixAgent 配置
  stratix?: {
    provider: LLMProvider;
    model: string;
    apiKey?: string;
    endpoint?: string;
    temperature?: number;
    maxTokens?: number;
  };
  // OpenClaw 配置
  openclaw?: {
    endpoint: string;
    deviceToken?: string;
    connectionMethod: 'pairing' | 'tailscale' | 'manual';
  };
  // Direct LLM 配置
  direct?: {
    provider: string;
    model: string;
    apiKey?: string;
  };
  // 通用配置 (扢有模式共?
  soul?: SoulConfig;
  skills?: string[];
  rules?: string[];
  // 元数据  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;
}
```
### 10.6 使用场景对比
| 场景 | 推荐模式 | 理由 |
|------|----------|------|
| 1-10 ?Agent，个人使?| **StratixAgent** | 轻量、无需 OpenClaw |
| 10+ Agent，团队协?| **OpenClaw** | 成熟稳定、多实例 |
| 简单测试快速原?| **Direct LLM** | 朢箢配置 |
| 霢?OpenClaw 抢?| **OpenClaw** | 完整技能生?|
| 需要本地模?| **StratixAgent + Ollama** | 完全离线 |
---
## 9. 附录
### 9.1 参资?
- OpenClaw 配置文件结构
- DirectLLMService 现有实现
- Stratix Protocol 数据类型
### 9.2 术语?
| 术语 | 定义 |
|------|------|
| StratixAgent | 轻量?Agent 实现 |
| Soul | Agent 的角色设?|
| 短期记忆 | 会话中的对话历史 |
| 长期记忆 | 持久化的重要信息 |
| Skill | Agent 可调用的抢?|
---
**文档结束**