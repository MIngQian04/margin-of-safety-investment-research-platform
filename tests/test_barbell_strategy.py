import pandas as pd
import pytest

from portfolio.barbell_strategy import (
    anchor_signal_table,
    build_anchor_selection_state,
    build_barbell_weights,
    build_full_market_anchor_universe,
    classify_future_states,
    include_held_anchors_for_review,
)
from scripts.run_barbell_strategy import _filter_statements_as_of


POLICY = {"anchor_target": .65, "future_total_cap": .25, "cash_floor": .10,
          "option_seed_weight": .025, "confirmed_build_weight": .05,
          "promoted_core_weight": .075, "single_theme_cap": .15}


def test_anchor_financials_exclude_statements_published_after_signal_date():
    statements = pd.DataFrame([
        {"end_date": "20260331", "ann_date": "20260430", "revenue": 100},
        {"end_date": "20260630", "ann_date": "20260825", "revenue": 120},
        {"end_date": "20260630", "ann_date": "", "revenue": 999},
    ])

    result = _filter_statements_as_of(statements, "2026-08-24")

    assert result["revenue"].tolist() == [100]


def test_unverified_bottom_candidate_is_only_an_option_seed():
    future = pd.DataFrame([{"ts_code": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80, "valuation_gate": "REASONABLE",
                            "financial_check": "PASS_SURVIVAL", "dcf_margin_of_safety": .1,
                            "timing_status": "BOTTOM_HOLD_NO_ADD"}])
    state = classify_future_states(future, pd.DataFrame([{"ts_code": "A"}]))
    assert state.iloc[0]["barbell_state"] == "OPTION_SEED"


def test_core_promotion_requires_all_milestones_and_trend():
    future = pd.DataFrame([{"ts_code": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80, "valuation_gate": "REASONABLE",
                            "financial_check": "PASS_SURVIVAL", "dcf_margin_of_safety": .1,
                            "timing_status": "BOTTOM_VOLUME_CONFIRMATION"}])
    ledger = pd.DataFrame([{"ts_code": "A", "demand_status": "VERIFIED", "profit_pool_status": "VERIFIED",
                            "company_status": "VERIFIED", "invalidation_status": "NONE"}])
    assert classify_future_states(future, ledger).iloc[0]["barbell_state"] == "PROMOTED_CORE"


def test_core_promotion_is_blocked_by_unresolved_caution():
    future = pd.DataFrame([{"ts_code": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80, "valuation_gate": "REASONABLE",
                            "financial_check": "PASS_SURVIVAL", "dcf_margin_of_safety": .1,
                            "timing_status": "BOTTOM_VOLUME_CONFIRMATION"}])
    milestones = pd.DataFrame([{"ts_code": "A", "demand_status": "VERIFIED", "profit_pool_status": "VERIFIED",
                                "company_status": "VERIFIED", "invalidation_status": "NONE"}])
    readiness = pd.DataFrame([{"ts_code": "A", "evidence_status": "SEED_READY_WITH_CAUTION",
                               "seed_evidence_ready": True, "promotion_evidence_ready": False}])
    assert classify_future_states(future, milestones, readiness).iloc[0]["barbell_state"] == "CONFIRMED_BUILD"


def test_two_verified_milestones_use_confirmed_build_step():
    future = pd.DataFrame([{"ts_code": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80,
                            "valuation_gate": "REASONABLE", "financial_check": "PASS_SURVIVAL",
                            "dcf_margin_of_safety": .1, "timing_status": "BOTTOM_VOLUME_CONFIRMATION"}])
    milestones = pd.DataFrame([{"ts_code": "A", "demand_status": "VERIFIED",
                                "profit_pool_status": "VERIFIED", "company_status": "UNVERIFIED",
                                "invalidation_status": "NONE"}])
    readiness = pd.DataFrame([{"ts_code": "A", "evidence_status": "SEED_READY",
                               "seed_evidence_ready": True, "promotion_evidence_ready": True}])
    assert classify_future_states(future, milestones, readiness).iloc[0]["barbell_state"] == "CONFIRMED_BUILD"


def test_held_seed_survives_a_modest_dcf_premium_with_additions_frozen():
    future = pd.DataFrame([{
        "ts_code": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80,
        "valuation_gate": "REASONABLE", "financial_check": "PASS_SURVIVAL",
        "dcf_margin_of_safety": -.05, "timing_status": "BOTTOM_HOLD_NO_ADD",
        "profit_growth_avg": .10, "profit_loss_to_profit": False,
    }])
    readiness = pd.DataFrame([{"ts_code": "A", "evidence_status": "SEED_READY",
                               "seed_evidence_ready": True, "promotion_evidence_ready": True}])
    previous = pd.DataFrame([{"ts_code": "A", "allocation_bucket": "FUTURE",
                              "target_weight": .025, "strategy_state": "OPTION_SEED"}])
    state = classify_future_states(
        future, pd.DataFrame([{"ts_code": "A"}]), readiness,
        previous_portfolio=previous, as_of="2026-07-17",
        policy={"seed_valuation_premium_factor": .8},
    ).iloc[0]
    assert state["barbell_state"] == "OPTION_SEED"
    assert state["valuation_warning_status"] == "WITHIN_TOLERANCE"


