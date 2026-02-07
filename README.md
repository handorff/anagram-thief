# Anagram Thief

Online multiplayer anagram game with a real-time lobby and turn-based tile flips.

## Quick start

1. Install dependencies: `npm install`
2. Run dev servers: `npm run dev`
3. Open the client at `http://localhost:5173`

The server runs on `http://localhost:3001` and uses Socket.IO for real-time gameplay.

## Optional: Persist Active Multiplayer State with Upstash Redis

To persist active rooms/games/sessions across server restarts, set these environment variables for the server:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `UPSTASH_REDIS_STATE_KEY` (optional, defaults to `anagram:active-state:v1`)

When Redis persistence is enabled:

- Multiplayer state snapshots are saved automatically after game/session mutations.
- State is hydrated on server boot before accepting connections.
- Timers (flip reveal, claim window, cooldown, game end) resume from stored absolute timestamps.
- Ended games are not retained indefinitely; cleanup behavior is unchanged.
