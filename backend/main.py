import asyncio
import contextlib
import json
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from config import config
from connection_manager import ConnectionManager
from opensky import fetch_flights
from routes import enrich_flights_with_routes, fetch_route
from token_manager import TokenManager
from viewport import ViewportStore

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

token_manager = TokenManager(config.opensky_client_id, config.opensky_client_secret)
manager = ConnectionManager()
viewports = ViewportStore()


class ViewportBody(BaseModel):
    client_id: str
    lat: float
    lon: float
    radius_deg: float | None = Field(default=None, gt=0)


async def _poll_loop() -> None:
    while True:
        try:
            viewport = viewports.get_poll_viewport()
            if viewport is None:
                await asyncio.sleep(config.poll_interval)
                continue

            flights, observation_time = await fetch_flights(
                viewport.lat,
                viewport.lon,
                viewport.radius_deg,
                token_manager,
            )
            timestamp = observation_time or int(time.time())
            center = {"lat": viewport.lat, "lon": viewport.lon}
            await manager.broadcast(
                {
                    "timestamp": timestamp,
                    "center": center,
                    "flights": flights,
                }
            )
            await enrich_flights_with_routes(flights, token_manager)
            await manager.broadcast(
                {
                    "timestamp": timestamp,
                    "center": center,
                    "flights": flights,
                }
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("Poll loop error: %s", exc)

        await asyncio.sleep(config.poll_interval)


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_poll_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "connected_clients": manager.connected_clients}


@app.get("/config")
async def get_config():
    return {
        "radius_deg": config.radius_deg,
        "poll_interval": config.poll_interval,
    }


@app.get("/routes")
async def get_route(callsign: str):
    origin, destination = await fetch_route(callsign, token_manager)
    return {
        "callsign": callsign.strip().upper(),
        "from": origin,
        "to": destination,
    }


@app.post("/viewport")
async def post_viewport(body: ViewportBody):
    radius_deg = body.radius_deg if body.radius_deg else config.radius_deg
    viewports.set(body.client_id, body.lat, body.lon, radius_deg)
    return {"ok": True}


@app.get("/events")
async def events():
    client = await manager.connect()

    async def event_stream():
        try:
            connected = json.dumps({"client_id": client.client_id})
            yield f"event: connected\ndata: {connected}\n\n"

            while True:
                data = await client.queue.get()
                yield f"data: {json.dumps(data)}\n\n"
        except asyncio.CancelledError:
            raise
        finally:
            manager.disconnect(client.client_id)
            viewports.remove(client.client_id)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
