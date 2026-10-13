import { z } from 'zod';

export const ModelRoleSchema = z.enum(['main', 'fast', 'planner', 'summarizer', 'autocomplete']);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const ModelRolesConfigSchema = z.object({
  main: z.string().default('claude-3-5-sonnet'),
  fast: z.string().default('claude-3-5-haiku'),
  planner: z.string().default('claude-3-5-sonnet'),
  summarizer: z.string().default('claude-3-5-haiku'),
  autocomplete: z.string().default('claude-3-5-haiku'),
});
export type ModelRolesConfig = z.infer<typeof ModelRolesConfigSchema>;

export const AnthropicConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().default('https://api.anthropic.com'),
});

export const OpenAIConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().default('https://api.openai.com/v1'),
});

export const GeminiConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().default('https://generativelanguage.googleapis.com/v1beta'),
});

export const OllamaConfigSchema = z.object({
  baseUrl: z.string().default('http://127.0.0.1:11434'),
});

export const OpenAICompatibleEndpointSchema = z.object({
  baseUrl: z.string(),
  apiKey: z.string().optional(),
  headers: z.record(z.string()).optional(),
});
export type OpenAICompatibleEndpoint = z.infer<typeof OpenAICompatibleEndpointSchema>;

export const ProvidersConfigSchema = z.object({
  anthropic: AnthropicConfigSchema.default({}),
  openai: OpenAIConfigSchema.default({}),
  gemini: GeminiConfigSchema.default({}),
  ollama: OllamaConfigSchema.default({}),
  openaiCompatible: z.record(OpenAICompatibleEndpointSchema).default({}),
});
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

export const ToolsConfigSchema = z.object({
  bashTimeoutMs: z.number().int().positive().default(30000),
  maxReadLines: z.number().int().positive().default(2000),
  maxOutputBytes: z.number().int().positive().default(100000),
  rgPath: z.string().optional(),
});
export type ToolsConfig = z.infer<typeof ToolsConfigSchema>;

export const AgentConfigSchema = z.object({
  maxTurns: z.number().int().positive().default(30),
  temperature: z.number().min(0).max(2).default(0),
  headless: z.boolean().default(false),
  json: z.boolean().default(false),
  maxRetries: z.number().int().min(0).default(3),
  systemPromptVariant: z.enum(['standard', 'compact', 'strict']).default('standard'),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ForgeConfigSchema = z.object({
  models: ModelRolesConfigSchema.default({}),
  providers: ProvidersConfigSchema.default({}),
  tools: ToolsConfigSchema.default({}),
  agent: AgentConfigSchema.default({}),
});
export type ForgeConfig = z.infer<typeof ForgeConfigSchema>;
