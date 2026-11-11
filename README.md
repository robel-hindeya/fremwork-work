# fremwork-ai

Fremwork website and AI app in one repo.

| Folder | What it is | Local port |
| --- | --- | --- |
| `apps/site` | Website: landing page, sign-up, login, admin | 3001 |
| `apps/site-api` | Website API | 4001 |
| `apps/web` | Fremwork AI app | 3000 |
| `apps/api` | Backend API (NestJS) | 4000 |
| `packages/types` | Shared types | |
| `supabase` | Migrations, functions, email templates | |

## Run it

```bash
cp .env.example .env
npm install
npm run build:types
npm run dev
```

`npm run dev` starts the app, the AI API and the website. All of them read the one `.env` at the root.

## Deploy on Vercel

Create one Vercel project per app from this repo, with Root Directory set to `apps/site` or `apps/web`. Add the values from `.env` as environment variables.

## Deploy on Render

Both services deploy from the repo root (leave Root Directory empty), because the npm lockfile and the shared `@fremwork/types` workspace live there. They are independent of each other.

### Workspace app (`apps/web`)

- Build Command: `npm ci --include=dev && npm run build:web`
- Start Command: `npm run start:web`
- Health Check Path: `/api/health`

`next start` listens on Render's `PORT`. Set `GEMINI_API_KEY`, `GEMINI_MODEL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Leave `API_URL` unset (production builds ignore it anyway).

### Backend API (`apps/api`)

A NestJS REST API over the same Supabase ledger. Clients authenticate with a Supabase access token (`Authorization: Bearer <token>`). Every query runs as that user, so row level security keeps each user's data private. Routes live under `/v1`, with docs at `/v1/docs`.

- Build Command: `npm ci --include=dev && npm run build:api`
- Start Command: `npm run start:api`
- Health Check Path: `/api/health` (readiness, including Supabase and the ledger schema, is `/api/health/ready`)

The server listens on `0.0.0.0:$PORT`. Environment variables:

| Variable | Required | Value |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `SUPABASE_URL` | yes | `https://<ref>.supabase.co` of the project that has the `ledger_*` tables |
| `SUPABASE_ANON_KEY` | yes | That project's publishable (anon) key. Never a service-role/secret key: startup refuses one. |
| `CORS_ORIGINS` | no | Comma-separated exact origins. Default: `https://app.fremwork.com,https://fremwork.com,https://www.fremwork.com,https://fremwork-app.onrender.com,https://fremwork-land.onrender.com` |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | for AI chat | Primary AI provider. `GEMINI_FALLBACK_MODEL` is optional and used on 429/503. |
| `ANTHROPIC_API_KEY` | no | Fallback AI provider. `ANTHROPIC_MODEL` defaults to `claude-opus-5-5`. |
| `AI_DAILY_LIMIT` | no | AI requests per user per day (default 50). |

In production the API refuses to start without valid Supabase settings. Data sources (QuickBooks, Xero, bank feeds, Stripe, Gusto) are listed but have no integration yet, so connecting one answers `501`. Saved tasks run on demand (`POST /v1/tasks/:id/run`); there is no background scheduler.

Run the API tests with `npm run test:api`.
