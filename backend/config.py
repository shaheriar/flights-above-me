import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    radius_deg: float = 0.5
    poll_interval: int = 10
    opensky_client_id: str | None = None
    opensky_client_secret: str | None = None

    @classmethod
    def from_env(cls) -> "Config":
        client_id = os.environ.get("OPENSKY_CLIENT_ID") or None
        client_secret = os.environ.get("OPENSKY_CLIENT_SECRET") or None

        return cls(
            radius_deg=float(os.environ.get("RADIUS_DEG", "0.5")),
            poll_interval=int(os.environ.get("POLL_INTERVAL", "10")),
            opensky_client_id=client_id,
            opensky_client_secret=client_secret,
        )


config = Config.from_env()
