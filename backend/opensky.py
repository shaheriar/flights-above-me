import logging

import httpx

from token_manager import TokenManager

log = logging.getLogger(__name__)

STATES_URL = "https://opensky-network.org/api/states/all"


async def fetch_flights(
    center_lat: float,
    center_lon: float,
    radius_deg: float,
    token_manager: TokenManager,
) -> tuple[list[dict], int | None]:
    try:
        lamin = center_lat - radius_deg
        lamax = center_lat + radius_deg
        lomin = center_lon - radius_deg
        lomax = center_lon + radius_deg

        params = {
            "lamin": lamin,
            "lomin": lomin,
            "lamax": lamax,
            "lomax": lomax,
        }

        async with httpx.AsyncClient(timeout=15) as client:
            headers = await token_manager.headers()
            response = await client.get(STATES_URL, params=params, headers=headers)

            if response.status_code == 401 and not token_manager._anonymous:
                await token_manager.force_refresh()
                headers = await token_manager.headers()
                response = await client.get(STATES_URL, params=params, headers=headers)

                if response.status_code == 401:
                    log.error("OpenSky request failed with 401 after token refresh")
                    return [], None

            response.raise_for_status()
            data = response.json()

        observation_time = data.get("time")
        flights: list[dict] = []
        for row in data.get("states") or []:
            if row[5] is None or row[6] is None:
                continue

            callsign = row[1]
            if callsign is not None:
                callsign = callsign.strip() or None

            flights.append(
                {
                    "icao24": row[0],
                    "callsign": callsign,
                    "country": row[2],
                    "time_position": row[3],
                    "last_contact": row[4],
                    "longitude": row[5],
                    "latitude": row[6],
                    "altitude_m": row[7],
                    "on_ground": row[8],
                    "velocity_ms": row[9],
                    "heading": row[10],
                    "vertical_rate": row[11],
                }
            )

        return flights, observation_time
    except Exception as exc:
        log.error("Failed to fetch flights from OpenSky: %s", exc)
        return [], None
