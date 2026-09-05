from __future__ import annotations

import time
from typing import Any

from fastapi import Query, Response
from psycopg.types.json import Jsonb

from app import app, clean_text, initialize_usage_db, iso, normalize_domain, usage_db

APP_EXTENSION_VERSION = "coverage-ledger-v3"
COVERAGE_SOURCE = "Apollo · GCC+Egypt market coverage"


def account_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "domain": row["domain"],
        "name": row["name"],
        "source": row["source"],
        "sourceId": row["source_id"],
        "country": row["country"],
        "employeeCount": int(row["employee_count"] or 0),
        "industry": row["industry"],
        "activeJobs": int(row["active_jobs"] or 0),
        "headcountGrowth": float(row["headcount_growth"] or 0),
        "hrHeadcount": int(row["hr_headcount"] or 0),
        "careerPageUrl": row["career_page_url"],
        "detectedAts": row["detected_ats"],
        "gtmScore": int(row["gtm_score"] or 0),
        "gtmTier": row["gtm_tier"],
        "fitScore": int(row["fit_score"] or 0),
        "intentScore": int(row["intent_score"] or 0),
        "atsOpportunityScore": int(row["ats_opportunity_score"] or 0),
        "exclusionStatus": row["exclusion_status"],
        "exclusionReason": row["exclusion_reason"],
        "hubspotCompanyId": row["hubspot_company_id"],
        "status": row["status"],
        "primaryPersona": row["primary_persona"],
        "secondaryPersona": row["secondary_persona"],
        "economicBuyer": row["economic_buyer"],
        "technicalInfluencer": row["technical_influencer"],
        "strongestSignal": row["strongest_signal"],
        "recommendedAngle": row["recommended_angle"],
        "assignedOwnerId": row["assigned_owner_id"],
        "assignedOwnerName": row["assigned_owner_name"],
        "evidence": row.get("evidence") or {},
        "peopleCount": int(row.get("people_count") or 0),
        "enrichedCount": int(row.get("enriched_count") or 0),
        "phoneReadyCount": int(row.get("phone_ready_count") or 0),
        "pushCount": int(row.get("push_count") or 0),
        "createdAt": iso(row["created_at"]),
        "updatedAt": iso(row["updated_at"]),
    }


def global_summary(connection) -> dict[str, Any]:
    row = connection.execute(
        """
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE exclusion_status='eligible') AS eligible,
            COUNT(*) FILTER (WHERE exclusion_status='review') AS review,
            COUNT(*) FILTER (WHERE exclusion_status='excluded') AS excluded,
            COUNT(*) FILTER (WHERE status='existing_hubspot' OR hubspot_company_id <> '') AS existing_hubspot,
            COUNT(*) FILTER (WHERE employee_count BETWEEN 251 AND 5000) AS sweet_pool,
            COUNT(*) FILTER (WHERE employee_count BETWEEN 5001 AND 50000) AS enterprise_extension,
            COUNT(*) FILTER (WHERE employee_count = 0) AS size_pending,
            COUNT(*) FILTER (WHERE domain LIKE '%.invalid') AS domain_pending,
            COUNT(*) FILTER (WHERE exclusion_status='eligible' AND gtm_tier='A') AS tier_a,
            COUNT(*) FILTER (WHERE status='pushed') AS pushed,
            COUNT(*) FILTER (
                WHERE exclusion_status='eligible'
                  AND status <> 'pushed'
                  AND EXISTS (
                    SELECT 1 FROM acquisition_people ap
                    WHERE ap.account_domain=acquisition_accounts.domain
                      AND ap.enrichment_status='enriched'
                      AND (jsonb_array_length(ap.emails) > 0 OR jsonb_array_length(ap.phones) > 0)
                  )
            ) AS ready,
            COUNT(*) FILTER (
                WHERE exclusion_status='eligible'
                  AND NOT EXISTS (SELECT 1 FROM acquisition_people ap WHERE ap.account_domain=acquisition_accounts.domain)
            ) AS needs_people,
            COUNT(*) FILTER (
                WHERE exclusion_status='eligible'
                  AND EXISTS (SELECT 1 FROM acquisition_people ap WHERE ap.account_domain=acquisition_accounts.domain)
                  AND NOT EXISTS (
                    SELECT 1 FROM acquisition_people ap
                    WHERE ap.account_domain=acquisition_accounts.domain
                      AND ap.enrichment_status='enriched'
                  )
            ) AS search_only,
            COUNT(*) FILTER (
                WHERE exclusion_status='eligible'
                  AND EXISTS (
                    SELECT 1 FROM acquisition_people ap
                    WHERE ap.account_domain=acquisition_accounts.domain
                      AND ap.enrichment_status='enriched'
                      AND jsonb_array_length(ap.phones) > 0
                  )
            ) AS phone_ready
        FROM acquisition_accounts
        WHERE source = %s
        """,
        (COVERAGE_SOURCE,),
    ).fetchone() or {}
    return {key: int(value or 0) for key, value in row.items()}


