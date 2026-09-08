# OddsTamu

Heads-up football odds board for Tanzania. It pulls **Betway TZ** soccer markets (1X2, Double Chance, BTTS), caches them locally, and highlights the sweet band — Tamu (heavy favourites) or Chungu (longer prices).

This is not a betting desk. Nobody places bets here. Friends who want in must register and wait for an admin to approve them.

## What you get

- **Tamu / Chungu** bands with live, today, this week, and NBC Premier League tabs
- Kickoff radar (East Africa Time), Ghost Acca, NBC night cards, watchlist, steam on odds
- Kiswahili and English
- Login, self-register (pending approval), forgot-password reset via admin
- Roles: **USER** (board), **MANAGER** (dashboard + add users), **ADMIN** (approvals, odds prefs, manual Betway fetch, reset queue)

## Requirements

- Node.js 20+ (ES modules)
- npm

SQLite is created automatically as `oddstamu.db` in the project root.

## Setup

```bash
git clone https://github.com/kizomanizo/odds-tamu.git
cd odds-tamu
npm install
cp example.env .env
```

Edit `.env`:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `3000` if unset; example uses `3801`) |
| `ADMIN_EMAIL` | Seeded admin email |
| `ADMIN_USERNAME` | Seeded admin username (shown on the login screen) |
| `ADMIN_PASSWORD` | Seeded admin password (min 8 characters) |
| `SESSION_SECRET` | Long random string for cookies |

The admin user **Kizito Mrema** is created **once** on first boot if no admin exists. Later starts skip seeding.

`ODDS_API_KEY` and `API_FOOTBALL_KEY` in `example.env` are unused leftovers. Odds come from Betway’s public sports API, not those keys.

## Run

```bash
npm start
```

Development (restart on file change):

```bash
npx nodemon server.js
```

Open `http://localhost:3801` (or whatever `PORT` you set). Unauthenticated visitors land on **Sign in**.

## How access works

1. Anyone can register. The account stays **PENDING**.
2. They are told to wait for approval and to contact admin at **+255755437887** or **kizomanizo(at)gmail.com**.
3. An **ADMIN** accepts or rejects pending users. A **MANAGER** can create users; those still need admin approval.
4. **ADMIN**-created users are active immediately.
5. Forgot password queues a request. Admin issues a 6-digit code and a temporary password, then the user sets a new password on `/reset-password`.
6. Registration is rate-limited by IP. Email and username availability are checked live over WebSocket.

## Odds cache

- The board paints from SQLite immediately.
- Betway is queried at most **once per hour**, unless an admin runs **Fetch Betway now**.
- Failed scrapes keep the last good data.
- Default Tamu band is `1.05–1.45`; Chungu is `3.5–12`. Admin can change those prefs; a visit to `/` with no query uses them (not `0/0`).

## Deploy notes

- Copy `.env` onto the host. Do not commit it.
- `node_modules/` and `oddstamu.db` are gitignored; run `npm install` and let the app create the database.
- Set `SESSION_SECRET` to a unique value in production.
- Behind a reverse proxy, the app already sets `trust proxy`.
- Bind to your chosen `PORT` and point nginx/caddy at it.

## Project layout

```
server.js              HTTP + session gate + WebSocket
database.js            SQLite schema
services/scrapers.js   Betway TZ fetch
services/oddsService.js  Cache, dashboard, Ghost Acca
services/authService.js  Users, login, resets
views/                 EJS pages
public/                CSS and client JS
locales/               en + sw strings
```

## License

MIT