def test_held_seed_survives_missing_timing_confirmation_with_additions_frozen():
    future = pd.DataFrame([{
        "ts_code": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80,
        "valuation_gate": "REASONABLE", "financial_check": "PASS_SURVIVAL",
        "dcf_margin_of_safety": .20, "timing_status": "WAIT_NO_CONFIRMATION",
    }])
    readiness = pd.DataFrame([{"ts_code": "A", "evidence_status": "SEED_READY",
                               "seed_evidence_ready": True, "promotion_evidence_ready": True}])
    previous = pd.DataFrame([{"ts_code": "A", "allocation_bucket": "FUTURE",
                              "target_weight": .025, "strategy_state": "OPTION_SEED"}])
    state = classify_future_states(
        future, pd.DataFrame([{"ts_code": "A"}]), readiness,
        previous_portfolio=previous, as_of="2026-07-20",
    ).iloc[0]
    assert state["barbell_state"] == "OPTION_SEED"
    assert state["valuation_warning_status"] == "TIMING_WAIT"
    assert "暂停加仓和晋级" in state["state_reason"]


def test_held_seed_survives_unavailable_financial_refresh_without_exit():
    future = pd.DataFrame([{
        "ts_code": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80,
        "valuation_gate": "REASONABLE", "financial_check": "PASS_SURVIVAL",
        "financial_data_status": "STALE_CACHE", "financial_data_error": "income: ConnectionError",
        "financial_report_date": "20260331", "dcf_margin_of_safety": float("nan"),
        "timing_status": "BOTTOM_HOLD_NO_ADD",
    }])
    readiness = pd.DataFrame([{"ts_code": "A", "evidence_status": "SEED_READY",
                               "seed_evidence_ready": True, "promotion_evidence_ready": True}])
    previous = pd.DataFrame([{"ts_code": "A", "allocation_bucket": "FUTURE",
                              "target_weight": .025, "strategy_state": "OPTION_SEED"}])
    state = classify_future_states(
        future, pd.DataFrame([{"ts_code": "A"}]), readiness,
        previous_portfolio=previous, as_of="2026-07-27",
    ).iloc[0]
    assert state["barbell_state"] == "OPTION_SEED"
    assert state["valuation_warning_status"] == "DATA_UNAVAILABLE"
    assert "保留既有种子仓" in state["state_reason"]


def test_overdue_high_financial_review_reduces_held_future_position_one_step():
    future = pd.DataFrame([{
        "ts_code": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80,
        "valuation_gate": "REASONABLE", "financial_check": "PASS_SURVIVAL",
        "dcf_margin_of_safety": .20, "timing_status": "BOTTOM_HOLD_NO_ADD",
        "alert_risk_action": "FREEZE_AND_REDUCE_AFTER_CONFIRMATION",
    }])
    readiness = pd.DataFrame([{"ts_code": "A", "evidence_status": "SEED_READY",
                               "seed_evidence_ready": True, "promotion_evidence_ready": True}])
    previous = pd.DataFrame([{"ts_code": "A", "allocation_bucket": "FUTURE",
                              "target_weight": .05, "strategy_state": "CONFIRMED_BUILD"}])
    state = classify_future_states(
        future, pd.DataFrame([{"ts_code": "A"}]), readiness,
        previous_portfolio=previous, as_of="2026-07-20",
    ).iloc[0]
    assert state["barbell_state"] == "VALUATION_REDUCTION"
    portfolio, _ = build_barbell_weights(
        pd.DataFrame(columns=["defensive_status"]), pd.DataFrame([state]), POLICY,
        previous_portfolio=previous,
    )
    assert portfolio.iloc[0]["target_weight"] == .025
    assert "超过两个工作日" in portfolio.iloc[0]["reason"]


def test_persistent_seed_premium_reduces_one_ladder_step_after_warning():
    future = pd.DataFrame([{
        "ts_code": "A", "name": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80,
        "valuation_gate": "REASONABLE", "financial_check": "PASS_SURVIVAL",
        "dcf_margin_of_safety": -.15, "timing_status": "BOTTOM_HOLD_NO_ADD",
        "profit_growth_avg": .10, "profit_loss_to_profit": False,
    }])
    readiness = pd.DataFrame([{"ts_code": "A", "evidence_status": "SEED_READY",
                               "seed_evidence_ready": True, "promotion_evidence_ready": True}])
    previous = pd.DataFrame([{"ts_code": "A", "allocation_bucket": "FUTURE",
                              "target_weight": .05, "strategy_state": "CONFIRMED_BUILD"}])
    warnings = pd.DataFrame([{"ts_code": "A", "warning_date": "2026-07-16",
                              "status": "WARNING", "consecutive_days": 1}])
    state = classify_future_states(
        future, pd.DataFrame([{"ts_code": "A"}]), readiness,
        previous_portfolio=previous, valuation_warnings=warnings,
        as_of="2026-07-17", policy={"seed_valuation_premium_factor": .8},
    )
    assert state.iloc[0]["barbell_state"] == "VALUATION_REDUCTION"
    portfolio, _ = build_barbell_weights(
        pd.DataFrame(columns=["defensive_status"]), state,
        {**POLICY, "option_seed_weight": .025}, previous_portfolio=previous,
    )
    assert portfolio.iloc[0]["target_weight"] == .025


