# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stratix (星策) is a multi-agent visual command platform with a Phaser 3 RTS game-like interface for managing AI agents. It connects to OpenClaw instances and supports multiple backends (direct LLM, OpenClaw, Stratix).

## Development Commands

```bash
# Development (runs both backend and frontend concurrently)
npm run dev

# Backend only (gateway API server)
npm run dev:backend

# Frontend only (Vite dev server on port 7523)
npm run dev:frontend

# Build
npm run build              # Full build (backend + frontend)
npm run build:backend      # TypeScript compilation + tsc-alias
npm run build:frontend     # Vite production build

# Type checking
npm run typecheck          # Root tsconfig check
npm run typecheck:app      # App-specific tsconfig check

# Linting
npm run lint              # ESLint on src/**/*.ts

# Testing
npm run test              # Jest tests
npm run test:watch        # Jest watch mode
npm run test:coverage     # Jest with coverage
npm run test:e2e          # Playwright e2e tests
npm run test:e2e:ui       # Playwright with UI
npm run test:e2e:headed   # Playwright headed mode

# Electron
npm run electron:dev       # Dev mode with electron
npm run electron:build     # Production build

# Single test file (Jest)
npx jest src/path/to/test.spec.ts

# Single test file (Playwright)
npx playwright test e2e/path/to.spec.ts
```

## Architecture

### Module Structure

```
src/
├── stratix-core/           # Protocol definitions, event bus, shared types
├── stratix-gateway/        # Backend API server (Express + WebSocket)
├── stratix-rts/            # Phaser 3 RTS game interface
├── stratix-character-creator/  # Character creation scene (Vue + Phaser)
├── stratix-designer/       # Agent/Hero visual designer
├── stratix-command-panel/   # Command panel UI
├── stratix-agent/          # Enhanced StratixAgent (LangChain + LangGraph)
├── stratix-data-store/     # Data persistence layer
├── stratix-openclaw-adapter/ # OpenClaw protocol adapter
├── design-system/          # Vue UI component library
├── agent-platform/         # Agent platform (providers, workflow, orchestration)
└── components/             # Shared Vue components
```

### Key Architectural Patterns

**1. Backend API Flow**
Frontend (Vue/Phaser) → Gateway (Express) → OpenClaw Connector / Executor Factory → LLM Providers

The gateway (`stratix-gateway/index.ts`) handles:
- Agent configuration CRUD via `/api/stratix/config/agent/*`
- Command execution via `/api/stratix/command/*`
- WebSocket state sync for real-time updates

**2. Executor Pattern (stratix-core/executor/)**
ExecutorFactory creates executor instances based on backend type:
- `direct` - Direct LLM calls (via LangChain)
- `openclaw` - OpenClaw protocol
- `stratix` - Stratix backend

**3. Event Bus (stratix-core/)**
Uses `mitt` for module communication. All events prefixed with `stratix:`.

**4. Design System (design-system/)**
Tokens at `design-system/tokens/index.ts` define CSS variables. Vue components use unified patterns with consistent spacing, typography, and colors.

**5. Character Creator Scene (stratix-character-creator/)**
Uses `characterComposer` for character assembly, `partRegistry` for part management, `textureManager` for texture generation, and connects via `unifiedOpenClawConnectionManager`.

### Frontend-Backend Communication

- Vite dev server: `http://127.0.0.1:7523`
- Gateway API: `http://127.0.0.1:7524` (proxied via Vite `/api`)
- WebSocket: `ws://127.0.0.1:7525` (proxied via Vite `/ws`)

### Path Aliases

- `@/*` → `src/*`
- `@stratix-core/*` → `src/stratix-core/*`
- `@stratix-gateway/*` → `src/stratix-gateway/*`
- etc.

## Testing

### Test Infrastructure

**Jest** (unit tests, pure TypeScript logic):
- 233+ passing tests
- Located in `tests/**/*.test.ts` and `src/**/__tests__/*.test.ts`
- Configuration: `jest.config.js`
- Uses Jest 29 for Node 16 compatibility

**Playwright** (E2E tests, browser-based):
- Located in `tests/**/*.spec.ts`
- Configuration: `playwright.config.ts`
- Requires Node.js 18+ (uses Node 20 via `/opt/homebrew/opt/node@20/bin`)

### Running Tests

```bash
# Jest unit tests (pure TypeScript logic)
npm test                    # Run all Jest tests
npm run test:watch         # Watch mode
npm run test:coverage      # With coverage report

# Playwright E2E tests (auto-uses Node 20)
npm run test:e2e           # Run all E2E tests
npm run test:e2e:ui        # Interactive UI mode
npm run test:e2e:headed    # Headed mode (see browser)

# Single test
npx jest tests/stratix-rts/managers/ZoneSyncManager.test.ts
npm run test:e2e -- tests/app.spec.ts
```

### Test Utilities

**Location**: `tests/utils/`

- `canvas-screenshot.ts` - Capture Phaser canvas screenshots
- `visual-diff.ts` - Pixel-level visual comparison for canvas content
- `pages/` - Page Object models for common workflows

**Page Objects** (`tests/pages/`):
- `AgentDesignerPage` - Agent/Hero designer workflows
- `CharacterCreatorPage` - Character creator (Phaser scene)
- `AppPage` - Main app shell navigation

### Visual Regression Testing

Phaser canvas content can be tested with pixel-level comparison:

```typescript
import { expectCanvasMatch } from './utils/visual-diff';

test('canvas matches baseline', async ({ page }) => {
  await page.goto('/character-creator');
  await expectCanvasMatch(page, 'character-creator-default');
});
```

Baseline screenshots stored in: `tests/screenshots/baseline/`

### Known Limitations

- **Phaser/Jest incompatibility**: Tests requiring Phaser globals (e.g., `ZoneUI.test.ts`) cannot run in Jest's node environment. Use Playwright for Phaser-related tests.
- **Mixed test frameworks**: Playwright only runs `*.spec.ts` files; Jest only runs `*.test.ts` files.
- **Some E2E tests may fail**: UI has changed since tests were written. Update selectors to match current UI.

## Important Notes

- Element Plus was removed from dependencies (not used); do not re-add
- Backend uses TypeScript with `tsx` for direct execution
- All UI components follow the design-system token conventions
- Agent configurations follow `StratixAgentConfig` interface in `stratix-core`
- Recent refactor unified OpenClaw connection management via `UnifiedOpenClawConnectionManager`
- **Node version**: Jest uses Node 16 (Jest 29); Playwright uses Node 20 (via `/opt/homebrew/opt/node@20/bin`)
