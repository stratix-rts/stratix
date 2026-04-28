# Stratix Agent Backend 架构设计

## 概述

Stratix Agent 支持多种后端模式，实现外观与能力的统一管理。

## 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    Stratix Agent                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   外观 (Character)                    │   │
│  │  bodyType, parts, thumbnail, texture                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   后端 (Backend)                      │   │
│  │                                                        │   │
│  │  ┌─────────────────┐  ┌───────────────────────────┐  │   │
│  │  │    OpenClaw     │  │      Direct LLM           │  │   │
│  │  ├─────────────────┤  ├───────────────────────────┤  │   │
│  │  │ 连接配置:        │  │ provider, model, apiKey   │  │   │
│  │  │ - endpoint      │  │                           │  │   │
│  │  │ - accountId     │  │ 能力定义:                  │  │   │
│  │  │ - agentId       │  │ - soul (身份)             │  │   │
│  │  │                 │  │ - skills (技能树)         │  │   │
│  │  │ 能力由 OpenClaw  │  │ - rules (规则)           │  │   │
│  │  │ 服务端提供       │  │ - memory (记忆)          │  │   │
│  │  └─────────────────┘  └───────────────────────────┘  │   │
│  │                         ↑                              │   │
│  │            ┌────────────┴────────────┐                │   │
│  │            │                         │                │   │
│  │     ┌──────┴──────┐          ┌───────┴───────┐       │   │
│  │     │  自定义 Agent │          │  模板 Agent   │       │   │
│  │     ├─────────────┤          ├───────────────┤       │   │
│  │     │ 用户自己配置  │          │ 预设 skills   │       │   │
│  │     │ skills/rules │          │ 预设 rules    │       │   │
│  │     └─────────────┘          └───────────────┘       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 数据结构

### StratixAgentConfig

```typescript
interface StratixAgentConfig {
  agentId: string;
  name: string;
  type: 'custom' | 'writer' | 'dev' | 'analyst';
  
  // 外观 - 所有类型
  character?: CharacterData;
  
  // 后端模式
  backendType: 'openclaw' | 'direct';
  
  // OpenClaw 配置
  openClawConfig?: {
    endpoint: string;
    accountId: string;
    apiKey?: string;
    agentId?: string;
  };
  
  // 直连 LLM 配置
  directConfig?: {
    provider: 'openai' | 'anthropic' | 'ollama' | 'custom';
    model: string;
    endpoint?: string;
    apiKey?: string;
  };
  
  // 能力定义 (直连 LLM 模式)
  soul?: StratixSoulConfig;
  skillTree?: SkillTreeState;
  attributes?: Record<string, number>;
  skills?: StratixSkillConfig[];
  rules?: string[];
  
  // 记忆 (可选)
  memory?: StratixMemoryConfig;
}
```

## 类型对应关系

| type | backendType | 说明 |
|------|-------------|------|
| `custom` | `openclaw` | 连接 OpenClaw 的自定义角色 |
| `custom` | `direct` | 直连 LLM，用户自配置 |
| `writer` | `direct` | 模板，预设文案技能 |
| `dev` | `direct` | 模板，预设开发技能 |
| `analyst` | `direct` | 模板，预设分析技能 |

## Character Creator 流程

```
Step 1: 外观配置 (所有模式)
         ↓
Step 2: 后端选择
         ├── OpenClaw → 连接配置 → 测试连接
         └── Direct LLM → Provider/Model → 技能树配置
         ↓
Step 3: 测试聊天 → 验证可用
         ↓
       创建完成
```

## 执行流程

```
用户输入 → Stratix Command
              ↓
        判断 backendType
              ↓
    ┌─────────┴─────────┐
    ↓                   ↓
OpenClaw API      Direct LLM API
    ↓                   ↓
返回结果 ← ← ← ← 返回结果
```
