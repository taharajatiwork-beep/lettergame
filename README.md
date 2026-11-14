# Campfire

A Letterboxd-style social diary for video games. Log what you play, rate it, keep a backlog,
build lists, follow friends, and sit at each game's "fire": a community page with its own
vibes and counters (deaths, strawberries, escape attempts…).

Early prototype. Zero dependencies, Node 20+.

## Run

```bash
node server.js
# http://localhost:3000
```

First start downloads ~32 popular games from the Steam Store API (no key needed) and creates
a few clearly-labelled demo accounts. Data lives in `data/db.json` (git-ignored).

## Features

- Accounts with email, email confirmation and password reset
- Played / Like / Backlog, half-star ratings, reviews with spoiler flag, vibes
- Diary, lists, favorites, activity feed, followers/following, comments, notifications
- Per-game "fire": community counter + vibe breakdown
- Taste match between users
- Languages: English, فارسی, العربية, Español, Türkçe (RTL supported)

## Configuration (environment variables)

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `DATA_DIR` | Where `db.json` is stored (use a persistent volume in production) |
| `NODE_ENV=production` | Marks the session cookie `Secure` (needs HTTPS) |
| `APP_URL` | Public base URL used in emailed links |
| `RESEND_API_KEY`, `MAIL_FROM` | Send real email via Resend. Without a key, mails are written to the console and `data/outbox.log` |
| `SEED_DEMO=0` | Don't create demo accounts |

## Deploy

`Dockerfile` and `fly.toml` are included (Fly.io with a persistent volume at `/data`).

## Notes

- Game data and artwork come from the Steam Store; artwork belongs to its owners.
- JSON file storage is for prototyping; move to SQLite/Postgres before real traffic.
