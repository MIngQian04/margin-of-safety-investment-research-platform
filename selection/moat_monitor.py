from __future__ import annotations

import pandas as pd


REGISTRY_FIELDS = (
    "ts_code", "name", "moat_type", "moat_thesis", "replication_barrier",
    "monitoring_signals", "invalidation_signals", "last_review_date",
    "next_review_date", "action_if_intact", "action_if_weakened",
)
EVIDENCE_FIELDS = (
    "evidence_id", "ts_code", "claim", "evidence_date", "published_date",
    "source_type", "source_url", "direction", "next_review_date",
)
TRUSTED_SOURCE_TYPES = {"COMPANY_FILING", "GOVERNMENT_PRIMARY", "INDUSTRY_PRIMARY"}
REVIEW_FIELDS = (
    "ts_code", "review_status", "reviewer_type", "reviewer_id", "reviewer_model",
    "reviewed_date", "next_review_date", "source_evidence_ids", "conclusion", "note",
)


def _require(frame: pd.DataFrame, fields: tuple[str, ...], label: str) -> None:
    missing = set(fields) - set(frame.columns)
    if missing:
        raise ValueError(f"{label} missing columns: {sorted(missing)}")


def build_moat_monitor(registry: pd.DataFrame, evidence: pd.DataFrame, as_of: str) -> pd.DataFrame:
    """Build a current, auditable moat judgment from thesis cards and append-only evidence."""
    _require(registry, REGISTRY_FIELDS, "moat registry")
    _require(evidence, EVIDENCE_FIELDS, "moat evidence ledger")
    today = pd.Timestamp(as_of).normalize()
    cards = registry.copy().drop_duplicates("ts_code", keep="last")
    cards["ts_code"] = cards["ts_code"].astype(str)
    cards["next_review_date"] = pd.to_datetime(cards["next_review_date"], errors="coerce")

    ledger = evidence.copy()
    ledger["ts_code"] = ledger["ts_code"].astype(str)
    ledger["source_type"] = ledger["source_type"].fillna("").astype(str).str.upper()
    ledger["direction"] = ledger["direction"].fillna("").astype(str).str.upper()
    for column in ["evidence_date", "published_date", "next_review_date"]:
        ledger[column] = pd.to_datetime(ledger[column], errors="coerce")
    active = ledger[
        ledger["evidence_date"].le(today)
        & ledger["published_date"].le(today)
        & ledger["next_review_date"].ge(today)
        & ledger["source_type"].isin(TRUSTED_SOURCE_TYPES)
        & ledger["source_url"].fillna("").astype(str).str.strip().ne("")
        & ledger["claim"].fillna("").astype(str).str.strip().ne("")
    ].copy()

    rows: list[dict] = []
    for _, card in cards.iterrows():
        code = str(card["ts_code"])
        company = active[active["ts_code"].eq(code)]
        supports = company[company["direction"].eq("SUPPORTS")]
        cautions = company[company["direction"].eq("CAUTION")]
        contradictions = company[company["direction"].eq("CONTRADICTS")]
        if pd.isna(card["next_review_date"]) or card["next_review_date"] < today:
            status = "REVIEW_DUE"
            action = "暂停加仓，先完成护城河复核"
        elif not contradictions.empty:
            status = "WEAKENED"
            action = str(card["action_if_weakened"])
        elif not cautions.empty:
            status = "WATCH"
            action = "维持或降低仓位，暂停加仓并核查风险证据"
        elif not supports.empty:
            status = "INTACT"
            action = str(card["action_if_intact"])
        else:
            status = "DRAFT"
            action = "维持现有仓位上限，完成原始证据核验前不因历史财务加仓"
        rows.append({
            **{field: card.get(field, "") for field in REGISTRY_FIELDS},
            "moat_status": status,
            "recommended_action": action,
            "supporting_evidence_count": int(len(supports)),
            "caution_evidence_count": int(len(cautions)),
            "contradictory_evidence_count": int(len(contradictions)),
            "latest_evidence_date": (
                company["evidence_date"].max().strftime("%Y-%m-%d") if not company.empty else ""
            ),
            "next_review_date": card["next_review_date"].strftime("%Y-%m-%d") if pd.notna(card["next_review_date"]) else "",
        })
    return pd.DataFrame(rows)


