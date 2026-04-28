# src/stratix-core/utils/OpenAIEndpointBuilder.ts

> 语言：typescript | 代码行数：115

## 概述

/**
 * OpenAI-compatible API endpoint builder
 *
 * Handles URL construction for various OpenAI-compatible API endpoints.
 * Automatically appends correct paths when base URLs are provided without paths.
 */

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `hasAPIPath` | `url: string` | - |
| `getBaseUrl` | `url: string` | - |
| `buildOpenAIURL` | `baseUrl: string, path: OpenAIP` | - |
| `buildChatCompletionsURL` | `baseUrl: string` | - |
| `buildModelsURL` | `baseUrl: string` | - |
| `buildEmbeddingsURL` | `baseUrl: string` | - |
| `buildImagesGenerationsURL` | `baseUrl: string` | - |
| `buildAudioTranscriptionsURL` | `baseUrl: string` | - |