def country_facets(connection) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT country,
               COUNT(*) AS stored,
               COUNT(*) FILTER (WHERE exclusion_status='eligible') AS eligible,
               COUNT(*) FILTER (WHERE exclusion_status='review') AS review,
               COUNT(*) FILTER (WHERE exclusion_status='excluded') AS excluded,
               COUNT(*) FILTER (WHERE status='existing_hubspot' OR hubspot_company_id <> '') AS existing_hubspot
        FROM acquisition_accounts
        WHERE source = %s AND country <> ''
        GROUP BY country
        ORDER BY country ASC
        """,
        (COVERAGE_SOURCE,),
    ).fetchall()
    return [
        {
            "country": row["country"],
            "stored": int(row["stored"] or 0),
            "eligible": int(row["eligible"] or 0),
            "review": int(row["review"] or 0),
            "excluded": int(row["excluded"] or 0),
            "existingHubSpot": int(row["existing_hubspot"] or 0),
        }
        for row in rows
    ]


@app.get("/v2/acquisition/accounts")
def acquisition_accounts_v2(
    response: Response,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0, le=1_000_000),
    status: str = Query(default="", max_length=40),
    country: str = Query(default="", max_length=160),
    tier: str = Query(default="", max_length=20),
    exclusion_status: str = Query(default="", max_length=30),
    domain: str = Query(default="", max_length=255),
    q: str = Query(default="", max_length=300),
    readiness: str = Query(default="", max_length=30),
    include_excluded: bool = Query(default=False),
) -> dict[str, Any]:
    initialize_usage_db()
    clauses: list[str] = ["a.source = %s"]
    params: list[Any] = [COVERAGE_SOURCE]
    if not include_excluded:
        clauses.append("a.exclusion_status = 'eligible'")
    if status:
        clauses.append("a.status = %s")
        params.append(clean_text(status, 40))
    if country:
        clauses.append("a.country = %s")
        params.append(clean_text(country, 160))
    if tier:
        clauses.append("a.gtm_tier = %s")
        params.append(clean_text(tier, 20))
    if exclusion_status:
        clauses.append("a.exclusion_status = %s")
        params.append(clean_text(exclusion_status, 30))
    if domain:
        clauses.append("a.domain = %s")
        params.append(normalize_domain(domain))
    if q:
        term = f"%{clean_text(q, 300)}%"
        clauses.append("(a.name ILIKE %s OR a.domain ILIKE %s OR a.industry ILIKE %s OR a.country ILIKE %s OR a.primary_persona ILIKE %s)")
        params.extend([term, term, term, term, term])

    readiness_clause = ""
    if readiness == "ready":
        readiness_clause = " AND a.exclusion_status='eligible' AND a.status <> 'pushed' AND COALESCE(p.reachable_count,0) > 0"
    elif readiness == "needs_people":
        readiness_clause = " AND a.exclusion_status='eligible' AND COALESCE(p.people_count,0)=0"
    elif readiness == "search_only":
        readiness_clause = " AND a.exclusion_status='eligible' AND COALESCE(p.people_count,0)>0 AND COALESCE(p.enriched_count,0)=0"

    where = f"WHERE {' AND '.join(clauses)}"
    with usage_db() as connection:
        base_join = """
            FROM acquisition_accounts a
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS people_count,
                       COUNT(*) FILTER (WHERE enrichment_status='enriched') AS enriched_count,
                       COUNT(*) FILTER (WHERE enrichment_status='enriched' AND jsonb_array_length(phones)>0) AS phone_ready_count,
                       COUNT(*) FILTER (
                           WHERE enrichment_status='enriched'
                             AND (jsonb_array_length(emails)>0 OR jsonb_array_length(phones)>0)
                       ) AS reachable_count
                FROM acquisition_people ap WHERE ap.account_domain=a.domain
            ) p ON TRUE
            LEFT JOIN LATERAL (
                SELECT COUNT(*) AS push_count FROM acquisition_pushes x WHERE x.account_domain=a.domain
            ) push ON TRUE
        """
        count_row = connection.execute(
            f"SELECT COUNT(*) AS count {base_join} {where}{readiness_clause}",
            tuple(params),
        ).fetchone() or {}
        rows = connection.execute(
            f"""
            SELECT a.*,
                   COALESCE(p.people_count,0) AS people_count,
                   COALESCE(p.enriched_count,0) AS enriched_count,
                   COALESCE(p.phone_ready_count,0) AS phone_ready_count,
                   COALESCE(push.push_count,0) AS push_count
            {base_join}
            {where}{readiness_clause}
            ORDER BY
                CASE WHEN COALESCE(p.reachable_count,0)>0 THEN 1 ELSE 0 END DESC,
                a.gtm_score DESC, a.intent_score DESC, a.active_jobs DESC, a.name ASC
            LIMIT %s OFFSET %s
            """,
            (*params, limit, offset),
        ).fetchall()
        summary = global_summary(connection)
        countries = country_facets(connection)

    response.headers["Cache-Control"] = "private, no-store, max-age=0"
    return {
        "version": APP_EXTENSION_VERSION,
        "database": "postgresql",
        "generatedAt": int(time.time() * 1000),
        "summary": summary,
        "countries": countries,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "returned": len(rows),
            "filteredTotal": int(count_row.get("count") or 0),
        },
        "accounts": [account_json(row) for row in rows],
    }


@app.post("/v2/acquisition/reclassify")
def acquisition_reclassify_v2(response: Response) -> dict[str, Any]:
    """Zero-credit reclassification of already stored Apollo coverage rows."""
    initialize_usage_db()
    with usage_db() as connection:
        before = global_summary(connection)
        rows = connection.execute(
            """
            SELECT domain, hubspot_company_id, status, exclusion_status, exclusion_reason, evidence
            FROM acquisition_accounts
            WHERE source = %s
            """,
            (COVERAGE_SOURCE,),
        ).fetchall()
        changed = 0
        for row in rows:
            domain = str(row["domain"] or "")
            hubspot_id = str(row["hubspot_company_id"] or "")
            evidence = row.get("evidence") or {}
            guardrail = evidence.get("guardrail") if isinstance(evidence, dict) else None
            guardrail_status = str((guardrail or {}).get("status") or "") if isinstance(guardrail, dict) else ""
            guardrail_reason = str((guardrail or {}).get("reason") or "") if isinstance(guardrail, dict) else ""

            if hubspot_id:
                next_exclusion = "excluded"
                next_reason = "Already exists in HubSpot"
                next_status = "existing_hubspot"
            elif domain.endswith(".invalid"):
                next_exclusion = "review"
                next_reason = "Needs domain resolution before CRM push"
                next_status = "candidate"
            elif guardrail_status == "excluded":
                next_exclusion = "excluded"
                next_reason = guardrail_reason or "Excluded by acquisition guardrail"
                next_status = "excluded"
            elif guardrail_status == "review":
                next_exclusion = "review"
                next_reason = guardrail_reason or "Manual review required by acquisition guardrail"
                next_status = "candidate"
            else:
                next_exclusion = "eligible"
                next_reason = "In-scope Apollo GCC+Egypt coverage: target market and 251–50,000 employee range"
                next_status = "candidate" if row["status"] not in ("people_ready", "enriched", "pushed") else row["status"]

            next_evidence = dict(evidence) if isinstance(evidence, dict) else {}
            next_evidence["coverageEligibilityPolicy"] = "in_scope_market_size_default_eligible_v3"
            next_evidence["reclassifiedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if (
                row["exclusion_status"] != next_exclusion
                or row["exclusion_reason"] != next_reason
                or row["status"] != next_status
                or next_evidence != evidence
            ):
                connection.execute(
                    """
                    UPDATE acquisition_accounts
                    SET exclusion_status=%s, exclusion_reason=%s, status=%s, evidence=%s, updated_at=NOW()
                    WHERE domain=%s
                    """,
                    (next_exclusion, next_reason, next_status, Jsonb(next_evidence), domain),
                )
                changed += 1
        after = global_summary(connection)

    response.headers["Cache-Control"] = "no-store"
    return {
        "version": APP_EXTENSION_VERSION,
        "status": "reclassified",
        "providerCreditsUsed": {"apollo": 0, "signalHireContact": 0, "signalHireSearch": 0},
        "scanned": len(rows),
        "changed": changed,
        "before": before,
        "after": after,
    }
