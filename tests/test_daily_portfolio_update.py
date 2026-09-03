import copy

import pandas as pd
import pytest

from scripts.run_daily_portfolio_update import (
    PublicationValidationError,
    inspect_market_snapshot,
    reconcile_published_execution_history,
    validate_future_financials,
    validate_publication,
)


def published_snapshot():
    return {
        "asOf": "2026-09-02",
        "summary": {"universeScanned": 5100, "cashWeight": 0.4},
        "nextHoldings": [{
            "code": "ANCHOR", "name": "Anchor", "bucket": "ANCHOR",
            "weight": 0.6, "price": 10.0,
        }],
        "navHistory": [{
            "date": "2026-09-02", "nav": 1.0, "dailyReturn": 0.0,
            "priceCoverage": 0.6,
        }],
    }


def candidate_snapshot():
    return {
        "asOf": "2026-09-03",
        "returnDate": "2026-09-03",
        "activeAsOf": "2026-09-02",
        "allocationChange": {"nextAsOf": "2026-09-04"},
        "summary": {
            "anchorWeight": 0.5,
            "futureWeight": 0.1,
            "cashWeight": 0.4,
            "activeCashWeight": 0.4,
            "financialReviewed": 20,
            "financialComplete": 20,
        },
        "holdings": [{"code": "ANCHOR", "weight": 0.6}],
        "nextHoldings": [{"code": "ANCHOR", "weight": 0.6}],
        "navHistory": [
            {"date": "2026-09-02", "nav": 1.0, "dailyReturn": 0.0, "priceCoverage": 0.6},
            {"date": "2026-09-03", "nav": 1.01, "dailyReturn": 0.01, "priceCoverage": 0.6},
        ],
        "moatRadar": {
            "financialStatus": "OK", "pendingAlerts": 2, "highAlerts": 1, "overdueAlerts": 1,
        },
        "benchmark": {
            "status": "OK", "endDate": "2026-09-03", "history": [{"date": "2026-09-03"}],
        },
    }


def test_validate_publication_accepts_one_exact_history_append():
    result = validate_publication(candidate_snapshot(), published_snapshot(), "2026-09-03")

    assert result["status"] == "READY_TO_PUBLISH"
    assert result["nav"] == pytest.approx(1.01)


def test_validate_publication_rejects_rewritten_history():
    candidate = candidate_snapshot()
    candidate["navHistory"][0]["nav"] = 0.99

    with pytest.raises(PublicationValidationError, match="previously published NAV history"):
        validate_publication(candidate, published_snapshot(), "2026-09-03")


def test_validate_publication_rejects_partial_benchmark():
    candidate = candidate_snapshot()
    candidate["benchmark"]["status"] = "PARTIAL"

    with pytest.raises(PublicationValidationError, match="CSI 300 coverage"):
        validate_publication(candidate, published_snapshot(), "2026-09-03")


def test_validate_publication_rejects_unpublished_active_target():
    candidate = candidate_snapshot()
    candidate["holdings"].append({"code": "LOCAL_ONLY", "weight": 0.025})
    candidate["summary"]["activeCashWeight"] = 0.375

    with pytest.raises(PublicationValidationError, match="active holdings"):
        validate_publication(candidate, published_snapshot(), "2026-09-03")


def test_reconcile_published_execution_history_discards_unpublished_targets(tmp_path):
    holdings_path = tmp_path / "holdings.csv"
    nav_path = tmp_path / "nav.csv"
    target_path = tmp_path / "target.csv"
    pd.DataFrame([
        {"date": "2026-09-01", "ts_code": "OLD", "name": "Old", "allocation_bucket": "ANCHOR",
         "target_weight": 0.6, "close": 9.0, "open": 9.0},
        {"date": "2026-09-02", "ts_code": "LOCAL", "name": "Local", "allocation_bucket": "ANCHOR",
         "target_weight": 0.6, "close": 11.0, "open": 11.0},
        {"date": "2026-09-03", "ts_code": "FUTURE", "name": "Future", "allocation_bucket": "ANCHOR",
         "target_weight": 0.6, "close": 12.0, "open": 12.0},
    ]).to_csv(holdings_path, index=False)
    pd.DataFrame([
        {"date": "2026-09-02", "nav": 1.0, "daily_return": 0.0, "price_coverage": 0.6},
        {"date": "2026-09-03", "nav": 1.01, "daily_return": 0.01, "price_coverage": 0.6},
    ]).to_csv(nav_path, index=False)

    reconcile_published_execution_history(
        published_snapshot(), holdings_path, nav_path, target_path
    )

    holdings = pd.read_csv(holdings_path)
    nav = pd.read_csv(nav_path)
    assert holdings["date"].max() == "2026-09-02"
    assert holdings.loc[holdings["date"].eq("2026-09-02"), "ts_code"].tolist() == ["ANCHOR"]
    assert nav["date"].tolist() == ["2026-09-02"]
    assert pd.read_csv(target_path)["ts_code"].tolist() == ["ANCHOR"]


def test_inspect_market_snapshot_requires_one_complete_unique_session():
    frame = pd.DataFrame({
        "ts_code": [f"{index:06d}.SZ" for index in range(5000)],
        "trade_date": [20260903] * 5000,
        "close": [10.0] * 5000,
    })

    assert inspect_market_snapshot(frame, {"summary": {"universeScanned": 5000}}) == ("2026-09-03", 5000)

    duplicate = copy.deepcopy(frame)
    duplicate.loc[1, "ts_code"] = duplicate.loc[0, "ts_code"]
    with pytest.raises(PublicationValidationError, match="duplicate securities"):
        inspect_market_snapshot(duplicate, {"summary": {"universeScanned": 5000}})


def test_validate_future_financials_requires_live_rows():
    with pytest.raises(PublicationValidationError, match="600941.SH"):
        validate_future_financials(pd.DataFrame({
            "ts_code": ["600941.SH"], "financial_data_status": ["STALE_CACHE"],
        }))
