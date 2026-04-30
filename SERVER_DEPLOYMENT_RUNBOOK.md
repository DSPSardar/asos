# ASOS Server Deployment Runbook

This runbook explains how ASOS is deployed in production, what the update pipeline is, and exactly what commands to run for common server issues.

## 1) Production Architecture

- **Repo path on server:** `/opt/asos`
- **Main branch:** `main`
- **Orchestrator:** Docker Compose (`docker-compose.yml`)
- **Core services:**
  - `api` (Node backend)
  - `worker` (BullMQ worker)
  - `postgres` (PostgreSQL)
  - `redis` (Redis)
  - `nginx` (reverse proxy)
- **Frontend hosting:** built Vite files copied to Apache webroot (`/home/app/public_html`)
- **Env file:** `/opt/asos/.env.production`

## 2) Standard Deploy / Update Pipeline

### A. Pull latest code

```bash
cd /opt/asos
git pull origin main
```

### B. Apply schema changes (if Prisma schema changed and no migration is present)

Use this when release includes Prisma model changes and deploy script did not run migration automatically:

```bash
cd /opt/asos
set -a
source /opt/asos/.env.production
set +a
export DATABASE_URL="${DATABASE_URL//@postgres:5432/@127.0.0.1:5432}"

cd /opt/asos/backend
npx prisma db push
npm run db:generate
```

### C. Deploy backend/services

```bash
cd /opt/asos
bash deploy/update.sh
```

If `update.sh` reports "Already up to date" but new commit was just pulled, force rebuild/restart:

```bash
cd /opt/asos
docker compose --env-file .env.production build api worker
docker compose --env-file .env.production up -d api worker
```

### D. Deploy frontend (Vite) to live webroot

```bash
cd /opt/asos/vite-app
npm ci --include=dev
npm run build
cp -r /opt/asos/vite-app/dist/* /home/app/public_html/
```

Then hard-refresh browser (`Ctrl+Shift+R` / `Cmd+Shift+R`).

## 3) After Every Update (Checklist)

Run these in order:

```bash
cd /opt/asos
curl -fsS http://127.0.0.1:3000/health
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs --tail=120 api
docker compose --env-file .env.production logs --tail=120 worker
```

Expected:
- `/health` returns JSON with `status: ok`
- `api`, `worker`, `postgres`, `redis` are Up/healthy
- no repeated runtime exceptions in logs

## 4) Common Production Issues + Fix Commands

## 4.1 Prisma error: `Environment variable not found: DATABASE_URL`

```bash
cd /opt/asos
set -a
source /opt/asos/.env.production
set +a
echo ${#DATABASE_URL}
```

If set and using host shell for Prisma, rewrite hostname:

```bash
export DATABASE_URL="${DATABASE_URL//@postgres:5432/@127.0.0.1:5432}"
```

## 4.2 Prisma cannot connect: `P1001 postgres:5432`

This usually happens when running Prisma from host shell (not Docker network). Use host-loopback:

```bash
export DATABASE_URL="${DATABASE_URL//@postgres:5432/@127.0.0.1:5432}"
cd /opt/asos/backend
npx prisma db push
```

## 4.3 `vite: not found` during frontend build

Install dev dependencies explicitly:

```bash
cd /opt/asos/vite-app
npm ci --include=dev
npm run build
```

## 4.4 API endpoint still running old code after pull

Force container rebuild/recreate:

```bash
cd /opt/asos
docker compose --env-file .env.production build api worker
docker compose --env-file .env.production up -d api worker
```

## 4.5 Claude errors: `invalid x-api-key`

Fix Anthropic key in `.env.production`:

```bash
cd /opt/asos
nano .env.production
# set valid ANTHROPIC_API_KEY=sk-ant-...
docker compose --env-file .env.production up -d --force-recreate api worker
```

## 4.6 Endpoint returns 401 in curl tests

401 is expected for protected routes without bearer token. Health check for route mount:
- 401 = route exists and auth is working
- 500 = runtime bug / server issue

## 5) Useful Debug Commands

## Last API logs

```bash
cd /opt/asos
docker compose --env-file .env.production logs --tail=200 api
```

## Last Worker logs

```bash
cd /opt/asos
docker compose --env-file .env.production logs --tail=200 worker
```

## Live follow logs

```bash
cd /opt/asos
docker compose --env-file .env.production logs -f api worker
```

## Verify running code version

```bash
cd /opt/asos
git rev-parse --short HEAD
docker compose --env-file .env.production ps
```

## 6) Safe Release Pattern (Recommended)

For each release:
1. `git pull origin main`
2. Apply Prisma sync/migrations if schema changed
3. `bash deploy/update.sh`
4. Force rebuild `api/worker` if needed
5. Rebuild/copy frontend bundle
6. Run post-deploy health + logs checklist
7. Manually test critical paths (login, dashboard, leads, conversations, ads extract/generate)

This sequence avoids most "pulled but not live" issues.

