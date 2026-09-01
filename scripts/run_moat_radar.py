"""Build the event-driven moat review queue for current holdings."""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from selection.moat_radar import apply_review_sla, build_financial_alerts, build_review_due_alerts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of", help="YYYY-MM-DD; defaults to portfolio as-of date")
    args = parser.parse_args()

    output_dir = PROJECT_ROOT / "outputs/barbell-strategy"
    holdings = pd.read_csv(output_dir / "target_portfolio.csv", encoding="utf-8-sig")
    registry = pd.read_csv(PROJECT_ROOT / "config/moat-thesis-registry.csv", encoding="utf-8-sig")
    summary = pd.read_csv(output_dir / "portfolio_summary.csv", encoding="utf-8-sig").iloc[0]
    as_of = pd.Timestamp(args.as_of or summary["as_of_date"]).normalize()
    codes = holdings["ts_code"].dropna().astype(str).tolist()
    financial_alerts, financial_health = build_financial_alerts(
        holdings, PROJECT_ROOT / "data/raw/fundamental", as_of.strftime("%Y-%m-%d")
    )
    due_alerts = build_review_due_alerts(registry, as_of.strftime("%Y-%m-%d"))
    alerts = pd.concat([financial_alerts, due_alerts], ignore_index=True)
    alerts = alerts.drop_duplicates("alert_id", keep="last")

    alert_path = output_dir / "moat_radar_alerts.csv"
    if alert_path.exists() and not alerts.empty:
        old = pd.read_csv(alert_path, encoding="utf-8-sig")
        statuses = old.set_index("alert_id")["review_status"] if "review_status" in old else pd.Series(dtype=str)
        alerts["review_status"] = alerts["alert_id"].map(statuses).fillna(alerts["review_status"])
    alerts = apply_review_sla(alerts, as_of.strftime("%Y-%m-%d"))
    alerts = alerts.sort_values(["alert_level", "alert_date"], ascending=[True, False]) if not alerts.empty else alerts
    alerts.to_csv(alert_path, index=False, encoding="utf-8-sig")

    pending = alerts[alerts["review_status"].eq("PENDING_REVIEW")] if not alerts.empty else alerts
    health = pd.DataFrame([{
        "as_of_date": as_of.strftime("%Y-%m-%d"),
        "checked_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "monitor_scope": "QUARTERLY_FINANCIAL_AND_REVIEW_DEADLINES",
        "codes_requested": len(codes),
        "financial_status": "OK" if financial_health["codes_checked"] == len(codes) else "PARTIAL",
        "financial_codes_checked": financial_health["codes_checked"],
        "financial_missing_codes": "|".join(financial_health["missing_codes"]),
        "pending_alerts": len(pending),
        "high_alerts": int(pending["alert_level"].eq("HIGH").sum()) if not pending.empty else 0,
        "overdue_alerts": int(pending["review_overdue"].fillna(False).sum()) if not pending.empty else 0,
    }])
    health.to_csv(output_dir / "moat_radar_health.csv", index=False, encoding="utf-8-sig")
    print(f"financial_status={health.iloc[0]['financial_status']} pending_alerts={len(pending)} high_alerts={int(health.iloc[0]['high_alerts'])} overdue_alerts={int(health.iloc[0]['overdue_alerts'])}")


if __name__ == "__main__":
    main()
