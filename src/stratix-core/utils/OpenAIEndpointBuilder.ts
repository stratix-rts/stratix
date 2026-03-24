/**
 * OpenAI-compatible API endpoint builder
 *
 * Handles URL construction for various OpenAI-compatible API endpoints.
 * Automatically appends correct paths when base URLs are provided without paths.
 */

/**
 * Standard OpenAI API endpoint paths
 */
export const OPENAI_PATHS = {
  CHAT_COMPLETIONS: '/chat/completions',
  COMPLETIONS: '/completions',      // Legacy text completions
  EMBEDDINGS: '/embeddings',
  MODELS: '/models',
  IMAGES_GENERATIONS: '/images/generations',
  IMAGES_EDIT: '/images/edits',
  IMAGES_VARIATIONS: '/images/variations',
  AUDIO_TRANSCRIPTIONS: '/audio/transcriptions',
  AUDIO_TRANSLATIONS: '/audio/translations',
  FILE_LIST: '/files',
  FINE_TUNING_JOBS: '/fine_tuning/jobs',
} as const;

export type OpenAIPath = typeof OPENAI_PATHS[keyof typeof OPENAI_PATHS];

/**
 * Check if a URL already contains an API path
 */
function hasAPIPath(url: string): boolean {
  const apiPaths = Object.values(OPENAI_PATHS);
  return apiPaths.some(path => url.includes(path));
}

/**
 * Extract the base URL without trailing slashes
 */
function getBaseUrl(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Determine API version prefix from URL patterns
 */
function getVersionPrefix(url: string): string {
  // Already has /v1 or /v2
  if (url.match(/\/v\d+$/) || url.match(/\/v\d+\//)) {
    return '';
  }
  return '/v1';
}

/**
 * Build an OpenAI-compatible API URL
 *
 * @param baseUrl - The base URL (e.g., https://api.minimaxi.com/v1)
 * @param path - The API path (e.g., /chat/completions)
 * @returns Full URL with correct path
 *
 * @example
 * buildURL('https://api.minimaxi.com/v1', OPENAI_PATHS.CHAT_COMPLETIONS)
 * // => 'https://api.minimaxi.com/v1/chat/completions'
 *
 * @example
 * buildURL('https://api.minimaxi.com/v1/chat/completions', OPENAI_PATHS.CHAT_COMPLETIONS)
 * // => 'https://api.minimaxi.com/v1/chat/completions' (no duplicate)
 *
 * @example
 * buildURL('https://api.minimaxi.com', OPENAI_PATHS.CHAT_COMPLETIONS)
 * // => 'https://api.minimaxi.com/v1/chat/completions'
 */
export function buildOpenAIURL(baseUrl: string, path: OpenAIPath): string {
  if (!baseUrl) {
    return path;
  }

  const trimmedUrl = getBaseUrl(baseUrl);

  // If URL already has an API path, return as-is
  if (hasAPIPath(trimmedUrl)) {
    return trimmedUrl;
  }

  // Determine if we need to add version prefix
  // Most OpenAI-compatible APIs use /v1
  const needsVersion = !trimmedUrl.match(/\/v\d+$/) && !trimmedUrl.match(/\/v\d+\//);
  const versionPrefix = needsVersion ? '/v1' : '';

  return `${trimmedUrl}${versionPrefix}${path}`;
}

/**
 * Build chat completions URL (most common use case)
 */
export function buildChatCompletionsURL(baseUrl: string): string {
  return buildOpenAIURL(baseUrl, OPENAI_PATHS.CHAT_COMPLETIONS);
}

/**
 * Build models list URL
 */
export function buildModelsURL(baseUrl: string): string {
  return buildOpenAIURL(baseUrl, OPENAI_PATHS.MODELS);
}

/**
 * Build embeddings URL
 */
export function buildEmbeddingsURL(baseUrl: string): string {
  return buildOpenAIURL(baseUrl, OPENAI_PATHS.EMBEDDINGS);
}

/**
 * Build images generations URL
 */
export function buildImagesGenerationsURL(baseUrl: string): string {
  return buildOpenAIURL(baseUrl, OPENAI_PATHS.IMAGES_GENERATIONS);
}

/**
 * Build audio transcription URL
 */
export function buildAudioTranscriptionsURL(baseUrl: string): string {
  return buildOpenAIURL(baseUrl, OPENAI_PATHS.AUDIO_TRANSCRIPTIONS);
}
