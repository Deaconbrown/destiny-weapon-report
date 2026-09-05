# Destiny Weapon Report

A Destiny 2 weapon search/filter tool built on Bungie's public API — search by name, damage type, and ammo type. Inspired by the category of tool destiny.report belongs to (original code and design, not a copy).

## Structure

- `server/` — Node/Express API that fetches and caches Bungie's Manifest (weapon definitions) and serves a filtered `/api/weapons` endpoint.
- `client/` — React (Vite) frontend with search + filter UI.

## Setup

### 1. Server

```
cd server
npm install
cp .env.example .env
```

Edit `.env` and set `BUNGIE_API_KEY` to your key from https://www.bungie.net/en/Application.

```
npm run dev
```

Server runs on `http://localhost:4000`. First start will download and cache the Bungie manifest (~1-2 min, tens of MB).

### 2. Client

```
cd client
npm install
cp .env.example .env
npm run dev
```

Client runs on `http://localhost:5173` (Vite default) and talks to the server via `VITE_API_BASE_URL`.

## Deployment

Planned: Docker container on the VPS behind Traefik, same pattern as other services (senalai.com, bot.senalai.com), served on a dedicated subdomain.
