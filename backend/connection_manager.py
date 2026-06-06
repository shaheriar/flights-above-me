import asyncio
from dataclasses import dataclass, field
from uuid import uuid4


@dataclass
class SseClient:
    client_id: str
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)


class ConnectionManager:
    def __init__(self) -> None:
        self.active: dict[str, SseClient] = {}

    async def connect(self) -> SseClient:
        client = SseClient(client_id=str(uuid4()))
        self.active[client.client_id] = client
        return client

    def disconnect(self, client_id: str) -> None:
        self.active.pop(client_id, None)

    @property
    def connected_clients(self) -> int:
        return len(self.active)

    async def broadcast(self, data: dict) -> None:
        dead: list[str] = []

        for client_id, client in list(self.active.items()):
            try:
                client.queue.put_nowait(data)
            except Exception:
                dead.append(client_id)

        for client_id in dead:
            self.disconnect(client_id)
