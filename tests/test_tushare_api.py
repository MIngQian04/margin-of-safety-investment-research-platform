import pandas as pd
import pytest

from utils.tushare_api import DEFAULT_TUSHARE_API_URL, TushareProClient


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


def test_client_uses_current_endpoint_and_tushare_envelope(monkeypatch):
    calls = []

    def fake_post(url, *, json, timeout):
        calls.append((url, json, timeout))
        return FakeResponse({"code": 0, "data": {"fields": ["cal_date"], "items": [["20260805"]]}})

    monkeypatch.setattr("utils.tushare_api.requests.post", fake_post)
    client = TushareProClient("test-token", timeout=7)
    result = client.trade_cal(exchange="SSE", is_open="1")

    assert calls[0][0] == DEFAULT_TUSHARE_API_URL
    assert calls[0][1]["api_name"] == "trade_cal"
    assert calls[0][1]["token"] == "test-token"
    assert calls[0][2] == 7
    assert isinstance(result, pd.DataFrame)
    assert result.iloc[0]["cal_date"] == "20260805"


def test_client_surfaces_tushare_api_errors(monkeypatch):
    monkeypatch.setattr(
        "utils.tushare_api.requests.post",
        lambda *args, **kwargs: FakeResponse({"code": -2001, "msg": "permission denied"}),
    )
    with pytest.raises(RuntimeError, match="permission denied"):
        TushareProClient("test-token").trade_cal()
