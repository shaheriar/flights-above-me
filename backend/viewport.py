from dataclasses import dataclass


@dataclass(frozen=True)
class Viewport:
    lat: float
    lon: float
    radius_deg: float


class ViewportStore:
    def __init__(self) -> None:
        self._by_client: dict[str, Viewport] = {}

    def set(self, client_id: str, lat: float, lon: float, radius_deg: float) -> None:
        self._by_client[client_id] = Viewport(lat=lat, lon=lon, radius_deg=radius_deg)

    def remove(self, client_id: str) -> None:
        self._by_client.pop(client_id, None)

    def get_poll_viewport(self) -> Viewport | None:
        if not self._by_client:
            return None

        viewports = list(self._by_client.values())
        return Viewport(
            lat=sum(v.lat for v in viewports) / len(viewports),
            lon=sum(v.lon for v in viewports) / len(viewports),
            radius_deg=max(v.radius_deg for v in viewports),
        )
