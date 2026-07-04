# Deploying the carchat backend (free)

Goal: a public HTTPS URL (e.g. `https://carchat-api.onrender.com`) the TestFlight app
can reach from anywhere. Stack: **Neon** (free Postgres) + **Render** (free Node host).

## 1. Create a free Postgres (Neon)
1. Sign up at https://neon.tech (free).
2. Create a project → copy the **connection string** (looks like
   `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).

## 2. Switch Prisma from SQLite → Postgres (one time)
In `prisma/schema.prisma` change:
```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```
Then locally, pointing DATABASE_URL at your Neon URL, regenerate migrations:
```
# delete the old SQLite migrations first
rm -rf prisma/migrations
DATABASE_URL="<your-neon-url>" npx prisma migrate dev --name init
DATABASE_URL="<your-neon-url>" npm run seed   # optional demo data
```
(Claude can do this step for you once you paste the Neon URL.)

## 3. Deploy to Render
1. Push this repo to GitHub.
2. https://render.com → New → **Blueprint** → pick the repo (it reads `server/render.yaml`).
3. In the service's **Environment**, set:
   - `DATABASE_URL` = your Neon URL
   - `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_ID` (later, when OAuth is set up)
   - `JWT_SECRET` is auto-generated.
4. Deploy. When live, hit `https://<your-service>.onrender.com/health` → `{"ok":true}`.

## 4. Point the app at it
In `mobile-app/.env`:
```
EXPO_PUBLIC_API_BASE=https://<your-service>.onrender.com
```
Rebuild the app (or restart Expo). The dev LAN IP is only used when this is unset.

## Notes
- Render free web services sleep after inactivity (first request wakes them, ~30s). Fine for testing.
- `NODE_ENV=production` disables the `/auth/dev` route — real Google/Apple sign-in is required then.
- Keep secrets out of git (`.env` is gitignored).
