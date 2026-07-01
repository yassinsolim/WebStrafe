# Deploying WebStrafe to `strafe.yassin.app`

**Primary path: Vercel (static) + Supabase (Realtime + leaderboard) — $0, no
server.** This is the same serverless pattern the Nordschleife racer uses:
Supabase Realtime carries multiplayer and the elected host runs the bots
client-side, so there is nothing always-on to pay for.

```
Browser ──HTTPS──▶ Vercel (static dist)          strafe.yassin.app
   │
   └──WSS─────────▶ Supabase Realtime + Postgres  <project>.supabase.co
```

## 1. Supabase (one-time)

1. Open your project → **SQL Editor** and run [`supabase/schema.sql`](../supabase/schema.sql).
   That creates `webstrafe_leaderboard` with row-level security (public read,
   validated public insert, no update/delete).
2. Grab **Project Settings → API**: the **Project URL** and the **publishable**
   (anon) key. These are client-safe.

Multiplayer/bots need no tables — Realtime broadcast + presence are enough.

## 2. Vercel

Connect the GitHub repo (`yassinsolim/WebStrafe`) as a new Vercel project
(`vercel.json` already sets build=`npm run build`, output=`dist`). Set these
**Environment Variables** (Production + Preview):

| Variable | Value |
|----------|-------|
| `VITE_ENABLE_COMBAT` | `true` |
| `VITE_SUPABASE_URL` | your Project URL (e.g. `https://xxxx.supabase.co`) |
| `VITE_SUPABASE_KEY` | your **publishable** key |

That's it — `supabaseConfig` reads those at build time, so **no config file ships
in git**. Deploy, then add `strafe.yassin.app` under the project's **Domains**
and create a `CNAME strafe → cname.vercel-dns.com` on `yassin.app`.

> The publishable key is safe in the client bundle by design; access is
> constrained by the RLS policies in `schema.sql`. The `service_role` key must
> never be used here.

## 3. Verify

Open `https://strafe.yassin.app`, set a username, pick **surf_skyworld_x**, Play.
Single-player surf works immediately; open a second tab/device to see the other
player, and with combat on you'll see bots (run by whichever tab is host) surf
and shoot. Submit a run to confirm the leaderboard writes to Supabase.

## Local development

- `npm run dev` alone → offline/self-hosted (the bundled WebSocket server, with
  its own authoritative bots via `ENABLE_BOTS=true`). No Supabase needed.
- To exercise the Supabase path locally, drop your keys into
  `public/config/webstrafe.config.json` (gitignored; copy
  `public/config/webstrafe.config.example.json`) **or** export
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` before `vite`.

## Self-hosted alternative (WebSocket server)

If you'd rather run the authoritative server (LAN, homelab, or a box that stays
on), the backend image + `fly.toml` are still here — see the server env vars in
`.env.example`. In that mode leave the `VITE_SUPABASE_*` vars unset; the client
talks to the server over `/ws` and `/api`.

```bash
docker build -t webstrafe-server .
docker run --rm -p 8080:8080 -e ENABLE_BOTS=true webstrafe-server
# http://localhost:8080  (server serves the client + runs bots)
```
