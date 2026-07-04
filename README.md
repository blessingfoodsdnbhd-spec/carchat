# carchat backend (Node + Express + Prisma)

Self-hosted API for the carchat app. Implements BUILD-SPEC §6 (data model) and §7 (API).

## Run locally
```
cd server
npm install
npx prisma migrate dev      # creates the SQLite dev.db
npm run seed                # demo merchants / showcase / listings
npm run dev                 # http://localhost:4000
```
The app connects at `http://<your-LAN-IP>:4000` (set in `mobile-app/src/api.ts`).

## Auth
- `POST /auth/google` `{ idToken }` — verifies Google ID token → issues our JWT.
- `POST /auth/apple` `{ idToken }` — verifies Apple ID token → issues our JWT.
- `POST /auth/dev` — **dev only** quick login (no OAuth), disabled when `NODE_ENV=production`.
- All protected routes need `Authorization: Bearer <jwt>`.

### Setting up Google/Apple (when ready)
1. **Google:** create an OAuth Client ID in Google Cloud Console (one per platform: iOS, Android, Web).
   Put the accepted client IDs (comma-separated) in `.env` `GOOGLE_CLIENT_IDS`. The app sends the
   Google ID token to `/auth/google`.
2. **Apple:** create a Service ID / App ID in the Apple Developer portal. Put it in `.env` `APPLE_CLIENT_ID`.
   Harden `verifyAppleIdToken` to check Apple's public-key signature before launch.

## Switch to Postgres for production
1. In `prisma/schema.prisma` set `provider = "postgresql"`.
2. Set `DATABASE_URL` to your Postgres URL (e.g. a free Neon database).
3. `npx prisma migrate deploy`.
4. `photos` on Listing is a JSON string for SQLite portability — fine on Postgres too.

## Deploy
Any Node host (Railway, Render, Fly, a VPS). `npm run build` then `npm start`. Set env vars
(`DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_IDS`, `APPLE_CLIENT_ID`) on the host.
