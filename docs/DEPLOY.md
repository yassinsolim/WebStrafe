# Deploying WebStrafe to `strafe.yassin.app`

WebStrafe is two pieces:

1. **Static client** — the Vite build (`dist/`). Goes on **Vercel** at
   `strafe.yassin.app`.
2. **Multiplayer backend** — a persistent **Node WebSocket + API + bot-sim**
   server (`server/index.ts`). Vercel can't host long-lived WebSockets, so this
   runs on a persistent host (**Fly.io** shown here; Railway/Render/a homelab
   box work the same way).

The client discovers the backend at build time via `VITE_WS_URL` / `VITE_API_BASE`.
With those unset, everything falls back to same-origin (single-host or local dev).

```
Browser ──HTTPS──▶ Vercel (static dist)         strafe.yassin.app
   │
   └──WSS / HTTPS─▶ Fly.io (WS + API + bots)     webstrafe-server.fly.dev
```

## 1. Backend → Fly.io

```bash
# one-time
fly launch --no-deploy            # sets app name + region in fly.toml
fly volumes create webstrafe_data --size 1 --region <your-region>

# set the allowed frontend origin (or edit fly.toml [env])
fly secrets set WEBSTRAFE_ALLOWED_ORIGINS="https://strafe.yassin.app"

fly deploy
```

Notes:
- `fly.toml` already sets `ENABLE_BOTS`, `BOTS_PER_MAP`, `WEBSTRAFE_DATA_DIR=/data`,
  and **`auto_stop_machines = false`** (required — an auto-stopped machine drops
  live WebSockets).
- Note the deployed URL (e.g. `https://webstrafe-server.fly.dev`).

## 2. Frontend → Vercel

Set these **Build & Development** environment variables on the Vercel project
(point them at the backend from step 1):

| Variable | Value |
|----------|-------|
| `VITE_ENABLE_COMBAT` | `true` |
| `VITE_WS_URL` | `wss://webstrafe-server.fly.dev/ws` |
| `VITE_API_BASE` | `https://webstrafe-server.fly.dev` |

Then:

```bash
vercel                 # preview
vercel --prod          # production
```

`vercel.json` pins `buildCommand=npm run build` and `outputDirectory=dist`.
Add `strafe.yassin.app` as a domain on the project (Vercel dashboard → Domains),
then create the DNS `CNAME strafe → cname.vercel-dns.com` on `yassin.app`.

## 3. Verify

- Open `https://strafe.yassin.app`, set a username, pick **surf_skyworld_x**, Play.
- You should connect (no WS errors in devtools), see the leaderboard load, and —
  with combat + bots enabled — see bots surfing and shooting (tracers, HUD,
  kill feed).

## Single-origin alternative (no Vercel)

The backend image already runs `npm run build` and serves `dist/`, so you can
skip Vercel entirely and serve everything from Fly: leave `VITE_WS_URL` /
`VITE_API_BASE` unset, build with `VITE_ENABLE_COMBAT=true`, and point
`strafe.yassin.app` at the Fly app. Simpler, but no Vercel CDN for the static
assets.

## Local production smoke test

```bash
docker build -t webstrafe-server .
docker run --rm -p 8080:8080 -e ENABLE_BOTS=true webstrafe-server
# open http://localhost:8080  (single-origin; server serves the client)
```