def test_option_seed_is_blocked_when_evidence_gate_is_incomplete():
    future = pd.DataFrame([{"ts_code": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80, "valuation_gate": "REASONABLE",
                            "financial_check": "PASS_SURVIVAL", "dcf_margin_of_safety": .1,
                            "timing_status": "BOTTOM_HOLD_NO_ADD"}])
    readiness = pd.DataFrame([{"ts_code": "A", "evidence_status": "EVIDENCE_INCOMPLETE",
                               "seed_evidence_ready": False}])
    state = classify_future_states(future, pd.DataFrame([{"ts_code": "A"}]), readiness).iloc[0]
    assert state["barbell_state"] == "RESEARCH_ONLY"
    assert state["state_reason"] == "seed evidence gate failed: EVIDENCE_INCOMPLETE"


def test_option_seed_passes_when_auditable_evidence_is_ready():
    future = pd.DataFrame([{"ts_code": "A", "policy_status": "POLICY_ELIGIBLE", "future_thesis_score": 80, "valuation_gate": "REASONABLE",
                            "financial_check": "PASS_SURVIVAL", "dcf_margin_of_safety": .1,
                            "timing_status": "BOTTOM_HOLD_NO_ADD"}])
    readiness = pd.DataFrame([{"ts_code": "A", "evidence_status": "SEED_READY",
                               "seed_evidence_ready": True}])
    assert classify_future_states(future, pd.DataFrame([{"ts_code": "A"}]), readiness).iloc[0]["barbell_state"] == "OPTION_SEED"


def test_future_seed_uses_probability_weighted_milestone_valuation_when_enabled():
    future = pd.DataFrame([{
        "ts_code": "A", "close": 80.0, "policy_status": "POLICY_ELIGIBLE",
        "future_thesis_score": 80, "valuation_gate": "REASONABLE",
        "financial_check": "PASS_SURVIVAL", "dcf_margin_of_safety": .10,
        "dcf_very_pessimistic_value_per_share": 60.0,
        "dcf_cautious_value_per_share": 75.0,
        "dcf_base_value_per_share": 100.0,
        "dcf_very_optimistic_value_per_share": 180.0,
        "timing_status": "BOTTOM_VOLUME_CONFIRMATION",
    }])
    readiness = pd.DataFrame([{
        "ts_code": "A", "evidence_status": "SEED_READY",
        "seed_evidence_ready": True, "promotion_evidence_ready": True,
    }])
    milestones = pd.DataFrame([{
        "ts_code": "A", "demand_status": "VERIFIED", "profit_pool_status": "VERIFIED",
        "company_status": "VERIFIED", "invalidation_status": "NONE",
    }])
    policy = {
        "future_milestone_valuation_required": True,
        "future_probability_weighted_min_margin": .30,
        "future_failure_max_downside": .30,
    }

    state = classify_future_states(future, milestones, readiness, policy=policy).iloc[0]

    assert state["future_failure_probability"] == .20
    assert state["future_partial_probability"] == .40
    assert state["future_success_probability"] == .40
    assert state["future_probability_weighted_value_per_share"] == 124.0
    assert state["future_probability_weighted_margin_of_safety"] == .55
    assert state["future_failure_downside"] == .25
    assert state["future_milestone_valuation_status"] == "PASS"
    assert state["barbell_state"] == "PROMOTED_CORE"


def test_future_seed_waits_when_probability_weighted_margin_is_too_small():
    future = pd.DataFrame([{
        "ts_code": "A", "close": 100.0, "policy_status": "POLICY_ELIGIBLE",
        "future_thesis_score": 80, "valuation_gate": "REASONABLE",
        "financial_check": "PASS_SURVIVAL", "dcf_margin_of_safety": .10,
        "dcf_very_pessimistic_value_per_share": 80.0,
        "dcf_cautious_value_per_share": 90.0,
        "dcf_base_value_per_share": 110.0,
        "dcf_very_optimistic_value_per_share": 150.0,
        "timing_status": "BOTTOM_HOLD_NO_ADD",
    }])
    readiness = pd.DataFrame([{
        "ts_code": "A", "evidence_status": "SEED_READY", "seed_evidence_ready": True,
    }])
    state = classify_future_states(
        future, pd.DataFrame([{"ts_code": "A"}]), readiness,
        policy={"future_milestone_valuation_required": True},
    ).iloc[0]

    assert state["future_milestone_valuation_status"] == "EXPECTED_VALUE_FAIL"
    assert state["barbell_state"] == "RESEARCH_ONLY"


def test_future_seed_waits_when_failure_case_downside_is_too_large():
    future = pd.DataFrame([{
        "ts_code": "A", "close": 100.0, "policy_status": "POLICY_ELIGIBLE",
        "future_thesis_score": 80, "valuation_gate": "REASONABLE",
        "financial_check": "PASS_SURVIVAL", "dcf_margin_of_safety": .50,
        "dcf_very_pessimistic_value_per_share": 50.0,
        "dcf_cautious_value_per_share": 90.0,
        "dcf_base_value_per_share": 250.0,
        "dcf_very_optimistic_value_per_share": 400.0,
        "timing_status": "BOTTOM_HOLD_NO_ADD",
    }])
    readiness = pd.DataFrame([{
        "ts_code": "A", "evidence_status": "SEED_READY", "seed_evidence_ready": True,
    }])
    state = classify_future_states(
        future, pd.DataFrame([{"ts_code": "A"}]), readiness,
        policy={"future_milestone_valuation_required": True},
    ).iloc[0]

    assert state["future_probability_weighted_margin_of_safety"] > .30
    assert state["future_failure_downside"] == .50
    assert state["future_milestone_valuation_status"] == "FAILURE_DOWNSIDE_FAIL"
    assert state["barbell_state"] == "RESEARCH_ONLY"


