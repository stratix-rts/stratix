# scripts/fix-migration-v2.py

> 语言：python | 代码行数：162

## 概述

修复 Character Creator 组件迁移 - V2 (正确处理引号)
关键：不使用字符串替换，而是直接生成正确的代码

## 函数

| 函数名 | 参数 | 说明 |
|--------|------|------|
| `migrate_file` | `filepath` | 迁移单个文件 - 逐行处理 |
| `main` | `` | - |

## 依赖

- re
- os
