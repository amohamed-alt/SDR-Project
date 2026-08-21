from __future__ import annotations

import json
import os
import urllib.request

BASE_URL = os.getenv("DASHBOARD_CACHE_SMOKE_URL", "http://127.0.0.1:18080").rstrip("/")
KEY = "a" * 64


def request_json(path: str, *, method: str = "GET", body: dict | None = None) -> dict:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"Unexpected HTTP {response.status} for {path}")
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    health = request_json("/health")
    assert health["status"] == "ok", health

    snapshot = {
        "key": KEY,
        "refreshedAt": 1787353200000,
        "data": {
            "meta": {"generatedAt": "2026-08-21T20:20:00.000Z"},
            "kpis": {"contacts": 123, "meetings": 7},
        },
    }
    stored = request_json(f"/v1/dashboard/{KEY}", method="PUT", body=snapshot)
    assert stored["status"] == "stored", stored

    loaded = request_json(f"/v1/dashboard/{KEY}")
    assert loaded["key"] == KEY, loaded
    assert loaded["data"]["kpis"]["contacts"] == 123, loaded
    assert loaded["data"]["kpis"]["meetings"] == 7, loaded

    stats = request_json("/v1/stats")
    assert stats["entries"] >= 1, stats

    deleted = request_json(f"/v1/dashboard/{KEY}", method="DELETE")
    assert deleted["deleted"] is True, deleted
    print("FastAPI dashboard cache smoke test passed")


if __name__ == "__main__":
    main()