def test_unapproved_anchor_budget_remains_cash():
    anchors = pd.DataFrame([{"ts_code": "B", "defensive_status": "WATCH"}])
    future = pd.DataFrame(columns=["barbell_state"])
    _, summary = build_barbell_weights(anchors, future, POLICY)
    assert summary["cash_weight"] == 1.0


def test_seed_and_core_weights_are_different():
    anchors = pd.DataFrame(columns=["defensive_status"])
    future = pd.DataFrame([
        {"ts_code": "A", "name": "A", "theme": "x", "barbell_state": "OPTION_SEED", "future_thesis_score": 80, "state_reason": "seed"},
        {"ts_code": "B", "name": "B", "theme": "y", "barbell_state": "PROMOTED_CORE", "future_thesis_score": 80, "state_reason": "core"},
    ])
    portfolio, _ = build_barbell_weights(anchors, future, POLICY)
    weights = portfolio.set_index("ts_code")["target_weight"]
    assert weights["A"] == .025
    assert weights["B"] == .075


def test_confirmed_build_receives_five_percent():
    anchors = pd.DataFrame(columns=["defensive_status"])
    future = pd.DataFrame([{
        "ts_code": "A", "name": "A", "theme": "x", "barbell_state": "CONFIRMED_BUILD",
        "future_thesis_score": 80, "state_reason": "build",
    }])
    portfolio, summary = build_barbell_weights(anchors, future, POLICY)
    assert portfolio.iloc[0]["target_weight"] == .05
    assert summary["confirmed_build_weight"] == .05


def test_option_seed_total_is_capped_at_ten_percent():
    anchors = pd.DataFrame(columns=["defensive_status"])
    future = pd.DataFrame([
        {"ts_code": str(i), "name": str(i), "theme": f"theme-{i}", "barbell_state": "OPTION_SEED",
         "future_thesis_score": 90 - i, "state_reason": "seed"}
        for i in range(6)
    ])
    policy = {**POLICY, "option_seed_target_min": .075, "option_seed_total_cap": .10}
    portfolio, summary = build_barbell_weights(anchors, future, policy)
    assert abs(portfolio["target_weight"].sum() - .10) < 1e-12
    assert len(portfolio) == 4
    assert summary["option_seed_target_status"] == "WITHIN_TARGET"


def test_anchor_requires_positive_cash_earnings_even_when_moat_is_approved():
    daily = pd.DataFrame([{"ts_code": "A", "dv_ratio": 4.0}])
    watch = pd.DataFrame([{"ts_code": "A", "name": "A", "moat_approved": "TRUE"}])
    financials = pd.DataFrame([{"ts_code": "A", "owner_earnings_yield": .05,
                                "normalized_owner_earnings": 10, "normalized_fcf": -1}])
    assert anchor_signal_table(daily, watch, financials).iloc[0]["defensive_status"] == "WATCH"


def test_auto_anchor_does_not_require_manual_moat_flag():
    daily = pd.DataFrame([{"ts_code": "A", "dv_ratio": 4.0, "pe_ttm": 10.0}])
    watch = pd.DataFrame([{"ts_code": "A", "name": "A", "moat_approved": "FALSE"}])
    financials = pd.DataFrame([{"ts_code": "A", "owner_earnings_yield": .05,
                                "normalized_owner_earnings": 10, "normalized_fcf": 8, "net_cash": 1}])
    policy = {"anchor_selection_mode": "auto"}
    assert anchor_signal_table(daily, watch, financials, policy).iloc[0]["defensive_status"] == "DEFENSIVE_ELIGIBLE"


def test_new_anchor_requires_positive_base_dcf_when_policy_enables_it():
    daily = pd.DataFrame([{"ts_code": "A", "dv_ratio": 4.0, "pe_ttm": 10.0}])
    watch = pd.DataFrame([{"ts_code": "A", "name": "A", "moat_approved": "FALSE"}])
    financials = pd.DataFrame([{
        "ts_code": "A", "owner_earnings_yield": .05, "normalized_owner_earnings": 10,
        "normalized_fcf": 8, "net_cash": 1, "dcf_base_margin_of_safety": -.05,
        "dcf_optimistic_margin_of_safety": .06,
    }])
    result = anchor_signal_table(
        daily, watch, financials,
        {"anchor_selection_mode": "auto", "anchor_require_dcf_base": True},
    ).iloc[0]
    assert result["defensive_status"] == "WATCH"
    assert result["first_failed_anchor_gate"] == "DCF_BASE_VALUE_FAIL"
    assert result["anchor_dcf_status"] == "PREMIUM_WITHIN_OPTIMISTIC"


def test_existing_anchor_inside_optimistic_dcf_is_held_without_additions():
    anchors = pd.DataFrame([{
        "ts_code": "A", "name": "A", "defensive_status": "WATCH",
        "anchor_dcf_status": "PREMIUM_WITHIN_OPTIMISTIC", "l1_name": "消费",
        "economic_factor": "CONSUMPTION",
    }])
    previous = pd.DataFrame([{"ts_code": "A", "name": "A", "allocation_bucket": "ANCHOR", "target_weight": .15}])
    portfolio, _ = build_barbell_weights(
        anchors, pd.DataFrame(columns=["barbell_state"]),
        {**POLICY, "anchor_sticky": True, "anchor_min_weight": .025, "anchor_reduction_step": .025},
        previous_portfolio=previous, as_of="2026-07-17",
    )
    row = portfolio.iloc[0]
    assert row["target_weight"] == .15
    assert "暂停加仓" in row["reason"]


