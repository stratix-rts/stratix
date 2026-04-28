# tests/stratix-agent/runtime/SessionRuntime.test.ts

> 语言：typescript | 代码行数：902

## 概述

/**
 * SessionRuntime Unit Tests
 *
 * Comprehensive tests for session lifecycle, turn execution, transcript
 * persistence, usage tracking, and edge cases.
 *
 * Test coverage:
 * - Session lifecycle: createSession, getSession, resumeSession, pause, destroy
 * - Turn execution: executeTurn with retries, abort, timeout
 * - Message management: getRecentMessages
 * - Usage tracking: getUsage, token accumulation
 * - Transcript persistence
 * - Permission denials and skill discovery
 * - Edge cases: concurrent execution, error handling, boundary conditions
 */

## 依赖

- @/stratix-agent/runtime/SessionRuntime
- @/stratix-agent/runtime/TranscriptStore
- @/stratix-agent/runtime/types
- fs
- path
- os
