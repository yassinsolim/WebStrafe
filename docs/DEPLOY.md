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

Open `https://strafe.yassin.app`, set a username, pick **Prismline**, Play.
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

## Free, recommended: dedicated server on the homelab + Cloudflare Tunnel

No card, no new service: `yassin.app` DNS is already on Cloudflare, and
Cloudflare Tunnel plus proxied WebSockets are free on every plan. The tunnel
connects outbound from the VM, so no router ports are opened.

On a Debian VM on Proxmox (2 vCPU and 2 GB is plenty):

```bash
# node + the repo
sudo apt install -y nodejs npm git
sudo useradd --system --home /var/lib/webstrafe --create-home webstrafe
sudo git clone -b revamp/netcode-phase1 https://github.com/yassinsolim/WebStrafe.git /opt/webstrafe
cd /opt/webstrafe && sudo npm ci --no-audit --no-fund && sudo chown -R webstrafe: /opt/webstrafe
sudo mkdir -p /etc/webstrafe && sudo cp deploy/homelab/game.env.example /etc/webstrafe/game.env

# game server as a service
sudo cp deploy/homelab/webstrafe-game.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now webstrafe-game
curl -s http://127.0.0.1:8080/api/health
```

Tunnel (Cloudflare dashboard → Networking → Tunnels → Create tunnel):

1. Name it `webstrafe`, pick Debian, and run the `cloudflared service install <token>`
   command it shows on the VM.
2. Add a route → Published application: hostname `game.yassin.app`,
   service `http://127.0.0.1:8080`.
3. Check from anywhere: `curl https://game.yassin.app/api/health`.

Keep the VM's clock synced (`timedatectl`, on by default on Debian). Updating
is `git pull && npm ci && sudo systemctl restart webstrafe-game`.

### Point only the PR preview at it

Scoped to the Preview environment and the PR branch, so production keeps Supabase:

```bash
vercel env add VITE_MULTIPLAYER_TRANSPORT preview revamp/netcode-phase1   # value: ws
vercel env add VITE_WS_URL preview revamp/netcode-phase1                  # value: wss://game.yassin.app/ws
```

Then deploy a preview from the branch's worktree with `vercel deploy` (pushing
no longer builds previews, see `AGENTS.md`) and bench it from anywhere:

```bash
npx tsx tools/netbench/bench.ts --target wss://game.yassin.app/ws --secs 30
```

Production only moves after the PR is merged and the same two variables are
set for Production.

## Free fallback: Render

`render.yaml` is a blueprint for Render's free web service (Oregon, no card
needed). It sleeps after 15 minutes without traffic (about a minute to wake),
has 0.1 CPU / 512 MB and 5 GB of egress a month (roughly 60 player-hours at
~75 MB per player-hour), so bots are off there. Use it only if the homelab is down.

## Optional, paid: Fly.io

Not required. Fly has no free tier for new apps (the account needs a card),
so this is kept only as an option. Everything above and the homelab path
below are free.

`fly.toml` defines `webstrafe-game`: backend only, `shared-cpu-1x` with 1 GB,
health checks on `/api/health`, no volume (the leaderboard stays on Supabase).
Fly no longer offers `sea`, so it defaults to `sjc`.

```bash
fly auth login                        # once
fly apps create webstrafe-game --org personal
fly deploy --remote-only              # builds on fly, no local docker needed
curl https://webstrafe-game.fly.dev/api/health
```

Pick the region by rtt from where players are. Clone into candidates, probe
each with `fly-prefer-region`, keep the best, destroy the rest:

```bash
fly machine clone <id> --region ord   # repeat for lax, yyz, ...
for r in sjc lax ord yyz; do
  curl -s -o /dev/null -H "fly-prefer-region: $r" \
    -w "$r %{time_starttransfer}\n" https://webstrafe-game.fly.dev/api/health
done
```

Bench the deployed server with bot clients (no proxy, real internet path):

```bash
npx tsx tools/netbench/bench.ts --target wss://webstrafe-game.fly.dev/ws --secs 30
```

Point the preview at it with the same preview-scoped variables as the
homelab section, using `wss://webstrafe-game.fly.dev/ws`.