def test_anchor_above_optimistic_dcf_warns_then_reduces_one_step():
    anchors = pd.DataFrame([{
        "ts_code": "A", "name": "A", "defensive_status": "WATCH",
        "anchor_dcf_status": "OVER_OPTIMISTIC", "l1_name": "消费",
        "economic_factor": "CONSUMPTION",
    }])
    previous = pd.DataFrame([{"ts_code": "A", "name": "A", "allocation_bucket": "ANCHOR", "target_weight": .15}])
    policy = {**POLICY, "anchor_sticky": True, "anchor_min_weight": .025, "anchor_reduction_step": .025}
    first, _ = build_barbell_weights(
        anchors, pd.DataFrame(columns=["barbell_state"]), policy,
        previous_portfolio=previous, as_of="2026-07-17",
    )
    assert first.iloc[0]["target_weight"] == .15
    assert "预警" in first.iloc[0]["reason"]
    warnings = pd.DataFrame([{"ts_code": "A", "warning_date": "2026-07-16", "status": "WARNING"}])
    second, _ = build_barbell_weights(
        anchors, pd.DataFrame(columns=["barbell_state"]), policy,
        previous_portfolio=previous, anchor_valuation_warnings=warnings,
        as_of="2026-07-17",
    )
    assert second.iloc[0]["target_weight"] == .125
    assert "减仓" in second.iloc[0]["reason"]


def test_anchor_valuation_reduction_enters_cooldown_instead_of_repeating_daily():
    anchors = pd.DataFrame([{
        "ts_code": "A", "name": "A", "defensive_status": "WATCH",
        "anchor_dcf_status": "OVER_OPTIMISTIC", "dcf_optimistic_margin_of_safety": -.15,
        "normalized_owner_earnings": 100.0, "normalized_fcf": 80.0,
        "financial_as_of": "20241231", "l1_name": "消费", "economic_factor": "CONSUMPTION",
    }])
    previous = pd.DataFrame([{"ts_code": "A", "name": "A", "allocation_bucket": "ANCHOR", "target_weight": .125}])
    policy = {**POLICY, "anchor_sticky": True, "anchor_min_weight": .025,
              "anchor_reduction_step": .025, "anchor_valuation_cooldown_sessions": 5}
    warnings = pd.DataFrame([{
        "ts_code": "A", "warning_date": "2026-07-17", "status": "WARNING",
        "consecutive_days": 4, "cooldown_sessions_remaining": 4,
        "reduction_count": 1, "last_reduction_date": "2026-07-18",
        "last_reduction_dcf_optimistic_margin": -.15,
        "last_reduction_normalized_owner_earnings": 100.0,
        "last_reduction_normalized_fcf": 80.0,
    }])
    portfolio, _ = build_barbell_weights(
        anchors, pd.DataFrame(columns=["barbell_state"]), policy,
        previous_portfolio=previous, anchor_valuation_warnings=warnings,
        as_of="2026-07-21",
    )
    assert portfolio.iloc[0]["target_weight"] == .125
    assert "冷静期" in portfolio.iloc[0]["reason"]


def test_anchor_can_reduce_again_only_after_cooldown_and_new_deterioration():
    anchors = pd.DataFrame([{
        "ts_code": "A", "name": "A", "defensive_status": "WATCH",
        "anchor_dcf_status": "OVER_OPTIMISTIC", "dcf_optimistic_margin_of_safety": -.21,
        "normalized_owner_earnings": 90.0, "normalized_fcf": 70.0,
        "financial_as_of": "20251231", "l1_name": "消费", "economic_factor": "CONSUMPTION",
    }])
    previous = pd.DataFrame([{"ts_code": "A", "name": "A", "allocation_bucket": "ANCHOR", "target_weight": .125}])
    policy = {**POLICY, "anchor_sticky": True, "anchor_min_weight": .025,
              "anchor_reduction_step": .025, "anchor_valuation_cooldown_sessions": 5,
              "anchor_valuation_new_evidence_margin_drop": .05,
              "anchor_valuation_new_evidence_financial_drop": .05}
    warnings = pd.DataFrame([{
        "ts_code": "A", "warning_date": "2026-07-10", "status": "WARNING",
        "consecutive_days": 8, "cooldown_sessions_remaining": 0,
        "reduction_count": 1, "last_reduction_date": "2026-07-14",
        "last_reduction_dcf_optimistic_margin": -.15,
        "last_reduction_normalized_owner_earnings": 100.0,
        "last_reduction_normalized_fcf": 80.0,
    }])
    portfolio, _ = build_barbell_weights(
        anchors, pd.DataFrame(columns=["barbell_state"]), policy,
        previous_portfolio=previous, anchor_valuation_warnings=warnings,
        as_of="2026-07-21",
    )
    assert portfolio.iloc[0]["target_weight"] == .10
    assert "新的DCF/现金收益恶化证据" in portfolio.iloc[0]["reason"]


