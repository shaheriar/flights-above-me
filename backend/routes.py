import asyncio
import logging
import time

import httpx

from token_manager import TokenManager

log = logging.getLogger(__name__)

ROUTES_URL = "https://opensky-network.org/api/routes"
FLIGHTS_AIRCRAFT_URL = "https://opensky-network.org/api/flights/aircraft"
CACHE_TTL_SEC = 3600
RATE_LIMIT_CACHE_SEC = 900
FLIGHT_LOOKUP_WINDOW_SEC = 6 * 3600
ROUTE_FETCH_CONCURRENCY = 2
MAX_CALLSIGN_LOOKUPS_PER_POLL = 12
MAX_AIRCRAFT_LOOKUPS_PER_POLL = 3

# callsign -> (expires_at, from_icao, to_icao | None)
_route_cache: dict[str, tuple[float, str | None, str | None]] = {}
# icao24 -> (expires_at, from_icao, to_icao | None)
_aircraft_cache: dict[str, tuple[float, str | None, str | None]] = {}
_route_semaphore = asyncio.Semaphore(ROUTE_FETCH_CONCURRENCY)
_rate_limited_until: float = 0.0
_rate_limit_logged_until: float = 0.0


def _is_rate_limited() -> bool:
    return time.time() < _rate_limited_until


def _set_rate_limited(retry_after_sec: float | None = None) -> None:
    global _rate_limited_until, _rate_limit_logged_until
    pause = retry_after_sec if retry_after_sec and retry_after_sec > 0 else 120.0
    _rate_limited_until = max(_rate_limited_until, time.time() + pause)
    if time.time() >= _rate_limit_logged_until:
        log.info("OpenSky rate limited; pausing route fetches for %.0fs", pause)
        _rate_limit_logged_until = _rate_limited_until


def _cache_get(
    cache: dict[str, tuple[float, str | None, str | None]], key: str
) -> tuple[str | None, str | None] | None:
    cached = cache.get(key)
    if cached and time.time() < cached[0]:
        return cached[1], cached[2]
    return None


def _cache_set(
    cache: dict[str, tuple[float, str | None, str | None]],
    key: str,
    origin: str | None,
    destination: str | None,
    ttl_sec: float,
) -> None:
    cache[key] = (time.time() + ttl_sec, origin, destination)


def _parse_retry_after(response: httpx.Response) -> float | None:
    raw = response.headers.get("Retry-After")
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


async def _get_with_auth_retry(
    client: httpx.AsyncClient,
    url: str,
    params: dict,
    token_manager: TokenManager,
) -> httpx.Response:
    headers = await token_manager.headers()
    response = await client.get(url, params=params, headers=headers)

    if response.status_code == 401 and not token_manager._anonymous:
        await token_manager.force_refresh()
        headers = await token_manager.headers()
        response = await client.get(url, params=params, headers=headers)

    return response


async def fetch_route(
    callsign: str, token_manager: TokenManager
) -> tuple[str | None, str | None]:
    key = callsign.strip().upper()
    if not key:
        return None, None

    cached = _cache_get(_route_cache, key)
    if cached is not None:
        return cached

    if _is_rate_limited():
        return None, None

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await _get_with_auth_retry(
                client, ROUTES_URL, {"callsign": key}, token_manager
            )

            if response.status_code == 429:
                _set_rate_limited(_parse_retry_after(response))
                _cache_set(_route_cache, key, None, None, RATE_LIMIT_CACHE_SEC)
                return None, None

            if response.status_code == 404:
                _cache_set(_route_cache, key, None, None, CACHE_TTL_SEC)
                return None, None

            response.raise_for_status()
            data = response.json()

        route = data.get("route") or []
        origin = route[0] if len(route) >= 1 else None
        destination = route[-1] if len(route) >= 2 else None
        if len(route) == 1:
            destination = None

        _cache_set(_route_cache, key, origin, destination, CACHE_TTL_SEC)
        return origin, destination
    except Exception as exc:
        log.warning("Failed to fetch route for callsign %s: %s", key, exc)
        _cache_set(_route_cache, key, None, None, 60)
        return None, None