def build_moat_readiness(
    registry: pd.DataFrame,
    evidence: pd.DataFrame,
    reviews: pd.DataFrame,
    as_of: str,
) -> pd.DataFrame:
    """Require auditable moat evidence plus a dated human or AI review.

    AI review is allowed, but it is not self-authenticating: the review must
    identify the model, cite active supporting evidence IDs, state a conclusion,
    and remain within its explicit review window.
    """
    _require(reviews, REVIEW_FIELDS, "moat review ledger")
    today = pd.Timestamp(as_of).normalize()
    monitor = build_moat_monitor(registry, evidence, as_of)

    ledger = evidence.copy()
    ledger["ts_code"] = ledger["ts_code"].astype(str)
    ledger["source_type"] = ledger["source_type"].fillna("").astype(str).str.upper()
    ledger["direction"] = ledger["direction"].fillna("").astype(str).str.upper()
    for column in ["evidence_date", "published_date", "next_review_date"]:
        ledger[column] = pd.to_datetime(ledger[column], errors="coerce")
    active_support = ledger[
        ledger["evidence_date"].le(today)
        & ledger["published_date"].le(today)
        & ledger["next_review_date"].ge(today)
        & ledger["source_type"].isin(TRUSTED_SOURCE_TYPES)
        & ledger["source_url"].fillna("").astype(str).str.strip().ne("")
        & ledger["claim"].fillna("").astype(str).str.strip().ne("")
        & ledger["direction"].eq("SUPPORTS")
    ].copy()
    support_ids = active_support.groupby("ts_code")["evidence_id"].apply(
        lambda values: {str(value).strip() for value in values if str(value).strip()}
    ).to_dict()

    review = reviews.copy().drop_duplicates("ts_code", keep="last")
    review["ts_code"] = review["ts_code"].astype(str)
    review["review_status"] = review["review_status"].fillna("").astype(str).str.upper()
    review["reviewer_type"] = review["reviewer_type"].fillna("").astype(str).str.upper()
    for column in ["reviewed_date", "next_review_date"]:
        review[column] = pd.to_datetime(review[column], errors="coerce")
    review = review.set_index("ts_code")

    rows: list[dict] = []
    for card in monitor.to_dict("records"):
        code = str(card["ts_code"])
        item = review.loc[code] if code in review.index else pd.Series(dtype=object)
        cited_ids = {
            value.strip()
            for value in str(item.get("source_evidence_ids", "")).split("|")
            if value.strip()
        }
        active_ids = support_ids.get(code, set())
        evidence_ids_valid = bool(cited_ids) and cited_ids.issubset(active_ids)
        reviewer_type = str(item.get("reviewer_type", "")).upper()
        reviewer_id = str(item.get("reviewer_id", "")).strip()
        reviewer_model = str(item.get("reviewer_model", "")).strip()
        reviewer_valid = (
            reviewer_type in {"HUMAN", "AI"}
            and bool(reviewer_id)
            and (reviewer_type != "AI" or bool(reviewer_model))
        )
        reviewed_date = pd.to_datetime(item.get("reviewed_date"), errors="coerce")
        next_review_date = pd.to_datetime(item.get("next_review_date"), errors="coerce")
        review_current = (
            pd.notna(reviewed_date) and reviewed_date.normalize() <= today
            and pd.notna(next_review_date) and next_review_date.normalize() >= today
        )
        conclusion_present = bool(str(item.get("conclusion", "")).strip())
        confirmed = str(item.get("review_status", "")).upper() == "CONFIRMED"
        moat_intact = str(card.get("moat_status", "")).upper() == "INTACT"
        ready = bool(
            moat_intact and confirmed and reviewer_valid and review_current
            and evidence_ids_valid and conclusion_present
        )
        if not moat_intact:
            gate_status = f"MOAT_{str(card.get('moat_status', 'NOT_READY')).upper()}"
        elif not confirmed:
            gate_status = "REVIEW_NOT_CONFIRMED"
        elif not reviewer_valid:
            gate_status = "REVIEWER_INVALID"
        elif not review_current:
            gate_status = "REVIEW_EXPIRED"
        elif not evidence_ids_valid:
            gate_status = "REVIEW_EVIDENCE_INVALID"
        elif not conclusion_present:
            gate_status = "REVIEW_CONCLUSION_MISSING"
        else:
            gate_status = "READY"
        rows.append({
            "ts_code": code,
            "moat_gate_status": gate_status,
            "moat_entry_ready": ready,
            "moat_status": card.get("moat_status", "DRAFT"),
            "moat_supporting_evidence_count": int(card.get("supporting_evidence_count", 0)),
            "moat_caution_evidence_count": int(card.get("caution_evidence_count", 0)),
            "moat_contradictory_evidence_count": int(card.get("contradictory_evidence_count", 0)),
            "moat_review_status": str(item.get("review_status", "NOT_REVIEWED")).upper(),
            "moat_reviewer_type": reviewer_type,
            "moat_reviewer_id": reviewer_id,
            "moat_reviewer_model": reviewer_model,
            "moat_reviewed_date": reviewed_date.strftime("%Y-%m-%d") if pd.notna(reviewed_date) else "",
            "moat_review_next_date": next_review_date.strftime("%Y-%m-%d") if pd.notna(next_review_date) else "",
            "moat_review_source_evidence_ids": "|".join(sorted(cited_ids)),
            "moat_review_conclusion": str(item.get("conclusion", "")).strip(),
        })
    return pd.DataFrame(rows)
