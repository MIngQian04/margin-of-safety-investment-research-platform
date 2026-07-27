import pandas as pd
import pytest

from selection.future_demand import decision_status, research_tier, score_future_thesis, valuation_gate
from scripts import run_future_demand_screen as future_screen
from scripts.run_future_demand_screen import _quarterly_profit_growth


def test_competition_penalty_lowers_future_thesis_score():
    base = dict(demand_certainty=5, bottleneck_strength=4, value_capture=4,
                exposure_confidence=5, substitution_risk=2)
    rows = pd.DataFrame([{**base, "competition_risk": 1}, {**base, "competition_risk": 5}])
    result = score_future_thesis(rows)
    assert result.loc[0, "future_thesis_score"] > result.loc[1, "future_thesis_score"]


def test_score_rejects_values_outside_research_scale():
    row = pd.DataFrame([dict(demand_certainty=6, bottleneck_strength=4, value_capture=4,
                             exposure_confidence=5, competition_risk=2, substitution_risk=2)])
    with pytest.raises(ValueError):
        score_future_thesis(row)


def test_expensive_company_cannot_enter_core_research():
    row = pd.DataFrame([{"future_thesis_score": 90, "pe_ttm": 100, "pb": 10, "ps_ttm": 12}])
    row["valuation_gate"] = valuation_gate(row)
    assert research_tier(row).iloc[0] == "OPTIONALITY_WATCH"


def test_value_supported_candidate_still_waits_without_volume_confirmation():
    row = pd.DataFrame([{"research_tier": "CORE_RESEARCH", "financial_check": "PASS_SURVIVAL",
                         "dcf_margin_of_safety": 0.1, "valuation_gate": "REASONABLE",
                         "timing_status": "BOTTOM_HOLD_NO_ADD"}])
    assert decision_status(row).iloc[0] == "VALUE_VERIFIED_WAIT_TIMING"


def test_two_reported_quarters_drive_profit_growth_average():
    income = pd.DataFrame([
        {"end_date": "20250331", "ann_date": "20250430", "n_income_attr_p": 100},
        {"end_date": "20260331", "ann_date": "20260430", "n_income_attr_p": 108},
        {"end_date": "20250630", "ann_date": "20250730", "n_income_attr_p": 200},
        {"end_date": "20260630", "ann_date": "20260710", "n_income_attr_p": 220},
    ])
    result = _quarterly_profit_growth(income, "2026-07-17")
    assert result["profit_growth_quarters"] == 2
    assert abs(result["profit_growth_avg"] - .09) < 1e-9


def test_refresh_failure_keeps_existing_statement_cache_and_marks_it_stale(tmp_path, monkeypatch):
    monkeypatch.setattr(future_screen, "FIN", tmp_path)
    cached = pd.DataFrame([{
        "end_date": "20260331", "ann_date": "20260421", "n_income_attr_p": 10,
    }])
    for endpoint in ["income", "cashflow", "balancesheet"]:
        path = tmp_path / endpoint / "A.parquet"
        path.parent.mkdir(parents=True)
        cached.to_parquet(path, index=False)

    class BrokenPro:
        def __getattr__(self, _name):
            def call(**_kwargs):
                raise ConnectionError("temporary Tushare outage")
            return call

    class Client:
        pro = BrokenPro()
        sleep_seconds = 0

    frames, metadata = future_screen.get_statements(
        Client(), "A", refresh=True, as_of="20260727", return_metadata=True,
    )
    assert metadata["financial_data_status"] == "STALE_CACHE"
    assert metadata["financial_report_date"] == "20260331"
    assert metadata["financial_announcement_date"] == "20260421"
    assert all(len(frame) == 1 for frame in frames)
