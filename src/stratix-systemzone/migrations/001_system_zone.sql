-- ============================================
-- System Zone 数据库 Schema
-- Phase 1: 类型定义 + 数据库 schema
-- Migration: 001_system_zone
-- ============================================

-- system_zones 表
CREATE TABLE IF NOT EXISTS system_zones (
  zone_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'learning')),

  config JSON DEFAULT '{}',

  insights_ref TEXT,
  lessons_ref TEXT,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- system_zone_inputs 表（用户输入记录）
CREATE TABLE IF NOT EXISTS system_zone_inputs (
  input_id TEXT PRIMARY KEY,
  zone_id TEXT REFERENCES system_zones(zone_id),
  content TEXT NOT NULL,
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'api')),
  input_type TEXT CHECK (input_type IN ('news', 'idea', 'analysis', 'code', 'test_report', 'other')),
  metadata JSON,
  processed BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- system_zone_insights 表（提取的洞察）
CREATE TABLE IF NOT EXISTS system_zone_insights (
  insight_id TEXT PRIMARY KEY,
  zone_id TEXT REFERENCES system_zones(zone_id),
  source_input_id TEXT REFERENCES system_zone_inputs(input_id),
  type TEXT CHECK (type IN ('trend', 'opportunity', 'risk', 'pattern')),
  content TEXT NOT NULL,
  entities JSON DEFAULT '[]',
  confidence REAL DEFAULT 0.5,
  archived BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- system_zone_proposals 表（提案队列）
CREATE TABLE IF NOT EXISTS system_zone_proposals (
  proposal_id TEXT PRIMARY KEY,
  zone_id TEXT REFERENCES system_zones(zone_id),
  type TEXT NOT NULL CHECK (type IN ('improve_code', 'improve_test', 'improve_architecture', 'new_zone')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  target JSON,

  confidence REAL DEFAULT 0.5,
  cost INTEGER DEFAULT 5,
  benefit INTEGER DEFAULT 5,
  risk TEXT DEFAULT 'medium' CHECK (risk IN ('low', 'medium', 'high')),

  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'rolled_back')),
  approved_by TEXT,
  executed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- system_zone_lessons 表（存储在 stratix-database）
CREATE TABLE IF NOT EXISTS system_zone_lessons (
  lesson_id TEXT PRIMARY KEY,
  zone_id TEXT REFERENCES system_zones(zone_id),
  type TEXT NOT NULL CHECK (type IN ('error', 'learning', 'success')),
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  context TEXT,
  avoidance_rule TEXT,
  reuse_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 索引策略
-- ============================================

CREATE INDEX IF NOT EXISTS idx_sz_inputs_zone_processed ON system_zone_inputs(zone_id, processed);
CREATE INDEX IF NOT EXISTS idx_sz_insights_zone_type ON system_zone_insights(zone_id, type);
CREATE INDEX IF NOT EXISTS idx_sz_proposals_zone_status ON system_zone_proposals(zone_id, status);
CREATE INDEX IF NOT EXISTS idx_sz_proposals_status ON system_zone_proposals(status);
CREATE INDEX IF NOT EXISTS idx_sz_lessons_category ON system_zone_lessons(zone_id, category);
