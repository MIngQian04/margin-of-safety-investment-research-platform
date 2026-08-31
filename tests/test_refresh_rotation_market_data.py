import pandas as pd

from scripts import refresh_rotation_market_data as refresh


def test_latest_open_date_retries_transient_provider_error(monkeypatch):
    monkeypatch.setattr(refresh.time, "sleep", lambda _seconds: None)

    class Pro:
        calls = 0

        def trade_cal(self, **_kwargs):
            self.calls += 1
            if self.calls < 3:
                raise TimeoutError("temporary TLS timeout")
            return pd.DataFrame([{"cal_date": "20260831", "is_open": 1}])

    pro = Pro()

    assert refresh.latest_open_date(pro, "20260831") == "20260831"
    assert pro.calls == 3