def test_manual_anchor_override_releases_weight_to_cash():
    anchors = pd.DataFrame([{
        "ts_code": "000786.SZ", "name": "北新建材", "defensive_status": "DEFENSIVE_ELIGIBLE",
        "anchor_dcf_status": "BASE_SUPPORTED", "l1_name": "建筑材料",
        "economic_factor": "INDUSTRIAL_CAPEX",
    }])
    previous = pd.DataFrame([{
        "ts_code": "000786.SZ", "name": "北新建材", "allocation_bucket": "ANCHOR",
        "target_weight": .15,
    }])
    policy = {**POLICY, "anchor_sticky": True, "anchor_max_names": 1,
              "manual_anchor_overrides": [{
                  "ts_code": "000786.SZ", "target_weight": .10,
                  "effective_date": "20260720", "reason": "人工研究降仓",
              }]}
    portfolio, summary = build_barbell_weights(
        anchors, pd.DataFrame(columns=["barbell_state"]), policy,
        previous_portfolio=previous, as_of="20260720",
    )
    row = portfolio.iloc[0]
    assert row["target_weight"] == .10
    assert row["reason"] == "人工研究降仓"
    assert summary["cash_weight"] == .90


def test_manual_future_override_promotes_with_explicit_reason():
    future = pd.DataFrame([{
        "ts_code": "600941.SH", "name": "中国移动", "policy_status": "POLICY_ELIGIBLE",
        "future_thesis_score": 88, "valuation_gate": "REASONABLE",
        "financial_check": "PASS_SURVIVAL", "dcf_margin_of_safety": .20,
        "timing_status": "BOTTOM_HOLD_NO_ADD",
    }])
    milestones = pd.DataFrame([{
        "ts_code": "600941.SH", "demand_status": "VERIFIED",
        "profit_pool_status": "VERIFIED", "company_status": "VERIFIED",
        "invalidation_status": "NONE",
    }])
    state = classify_future_states(
        future, milestones,
        evidence_readiness=pd.DataFrame([{
            "ts_code": "600941.SH", "evidence_status": "SEED_READY",
            "seed_evidence_ready": True, "promotion_evidence_ready": True,
        }]),
        as_of="2026-07-17",
        policy={"manual_future_overrides": [{
            "ts_code": "600941.SH", "target_weight": .075,
            "strategy_state": "PROMOTED_CORE", "effective_date": "2026-07-17",
            "reason": "人工确认中国移动",
        }]},
    )
    assert state.iloc[0]["barbell_state"] == "PROMOTED_CORE"
    assert state.iloc[0]["manual_override"]
    assert state.iloc[0]["state_reason"] == "人工确认中国移动"


def test_approved_anchor_cannot_also_receive_future_weight():
    anchors = pd.DataFrame([{"ts_code": "A", "name": "A", "defensive_status": "DEFENSIVE_ELIGIBLE"}])
    future = pd.DataFrame([{"ts_code": "A", "name": "A", "theme": "x", "barbell_state": "OPTION_SEED",
                            "future_thesis_score": 90, "state_reason": "seed"}])
    portfolio, _ = build_barbell_weights(anchors, future, POLICY)
    assert len(portfolio[portfolio["ts_code"].eq("A")]) == 1
    assert portfolio.iloc[0]["allocation_bucket"] == "ANCHOR"


def test_sticky_anchor_does_not_replace_gree_with_a_small_score_leader():
    anchors = pd.DataFrame([
        {"ts_code": "000651.SZ", "name": "格力电器", "defensive_status": "DEFENSIVE_ELIGIBLE",
         "anchor_score": 71.56, "l1_name": "家用电器", "economic_factor": "DOMESTIC_CONSUMPTION"},
        {"ts_code": "603195.SH", "name": "公牛集团", "defensive_status": "DEFENSIVE_ELIGIBLE",
         "anchor_score": 71.71, "l1_name": "家用电器", "economic_factor": "DOMESTIC_CONSUMPTION"},
    ])
    previous = pd.DataFrame([{
        "date": "2026-07-16", "ts_code": "000651.SZ", "name": "格力电器",
        "allocation_bucket": "ANCHOR", "target_weight": .064865, "close": 39.83,
    }])
    policy = {**POLICY, "anchor_target": .10, "anchor_max_names": 1,
              "anchor_entry_weight": .025, "anchor_sticky": True}
    portfolio, _ = build_barbell_weights(anchors, pd.DataFrame(columns=["barbell_state"]), policy, previous)
    weights = portfolio.set_index("ts_code")["target_weight"]
    assert weights["000651.SZ"] == .064865
    assert "603195.SH" not in weights


def test_confirmed_hard_fail_reduces_in_steps_and_can_exit():
    anchors = pd.DataFrame([{
        "ts_code": "000651.SZ", "name": "格力电器", "defensive_status": "WATCH",
        "anchor_score": 20, "l1_name": "家用电器", "economic_factor": "DOMESTIC_CONSUMPTION",
    }])
    previous = pd.DataFrame([{
        "date": "2026-07-16", "ts_code": "000651.SZ", "name": "格力电器",
        "allocation_bucket": "ANCHOR", "target_weight": .064865, "close": 39.83,
    }])
    selection_state = pd.DataFrame([{
        "ts_code": "000651.SZ", "review_action": "HARD_FAIL_REDUCE",
        "failed_gate": "PRESELECTION_PB_FAIL",
    }])
    portfolio, _ = build_barbell_weights(
        anchors, pd.DataFrame(columns=["barbell_state"]), POLICY, previous,
        anchor_selection_state=selection_state,
    )
    row = portfolio.loc[portfolio["ts_code"].eq("000651.SZ")].iloc[0]
    assert row["target_weight"] == pytest.approx(.039865)
    assert "允许最终退出" in row["reason"]


