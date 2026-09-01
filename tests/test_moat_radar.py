import tempfile
import unittest
from pathlib import Path

import pandas as pd

from selection.moat_radar import apply_review_sla, build_financial_alerts


class MoatRadarTests(unittest.TestCase):
    def test_high_financial_alert_has_two_session_sla_and_overdue_action(self):
        alerts = pd.DataFrame([{
            "alert_id": "a", "ts_code": "600000.SH", "name": "样本",
            "alert_date": "2026-07-13", "alert_source": "QUARTERLY_FINANCIAL",
            "alert_level": "HIGH", "category": "CASHFLOW_DETERIORATION",
            "trigger": "经营现金流同比", "title": "下降", "source_url": "",
            "review_status": "PENDING_REVIEW", "suggested_action": "复核",
        }])
        result = apply_review_sla(alerts, "2026-07-16").iloc[0]
        self.assertEqual(result["review_due_date"], "2026-07-15")
        self.assertTrue(result["review_overdue"])
        self.assertEqual(result["risk_action"], "FREEZE_AND_REDUCE_AFTER_CONFIRMATION")

    def test_same_period_financial_decline_only_triggers_review(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "income").mkdir()
            (root / "cashflow").mkdir()
            pd.DataFrame([
                {"ann_date": "20260430", "end_date": "20260331", "revenue": 80, "n_income_attr_p": 70},
                {"ann_date": "20250430", "end_date": "20250331", "revenue": 100, "n_income_attr_p": 100},
            ]).to_parquet(root / "income/600000_SH.parquet")
            pd.DataFrame([
                {"ann_date": "20260430", "end_date": "20260331", "n_cashflow_act": 60},
                {"ann_date": "20250430", "end_date": "20250331", "n_cashflow_act": 100},
            ]).to_parquet(root / "cashflow/600000_SH.parquet")
            alerts, health = build_financial_alerts(
                pd.DataFrame([{"ts_code": "600000.SH", "name": "样本"}]), root, "2026-07-15"
            )
        self.assertEqual(health["codes_checked"], 1)
        self.assertEqual(set(alerts["trigger"]), {"收入同比", "归母净利润同比", "经营现金流同比"})
        self.assertTrue(alerts["review_status"].eq("PENDING_REVIEW").all())


if __name__ == "__main__":
    unittest.main()
