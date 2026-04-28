# src/stratix-core/types/event-bus-types.ts

> 语言：typescript | 代码行数：139

## 概述

/**
 * Stratix Core - Typed Event Bus Interface
 *
 * Defines the standard interface for all event buses in the Stratix system.
 * All event buses should conform to this interface to ensure consistent
 * event handling patterns across the codebase.
 *
 * Event buses are singleton instances that manage pub/sub communication
 * between modules. Each bus is scoped to a specific domain.
 */