def test_full_market_anchor_universe_applies_first_pass_and_industry_cap():
    daily = pd.DataFrame([
        {"ts_code": "A", "trade_date": 20260713, "pe_ttm": 10, "pb": 1, "dv_ratio": 4, "total_mv": 2_000_000},
        {"ts_code": "B", "trade_date": 20260713, "pe_ttm": 10, "pb": 1, "dv_ratio": 4, "total_mv": 2_000_000},
        {"ts_code": "C", "trade_date": 20260713, "pe_ttm": 10, "pb": 1, "dv_ratio": 1, "total_mv": 2_000_000},
    ])
    master = pd.DataFrame([
        {"ts_code": code, "name": code, "list_date": "2010-01-01", "list_status": "L"}
        for code in ["A", "B", "C"]
    ])
    members = pd.DataFrame([{"ts_code": code, "l1_name": "消费"} for code in ["A", "B", "C"]])
    policy = {"anchor_min_dividend_yield": 2.5, "anchor_max_pe_ttm": 30, "anchor_max_pb": 6,
              "anchor_min_market_cap_yi": 100, "anchor_min_listing_years": 5,
              "anchor_preselect_per_industry": 1, "anchor_financial_shortlist_size": 10}
    funnel, shortlist = build_full_market_anchor_universe(daily, master, members, policy)
    assert len(shortlist) == 1
    assert shortlist.iloc[0]["preselection_status"] == "FINANCIAL_SHORTLIST"
    assert funnel.set_index("ts_code").loc["C", "preselection_status"] == "DIVIDEND_FAIL"


def test_held_anchor_that_fails_preselection_is_forced_into_explicit_review():
    daily = pd.DataFrame([{
        "ts_code": "A", "trade_date": 20260713, "pe_ttm": 10, "pb": 8,
        "dv_ratio": 4, "total_mv": 2_000_000,
    }])
    master = pd.DataFrame([{"ts_code": "A", "name": "A", "list_date": "2010-01-01", "list_status": "L"}])
    members = pd.DataFrame([{"ts_code": "A", "l1_name": "消费"}])
    policy = {"anchor_min_dividend_yield": 2.5, "anchor_max_pe_ttm": 30, "anchor_max_pb": 6,
              "anchor_min_market_cap_yi": 100, "anchor_min_listing_years": 5}
    funnel, shortlist = build_full_market_anchor_universe(daily, master, members, policy)
    previous = pd.DataFrame([{"ts_code": "A", "allocation_bucket": "ANCHOR", "target_weight": .10}])
    review = include_held_anchors_for_review(funnel, shortlist, previous)
    assert review.iloc[0]["preselection_status"] == "PB_FAIL"
    financials = pd.DataFrame([{
        "ts_code": "A", "owner_earnings_yield": .05, "normalized_owner_earnings": 10,
        "normalized_fcf": 8, "net_cash": 1,
    }])
    result = anchor_signal_table(daily, review, financials, {"anchor_selection_mode": "auto"}).iloc[0]
    assert result["first_failed_anchor_gate"] == "PRESELECTION_PB_FAIL"


def test_rank_replacement_requires_buffer_gap_and_three_confirmations():
    anchors = pd.DataFrame([
        {"ts_code": "OLD", "defensive_status": "DEFENSIVE_ELIGIBLE", "anchor_score": 60,
         "anchor_financial_check": "PASS_CASH_EARNINGS"},
        {"ts_code": "NEW", "defensive_status": "DEFENSIVE_ELIGIBLE", "anchor_score": 70,
         "anchor_financial_check": "PASS_CASH_EARNINGS"},
    ])
    previous = pd.DataFrame([{"ts_code": "OLD", "allocation_bucket": "ANCHOR", "target_weight": .05}])
    policy = {"anchor_hold_rank_buffer": 1, "anchor_entry_rank": 1,
              "anchor_replacement_score_gap": 5, "anchor_replacement_confirmation_sessions": 3}
    first = build_anchor_selection_state(anchors, previous, pd.DataFrame(), "2026-07-13", policy)
    second = build_anchor_selection_state(anchors, previous, first, "2026-07-14", policy)
    third = build_anchor_selection_state(anchors, previous, second, "2026-07-15", policy)
    assert first.iloc[0]["review_action"] == "HOLD"
    assert second.iloc[0]["review_action"] == "HOLD"
    assert third.iloc[0]["review_action"] == "RANK_REDUCE"


def test_explicit_preselection_failure_counts_even_when_dcf_is_over_optimistic():
    anchors = pd.DataFrame([{
        "ts_code": "OLD", "defensive_status": "WATCH", "anchor_score": 60,
        "anchor_financial_check": "PASS_CASH_EARNINGS",
        "first_failed_anchor_gate": "PRESELECTION_PB_FAIL",
        "anchor_dcf_status": "OVER_OPTIMISTIC",
    }])
    previous = pd.DataFrame([{"ts_code": "OLD", "allocation_bucket": "ANCHOR", "target_weight": .05}])
    state = build_anchor_selection_state(
        anchors, previous, pd.DataFrame(), "2026-07-13",
        {"anchor_hard_fail_confirmation_sessions": 2},
    )
    assert state.iloc[0]["hard_fail_consecutive"] == 1
    assert state.iloc[0]["review_action"] == "HOLD"


