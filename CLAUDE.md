# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies (all workspaces)
npm install

# Run dev servers (client + server concurrently)
npm run dev

# Build all workspaces (must be in order: shared → server → client)
npm run build

# Run tests per workspace
npm run test --workspace server
npm run test --workspace client
npm run test --workspace shared

# Run a single server test file
NODE_ENV=test node --test --loader tsx server/src/practice.test.ts

# Run a single shared test file
NODE_ENV=test node --test --loader tsx shared/replayFile.test.ts
```

## Architecture

**Monorepo with three npm workspaces:**

- `client/` — React 18 SPA bundled with Vite (port 5173)
- `server/` — Express + Socket.IO game server (port 3001)
- `shared/` — TypeScript types and utilities consumed by both client and server

**Real-time communication:** All gameplay uses Socket.IO WebSockets, not REST. The server in `server/src/index.ts` handles room management, game state, tile flips, word claims, replays, and timers. The client in `client/src/App.tsx` manages all game UI and socket event handling.

**Shared code importing:** The client uses a `@shared/*` path alias (configured in `client/tsconfig.json` and `client/vite.config.ts`) to import from `../shared/*`. The server includes shared code directly via its `tsconfig.json` rootDir set to `..` with `../shared/**/*.ts` in its include list.

**Game modes:**
- Multiplayer rooms with lobbies, spectators, and private invite links
- Pre-steal mode (strategic pre-programming of claims)
- Practice mode with 5 difficulty levels (`server/src/practice.ts`)
- Game replay recording, analysis, and JSON import/export

**State persistence:** Optional Upstash Redis integration for persisting multiplayer state across server restarts (env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).

## Code Conventions

- Node.js 22.12.0 (see `.nvmrc`)
- All workspaces use ES modules (`"type": "module"`)
- TypeScript strict mode enabled in all workspaces
- Tests use Node.js built-in `node:test` runner with `tsx` loader (no Jest/Vitest)
- No linter or formatter configured
- Game types are defined in `shared/types.ts`
