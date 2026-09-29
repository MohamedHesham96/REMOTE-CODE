# RemoteCode

Talk to [OpenCode](https://opencode.ai) from your phone — on your own Wi-Fi, or from anywhere in the world over [Tailscale](https://tailscale.com/).

A small Express backend runs OpenCode on your machine and serves a mobile web app. Add it to your home screen and it behaves like a native app: conversations, live progress, permissions, questions, git status, and push notifications.

- **Your phone drives your machine.** Send prompts, answer questions, approve permissions, watch the agent work.
- **Installable PWA** — full-screen app, offline shell, Web Push.
- **Arabic (default) and English**, in four themes.
- **OpenCode is the source of truth** — the backend just proxies it, it never reimplements the engine.

## Quick start

### Windows

```powershell
git clone <repo-url>
cd REMOTE-CODE
.\build.bat
```

`build.bat` checks your tools, opens the firewall, creates `.env` with a random access token and push keys, then starts everything. Use `.\build.bat prod` for a production build on a single port.

### Any OS

```powershell
git clone <repo-url>
cd REMOTE-CODE
npm install
npm run setup      # creates .env and prints your access token
npm run dev        # or: npm run build && npm start
```

Log in with the `APP_ACCESS_TOKEN` printed by `npm run setup`.

## Getting to it from your phone

There are two ways in. Use whichever fits — or both.

### On the same Wi-Fi

| Mode | URL |
|------|-----|
| Dev | `http://<PC-IP>:5173` |
| Prod | `http://<PC-IP>:7171` |

Find your PC's IP with `ipconfig` (Windows) or `ip addr` (macOS/Linux). Both devices need to be on the same network, and the network must not isolate clients — guest and hotel Wi-Fi usually blocks this.

### From anywhere with Tailscale

[Tailscale](https://tailscale.com/) puts your computer and your phone on a private encrypted network. The app is then reachable from anywhere — home, the office, mobile data — without opening a single port on your router.

1. Install Tailscale on your computer and on your phone, then sign in with the same account on both: [tailscale.com/download](https://tailscale.com/download).

2. On the computer, with the app running, expose it over HTTPS:

   ```powershell
   tailscale serve --bg --https=443 7171
   ```

   `7171` is the app's default port. If you changed `APP_PORT` in `.env`, use that port here too.

3. Print the address Tailscale assigned you:

   ```powershell
   tailscale serve status
   ```

4. On the phone, with Tailscale running, open the `https://<machine>.<tailnet>.ts.net` address it shows and log in with your access token.

Why this one: Tailscale hands out a real TLS certificate for the `*.ts.net` name, so **installing the app and push notifications work over the phone** — something plain `http://` on a LAN IP cannot do. The traffic is encrypted end to end and only your own devices can reach it, so it is safe on untrusted Wi-Fi. That is strictly better than port-forwarding this app to the open internet.

`--bg` keeps the mapping alive across reboots. To undo it, run `tailscale serve reset`.

## What you can do from the phone

- **Conversations** — list projects, start a session, send prompts, rename, delete. A second prompt while one is running is queued, not lost.
- **Live progress** — streaming responses, the agent's plan, elapsed time, status chips. Updates arrive over Server-Sent Events.
- **Stay in the loop** — approve or reject permission requests, and answer questions with choices or your own text.
- **History** — every finished request with its answer and the files it produced. Copy the result, or share and download the files.
- **Pins** — bookmark conversations; the list is shared across all your devices.
- **Models** — pick the model and thinking level per session, or set a default per project.
- **Git** — see what changed in the current project, then ask the agent to commit, push, or revert.
- **Notifications** — get a buzz when a task finishes or when it needs your attention.

## Configuration

Everything lives in `.env`, created by `npm run setup` and never committed. The only value you normally need to know is `APP_ACCESS_TOKEN` — that is your login password.

| Variable | Default | What it does |
|----------|---------|--------------|
| `APP_ACCESS_TOKEN` | random | Login token, minimum 24 characters. Changing it signs out every device. |
| `APP_HOST` | `0.0.0.0` | Interface to listen on. Keep it so your phone can reach the app. |
| `APP_PORT` | `7171` | Port the app listens on. |
| `OPENCODE_PROJECT_DIR` | `.` | Directory OpenCode works in. |
| `OPENCODE_SERVER_URL` | empty | Use an existing OpenCode server instead of starting one. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated | Web Push keys. Set both or neither. |
| `APP_TLS_CERT_PATH` / `APP_TLS_KEY_PATH` | empty | Serve HTTPS directly instead of via Tailscale. Set both or neither. |

The token is validated at startup, and key pairs must be configured together or not at all.

## Install it as an app

Browsers only allow install and push on a **secure context** — HTTPS or `localhost`. If you followed the Tailscale section, you already have a valid HTTPS address. Otherwise put a certificate your phone trusts into `APP_TLS_CERT_PATH` / `APP_TLS_KEY_PATH` and restart.

- **Android** (Chrome/Edge): open the URL, then ⋮ → **Install app**
- **iOS** (Safari 16.4+): open the URL, then **Share → Add to Home Screen**. Push only works once the app is installed.
- **Desktop** (Chrome/Edge): click the install icon in the address bar

Then turn on notifications from the app's Settings.

## Security notes

- **The engine stays private.** OpenCode only ever listens on `127.0.0.1`. `APP_HOST=0.0.0.0` exposes the RemoteCode app and nothing else — keep it that way.
- **One shared token** guards the whole app, compared in constant time. There are no per-user accounts, so treat the token as a password.
- **`.env` is secret** — it holds the access token and the push private key. Never commit, print, or share it. Only `.env.example` belongs in git.
- **Don't port-forward it.** Anyone who guesses the token owns your machine's shell. Use Tailscale or a similar private network; never expose plain HTTP to the internet.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Missing required environment variable: APP_ACCESS_TOKEN` | No `.env` — run `npm run setup` (or `.\build.bat`, which does it for you). |
| `APP_ACCESS_TOKEN must contain at least 24 characters` | Token too short. `npm run setup` generates a long one. |
| `VAPID_…` or `APP_TLS_…` `must be configured together` | Key pairs are all-or-nothing. Set both or leave both empty. |
| `EADDRINUSE` | Another instance holds the port. Stop it or change `APP_PORT` in `.env`. |
| Phone can't reach the PC on Wi-Fi | Same network required, no client isolation, and the firewall rule must exist — run `build.bat` as Administrator if it could not be added. |
| Phone can't reach it over Tailscale | Check `tailscale status` on both devices and confirm they are on the same tailnet. Then `tailscale serve status` on the computer. |
| `BACKEND_STARTING` on the phone | The engine is still booting — wait a few seconds and refresh. The app opens its port before OpenCode is ready, so login always works. |
| Prod shows nothing on `:5173` | Expected. `5173` is dev-only; in production use `:<APP_PORT>` (default `7171`). |
| Install button missing, push won't turn on | Needs HTTPS. Use the Tailscale address, a real certificate, or `localhost`. On iOS the app must be on the home screen first. |
| Stale screen after a network change | The live stream dropped while the app was asleep. It resyncs on its own; pull to refresh also works. |

## Development

The single required gate — lint, typecheck, tests, build:

```powershell
npm run check
```

It must be green before any change is called done. Individual steps are `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`.

| Script | Purpose |
|--------|---------|
| `setup` | Create `.env` with an access token and push keys |
| `dev` | Backend with watch mode + Vite frontend on `5173` |
| `build` | Typecheck, build the frontend, compile the server |
| `start` | Run the production server |
| `check` | lint + typecheck + test + build |

Architecture, conventions, and the API surface are documented in [AGENTS.md](./AGENTS.md).