def test_auto_anchor_rejects_low_roe_or_unstable_owner_earnings():
    daily = pd.DataFrame([
        {"ts_code": "LOW", "dv_ratio": 4.0, "pe_ttm": 10.0},
        {"ts_code": "VOL", "dv_ratio": 4.0, "pe_ttm": 10.0},
    ])
    watch = pd.DataFrame([
        {"ts_code": "LOW", "name": "low", "moat_approved": False},
        {"ts_code": "VOL", "name": "volatile", "moat_approved": False},
    ])
    common = {"owner_earnings_yield": .05, "normalized_owner_earnings": 10,
              "normalized_fcf": 8, "net_cash": 1, "financial_years": 5,
              "owner_earnings_positive_years": 5, "fcf_positive_years": 5}
    financials = pd.DataFrame([
        {"ts_code": "LOW", **common, "normalized_roe": .05, "owner_earnings_cv": .10},
        {"ts_code": "VOL", **common, "normalized_roe": .20, "owner_earnings_cv": .80},
    ])
    policy = {"anchor_selection_mode": "auto", "anchor_min_normalized_roe": .08,
              "anchor_max_owner_earnings_cv": .50}
    result = anchor_signal_table(daily, watch, financials, policy)
    assert result["defensive_status"].eq("WATCH").all()


def test_anchor_moat_proxy_requires_industry_position_and_durable_pricing_or_scale():
    daily = pd.DataFrame([
        {"ts_code": "LEADER", "dv_ratio": 4.0, "pe_ttm": 12.0},
        {"ts_code": "FOLLOWER", "dv_ratio": 4.0, "pe_ttm": 12.0},
    ])
    watch = pd.DataFrame([
        {"ts_code": "LEADER", "name": "leader", "moat_approved": False,
         "l1_name": "食品饮料", "l2_name": "饮料", "l3_name": "品牌饮料",
         "subindustry_market_cap_rank": 1},
        {"ts_code": "FOLLOWER", "name": "follower", "moat_approved": False,
         "l1_name": "食品饮料", "l2_name": "饮料", "l3_name": "品牌饮料",
         "subindustry_market_cap_rank": 6},
    ])
    common = {
        "owner_earnings_yield": .06, "normalized_owner_earnings": 10,
        "normalized_fcf": 8, "normalized_fcf_conversion": .8, "net_cash": 1,
        "financial_years": 5, "owner_earnings_positive_years": 5,
        "fcf_positive_years": 5, "normalized_roe": .22,
        "owner_earnings_cv": .12, "revenue_cagr": .05,
        "normalized_gross_margin": .55, "gross_margin_cv": .04,
        "latest_gross_margin_delta": -.01,
    }
    financials = pd.DataFrame([
        {"ts_code": "LEADER", **common},
        {"ts_code": "FOLLOWER", **common},
    ])
    policy = {
        "anchor_selection_mode": "auto", "anchor_require_moat_proxy": True,
        "anchor_max_subindustry_market_cap_rank": 3,
        "anchor_max_gross_margin_cv": .15, "anchor_min_revenue_cagr": -.03,
        "anchor_min_gross_margin_delta": -.03, "anchor_min_fcf_conversion": .5,
        "anchor_max_dividend_payout_proxy": 1.1,
    }
    result = anchor_signal_table(daily, watch, financials, policy).set_index("ts_code")
    assert result.loc["LEADER", "defensive_status"] == "DEFENSIVE_ELIGIBLE"
    assert result.loc["LEADER", "moat_proxy_type"] == "BRAND_PRICING_POWER_PROXY"
    assert result.loc["FOLLOWER", "defensive_status"] == "WATCH"
    assert result.loc["FOLLOWER", "first_failed_anchor_gate"] == "MOAT_PROXY_FAIL"


def test_anchor_allocation_diversifies_economic_factors_before_adding_second_name():
    anchors = pd.DataFrame([
        {"ts_code": "A1", "name": "A1", "l1_name": "消费", "economic_factor": "A",
         "anchor_score": 100, "defensive_status": "DEFENSIVE_ELIGIBLE"},
        {"ts_code": "A2", "name": "A2", "l1_name": "消费", "economic_factor": "A",
         "anchor_score": 99, "defensive_status": "DEFENSIVE_ELIGIBLE"},
        {"ts_code": "A3", "name": "A3", "l1_name": "消费", "economic_factor": "A",
         "anchor_score": 98, "defensive_status": "DEFENSIVE_ELIGIBLE"},
        {"ts_code": "B1", "name": "B1", "l1_name": "工业", "economic_factor": "B",
         "anchor_score": 80, "defensive_status": "DEFENSIVE_ELIGIBLE"},
        {"ts_code": "C1", "name": "C1", "l1_name": "医疗", "economic_factor": "C",
         "anchor_score": 70, "defensive_status": "DEFENSIVE_ELIGIBLE"},
        {"ts_code": "D1", "name": "D1", "l1_name": "数字", "economic_factor": "D",
         "anchor_score": 60, "defensive_status": "DEFENSIVE_ELIGIBLE"},
    ])
    policy = {**POLICY, "anchor_max_names": 6, "anchor_max_weight": .15,
              "anchor_industry_cap": .20, "anchor_economic_factor_cap": .20}
    portfolio, summary = build_barbell_weights(anchors, pd.DataFrame(columns=["barbell_state"]), policy)
    factor_weights = portfolio.groupby(portfolio["ts_code"].str[0])["target_weight"].sum()
    assert set("BCD").issubset(set(portfolio["ts_code"].str[0]))
    assert factor_weights.max() <= .20 + 1e-12
    assert abs(summary["anchor_weight"] - .65) < 1e-12
