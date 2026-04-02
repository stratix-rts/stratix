/**
 * Stratix Core - Zod Schema Validation Layer
 *
 * Provides runtime validation for stratix-protocol types using Zod schemas.
 * All schemas export both the schema and inferred TypeScript types.
 */

import { z, ZodSchema, ZodError } from 'zod';

// ============================================================================
// Primitive & Shared Schemas
// ============================================================================

export const BodyTypeSchema = z.enum(['male', 'female', 'teen', 'muscular', 'pregnant', 'child']);
export type BodyType = z.infer<typeof BodyTypeSchema>;

export const LLMProviderSchema = z.enum([
  'openai', 'anthropic', 'google', 'deepseek', 'qwen', 'moonshot', 'stepfun', 'ollama', 'custom',
]);
export type LLMProvider = z.infer<typeof LLMProviderSchema>;

export const AgentBackendTypeSchema = z.enum(['openclaw', 'stratix']);
export type AgentBackendType = z.infer<typeof AgentBackendTypeSchema>;

export const AgentConfigStatusSchema = z.enum(['draft', 'ready']);
export type AgentConfigStatus = z.infer<typeof AgentConfigStatusSchema>;

export const AgentConnectionStatusSchema = z.enum(['connected', 'disconnected', 'connecting', 'error']);
export type AgentConnectionStatus = z.infer<typeof AgentConnectionStatusSchema>;

export const AgentActivityStatusSchema = z.enum(['idle', 'busy', 'error']);
export type AgentActivityStatus = z.infer<typeof AgentActivityStatusSchema>;

// ============================================================================
// CharacterProfile Schemas
// ============================================================================

export const PartSelectionSchema: z.ZodType<{ itemId: string; variant: string }> = z.object({
  itemId: z.string(),
  variant: z.string(),
});

export const SkillTreeStateSchema = z.object({
  selectedNodes: z.array(z.string()),
  unlockedNodes: z.array(z.string()),
});

export const CharacterTextureSchema = z.object({
  filePath: z.string(),
  width: z.number(),
  height: z.number(),
  animations: z.array(z.string()),
  generatedAt: z.number(),
});

export const CharacterProfileSchema = z.object({
  characterId: z.string(),
  name: z.string(),
  bodyType: BodyTypeSchema,
  parts: z.record(z.string(), PartSelectionSchema),
  skillTree: SkillTreeStateSchema.optional(),
  attributes: z.record(z.string(), z.number()).optional(),
  thumbnail: z.string().optional(),
  texture: CharacterTextureSchema.optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
export type CharacterProfile = z.infer<typeof CharacterProfileSchema>;

// ============================================================================
// AgentConfig Schemas
// ============================================================================

export const OpenClawConfigSchema = z.object({
  endpoint: z.string(),
  accountId: z.string(),
  apiKey: z.string().optional(),
  agentId: z.string().optional(),
});

export const StratixDirectConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'ollama', 'deepseek', 'qwen', 'custom']),
  model: z.string(),
  apiKey: z.string().optional(),
  endpoint: z.string().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  maxShortTerm: z.number().optional(),
  enableLongTerm: z.boolean().optional(),
});

export const StratixSoulConfigSchema = z.object({
  identity: z.string(),
  goals: z.array(z.string()),
  personality: z.string(),
});

export const StratixMemoryConfigSchema = z.object({
  shortTerm: z.array(z.string()),
  longTerm: z.array(z.string()),
  context: z.string(),
});

export const StratixSkillParameterSchema = z.object({
  paramId: z.string(),
  name: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'object']),
  required: z.boolean(),
  defaultValue: z.any().optional(),
  default: z.any().optional(),
  description: z.string().optional(),
});

export const StratixSkillConfigSchema = z.object({
  skillId: z.string(),
  name: z.string(),
  description: z.string(),
  parameters: z.array(StratixSkillParameterSchema),
  executor: z.string().optional(),
  executeScript: z.string().optional(),
  prompt: z.string().optional(),
});

/**
 * AgentConfig - core agent configuration (StrratixAgentConfig from protocol)
 */
export const AgentConfigSchema = z.object({
  agentId: z.string(),
  name: z.string(),
  type: z.string(),
  profile: CharacterProfileSchema,
  backendType: AgentBackendTypeSchema,
  openClawConfig: OpenClawConfigSchema.optional(),
  stratixConfig: StratixDirectConfigSchema.optional(),
  soul: StratixSoulConfigSchema.optional(),
  memory: StratixMemoryConfigSchema.optional(),
  skills: z.array(StratixSkillConfigSchema).optional(),
  rules: z.array(z.string()).optional(),
  configStatus: AgentConfigStatusSchema,
  lastError: z.string().optional(),
  lastActiveAt: z.number().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

// ============================================================================
// AgentState Schema (runtime state)
// ============================================================================

export const AgentStateSchema = z.object({
  config: AgentConfigStatusSchema,
  connection: AgentConnectionStatusSchema,
  activity: AgentActivityStatusSchema,
  lastError: z.string().optional(),
  lastActiveAt: z.number().optional(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;

// ============================================================================
// ZoneConfig Schema
// ============================================================================

export const ZoneConfigSchema = z.object({
  zoneId: z.string(),
  name: z.string(),
  title: z.string().optional(),
  prompt: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  agentCount: z.number().int().min(0),
  status: z.string().optional(),
});
export type ZoneConfig = z.infer<typeof ZoneConfigSchema>;

// ============================================================================
// Message Schema
// ============================================================================

export const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.number(),
});
export type Message = z.infer<typeof MessageSchema>;

// ============================================================================
// CommandLog Schema
// ============================================================================

export const CommandLogSchema = z.object({
  commandId: z.string(),
  skillId: z.string(),
  agentId: z.string(),
  params: z.record(z.string(), z.any()),
  executeAt: z.number(),
});
export type CommandLog = z.infer<typeof CommandLogSchema>;

// ============================================================================
// Validate Helper
// ============================================================================

/**
 * Validates data against a Zod schema and returns the typed data.
 * Throws a descriptive ZodError if validation fails.
 *
 * @example
 * const config = validateOrThrow(AgentConfigSchema, rawData);
 */
export function validateOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  return schema.parse(data);
}

/**
 * Safe validation that returns null instead of throwing.
 */
export function validateSafe<T>(schema: ZodSchema<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

// ============================================================================
// Re-export commonly used types for convenience
// ============================================================================

export type { ZodSchema, ZodError };
