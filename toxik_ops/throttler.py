import time
import asyncio
from collections import deque


class RateLimiter:
    def __init__(self, max_per_second: float = 1.0, burst: int = 1):
        self.max_per_second = max_per_second
        self.burst = burst
        self._timestamps: deque[float] = deque()
        self._lock = asyncio.Lock()

    async def acquire(self) -> float:
        async with self._lock:
            now = time.monotonic()
            while self._timestamps and now - self._timestamps[0] > 1.0:
                self._timestamps.popleft()
            if len(self._timestamps) >= self.burst:
                wait = self._timestamps[0] + 1.0 - now
                if wait > 0:
                    await asyncio.sleep(wait)
                now = time.monotonic()
            self._timestamps.append(now)
            return now


class SyncRateLimiter:
    def __init__(self, max_per_second: float = 1.0, burst: int = 1):
        self.max_per_second = max_per_second
        self.burst = burst
        self._timestamps: deque[float] = deque()

    def acquire(self) -> float:
        now = time.monotonic()
        while self._timestamps and now - self._timestamps[0] > 1.0:
            self._timestamps.popleft()
        if len(self._timestamps) >= self.burst:
            wait = self._timestamps[0] + 1.0 - now
            if wait > 0:
                time.sleep(wait)
            now = time.monotonic()
        self._timestamps.append(now)
        return now
