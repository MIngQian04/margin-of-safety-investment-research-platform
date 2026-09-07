"""Prepare and verify one publishable forward-barbell daily snapshot.

This is the single local entry point used by the recurring Codex task.  It
refreshes the latest completed SSE session, skips dates that are already in the
published website commit, runs the strategy stages in order, and refuses to
return success unless the new website snapshot preserves the published NAV
history and satisfies the release invariants.

Git synchronization and Sites deployment intentionally remain outside this
script so credentials are never persisted in the repository.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import math
import socket
import subprocess
import sys
import time
import traceback
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Iterator
from zoneinfo import ZoneInfo

import pandas as pd


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SITE_ROOT = PROJECT_ROOT / "portfolio-site"
SITE_DATA = SITE_ROOT / "public" / "data" / "portfolio.json"
DAILY_BASIC = PROJECT_ROOT / "data" / "processed" / "portfolio" / "daily_basic_latest.csv"
FUTURE_CANDIDATES = PROJECT_ROOT / "outputs" / "future-demand-screen" / "future_demand_candidates.csv"
HOLDINGS_HISTORY = PROJECT_ROOT / "outputs" / "barbell-strategy" / "portfolio_holdings_history.csv"
NAV_HISTORY = PROJECT_ROOT / "outputs" / "barbell-strategy" / "portfolio_nav_history.csv"
TARGET_PORTFOLIO = PROJECT_ROOT / "outputs" / "barbell-strategy" / "target_portfolio.csv"
UPDATE_LOCK = PROJECT_ROOT / "work" / "daily-portfolio-update.lock"
PROVIDER_HOST = "api.tushare.pro"

CURRENT_STAGE = "startup"


class PublicationValidationError(RuntimeError):
    """Raised when a generated snapshot is not safe to publish."""


class ProviderNetworkUnavailableError(RuntimeError):
    """Raised before mutation when the market-data provider cannot be resolved."""


def emit_status(status: str, **details: object) -> None:
    print(json.dumps({"status": status, **details}, ensure_ascii=False, sort_keys=True), flush=True)


def enter_stage(stage: str) -> None:
    global CURRENT_STAGE
    CURRENT_STAGE = stage
    emit_status("STAGE_STARTED", stage=stage, terminal=False)


@contextmanager
def exclusive_update_lock(lock_path: Path = UPDATE_LOCK) -> Iterator[bool]:
    """Allow only one daily update process to mutate local strategy state."""
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def require_provider_network(
    host: str = PROVIDER_HOST,
    attempts: int = 3,
    delay_seconds: float = 5.0,
) -> None:
    """Wait briefly for DNS before starting any market-data mutation."""
    if attempts < 1:
        raise ValueError("attempts must be positive")
    last_error: OSError | None = None
    for attempt in range(1, attempts + 1):
        try:
            socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
            emit_status(
                "NETWORK_READY", host=host, attempt=attempt, terminal=False
            )
            return
        except OSError as exc:
            last_error = exc
            emit_status(
                "NETWORK_WAIT",
                host=host,
                attempt=attempt,
                attempts=attempts,
                terminal=False,
            )
            if attempt < attempts:
                time.sleep(delay_seconds)
    raise ProviderNetworkUnavailableError(
        f"provider DNS unavailable after {attempts} attempts: {host}"
    ) from last_error


def run(command: list[str], cwd: Path = PROJECT_ROOT) -> None:
    print(f"===== RUN {' '.join(command)} =====", flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_published_site_data(site_root: Path = SITE_ROOT) -> dict:
    """Read the website snapshot from its committed publication baseline."""
    result = subprocess.run(
        ["git", "show", "HEAD:public/data/portfolio.json"],
        cwd=site_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def inspect_market_snapshot(frame: pd.DataFrame, published: dict) -> tuple[str, int]:
    required = {"ts_code", "trade_date", "close"}
    missing = required.difference(frame.columns)
    if missing:
        raise PublicationValidationError(
            f"daily-basic is missing required columns: {', '.join(sorted(missing))}"
        )
    trade_dates = pd.to_numeric(frame["trade_date"], errors="coerce").dropna().astype(int).unique()
    if len(trade_dates) != 1:
        raise PublicationValidationError("daily-basic must contain exactly one trade date")
    if frame["ts_code"].astype(str).duplicated().any():
        raise PublicationValidationError("daily-basic contains duplicate securities")
    if pd.to_numeric(frame["close"], errors="coerce").isna().any():
        raise PublicationValidationError("daily-basic contains missing closing prices")

    previous_count = int(published.get("summary", {}).get("universeScanned") or 0)
    minimum_count = max(5000, math.floor(previous_count * 0.98))
    if len(frame) < minimum_count:
        raise PublicationValidationError(
            f"daily-basic coverage is incomplete: {len(frame)} rows, need at least {minimum_count}"
        )
    raw_date = str(trade_dates[0])
    return f"{raw_date[:4]}-{raw_date[4:6]}-{raw_date[6:]}", len(frame)


def validate_future_financials(frame: pd.DataFrame) -> None:
    if "financial_data_status" not in frame:
        raise PublicationValidationError("future screen has no financial-data status")
    failures = frame.loc[frame["financial_data_status"].astype(str).ne("LIVE")]
    if not failures.empty:
        codes = ", ".join(failures["ts_code"].astype(str).head(8))
        raise PublicationValidationError(f"future financial refresh is incomplete: {codes}")


def reconcile_published_execution_history(
    published: dict,
    holdings_path: Path = HOLDINGS_HISTORY,
    nav_path: Path = NAV_HISTORY,
    target_path: Path = TARGET_PORTFOLIO,
) -> None:
    """Make the last committed target the sole basis for the next return.

    A prior task may have prepared a local snapshot but failed before it was
    published. Such a target must never become the next session's active
    portfolio. Market and financial caches may remain ahead, but executable
    holdings and NAV are trimmed back to the committed website baseline.
    """
    published_date = str(published.get("asOf", ""))
    next_holdings = published.get("nextHoldings") or []
    if not published_date or not next_holdings:
        raise PublicationValidationError("published website has no next-session target")

    history = pd.read_csv(holdings_path) if holdings_path.exists() else pd.DataFrame()
    columns = list(history.columns) if not history.empty else [
        "date", "ts_code", "name", "allocation_bucket", "target_weight", "close", "open",
    ]
    required = {"date", "ts_code", "name", "allocation_bucket", "target_weight", "close", "open"}
    if not required.issubset(columns):
        raise PublicationValidationError("holdings history has an unsupported schema")
    if not history.empty:
        history = history[history["date"].astype(str).lt(published_date)].copy()
    target_rows = pd.DataFrame([{
        "date": published_date,
        "ts_code": row["code"],
        "name": row["name"],
        "allocation_bucket": row["bucket"],
        "target_weight": float(row["weight"]),
        "close": float(row["price"]),
        "open": pd.NA,
    } for row in next_holdings], columns=columns)
    pd.concat([history, target_rows], ignore_index=True).to_csv(
        holdings_path, index=False, encoding="utf-8-sig"
    )
    pd.DataFrame([{
        "ts_code": row["code"],
        "name": row["name"],
        "allocation_bucket": row["bucket"],
        "target_weight": float(row["weight"]),
    } for row in next_holdings]).to_csv(target_path, index=False, encoding="utf-8-sig")

    nav = pd.read_csv(nav_path)
    published_nav = published.get("navHistory") or []
    expected_by_date = {str(row["date"]): row for row in published_nav}
    committed_nav = nav[nav["date"].astype(str).le(published_date)].copy()
    if len(committed_nav) != len(published_nav):
        raise PublicationValidationError("local NAV history does not match the published row count")
    shared_fields = {
        "nav": "nav",
        "daily_return": "dailyReturn",
        "price_coverage": "priceCoverage",
    }
    for _, local_row in committed_nav.iterrows():
        expected = expected_by_date.get(str(local_row["date"]))
        if expected is None:
            raise PublicationValidationError("local NAV history has a date absent from the publication")
        for local_name, site_name in shared_fields.items():
            if not math.isclose(
                float(local_row[local_name]), float(expected[site_name]), rel_tol=0.0, abs_tol=1e-12
            ):
                raise PublicationValidationError(
                    f"local NAV field {local_name} differs from the published baseline"
                )
    committed_nav.to_csv(nav_path, index=False, encoding="utf-8-sig")


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise PublicationValidationError(message)


def validate_publication(candidate: dict, published: dict, expected_date: str) -> dict:
    _require(candidate.get("asOf") == expected_date, "website asOf does not match the market date")
    _require(candidate.get("returnDate") == expected_date, "website returnDate does not match the market date")
    _require(candidate.get("activeAsOf") == published.get("asOf"), "active holdings are not the last published target")

    next_as_of = candidate.get("allocationChange", {}).get("nextAsOf")
    _require(bool(next_as_of) and date.fromisoformat(next_as_of) > date.fromisoformat(expected_date),
             "next-session target date is not after the return date")

    old_nav = published.get("navHistory") or []
    new_nav = candidate.get("navHistory") or []
    _require(len(new_nav) == len(old_nav) + 1, "NAV history must append exactly one row")
    _require(new_nav[:len(old_nav)] == old_nav, "previously published NAV history was modified")
    nav_dates = [row.get("date") for row in new_nav]
    _require(len(nav_dates) == len(set(nav_dates)), "NAV history contains duplicate dates")
    _require(nav_dates == sorted(nav_dates), "NAV history is not chronological")

    previous_nav = float(new_nav[-2]["nav"])
    latest = new_nav[-1]
    _require(latest.get("date") == expected_date, "latest NAV row has the wrong date")
    expected_nav = previous_nav * (1.0 + float(latest["dailyReturn"]))
    _require(math.isclose(float(latest["nav"]), expected_nav, rel_tol=0.0, abs_tol=1e-12),
             "latest NAV does not reconcile to previous NAV and daily return")

    summary = candidate.get("summary", {})
    published_target = {
        str(row["code"]): float(row["weight"]) for row in published.get("nextHoldings", [])
    }
    active_target = {
        str(row["code"]): float(row["weight"]) for row in candidate.get("holdings", [])
    }
    _require(published_target.keys() == active_target.keys(), "active holdings differ from the published target")
    _require(all(math.isclose(active_target[code], weight, rel_tol=0.0, abs_tol=1e-12)
                 for code, weight in published_target.items()),
             "active weights differ from the published target")
    _require(math.isclose(float(summary["activeCashWeight"]), float(published["summary"]["cashWeight"]),
                          rel_tol=0.0, abs_tol=1e-12),
             "active cash differs from the published target")
    active_total = sum(float(row["weight"]) for row in candidate.get("holdings", [])) + float(summary["activeCashWeight"])
    next_total = sum(float(row["weight"]) for row in candidate.get("nextHoldings", [])) + float(summary["cashWeight"])
    all_weights = [float(row["weight"]) for row in candidate.get("holdings", []) + candidate.get("nextHoldings", [])]
    _require(all(weight >= 0.0 for weight in all_weights), "portfolio contains a negative weight")
    _require(math.isclose(active_total, 1.0, rel_tol=0.0, abs_tol=1e-9), "active weights and cash do not sum to one")
    _require(math.isclose(next_total, 1.0, rel_tol=0.0, abs_tol=1e-9), "next weights and cash do not sum to one")
    _require(int(summary.get("financialComplete", -1)) == int(summary.get("financialReviewed", -2)),
             "anchor financial coverage is incomplete")

    radar = candidate.get("moatRadar", {})
    _require(radar.get("financialStatus") == "OK", "financial radar is not OK")
    benchmark = candidate.get("benchmark", {})
    _require(benchmark.get("status") == "OK", "CSI 300 coverage is not complete")
    _require(benchmark.get("endDate") == expected_date, "CSI 300 does not end on the market date")
    _require((benchmark.get("history") or [{}])[-1].get("date") == expected_date,
             "latest CSI 300 row has the wrong date")

    return {
        "status": "READY_TO_PUBLISH",
        "date": expected_date,
        "dailyReturn": float(latest["dailyReturn"]),
        "nav": float(latest["nav"]),
        "anchorWeight": float(summary["anchorWeight"]),
        "futureWeight": float(summary["futureWeight"]),
        "cashWeight": float(summary["cashWeight"]),
        "financialReviewed": int(summary["financialReviewed"]),
        "financialComplete": int(summary["financialComplete"]),
        "pendingAlerts": int(radar.get("pendingAlerts", 0)),
        "highAlerts": int(radar.get("highAlerts", 0)),
        "overdueAlerts": int(radar.get("overdueAlerts", 0)),
    }


def default_as_of() -> str:
    return datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d")


def run_update(args: argparse.Namespace) -> int:
    enter_stage("provider_network_preflight")
    require_provider_network()

    enter_stage("market_refresh")
    published = load_published_site_data()
    run([sys.executable, "scripts/refresh_rotation_market_data.py", "--as-of", args.as_of])

    enter_stage("market_validation")
    market_date, universe_count = inspect_market_snapshot(pd.read_csv(DAILY_BASIC), published)
    if market_date <= str(published.get("asOf", "")):
        emit_status(
            "NO_NEW_SESSION",
            publishedDate=published.get("asOf"),
            latestCompleteMarketDate=market_date,
            universeScanned=universe_count,
            terminal=True,
        )
        return 0

    raw_market_date = market_date.replace("-", "")

    enter_stage("published_history_reconciliation")
    reconcile_published_execution_history(published)

    enter_stage("moat_radar")
    run([sys.executable, "scripts/run_moat_radar.py", "--as-of", raw_market_date])

    enter_stage("future_financials")
    run([sys.executable, "scripts/run_future_demand_screen.py", "--refresh-financials"])
    validate_future_financials(pd.read_csv(FUTURE_CANDIDATES))

    enter_stage("strategy")
    run([sys.executable, "scripts/run_barbell_strategy.py"])

    enter_stage("public_snapshot")
    run([sys.executable, "scripts/build_public_readme_snapshot.py"])

    enter_stage("publication_validation")
    result = validate_publication(load_json(SITE_DATA), published, market_date)
    result["universeScanned"] = universe_count

    if args.verify:
        enter_stage("release_verification")
        run([sys.executable, "-m", "pytest", "-q"])
        run([sys.executable, "-m", "compileall", "-q", "portfolio", "scripts", "valuation", "tests"])
        run([sys.executable, "scripts/check_public_release.py"])
        run(["npm", "test"], cwd=SITE_ROOT)
        result["verification"] = "PASSED"

    emit_status(**result, terminal=True)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare one verified daily portfolio publication.")
    parser.add_argument("--as-of", default=default_as_of(), help="Shanghai calendar date, YYYYMMDD")
    parser.add_argument("--verify", action="store_true", help="run the complete Python and website release checks")
    args = parser.parse_args()

    with exclusive_update_lock() as acquired:
        if not acquired:
            emit_status(
                "UPDATE_ALREADY_RUNNING",
                stage="startup",
                terminal=True,
            )
            return 75

        emit_status(
            "UPDATE_STARTED",
            asOf=args.as_of,
            terminal=False,
        )
        try:
            return run_update(args)
        except Exception as exc:
            traceback.print_exc()
            details: dict[str, object] = {
                "stage": CURRENT_STAGE,
                "errorType": type(exc).__name__,
                "terminal": True,
            }
            if isinstance(exc, subprocess.CalledProcessError):
                details["returnCode"] = exc.returncode
            emit_status("UPDATE_FAILED", **details)
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