async def fetch_route_by_aircraft(
    icao24: str, token_manager: TokenManager
) -> tuple[str | None, str | None]:
    key = icao24.strip().lower()
    if not key:
        return None, None

    cached = _cache_get(_aircraft_cache, key)
    if cached is not None:
        return cached

    if _is_rate_limited():
        return None, None

    end = int(time.time())
    begin = end - FLIGHT_LOOKUP_WINDOW_SEC

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await _get_with_auth_retry(
                client,
                FLIGHTS_AIRCRAFT_URL,
                {"icao24": key, "begin": begin, "end": end},
                token_manager,
            )

            if response.status_code == 429:
                _set_rate_limited(_parse_retry_after(response))
                _cache_set(_aircraft_cache, key, None, None, RATE_LIMIT_CACHE_SEC)
                return None, None

            if response.status_code == 404:
                _cache_set(_aircraft_cache, key, None, None, CACHE_TTL_SEC)
                return None, None

            response.raise_for_status()
            flights = response.json()

        if not flights:
            _cache_set(_aircraft_cache, key, None, None, CACHE_TTL_SEC)
            return None, None

        current = max(flights, key=lambda row: row.get("lastSeen") or 0)
        origin = current.get("estDepartureAirport")
        destination = current.get("estArrivalAirport")

        _cache_set(_aircraft_cache, key, origin, destination, CACHE_TTL_SEC)
        return origin, destination
    except Exception as exc:
        log.warning("Failed to fetch flight route for icao24 %s: %s", key, exc)
        _cache_set(_aircraft_cache, key, None, None, 60)
        return None, None


async def _fetch_route_limited(
    callsign: str, token_manager: TokenManager
) -> tuple[str, tuple[str | None, str | None]]:
    async with _route_semaphore:
        origin, destination = await fetch_route(callsign, token_manager)
    return callsign, (origin, destination)


async def _fetch_aircraft_route_limited(
    icao24: str, token_manager: TokenManager
) -> tuple[str, tuple[str | None, str | None]]:
    async with _route_semaphore:
        origin, destination = await fetch_route_by_aircraft(icao24, token_manager)
    return icao24, (origin, destination)


async def enrich_flights_with_routes(
    flights: list[dict], token_manager: TokenManager
) -> None:
    for flight in flights:
        flight["from"] = None
        flight["to"] = None

    callsigns = sorted(
        {
            flight["callsign"].strip().upper()
            for flight in flights
            if flight.get("callsign")
        }
    )
    callsigns_to_fetch = [
        callsign
        for callsign in callsigns
        if _cache_get(_route_cache, callsign) is None
    ][:MAX_CALLSIGN_LOOKUPS_PER_POLL]

    if callsigns_to_fetch:
        callsign_results = await asyncio.gather(
            *[
                _fetch_route_limited(callsign, token_manager)
                for callsign in callsigns_to_fetch
            ]
        )
        routes_by_callsign = dict(callsign_results)
    else:
        routes_by_callsign = {}

    for flight in flights:
        callsign = flight.get("callsign")
        if not callsign:
            continue
        key = callsign.strip().upper()
        if key in routes_by_callsign:
            origin, destination = routes_by_callsign[key]
        else:
            origin, destination = await fetch_route(callsign, token_manager)
        flight["from"] = origin
        flight["to"] = destination

    icaos = sorted(
        {
            flight["icao24"].lower()
            for flight in flights
            if flight.get("icao24") and not flight.get("from") and not flight.get("to")
        }
    )
    icaos_to_fetch = [
        icao24 for icao24 in icaos if _cache_get(_aircraft_cache, icao24) is None
    ][:MAX_AIRCRAFT_LOOKUPS_PER_POLL]

    if icaos_to_fetch:
        aircraft_results = await asyncio.gather(
            *[
                _fetch_aircraft_route_limited(icao24, token_manager)
                for icao24 in icaos_to_fetch
            ]
        )
        routes_by_icao = dict(aircraft_results)
    else:
        routes_by_icao = {}

    for flight in flights:
        if flight.get("from") or flight.get("to"):
            continue
        icao24 = flight.get("icao24", "").lower()
        if not icao24:
            continue
        if icao24 in routes_by_icao:
            origin, destination = routes_by_icao[icao24]
        else:
            origin, destination = await fetch_route_by_aircraft(
                icao24, token_manager
            )
        flight["from"] = origin
        flight["to"] = destination
