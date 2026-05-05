/**
 * Type-safe API layer for Stratix Gateway
 *
 * Standardized response wrapper for all API calls.
 * All API responses follow: { success: true, ...data } or { success: false, error: string }
 */

/** Standard API response wrapper */
export interface ApiResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: string;
}

export type ApiResult<T> = ApiResponse<T> | ApiErrorResponse;

/** Check if a result is successful */
export function isApiSuccess<T>(result: ApiResult<T>): result is ApiResponse<T> {
  return result.success === true;
}

/** Check if a result is an error */
export function isApiError<T>(result: ApiResult<T>): result is ApiErrorResponse {
  return result.success === false;
}

/** Extract data from a result, throwing if error */
export function unwrapApiResult<T>(result: ApiResult<T>): T {
  if (isApiError(result)) {
    throw new Error(result.error);
  }
  return result.data;
}

/** Safely unwrap a result without throwing */
export function safeUnwrapApiResult<T>(result: ApiResult<T>): { data: T | null; error: string | null } {
  if (isApiError(result)) {
    return { data: null, error: result.error };
  }
  return { data: result.data, error: null };
}

/** Request options for typed API calls */
export interface ApiRequestOptions {
  timeout?: number;
  headers?: Record<string, string>;
  /** External AbortSignal for request cancellation */
  signal?: AbortSignal;
}

/** Pagination metadata */
export interface PaginationMeta {
  total: number;
  limit: number;
  offset: number;
}

/** Paginated response wrapper */
export interface PaginatedApiResponse<T> {
  success: true;
  data: T[];
  pagination: PaginationMeta;
}

/** API endpoint paths */
export const API_PATHS = {
  // Project endpoints
  // Project paths now point to /api/zones (backward compat)
  PROJECTS: '/api/zones',
  PROJECT_BY_ID: (id: string) => `/api/zones/${id}`,
  PROJECT_START: (id: string) => `/api/zones/${id}/start`,
  PROJECT_PAUSE: (id: string) => `/api/zones/${id}/pause`,
  PROJECT_COMPLETE: (id: string) => `/api/zones/${id}/complete`,
  PROJECT_FAIL: (id: string) => `/api/zones/${id}/fail`,
  PROJECT_AGENTS_ENTER: (id: string) => `/api/zones/${id}/agents/enter`,
  PROJECT_AGENTS_LEAVE: (id: string) => `/api/zones/${id}/agents/leave`,
  PROJECT_METADATA: '/api/zones/metadata/info',
  PROJECT_ZONE_CONTEXT_LINK: (id: string) => `/api/zones/${id}/zone-context-link`,

  // Zone endpoints
  ZONES: '/api/zones',
  ZONE_BY_ID: (id: string) => `/api/zones/${id}`,
  ZONE_RESTORE: (id: string) => `/api/zones/${id}/restore`,
  ZONE_PERMANENT: (id: string) => `/api/zones/${id}/permanent`,
  ZONE_TRASH: (zoneId: string) => `/api/zones/${zoneId}/trash`,
  ZONE_FILES: (zoneId: string) => `/api/zones/${zoneId}/files`,
  ZONE_FILE_BY_ID: (zoneId: string, fileId: string) => `/api/zones/${zoneId}/files/${fileId}`,
  ZONE_FILE_CONTENT: (zoneId: string, fileId: string) => `/api/zones/${zoneId}/files/${fileId}/content`,
  ZONE_FILE_REFRESH: (zoneId: string, fileId: string) => `/api/zones/${zoneId}/files/${fileId}/refresh`,
  ZONE_FILE_METADATA: (zoneId: string, fileId: string) => `/api/zones/${zoneId}/files/${fileId}/metadata`,
  ZONE_FILE_VERSIONS: (zoneId: string, fileId: string) => `/api/zones/${zoneId}/files/${fileId}/versions`,
  ZONE_FILE_ROLLBACK: (zoneId: string, fileId: string, versionId: string) => `/api/zones/${zoneId}/files/${fileId}/rollback/${versionId}`,
  ZONE_FILE_SCAN_FOLDER: (zoneId: string) => `/api/zones/${zoneId}/files/scan-folder`,
  ZONE_FILE_BATCH: (zoneId: string) => `/api/zones/${zoneId}/files/batch`,
  ZONE_MEMBERS: (zoneId: string) => `/api/zones/${zoneId}/members`,
  ZONE_MEMBER: (zoneId: string, agentId: string) => `/api/zones/${zoneId}/members/${agentId}`,
  ZONE_MEMBERS_BATCH: (zoneId: string) => `/api/zones/${zoneId}/members/batch`,
  ZONE_TASKS: (zoneId: string) => `/api/zones/${zoneId}/tasks`,
  ZONE_TASK: (zoneId: string, taskId: string) => `/api/zones/${zoneId}/tasks/${taskId}`,
  ZONE_TASK_CLAIM: (zoneId: string, taskId: string) => `/api/zones/${zoneId}/tasks/${taskId}/claim`,
  ZONE_TASKS_BATCH: (zoneId: string) => `/api/zones/${zoneId}/tasks/batch`,
  ZONE_MESSAGES: (zoneId: string) => `/api/zones/${zoneId}/messages`,
  ZONE_EXPORT: (zoneId: string) => `/api/zones/${zoneId}/export`,
  ZONE_CLONE: (zoneId: string) => `/api/zones/${zoneId}/clone`,
  ZONE_IMPORT: '/api/zones/import',
  ZONE_SEARCH: '/api/zones/search',
  ZONE_STATISTICS: (zoneId: string) => `/api/zones/${zoneId}/statistics`,
} as const;
