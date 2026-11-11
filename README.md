# fremwork-ai

Fremwork website and AI app in one repo.

| Folder | What it is | Local port |
| --- | --- | --- |
| `apps/site` | Website: landing page, sign-up, login, admin | 3001 |
| `apps/site-api` | Website API | 4001 |
| `apps/web` | Fremwork AI app | 3000 |
| `apps/api` | AI API | 4000 |
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

Deploy only the workspace app (`apps/web`). Its Next.js route handlers in `apps/web/src/app/api` are the production API. Do not deploy `apps/api`: that NestJS prototype refuses to start when `NODE_ENV=production`.

Create a Node web service with Root Directory left empty (the repo root) and:

- Build Command: `npm ci --include=dev && npm run build:web`
- Start Command: `npm run start:web`
- Health Check Path: `/api/health`

`next start` listens on Render's `PORT`. Set `GEMINI_API_KEY`, `GEMINI_MODEL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Leave `API_URL` unset (production builds ignore it anyway).
