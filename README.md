# RemoteCode

A mobile-first web interface for talking to [OpenCode](https://opencode.ai) from your phone over the same Wi-Fi network. A thin Express backend drives a locally-started OpenCode engine; a React single-page app gives you conversations, live status, history, pins, Git status, models, permissions, questions, files, and push notifications.

- **Use your phone as a remote control** for coding agents running on your computer.
- **Installable PWA**: standalone full-screen app with offline shell, icons, and Web Push.
- **Bilingual**: Arabic (default, RTL) and English (LTR). Four themes: glass, dark, hacker, metal.
- **Source of truth is OpenCode** — the backend proxies it; the app never reimplements the engine.

> Previous short Arabic README content is preserved in spirit below (run commands, Web Push over HTTPS, and the security rules). Everything here was verified against the actual code and scripts.

## Table of Contents

- [How It Works](#how-it-works)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation and Configuration](#installation-and-configuration)
- [Running the Application](#running-the-application)
- [PWA Installation](#pwa-installation)
- [Architecture](#architecture)
- [API Endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Verification and Checks](#verification-and-checks)

## How It Works

```text
Phone (PWA) ──HTTPS/HTTP──▶ Express backend (:7171 prod, or Vite :5173 + backend in dev)
                                │  serves dist/ + /api/*
                                │  starts + proxies OpenCode CLI on 127.0.0.1:4196
                                ▼
                        OpenCode engine (SDK @opencode-ai/sdk 1.18.32)
```

1. The backend (`server/`) starts the OpenCode CLI **locally on `127.0.0.1` only** (never exposed to the LAN) and talks to it via the pinned SDK.
2. The frontend (`src/`, React 19 SPA) talks only to the backend's `/api/*` endpoints.
3. Live updates arrive over **Server-Sent Events** (`GET /api/events`); polling is a fallback only.
4. Pins, push subscriptions, and the OpenCode database live in the local `data/` directory.

Main technologies:

| Layer    | Stack                                                                 |
|----------|-----------------------------------------------------------------------|
| Client   | React 19.3, Vite 8, TypeScript 5.9, plain CSS in `src/styles.css`     |
| Server   | Express 5.2, Node ESM (`module: NodeNext`), compiled with `tsc`       |
| Engine   | `@opencode-ai/sdk` **pinned to `1.18.32`**                            |
| Push     | `web-push` 3.6.7 (VAPID)                                              |
| Tests    | Vitest 4 (Node environment)                                           |

No other runtime dependencies exist. Do not add new packages without discussion.

## Features

Everything below is implemented in the current code — no planned/vapor features are listed.

### Conversations and projects

- **Projects**: list OpenCode projects, search, switch (`POST /api/project/select`). Recent projects and last-open session per project are remembered locally.
- **Sessions**: create, list (sorted by creation), rename (PATCH, max 120 chars), delete (also cleans up server pins for that session).
- **Messaging**: send prompts (max 20,000 chars, `POST .../message` → `202 { accepted, queued }`). A second message while one runs is **queued**, not lost.
- **Queue management**: view running/queued requests, skip the running one, remove a queued one, or run a queued one immediately.
- **Abort**: stop the running task (`POST .../abort`).
- **History**: organized newest-first cards, each with the question, final result, step count, and files; search, copy question/result, expand/collapse long results.
- **Request cards**: live response text, execution plan (todo list auto-updates), status chips (running / done / queued / stopped), elapsed time.
- **Result files**: per-request file list with **download** (HTTP range-aware streaming) and **share** via the mobile Web Share API (WhatsApp, Telegram, Drive, …).

### Real-time sync

- **SSE stream** (`GET /api/events`): `ready` + `opencode` + `pins` events, 25 s heartbeat, `no-transform` so compression never buffers the stream.
- **Polling fallback only**: statuses/activity every 4 s and sessions every 12 s when SSE is down or the tab is hidden; staggered, freshness-guarded refetch on `visibilitychange`/`focus` — never a busy-poll replacement for SSE.
- **Cross-device pins sync**: pin changes broadcast to every open tab/device over the same SSE connection.
- **Completion signals**: distinct sound + vibration pattern on task completion; attention sound + toast for questions/permissions/errors. Notification dedupe per task so nothing fires twice.

### Active sessions and activity

- **Active-sessions panel**: live list across all projects, merged from `/api/activity` + sidebar working set (deduped by id).
- **Recently active**: 5-minute grace window (`ACTIVE_GRACE_MS`) keeps just-finished sessions visible.
- **Sidebar badges**: working sessions counted from the same merged set the activity panel shows.

### Pins (server-side, shared)

- Stored in the backend (`data/`), shared across all devices and tabs — localStorage is display cache only.
- Per-project filtering (`GET /api/pin?project=<worktree>`); merge endpoint (`POST /api/pin/merge`) adds new pins without wiping existing ones, so two devices never lose each other's updates.
- Deleting a session auto-forgets its pins; legacy id-only caches are attributed to their project via OpenCode lookup.

### Models

- **Live model list** from OpenCode (`GET /api/models`); the picker shows **free (zero-cost) models only**, refreshed every time it opens.
- **Per-session model** view/switch (`GET`/`POST /api/session/:id/model`), plus **thinking-level variants** (auto / minimal / low / medium / high / max).
- **Per-project default model** saved locally and used for new conversations.

### Permissions and questions

- **Permission cards**: allow once / allow always / reject (`POST .../permission/:permissionId`).
- **Question cards**: single- and multi-select options plus a custom-answer field; reply or reject (`POST .../question/:requestId/reply|reject`).

### Git panel

- **Status** of the selected project's worktree (`GET /api/git/changes`): branch, added/modified/deleted counts, clean / not-a-repo states.
- **Commit & push**, **revert file**, and **revert all** are sent as agent prompts in the conversation (with a destructive-action confirmation step) — the app does not run git itself.

### Notifications (Web Push)

- VAPID push for: task completion (`session.idle` after busy), OpenCode questions, permission requests, and session errors. Per-subscription language (ar/en).
- Subscriptions persisted in `data/push-subscriptions.json`; dead endpoints (404/410) are pruned automatically.
- Requires **HTTPS or `localhost`** (browser rule, not app choice). Test endpoint available (`POST /api/push/test`).

### Personalization and access

- **Languages**: Arabic (Fusha, RTL, default) and English (LTR); server messages follow `?lang=` → body → `Accept-Language` → Arabic.
- **Themes**: glass (light), dark, hacker (green terminal), metal — persisted, follows OS preference on first run.
- **Login**: access-token login issuing an HttpOnly session cookie (30 days). Logout clears it.
- **Mobile + desktop**: responsive layout; touch composer detection (`Enter` behavior adapts), safe-area insets, desktop install supported.

### Implemented vs. not implemented

| Area | Status |
|------|--------|
| Everything above | Implemented and wired to real endpoints |
| File **upload** to the backend | Not implemented (`express.json` limit is 2 MB; no upload route exists) |
| Multi-user accounts / roles | Not implemented — single shared access token |
| Remote access outside LAN | Not built in — use your own secure tunnel/VPN (see [Security](#security)) |

## Prerequisites

| Requirement | Version / notes |
|-------------|-----------------|
| Node.js | **20+** (`run.bat` checks this; developed with Node 24) |
| npm | ships with Node (dependencies install via `npm install`) |
| OpenCode CLI | required in `PATH` — install with `npm install -g opencode-ai`. The **OpenCode desktop app v2 alone is not enough**: its database format is incompatible with the CLI v1 this backend drives (`run.bat` fails fast with a clear error if the CLI is missing) |
| OS | Windows scripts provided (`run.bat`); macOS/Linux can run the same `npm` commands manually |
| Phone + computer | same Wi-Fi, no VPN, firewall open (see [Troubleshooting](#troubleshooting)) |
| HTTPS (optional) | required for PWA install + Web Push on LAN; `localhost` is exempt by browsers |

## Installation and Configuration

### 1. Clone and install

```powershell
git clone <repo-url>
cd REMOTE-CODE
npm install
```

`run.bat` also runs `npm install` automatically when `node_modules/` is missing.

### 2. Create `.env`

```powershell
npm run setup
```

`npm run setup` (`tsx server/setup.ts`) generates `.env` (mode `0600`) with a random `APP_ACCESS_TOKEN` and fresh VAPID keys, filling in defaults for anything missing without overwriting existing values. It prints the access token once — save it; it is the phone login.

Never commit `.env`. Only `.env.example` belongs in git.

### 3. Configure environment variables

All keys from `.env.example` (values below are placeholders — never real secrets):

```dotenv
# Required: at least 24 characters (validated at startup)
APP_ACCESS_TOKEN=paste-your-long-random-token-here

# Backend listen address/port (0.0.0.0 = reachable from the phone)
APP_HOST=0.0.0.0
APP_PORT=7171

# Optional HTTPS pair — must be set TOGETHER or not at all
APP_TLS_CERT_PATH=./certs/localhost.pem
APP_TLS_KEY_PATH=./certs/localhost-key.pem

# OpenCode engine
OPENCODE_PROJECT_DIR=.
OPENCODE_SERVER_URL=
OPENCODE_SERVER_USERNAME=opencode
OPENCODE_SERVER_PASSWORD=
OPENCODE_PORT=4196

# Web Push (VAPID) — generated by npm run setup; must be set TOGETHER or not at all
VAPID_PUBLIC_KEY=paste-generated-public-key
VAPID_PRIVATE_KEY=paste-generated-private-key
VAPID_SUBJECT=mailto:opencode@localhost
```

| Variable | Default | Notes |
|----------|---------|-------|
| `APP_ACCESS_TOKEN` | (none — required) | min 24 chars; changing it signs out all devices |
| `APP_HOST` | `0.0.0.0` | keep for LAN access; `127.0.0.1` = this machine only |
| `APP_PORT` | `7171` | backend + prod frontend port |
| `APP_LANG` | empty (= Arabic) | console log language: set to `en` for English (`run.bat` sets it automatically) |
| `APP_TLS_CERT_PATH` / `APP_TLS_KEY_PATH` | empty (plain HTTP) | set both for HTTPS; needed for LAN PWA install + push |
| `OPENCODE_PROJECT_DIR` | `.` | working directory OpenCode operates in |
| `OPENCODE_SERVER_URL` | empty (= start local CLI) | set to use an external OpenCode server instead |
| `OPENCODE_SERVER_USERNAME` / `PASSWORD` | `opencode` / empty | external-server credentials |
| `OPENCODE_PORT` | `4196` | local OpenCode port on `127.0.0.1` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | generated | push key pair; both or neither |
| `VAPID_SUBJECT` | `mailto:opencode@localhost` | contact shown to push services |
| `OPENCODE_DB` (advanced) | `data/projects-database.db` | override the engine DB path (e.g. `:memory:`) |

Validation rules enforced at startup (`server/config.ts`): missing/short token fails, TLS and VAPID keys must be configured as pairs, and `OPENCODE_PROJECT_DIR` must exist.

### 4. Connect to OpenCode

- **Default**: the backend starts the OpenCode CLI itself on `127.0.0.1:<OPENCODE_PORT>` — nothing to configure.
- **External server**: set `OPENCODE_SERVER_URL` (plus username/password if needed); `run.bat` then skips the CLI check.

Note on databases: the backend pins `OPENCODE_DB` to `data/projects-database.db` because the desktop app (v2) migrates a shared database to a format without a `session` table, which kills CLI v1 with "Database is not empty and has no session table". Desktop project folders are auto-imported **read-only** (absolute, existing, non-hidden paths only — no drive roots, relative paths, or the home folder) as targets for new sessions; old desktop conversations are not migrated due to the format difference.

## Running the Application

### Easiest: `run.bat` (Windows)

```powershell
# Development (backend + Vite with hot reload)
.\run.bat

# Production (build + single-port server)
.\run.bat prod
```

What it does: checks Node/npm (and the OpenCode CLI unless an external server is set), adds Windows Firewall rules for the needed ports, creates `.env` on first run, shows localhost URLs, opens the browser once the servers answer, and starts the server (`pause` keeps the window open; `Ctrl+C` stops).

| Mode | Command | Phone URL | Notes |
|------|---------|-----------|-------|
| Dev | `.\run.bat` | `http://<PC-IP>:5173` | Vite frontend + backend on `APP_PORT`; hot reload via LAN (`hmr.clientPort: 5173`) |
| Prod | `.\run.bat prod` | `http://<PC-IP>:7171` (or your `APP_PORT`) | serves `dist/` + API on one port; port 5173 stays closed — this is normal |

Startup is quiet by design: the backend prints nothing on success (errors only),
and the launcher opens the browser automatically once the servers answer.
Find this machine's LAN IP with `ipconfig` and open
`http://<PC-IP>:5173` (dev) or `http://<PC-IP>:<APP_PORT>` (prod)
from the phone — same Wi-Fi, no VPN.

### Manual commands (any OS)

```powershell
npm install
npm run setup        # create .env once
npm run dev          # dev: tsx watch server/index.ts + vite --host 0.0.0.0 --port 5173
npm run build        # typecheck + vite build + tsc -p tsconfig.server.json
npm start            # prod: node dist-server/server/index.js
```

Available scripts (`package.json`):

| Script | Command | Purpose |
|--------|---------|---------|
| `setup` | `tsx server/setup.ts` | generate `.env` with token + VAPID keys |
| `dev` | `concurrently … "tsx watch server/index.ts" "vite --host 0.0.0.0 --port 5173"` | dev backend + frontend |
| `build` | `npm run typecheck && vite build && tsc -p tsconfig.server.json` | production build (`dist/` + `dist-server/`) |
| `start` | `node dist-server/server/index.js` | production server |
| `lint` | `eslint .` | lint |
| `typecheck` | `tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.server.json --noEmit` | typecheck client + server |
| `test` | `vitest run` | tests |
| `check` | `npm run lint && npm run typecheck && npm run test && npm run build` | full gate — must be green |

### Ports and how to change them

| Service | Default | Change via |
|---------|---------|------------|
| Prod / backend | `7171` | `APP_PORT` in `.env` |
| Dev frontend (Vite) | `5173` (strict) | fixed in `vite.config.ts` + `package.json` dev script |
| OpenCode engine (loopback) | `4196` on `127.0.0.1` | `OPENCODE_PORT` in `.env` |

### Access from the phone

1. Start the app (`.\run.bat` or `.\run.bat prod`).
2. Read the LAN address from the console (or find your PC's IPv4 via `ipconfig`).
3. On the phone (same Wi-Fi, no VPN), open `http://<PC-IP>:5173` (dev) or `http://<PC-IP>:<APP_PORT>` (prod).
4. Log in with the `APP_ACCESS_TOKEN` from `.env`.

## PWA Installation

The app ships a manifest (`public/manifest.webmanifest`: `display: standalone`, portrait, theme `#0b1020`, SVG + PNG/maskable icons) and a service worker (`public/sw.js`: versioned app-shell cache, hashed-asset cache-first, navigation network-first with offline fallback, push handling with session deep-links).

> Browsers require a **secure context** for installation and push: **HTTPS or `localhost`**. Plain `http://<LAN-IP>` works in the browser but cannot be installed and cannot receive push.

### Enable HTTPS on the LAN (for install + push)

1. Create a certificate your phone trusts (e.g. `mkcert <PC-IP>`, or a reverse-proxy/tunnel with valid TLS).
2. Point `.env` at it:

```dotenv
APP_TLS_CERT_PATH=./certs/localhost.pem
APP_TLS_KEY_PATH=./certs/localhost-key.pem
```

3. Rebuild and restart: `npm run build` then `npm start` (or `.\run.bat prod`).
4. Open the `https://<PC-IP>:<APP_PORT>` address on the phone, then install and enable push from the app's Settings.

### Android (Chrome/Edge)

1. Open the HTTPS app URL.
2. Tap ⋮ → **Install app** / **Add to Home screen** (or use the in-app install button when the `beforeinstallprompt` fires).
3. Launch from the home-screen icon for the full-screen standalone experience.

### iOS (Safari, 16.4+ for push)

1. Open the HTTPS app URL in Safari.
2. Tap **Share → Add to Home Screen**.
3. Launch from the home-screen icon. Web Push on iOS only works for installed home-screen apps on iOS 16.4+ — grant notification permission when prompted, then enable push in the app's Settings.

### Desktop (Chrome/Edge)

Open the app URL and click the install icon in the address bar (or ⋮ → Install). The same `standalone` manifest applies.

## Architecture

### Directory structure

```text
REMOTE-CODE/
├── src/                    # React 19 SPA (tsconfig.app.json: Bundler, browser, no noUncheckedIndexedAccess)
│   ├── api/                # typed wrappers over request() in api/http.ts (re-exported via api/index.ts)
│   ├── components/         # PanelFallback, PermissionCard, ProjectPicker, QuestionCard, RequestCard, ...
│   ├── hooks/              # useActivityGrace, useGitRequests, usePinnedConversations, ...
│   ├── panels/             # lazy-loaded panels (ModelPicker, ActiveSessionsPanel, GitChangesPanel, HistoryPanel, PinnedConversationsPanel)
│   ├── utils/              # storage, pin-sync gate, active-sessions merge, git prompts, paths, device
│   ├── App.tsx             # main app (~2000 lines, known — extract new code to separate files)
│   ├── i18n.ts             # ar + en strings (both required; typecheck enforces parity)
│   ├── sound.ts / theme.ts / display.tsx / types.ts / constants.ts
│   └── styles.css          # single global stylesheet
├── server/                 # Express backend (tsconfig.server.json: NodeNext, node, noUncheckedIndexedAccess)
│   ├── index.ts            # composition root ONLY: creates services, wires routes, starts HTTP(S)
│   ├── config.ts           # .env parsing + validation
│   ├── auth.ts             # HMAC session cookie, timingSafeEqual token compare
│   ├── opencode.ts         # OpenCodeService (SDK wrapper, ~1700 lines, known)
│   ├── opencode/           # SDK types + path/project-dir utilities
│   ├── routes/             # one registerXRoutes(app, ctx) per file; deps only via RouteContext
│   ├── sse/                # EventHub (broadcast) + filter (OpenCode event → client event)
│   ├── middleware/security.ts  # X-Frame-Options: DENY, nosniff, no-referrer, restrictive Permissions-Policy
│   ├── pins.ts / push.ts / connection.ts / static.ts / setup.ts / desktop-projects.ts
│   └── utils/              # rate-limit, hash (ETag), concurrency
├── public/                 # manifest.webmanifest, sw.js, icon.svg, icons/*.png
├── data/                   # gitignored local state: pins, push-subscriptions.json, projects-database.db
├── dist/ / dist-server/    # build outputs (frontend / backend)
├── run.bat                 # Windows launcher (dev default, prod via `prod` arg)
├── vite.config.ts          # host 0.0.0.0, allowedHosts, hmr.clientPort 5173, no sourcemaps, React vendor chunk
└── package.json            # scripts + pinned deps
```

### Frontend responsibilities

- All UI state, optimistic updates, and display caching (localStorage holds recent projects, last session per project, default models, theme, language, sound).
- `src/api/*.ts` are thin typed wrappers over `request()` in `src/api/http.ts`; GETs dedupe automatically; everything is re-exported from `src/api/index.ts`.
- New panels go in `src/panels/` → named export in `src/panels/index.ts` → `lazy()` in `App.tsx` (no default exports; `src/panels.tsx` stays a re-export shim).
- Server is the source of truth; `refresh` on `visibilitychange`/`focus` is a backup — never a poll replacement for SSE.

### Backend responsibilities

- `server/index.ts` only composes: creates `OpenCodeService`, `PinService`, `PushService`, `OpenCodeConnection`, `EventHub`, rate limiter, and registers routes in a deliberate order: public (`health`, `login`, `logout`) → `requireAuthentication` on `/api` → `readinessGate()` → everything else. Routes needing OpenCode behind the gate return clear `503 BACKEND_STARTING` instead of opaque 500s.
- Each route file exports `registerXRoutes(app, ctx: RouteContext)` and takes all dependencies from `ctx` — never imports another route.
- Fixed error contract: `{ error: "SCREAMING_SNAKE", message: <localized> }`. Stable codes (`UNAUTHORIZED`, `INVALID_PIN`, …) are never translated; messages are localized via `server/i18n.ts` (`ar` + `en`, `serverMessage(key, lang)`).
- `POST /api/session/:id/message` caps input (empty → 400, >20k chars → 400); `express.json({ limit: "2mb" })` caps bodies (larger → 413); hot poll endpoints (`/api/session/status`, `/api/activity`, `/api/session/:id/requests`) share a 300 req/min rate limiter (429 + Retry-After).
- Gzip via `compression` for slow Wi-Fi; `/api/events` sends `no-transform` so it is never compressed/buffered.

### Communication with OpenCode

- Local mode: backend spawns the CLI and connects to `http://127.0.0.1:<OPENCODE_PORT>` with infinite retry — the HTTP server opens first so login/health always answer during engine startup.
- External mode: `OPENCODE_SERVER_URL` (+ optional basic-auth username/password).
- Engine events flow: `OpenCodeService.onEvent` → `sse/filter.ts` (visible `ClientEvent`?) → push fan-out + SSE broadcast to `EventHub`. Queue-continuation idle events are suppressed so the phone never shows "finished" while work remains.

### Session and data storage

| Data | Location | Notes |
|------|----------|-------|
| Pins | `data/` (PinService file) | server source of truth, max 200, versioned schema |
| Push subscriptions | `data/push-subscriptions.json` | mode `0600`, per-endpoint language |
| OpenCode engine DB | `data/projects-database.db` (`OPENCODE_DB`) | isolated from desktop v2 format |
| Client display cache | `localStorage` | recents, last sessions, models, theme, lang, sound |
| HTTP caching | ETags on `/requests`, immutable `Cache-Control` on `/assets/*`, `no-cache` on `sw.js`/manifest/SPA fallback | — |

## API Endpoints

Base: same origin as the app. Auth: `POST /api/login` sets the session cookie; all `/api/*` except health/login/logout require it (401 `UNAUTHORIZED` otherwise). Endpoints needing a live engine return 503 `BACKEND_STARTING` while it connects.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | liveness + engine state (`connected`/`connecting`) — public |
| POST | `/api/login` | `{ accessToken }` → session cookie — public |
| POST | `/api/logout` | clear session cookie — public |
| GET | `/api/config` | engine health, push config (`enabled`, `publicKey`), `secureContext` |
| GET | `/api/project` | `{ projects, selected }` (root `/` filtered out) |
| POST | `/api/project/select` | `{ worktree }` or `{ id }` → `{ project }` |
| GET | `/api/session` | list sessions |
| POST | `/api/session` | `{ title?, mobile? }` → `201` session |
| PATCH | `/api/session/:id` | rename (`{ title }`, required, ≤120) |
| DELETE | `/api/session/:id` | delete + forget its pins |
| GET | `/api/session/status` | all session statuses (rate-limited) |
| GET | `/api/activity` | active sessions across projects (rate-limited) |
| GET | `/api/session/:id/message` | raw messages |
| GET | `/api/session/:id/history` | organized Q&A turns (localized) |
| GET | `/api/session/:id/requests` | requests + questions + status (rate-limited, ETag/304) |
| POST | `/api/session/:id/message` | `{ text, agent?, model? }` → `202 { accepted, queued }` |
| POST | `/api/session/:id/abort` | stop running task |
| POST | `/api/session/:id/skip` | skip running request, continue queue |
| DELETE | `/api/session/:id/request/:requestId` | remove queued request |
| POST | `/api/session/:id/request/:requestId/run` | run queued request now |
| GET | `/api/session/:id/todo` | execution-plan todos |
| GET | `/api/session/:id/diff` | session diff |
| GET | `/api/models` | live OpenCode model list |
| GET | `/api/session/:id/model` | current + default model refs |
| POST | `/api/session/:id/model` | `{ providerID, modelID, variant? }` switch |
| GET | `/api/permission` | pending permissions (works degraded) |
| POST | `/api/session/:id/permission/:permissionId` | `{ response: "once" \| "always" \| "reject" }` |
| POST | `/api/session/:id/question/:requestId/reply` | `{ answers }` |
| POST | `/api/session/:id/question/:requestId/reject` | reject question |
| GET | `/api/git/changes` | worktree git status (branch + files) |
| GET | `/api/session/:id/file?path=<…>` | result-file download (range-capable, `attachment`) |
| GET | `/api/pin` | all pins, or `?project=<worktree>` for one project |
| POST | `/api/pin` | `{ pin }` → `201` updated list |
| POST | `/api/pin/merge` | merge device cache into server list |
| DELETE | `/api/pin/:id` | unpin |
| POST | `/api/pin/forget` | `{ ids: [...] }` batch cleanup |
| POST | `/api/push/subscribe` | register Web Push subscription → `201` |
| POST | `/api/push/test` | send test notification |
| DELETE | `/api/push/subscribe` | `{ endpoint }` unregister |
| GET | `/api/events` | SSE stream (`ready`, `opencode`, `pins`; heartbeat 25 s) |

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `npm run setup` / start fails: `Missing required environment variable: APP_ACCESS_TOKEN` | `.env` missing — run `npm run setup` (or `.\run.bat`, which does it automatically) |
| `APP_ACCESS_TOKEN must contain at least 24 characters` | token too short — generate a long random value; `npm run setup` makes a 43-char one |
| `VAPID_… must be configured together` / `APP_TLS_… must be configured together` | key pairs are all-or-nothing — set both or neither (empty = disabled) |
| `OpenCode project directory does not exist` | `OPENCODE_PROJECT_DIR` points nowhere — fix the path in `.env` |
| `run.bat` says OpenCode CLI not found | install it: `npm install -g opencode-ai`, then restart. Desktop app v2 alone is insufficient |
| `Port 7171 مشغول` / `EADDRINUSE` | another instance holds the port — stop the old server or change `APP_PORT` in `.env` |
| Phone shows `BACKEND_STARTING` / Vite proxy `ECONNREFUSED` | backend still booting — wait ~5 s and refresh; the server opens the port before the engine connects |
| Phone can't reach the PC | same Wi-Fi required; disable VPN on both; allow the firewall rule (run `run.bat` as Administrator if auto-add failed); some guest/hotel networks enable client isolation — use a normal home router |
| Opened `:5173` in prod and nothing loads | expected — 5173 is dev-only; in prod open `:<APP_PORT>` (default 7171) |
| `Database is not empty and has no session table` | a desktop-app v2 database is being shared — keep the default isolated `OPENCODE_DB` (`data/projects-database.db`) or set an explicit `OPENCODE_DB` |
| Install/PWA button missing; push won't enable | needs a secure context — use HTTPS (see above) or `localhost`; on iOS 16.4+ the app must be installed to the home screen first |
| Notifications blocked | browser permission is `denied` — re-enable in the browser/OS site settings, then enable push in the app's Settings |
| `413` on large requests | `express.json` limit is 2 MB — there is no file-upload feature; shrink the payload |
| `429` on status/activity/requests polls | 300 req/min rate limiter tripped (usually a client loop) — it recovers after the window; check for duplicate tabs |
| Stale UI after screen lock / network change | SSE dropped events in that window — the app resyncs on reconnect/visibility; pull-to-refresh also works |

## Security

- **Never expose the OpenCode engine.** The backend binds OpenCode to `127.0.0.1` only; `APP_HOST=0.0.0.0` exposes just this app's backend. Do not change that design.
- **Single shared token.** `APP_ACCESS_TOKEN` (≥24 chars, compared with `timingSafeEqual` — never replace with `===`) guards the whole app. Changing it signs out every device — warn users first.
- **Session cookie.** Login mints an HMAC-derived `HttpOnly` cookie (`SameSite=Lax`, `Secure` under HTTPS, 30-day max age). API responses carry `Cache-Control: no-store`.
- **`.env` is secrets.** It holds the access token and VAPID private key (file mode `0600`, gitignored). Never commit, print, or share it or TLS private keys. Only `.env.example` is safe to touch.
- **Hardened headers.** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and a restrictive `Permissions-Policy` are intentional — do not loosen them.
- **LAN-only by default.** There is no built-in remote access. To reach the app off-network, use a VPN into your LAN or a trusted end-to-end-encrypted tunnel with authentication — never port-forward plain HTTP to the internet.
- **Push endpoints** are `https://` URLs validated on registration; subscriptions persist server-side with ropa `0600` file permissions.

## Verification and Checks

The single required gate (lint + typecheck + test + build):

```powershell
npm run check
```

It must be green before any change is called done. Individual steps (`npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`) match the old README's check list. Route tests run against real HTTP on port 0 with temp dirs (see `server/routes/pins.test.ts` as the pattern); client tests cover pure functions in `src/utils/`. Test files live next to their source (`foo.ts` → `foo.test.ts`) and `vitest.config.ts` excludes `dist-server/**` so compiled tests never run twice.
