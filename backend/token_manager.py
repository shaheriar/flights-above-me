import asyncio
import time

import httpx

TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network/"
    "protocol/openid-connect/token"
)


class TokenManager:
    def __init__(self, client_id: str | None, client_secret: str | None) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self._token: str | None = None
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    @property
    def _anonymous(self) -> bool:
        return not self.client_id or not self.client_secret

    async def get_token(self) -> str | None:
        if self._anonymous:
            return None

        if self._token is not None and time.time() < self._expires_at - 30:
            return self._token

        async with self._lock:
            if self._token is not None and time.time() < self._expires_at - 30:
                return self._token

            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    TOKEN_URL,
                    data={
                        "grant_type": "client_credentials",
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                    },
                )
                response.raise_for_status()
                payload = response.json()

            self._token = payload["access_token"]
            self._expires_at = time.time() + payload["expires_in"]
            return self._token

    async def headers(self) -> dict:
        token = await self.get_token()
        if token is None:
            return {}
        return {"Authorization": f"Bearer {token}"}

    async def force_refresh(self) -> None:
        async with self._lock:
            self._token = None
            self._expires_at = 0.0

        await self.get_token()
