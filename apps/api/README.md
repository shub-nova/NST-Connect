# NST Connect API

NestJS backend for NST Connect. See the [root README](../../README.md) for setup.

Scripts (run from the repo root with `-w apps/api`, or use the root shortcuts):

| Command | What it does |
| --- | --- |
| `npm run dev:api` | Start in watch mode on port 3000 (`PORT` overrides) |
| `npm run build -w apps/api` | Compile to `dist/` |
| `npm run test -w apps/api` | Run unit tests (Jest) |
| `npm run lint -w apps/api` | Lint with oxlint |

Health check: `GET /health` returns `{"status":"ok"}`.
