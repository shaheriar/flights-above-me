# Flights Above Me

A live map of aircraft overhead. The backend polls [OpenSky Network](https://opensky-network.org/) for ADS-B state vectors in your viewport; the frontend renders them on an interactive map with smooth dead-reckoned movement between updates.

## Features

- **Live map** centered on your location, with city labels and nearby airports
- **Smooth aircraft movement** between polls via client-side interpolation and dead reckoning
- **Click to track** an aircraft — the map follows it until you pan away or click again
- **Flight list** sidebar with callsign, altitude, and speed
- **Route enrichment** — origin/destination airports looked up from OpenSky when available

## Project structure

```
flights-above-me/
├── backend/          FastAPI server, OpenSky polling, SSE stream
└── frontend/         React + Leaflet map UI
```

## Prerequisites

- Python 3.11+
- Node.js 18+

OpenSky credentials are optional. Without them the backend runs in anonymous mode (lower rate limits).

## Quick start

### 1. Backend

```bash
cd backend
cp .env.example .env   # edit if you have OpenSky OAuth credentials
./run.sh
```

The API listens on `http://localhost:8000`.

`run.sh` creates a virtualenv, installs dependencies, and starts uvicorn.

### 2. Frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. The app expects the backend at `http://localhost:8000`.

## Configuration

Backend settings live in `backend/.env`:

| Variable | Default | Description |
|---|---|---|
| `RADIUS_DEG` | `0.5` | Default viewport half-size in degrees |
| `POLL_INTERVAL` | `10` | Seconds between OpenSky polls |
| `OPENSKY_CLIENT_ID` | — | OAuth2 client ID (optional) |
| `OPENSKY_CLIENT_SECRET` | — | OAuth2 client secret (optional) |

Override the server host/port when starting the backend:

```bash
HOST=0.0.0.0 PORT=8000 ./run.sh
```

## API

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check |
| `/config` | GET | Poll interval and default radius |
| `/viewport` | POST | Register the map viewport for a client |
| `/events` | GET | SSE stream of flight updates |
| `/routes` | GET | Look up route by callsign |

## How it works

1. The frontend opens an SSE connection to `/events` and posts the map viewport to `/viewport`.
2. The backend polls OpenSky for aircraft within the active viewport bounding box.
3. Flights are enriched with route data (departure/arrival airports) and broadcast to all connected clients.
4. The frontend dead-reckons each aircraft between polls and smoothly corrects when new data arrives.

## Production build

```bash
cd frontend
npm run build
npm run preview
```

Serve the `frontend/dist` output behind any static file host. The built app still calls `http://localhost:8000` — adjust the `API_BASE` constant in `frontend/src/hooks/useInterpolatedFlights.js` if the backend URL differs.

## Data sources

- **Aircraft positions** — [OpenSky Network API](https://opensky-network.org/data/api)
- **Map tiles** — [CARTO](https://carto.com/attributions) / OpenStreetMap
- **Airport labels** — [mwgg/Airports](https://github.com/mwgg/Airports)
