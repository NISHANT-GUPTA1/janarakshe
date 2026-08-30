"""Phase 8 — Crime Intelligence findings layer.

The platform already runs the detection: K-means district profiling, year-over-year
z-score anomalies, Isolation Forest multi-dimensional outliers, RandomForest/SHAP
attribution, OLS forecasts, co-offending networks and the FIR-level cluster
detection in ``fir_workspace``. What it did not have was the step between a model
output and an officer doing something about it.

This module is that step. It reads every detection the pipeline already produced
and republishes it as a ranked list of **intelligence findings**, where each one
carries:

  * a headline in the officer's language — "Theft up 233% in Bengaluru Urban",
    not "cluster 2, silhouette 0.31",
  * an operational priority (the same CRITICAL/HIGH/WATCH/INFORMATION/RESOLVED
    scale the FIR workspace uses, so one colour means one thing platform-wide),
  * a **claim type** — observed / statistical / ml / prediction — because a
    forecast and a counted fact must never look alike,
  * the signals that produced it, the records that back it, and a confidence,
  * the method that found it, kept out of the headline and available under
    "technical details",
  * and the actions available next.

Nothing here re-runs a model or changes a number: every figure traces back to a
payload the existing pipeline wrote. Inputs: districts.json, district_detail.json,
trends.json, intel_patterns.json, ml_insights.json, intel_repeat_offenders.json,
fir_queue.json, fir_graph.json. Outputs: ci_overview.json, ci_districts.json,
ci_offenders.json.
"""
from __future__ import annotations

import datetime as dt
import json

from . import paths

# Operational priority scale, shared with fir_workspace so a colour means the
# same thing in both workspaces.
PRIORITY = ["CRITICAL", "HIGH", "WATCH", "INFORMATION", "RESOLVED"]

# How a finding was arrived at. The UI must never blur these together.
CLAIM = {
    "observed": "Counted from records",
    "statistical": "Statistical test on recorded data",
    "ml": "Machine-learning detection",
    "prediction": "Model projection — not an observed fact",
}

PERIODS = [("7d", "Last 7 days", 7), ("30d", "Last 30 days", 30),
           ("90d", "Last 90 days", 90)]

Z_CRITICAL = 2.5             # year-over-year z above which a spike is critical
ISO_CRITICAL = 0.85          # isolation-forest score above which an outlier is critical
NEW_LINK_DAYS = 30           # a co-offending link is "new this period" inside this


def _load(name: str):
    path = paths.API_DIR / name
    if not path.exists():
        raise FileNotFoundError(
            f"{name} not built — run `python -m pipeline.run` (and fir_workspace) first.")
    return json.loads(path.read_text(encoding="utf-8"))


def _conf_label(c: float) -> str:
    return "High" if c >= 0.8 else ("Medium" if c >= 0.55 else "Low")


def _pct(now: float, before: float):
    if not before:
        return None
    return round((now - before) / before * 100)


def _hour_window(hour: int) -> str:
    return f"{hour:02d}:00–{(hour + 4) % 24:02d}:00"


class Findings:
    """Accumulates findings and keeps their ids stable and ordered."""

    def __init__(self):
        self.items: list[dict] = []

    def add(self, *, kind, priority, claim_type, headline, summary, where, metrics,
            signals, confidence, method, records, actions, when=None, cluster_id=None):
        self.items.append({
            "finding_id": "", "kind": kind, "priority": priority,
            "claim_type": claim_type, "claim_label": CLAIM[claim_type],
            "headline": headline, "summary": summary, "where": where,
            "when": when or {}, "metrics": metrics, "signals": signals,
            "confidence": round(confidence, 2), "confidence_label": _conf_label(confidence),
            "method": method, "records": records, "actions": actions,
            "cluster_id": cluster_id,
        })

    def finalise(self):
        self.items.sort(key=lambda f: (PRIORITY.index(f["priority"]), -f["confidence"]))
        for i, f in enumerate(self.items, 1):
            f["finding_id"] = f"INT-{i:03d}"
        return self.items


# --------------------------------------------------------------------------- #
# 1. Emerging clusters, from the FIR record layer.
#    These are the sharpest findings the platform has: real records, a named
#    locality, a measured window and a measured baseline.
# --------------------------------------------------------------------------- #
def _cluster_findings(queue, fnd):
    rows = {r["fir_id"]: r for r in queue["rows"]}
    for cl in queue["patterns"]:
        cases = [rows[c] for c in cl["cases"] if c in rows]
        change = cl["change_pct"]
        offence = cl["tier"] == "offence"
        if cl["case_count"] >= 6 or (change is not None and change >= 100):
            priority = "CRITICAL"
        elif offence:
            priority = "HIGH"
        else:
            priority = "WATCH"

        change_txt = (f"up {change}% on the previous {cl['window_days']} days"
                      if change is not None else
                      f"none in the previous {cl['window_days']} days")
        headline = (f"{cl['crime_type']} up {change}% in {cl['district']}"
                    if change is not None else
                    f"{cl['case_count']} {cl['crime_type'].lower()} FIRs in {cl['district']}, "
                    f"none the period before")

        signals = ["Same offence type across all incidents",
                   f"Concentrated around {cl['area']}",
                   f"All within a {cl['window_days']}-day window",
                   f"Rise above the preceding {cl['window_days']}-day baseline"]
        if len({c["station"] for c in cases}) == 1:
            signals.append("Single police-station jurisdiction")
        hours = [int(c["occurred_at"][11:13]) for c in cases]
        if max(hours) - min(hours) <= 5:
            signals.append(f"Offence times cluster in {_hour_window(min(hours))}")

        fnd.add(
            kind="emerging_cluster", priority=priority, claim_type="statistical",
            headline=headline,
            summary=(f"{cl['case_count']} {cl['crime_type'].lower()} FIRs registered in "
                     f"{cl['district']} over {cl['window_days']} days, {change_txt}. "
                     f"Concentrated around {cl['area']}."),
            where={"district": cl["district"], "area": cl["area"],
                   "lat": round(sum(c["lat"] for c in cases) / len(cases), 5) if cases else None,
                   "lon": round(sum(c["lon"] for c in cases) / len(cases), 5) if cases else None},
            when={"window_days": cl["window_days"], "peak_hour": cl["peak_hour"],
                  "peak_window": _hour_window(cl["peak_hour"])},
            metrics=[
                {"label": "Incidents", "value": cl["case_count"]},
                {"label": "Previous period", "value": cl["baseline"]},
                {"label": "Change", "value": (f"+{change}%" if change is not None else "new"),
                 "tone": "up"},
                {"label": "Peak time", "value": _hour_window(cl["peak_hour"])},
            ],
            signals=signals, confidence=cl["confidence"],
            method={"name": "Rolling-window rate comparison",
                    "detail": (f"FIRs bucketed by district and "
                               f"{'offence type' if offence else 'crime head'}, then the last "
                               f"{cl['window_days']} days compared against the "
                               f"{cl['window_days']} days before them."),
                    "source": "FIR records (fir_workspace)",
                    "caveat": ("A rise in registrations is a deployment signal. It can also "
                               "reflect a change in reporting or a drive, so confirm against "
                               "the case files before acting on it.")},
            records={"firs": cl["cases"][:14], "districts": [cl["district"]],
                     "stations": sorted({c["station"] for c in cases})},
            actions=[
                {"label": "Investigate Pattern", "kind": "open_pattern", "target": cl["cluster_id"]},
                {"label": "View Related FIRs", "kind": "open_firs", "target": cl["cluster_id"]},
                {"label": "View on Map", "kind": "open_map", "target": cl["district"]},
                {"label": "Generate Intelligence Brief", "kind": "brief", "target": cl["cluster_id"]},
            ],
            cluster_id=cl["cluster_id"],
        )


# --------------------------------------------------------------------------- #
# 2. Year-over-year spikes, from the existing z-score anomaly detector.
# --------------------------------------------------------------------------- #
def _spike_findings(patterns, detail, fnd):
    for a in patterns["anomalies"]:
        d = detail.get(a["geo_unit_id"])
        if not d:
            continue
        others = [t["total"] for t in d["trend"] if t["year"] != a["year"]]
        expected = round(sum(others) / len(others)) if others else a["cases"]
        change = _pct(a["cases"], expected)
        spike = a["direction"] == "spike"
        z = abs(a["zscore"])
        if not spike:
            priority = "INFORMATION"
        elif z >= Z_CRITICAL:
            priority = "CRITICAL"
        elif z >= 2.0:
            priority = "HIGH"
        else:
            priority = "WATCH"

        top = sorted(d["breakdown"], key=lambda b: -b["cases"])[:3]
        latest = a["year"] == d["year"]
        signals = [
            f"Observed {a['cases']:,} cases against a {len(others)}-year mean of {expected:,}",
            f"{z:.2f} standard deviations from this district's own history",
            f"Direction: {a['direction']}",
        ]
        if latest:
            signals.append("Falls in the latest reported year")

        fnd.add(
            kind="crime_spike", priority=priority, claim_type="statistical",
            headline=(f"{a['name']} recorded {change:+}% against its own baseline in {a['year']}"
                      if change is not None else f"{a['name']} anomaly in {a['year']}"),
            summary=(f"{a['name']} registered {a['cases']:,} cognizable cases in {a['year']} "
                     f"against an expected {expected:,} from its own {len(others)}-year record — "
                     f"a {z:.2f}σ {a['direction']}."),
            where={"district": a["name"], "geo_unit_id": a["geo_unit_id"],
                   "lat": None, "lon": None},
            when={"year": a["year"]},
            metrics=[
                {"label": "Observed", "value": f"{a['cases']:,}"},
                {"label": "Expected", "value": f"{expected:,}"},
                {"label": "Deviation", "value": (f"{change:+}%" if change is not None else "—"),
                 "tone": "up" if spike else "down"},
                {"label": "Anomaly score", "value": f"{z:.2f}σ"},
            ],
            signals=signals,
            confidence=min(0.5 + z * 0.12, 0.93),
            method={"name": "Year-over-year z-score",
                    "detail": ("Each district's annual cognizable-case total is standardised "
                               "against its own 2001–2013 series; |z| ≥ 1.8 is reported."),
                    "source": "NCRB district IPC totals (real)",
                    "caveat": ("Recorded crime reflects reporting and registration practice as "
                               "well as offending. A spike can follow a registration drive.")},
            records={"districts": [a["name"]], "geo_unit_ids": [a["geo_unit_id"]],
                     "categories": [t["category_code"] for t in top] if latest else []},
            actions=[
                {"label": "View District", "kind": "open_district", "target": a["geo_unit_id"]},
                {"label": "View Supporting Data", "kind": "open_evidence", "target": a["geo_unit_id"]},
                {"label": "Export Report", "kind": "export", "target": a["geo_unit_id"]},
            ],
        )


# --------------------------------------------------------------------------- #
# 3. Multi-dimensional outliers and prediction gaps, from the Phase-6 ML layer.
# --------------------------------------------------------------------------- #
def _ml_findings(ml, districts, fnd):
    by_name = {d["name"]: d for d in districts}
    features = ml["model_meta"]["features_used"]

    for a in ml["isolation_anomalies"]:
        if not a.get("is_anomaly"):
            continue
        score = a["anomaly_score"]
        d = by_name.get(a["name"], {})
        priority = "HIGH" if score >= ISO_CRITICAL else "WATCH"
        fnd.add(
            kind="unusual_pattern", priority=priority, claim_type="ml",
            headline=f"{a['name']} does not fit any district profile",
            summary=(f"Across {len(features)} crime and socio-economic dimensions, {a['name']} "
                     "sits outside the pattern the other districts form. That is a prompt to "
                     "look, not a finding about crime by itself."),
            where={"district": a["name"], "geo_unit_id": a["geo_unit_id"],
                   "lat": (d.get("centroid") or {}).get("lat"),
                   "lon": (d.get("centroid") or {}).get("lon")},
            metrics=[
                {"label": "Outlier score", "value": f"{score:.2f}"},
                {"label": "Dimensions", "value": len(features)},
                {"label": "Crime rate", "value": f"{d.get('crime_rate_per_100k', '—')}/100k"},
                {"label": "Risk band", "value": d.get("risk_band", "—")},
            ],
            signals=["Flagged against all districts simultaneously, not one metric at a time",
                     f"Assessed on {len(features)} features including "
                     f"{', '.join(features[:3])}",
                     "Isolation Forest contamination set to "
                     f"{ml['model_meta']['isolation_forest_contamination']}"],
            confidence=round(min(0.45 + score * 0.4, 0.85), 2),
            method={"name": "Isolation Forest (multi-dimensional outlier detection)",
                    "detail": ("An unsupervised model that scores how few splits it takes to "
                               "isolate a district in the full feature space."),
                    "source": "NCRB crime + Census 2011 socio-economic indicators",
                    "caveat": ("Being unusual is not being criminal. This flags districts whose "
                               "combination of indicators is uncommon and warrants a look.")},
            records={"districts": [a["name"]], "geo_unit_ids": [a["geo_unit_id"]]},
            actions=[
                {"label": "View District", "kind": "open_district", "target": a["geo_unit_id"]},
                {"label": "View Supporting Data", "kind": "open_evidence", "target": a["geo_unit_id"]},
            ],
        )

    # districts the model badly under-predicts — crime above what the socio-economic
    # picture accounts for. Reported as a model gap, never as an explanation.
    gaps = sorted(ml["shap_insights"], key=lambda s: s["prediction_error"])[:4]
    for s in gaps:
        if s["prediction_error"] > -60:
            continue
        d = by_name.get(s["name"], {})
        fnd.add(
            kind="unusual_pattern", priority="WATCH", claim_type="ml",
            headline=(f"{s['name']} records {abs(round(s['prediction_error']))} more cases per "
                      "100k than its profile accounts for"),
            summary=(f"The model predicts {s['predicted_rate']}/100k for {s['name']} from its "
                     f"socio-economic profile; the recorded rate is {s['actual_rate']}/100k. "
                     "The gap is what the model cannot explain — local factors, or local "
                     "registration practice."),
            where={"district": s["name"], "geo_unit_id": s["geo_unit_id"],
                   "lat": (d.get("centroid") or {}).get("lat"),
                   "lon": (d.get("centroid") or {}).get("lon")},
            metrics=[
                {"label": "Recorded", "value": f"{s['actual_rate']}/100k"},
                {"label": "Model expects", "value": f"{s['predicted_rate']}/100k"},
                {"label": "Unexplained gap", "value": f"{abs(round(s['prediction_error']))}/100k",
                 "tone": "up"},
            ],
            signals=["Recorded rate exceeds the socio-economic model's expectation",
                     "Gap computed per district on the latest reported year",
                     f"Model out-of-bag R² is {ml['model_meta']['rf_oob_r2']} — weak, so read "
                     "the gap as a prompt, not a measurement"],
            confidence=0.45,
            method={"name": "RandomForest regression + SHAP attribution",
                    "detail": ("Crime rate regressed on socio-economic indicators; the residual "
                               "is the part the indicators do not account for."),
                    "source": "NCRB crime + Census 2011",
                    "caveat": ("Low model fit (OOB R² "
                               f"{ml['model_meta']['rf_oob_r2']}). Socio-economic indicators do "
                               "not explain crime well, which is itself the finding. Never read "
                               "this as a community-level risk factor.")},
            records={"districts": [s["name"]], "geo_unit_ids": [s["geo_unit_id"]]},
            actions=[{"label": "View District", "kind": "open_district", "target": s["geo_unit_id"]}],
        )


# --------------------------------------------------------------------------- #
# 4. Forecasts — kept visibly separate from everything counted or measured.
# --------------------------------------------------------------------------- #
def _forecast_findings(ml, fnd):
    rising = [f for f in ml["forecasts"] if f["trend"] == "rising" and f["r2"] >= 0.25]
    rising.sort(key=lambda f: -f["slope_per_year"])
    for f in rising[:5]:
        fnd.add(
            kind="forecast", priority="INFORMATION", claim_type="prediction",
            headline=(f"{f['name']} is trending up by ~{round(f['slope_per_year']):,} "
                      "cases a year"),
            summary=(f"A linear fit over the district's series projects {f['forecast_cases']:,} "
                     f"cases for {f['forecast_year']} (range {f['ci_low']:,}–{f['ci_high']:,}). "
                     "This is a projection from past totals, not a measurement of anything "
                     "that has happened."),
            where={"district": f["name"], "geo_unit_id": f["geo_unit_id"],
                   "lat": None, "lon": None},
            when={"year": f["forecast_year"]},
            metrics=[
                {"label": "Projected", "value": f"{f['forecast_cases']:,}"},
                {"label": "Range", "value": f"{f['ci_low']:,}–{f['ci_high']:,}"},
                {"label": "Slope", "value": f"+{round(f['slope_per_year']):,}/yr", "tone": "up"},
                {"label": "Fit (R²)", "value": f["r2"]},
            ],
            signals=[f"Trend fitted across the district's full reported series",
                     f"R² {f['r2']} — {'moderate' if f['r2'] >= 0.5 else 'weak'} fit",
                     "Confidence interval spans "
                     f"{f['ci_high'] - f['ci_low']:,} cases"],
            confidence=round(min(0.3 + f["r2"] * 0.5, 0.7), 2),
            method={"name": "Ordinary least squares trend projection",
                    "detail": "Linear regression of annual totals on year, extended one year.",
                    "source": "NCRB district IPC totals",
                    "caveat": ("A projection, not a fact and not a plan. It assumes the past "
                               "trend continues and takes no account of policing changes.")},
            records={"districts": [f["name"]], "geo_unit_ids": [f["geo_unit_id"]]},
            actions=[{"label": "View District", "kind": "open_district", "target": f["geo_unit_id"]}],
        )


# --------------------------------------------------------------------------- #
# 5. Offender-network findings: links that formed inside the current period.
# --------------------------------------------------------------------------- #
def _network_findings(queue, graph, as_of, fnd):
    rows = {r["fir_id"]: r for r in queue["rows"]}
    persons = {n["id"]: n for n in graph["nodes"] if n["kind"] == "person"}
    person_firs: dict[str, list] = {}
    fir_persons: dict[str, list] = {}
    for e in graph["edges"]:
        if e["kind"] != "named_in":
            continue
        person_firs.setdefault(e["source"], []).append(e["target"])
        fir_persons.setdefault(e["target"], []).append(e["source"])

    cut = as_of - dt.timedelta(days=NEW_LINK_DAYS)

    def when(fir_id):
        r = rows.get(fir_id)
        return dt.date.fromisoformat(r["occurred_at"][:10]) if r else None

    # a co-offending pair whose *only* shared case is recent = a new association
    new_pairs = []
    for fir_id, crew in fir_persons.items():
        d = when(fir_id)
        if not d or d <= cut or len(crew) < 2:
            continue
        for i in range(len(crew)):
            for j in range(i + 1, len(crew)):
                a, b = sorted((crew[i], crew[j]))
                shared = set(person_firs[a]) & set(person_firs[b])
                if len(shared) == 1:
                    new_pairs.append((a, b, fir_id))

    for a, b, fir_id in sorted(new_pairs)[:8]:
        r = rows[fir_id]
        pa, pb = persons[a], persons[b]
        fnd.add(
            kind="network_link", priority="HIGH", claim_type="observed",
            headline=f"{pa['label']} and {pb['label']} newly linked on {r['fir_no']}",
            summary=(f"The two are named together on {r['fir_no']} ({r['crime_type']}, "
                     f"{r['occurred_at'][:10]}) and on no earlier case. Between them they "
                     f"account for {len(person_firs[a]) + len(person_firs[b]) - 1} FIRs."),
            where={"district": r["district"], "area": r["location"],
                   "lat": None, "lon": None},
            when={"since_days": NEW_LINK_DAYS},
            metrics=[
                {"label": pa["label"], "value": f"{len(person_firs[a])} FIRs"},
                {"label": pb["label"], "value": f"{len(person_firs[b])} FIRs"},
                {"label": "Shared cases", "value": 1},
                {"label": "Registered", "value": r["occurred_at"][:10]},
            ],
            signals=["Both named as accused on the same FIR",
                     f"No earlier case names them together",
                     f"Association formed within the last {NEW_LINK_DAYS} days"],
            confidence=0.8,
            method={"name": "Co-accused adjacency",
                    "detail": ("Two people are linked when they are named as accused on the "
                               "same FIR. A link is 'new' when their only shared case is recent."),
                    "source": "FIR accused records",
                    "caveat": ("Being named together on one FIR establishes an association on "
                               "record, not membership of a group and not guilt.")},
            records={"firs": [fir_id], "persons": [a, b], "districts": [r["district"]]},
            actions=[
                {"label": "View Network", "kind": "open_graph", "target": a},
                {"label": "Open FIR", "kind": "open_case", "target": fir_id},
                {"label": "View Profile", "kind": "open_person", "target": a},
            ],
        )

    # people whose caseload is concentrated in the current period
    active = []
    for pid, firs in person_firs.items():
        recent = [f for f in firs if (when(f) or dt.date.min) > cut]
        if len(firs) >= 4 and len(recent) >= 2:
            active.append((pid, firs, recent))
    active.sort(key=lambda t: (-len(t[2]), -len(t[1])))
    for pid, firs, recent in active[:6]:
        p = persons[pid]
        types = sorted({rows[f]["crime_type"] for f in firs if f in rows})
        stations = sorted({rows[f]["station"] for f in firs if f in rows})
        fnd.add(
            kind="repeat_offender", priority="HIGH", claim_type="observed",
            headline=f"{p['label']} named on {len(recent)} FIRs in the last {NEW_LINK_DAYS} days",
            summary=(f"{p['label']} is named as accused on {len(firs)} FIRs in total, across "
                     f"{len(types)} offence type(s) and {len(stations)} station(s). "
                     f"{len(recent)} of those fall inside the current period."),
            where={"district": p.get("district"), "lat": None, "lon": None},
            when={"since_days": NEW_LINK_DAYS},
            metrics=[
                {"label": "Linked cases", "value": len(firs)},
                {"label": "This period", "value": len(recent), "tone": "up"},
                {"label": "Crime types", "value": len(types)},
                {"label": "Jurisdictions", "value": len(stations)},
            ],
            signals=[f"Named on {len(firs)} FIRs on record",
                     f"Offending crosses {len(stations)} police station(s)",
                     f"Offence types: {', '.join(types[:4])}"],
            confidence=round(min(0.6 + 0.05 * len(firs), 0.9), 2),
            method={"name": "Repeat-offender aggregation",
                    "detail": "Accused identities counted across FIRs, filtered to the period.",
                    "source": "FIR accused records",
                    "caveat": ("Counts FIRs a person is named on. Being named is not a "
                               "conviction, and cases may still be under investigation.")},
            records={"firs": recent[:6], "persons": [pid],
                     "districts": [p.get("district")] if p.get("district") else []},
            actions=[
                {"label": "View Profile", "kind": "open_person", "target": pid},
                {"label": "View Network", "kind": "open_graph", "target": pid},
                {"label": "View Related FIRs", "kind": "open_firs", "target": pid},
            ],
        )


# --------------------------------------------------------------------------- #
# 6. Crime profiles — the K-means district clustering, stated as what it means.
#    The algorithm's name belongs in "technical details", not in the heading an
#    officer reads first.
# --------------------------------------------------------------------------- #
GROUP_LABEL = {
    "VIOLENT": "Violent crime", "WOMEN": "Crime against women",
    "CHILDREN": "Crime against children", "PROPERTY": "Property crime",
    "SCST": "Crime against SC/ST", "ECONOMIC": "Economic & financial crime",
    "CYBER": "Cyber crime", "PUBLIC_ORDER": "Public order",
    "NARCOTICS": "Drugs & narcotics", "OTHER_SLL": "Special & local laws",
}


def _profiles(patterns, ml, districts):
    by_name = {d["name"]: d for d in districts}
    ml_clusters = {c["cluster"]: c for c in ml["clusters"]}
    out = []
    for c in patterns["clusters"]:
        names = c.get("districts", [])
        members = [by_name[n] for n in names if n in by_name]
        groups = [GROUP_LABEL.get(g, g.title()) for g in c.get("dominant_groups", [])]
        rates = [m["crime_rate_per_100k"] for m in members]
        bands: dict[str, int] = {}
        for m in members:
            bands[m["risk_band"]] = bands.get(m["risk_band"], 0) + 1
        mlc = ml_clusters.get(c["cluster"], {})
        out.append({
            "profile_id": f"PRF-{c['cluster'] + 1}",
            "label": " + ".join(groups) if groups else "Mixed crime profile",
            "size": c["size"], "districts": names,
            "characteristics": [f"Elevated {g.lower()}" for g in groups]
                               + ["Similar crime-type distribution across the group"],
            "avg_rate": round(sum(rates) / len(rates)) if rates else None,
            "rate_range": [round(min(rates)), round(max(rates))] if rates else None,
            "risk_bands": [{"band": b, "count": n} for b, n in
                           sorted(bands.items(), key=lambda x: -x[1])],
            "model_confidence": mlc.get("avg_confidence"),
        })
    out.sort(key=lambda p: -p["size"])
    return {
        "profiles": out,
        "method": {
            "name": "K-means clustering on crime-type signature",
            "detail": ("Districts are described by the share of each crime group in their "
                       "recorded caseload, then grouped so that districts in a group look "
                       f"more like each other than like the rest. k = {ml['model_meta']['kmeans_k']}."),
            "quality": {
                "silhouette": ml["model_meta"]["kmeans_silhouette_score"],
                "reading": ("Silhouette "
                            f"{ml['model_meta']['kmeans_silhouette_score']} — the groups overlap "
                            "considerably. Treat them as a rough grouping for comparison, not "
                            "as hard categories."),
                "features": ml["model_meta"]["n_features"],
                "districts": ml["model_meta"]["n_districts"],
                "pca_variance": ml["model_meta"]["pca_cumulative_variance_explained"],
            },
            "source": "NCRB district IPC caseload composition",
            "caveat": ("A profile describes recorded caseload composition. It says nothing "
                       "about the people who live in a district."),
        },
    }


# --------------------------------------------------------------------------- #
# 7. Period comparison — the headline is the change, the chart is the evidence.
# --------------------------------------------------------------------------- #
def _period_changes(queue, as_of):
    rows = queue["rows"]
    dated = [(dt.date.fromisoformat(r["occurred_at"][:10]), r) for r in rows]
    out = []
    for key, label, days in PERIODS:
        cur_from = as_of - dt.timedelta(days=days)
        prev_from = as_of - dt.timedelta(days=days * 2)
        cur = [r for d, r in dated if d > cur_from]
        prev = [r for d, r in dated if prev_from < d <= cur_from]

        def tally(rs):
            agg: dict[str, int] = {}
            for r in rs:
                if r["crime_type"] == "Other":
                    continue
                agg[r["crime_type"]] = agg.get(r["crime_type"], 0) + 1
            return agg

        c, p = tally(cur), tally(prev)
        changes = []
        for name in sorted(set(c) | set(p)):
            now, before = c.get(name, 0), p.get(name, 0)
            if now + before < 3:
                continue
            changes.append({
                "crime_type": name, "current": now, "previous": before,
                "change_pct": _pct(now, before),
                "direction": "up" if now > before else ("down" if now < before else "flat"),
            })
        changes.sort(key=lambda x: -(x["change_pct"] if x["change_pct"] is not None else 999))
        out.append({
            "key": key, "label": label, "days": days,
            "total": len(cur), "previous_total": len(prev),
            "change_pct": _pct(len(cur), len(prev)),
            "by_crime_type": changes,
        })
    return out


# --------------------------------------------------------------------------- #
# 8. District intelligence drill-down: STATE -> DISTRICT -> STATION -> AREA.
# --------------------------------------------------------------------------- #
def _district_intel(districts, detail, queue, findings, as_of):
    rows = queue["rows"]
    by_district: dict[str, list] = {}
    for r in rows:
        by_district.setdefault(r["district"], []).append(r)

    cut30 = as_of - dt.timedelta(days=30)
    cut60 = as_of - dt.timedelta(days=60)
    out = {}
    for d in districts:
        name = d["name"]
        det = detail.get(d["geo_unit_id"], {})
        drows = by_district.get(name, [])
        dated = [(dt.date.fromisoformat(r["occurred_at"][:10]), r) for r in drows]
        cur = [r for dd, r in dated if dd > cut30]
        prev = [r for dd, r in dated if cut60 < dd <= cut30]

        def tally(rs):
            agg: dict[str, int] = {}
            for r in rs:
                if r["crime_type"] == "Other":
                    continue
                agg[r["crime_type"]] = agg.get(r["crime_type"], 0) + 1
            return agg

        c, p = tally(cur), tally(prev)
        top_types = sorted(c.items(), key=lambda x: -x[1])[:6]

        areas: dict[str, dict] = {}
        for r in drows:
            a = areas.setdefault(r["location"], {"area": r["location"], "cases": 0,
                                                 "recent": 0, "types": {}})
            a["cases"] += 1
            a["types"][r["crime_type"]] = a["types"].get(r["crime_type"], 0) + 1
        for dd, r in dated:
            if dd > cut30:
                areas[r["location"]]["recent"] += 1
        hotspots = sorted(areas.values(), key=lambda a: (-a["recent"], -a["cases"]))[:5]
        for h in hotspots:
            h["top_type"] = max(h["types"], key=h["types"].get) if h["types"] else "—"
            h.pop("types")

        stations: dict[str, dict] = {}
        for r in drows:
            s = stations.setdefault(r["station"], {"station": r["station"],
                                                   "unit_id": r["unit_id"], "cases": 0,
                                                   "open": 0, "critical": 0})
            s["cases"] += 1
            s["open"] += 1 if r["status"] == "Under Investigation" else 0
            s["critical"] += 1 if r["priority"] == "CRITICAL" else 0

        mine = [f for f in findings
                if name in (f["records"].get("districts") or [])
                or f["where"].get("district") == name]
        trend = det.get("trend", [])
        yoy = _pct(trend[-1]["total"], trend[-2]["total"]) if len(trend) >= 2 else None

        out[d["geo_unit_id"]] = {
            "geo_unit_id": d["geo_unit_id"], "name": name,
            "risk_band": d["risk_band"], "risk_score": d["risk_score"],
            "hotspot_status": d["hotspot_status"],
            "crime_rate_per_100k": d["crime_rate_per_100k"],
            "total_cognizable_cases": d["total_cognizable_cases"],
            "centroid": d.get("centroid"),
            "yoy_change_pct": yoy,
            "period": {"days": 30, "current": len(cur), "previous": len(prev),
                       "change_pct": _pct(len(cur), len(prev))},
            "top_crime_types": [{"crime_type": t, "current": n, "previous": p.get(t, 0),
                                 "change_pct": _pct(n, p.get(t, 0))} for t, n in top_types],
            "hotspot_areas": hotspots,
            "stations": sorted(stations.values(), key=lambda s: -s["cases"])[:8],
            "findings": [f["finding_id"] for f in mine],
            "finding_counts": {
                b: sum(1 for f in mine if f["priority"] == b) for b in PRIORITY
            },
            "open_cases": sum(1 for r in drows if r["status"] == "Under Investigation"),
            "critical_cases": sum(1 for r in drows if r["priority"] == "CRITICAL"),
            "trend": trend,
            "breakdown": sorted(det.get("breakdown", []), key=lambda b: -b["cases"])[:8],
            "risk_components": (det.get("risk") or {}).get("components", []),
        }
    return out


# --------------------------------------------------------------------------- #
# 9. Repeat-offender intelligence, framed for investigation rather than ranking.
# --------------------------------------------------------------------------- #
def _offender_intel(queue, graph, as_of):
    rows = {r["fir_id"]: r for r in queue["rows"]}
    persons = {n["id"]: n for n in graph["nodes"] if n["kind"] == "person"}
    person_firs: dict[str, list] = {}
    fir_persons: dict[str, list] = {}
    person_vehicles: dict[str, set] = {}
    for e in graph["edges"]:
        if e["kind"] == "named_in":
            person_firs.setdefault(e["source"], []).append(e["target"])
            fir_persons.setdefault(e["target"], []).append(e["source"])
    fir_vehicles: dict[str, list] = {}
    for e in graph["edges"]:
        if e["kind"] == "recorded_on":
            fir_vehicles.setdefault(e["target"], []).append(e["source"])
    for pid, firs in person_firs.items():
        person_vehicles[pid] = {v for f in firs for v in fir_vehicles.get(f, [])}

    cut = as_of - dt.timedelta(days=NEW_LINK_DAYS)
    out = []
    for pid, firs in person_firs.items():
        if len(firs) < 2:
            continue
        rs = [rows[f] for f in firs if f in rows]
        if not rs:
            continue
        dates = sorted(dt.date.fromisoformat(r["occurred_at"][:10]) for r in rs)
        associates = {p for f in firs for p in fir_persons.get(f, []) if p != pid}
        new_assoc = {p for f in firs
                     if f in rows and dt.date.fromisoformat(rows[f]["occurred_at"][:10]) > cut
                     for p in fir_persons.get(f, []) if p != pid}
        types = sorted({r["crime_type"] for r in rs})
        locations = sorted({r["location"] for r in rs})
        stations = sorted({r["station"] for r in rs})
        out.append({
            "person_id": pid, "name": persons[pid]["label"],
            "district": persons[pid].get("district"),
            "linked_cases": len(firs), "crime_types": len(types), "type_list": types[:5],
            "locations": len(locations), "location_list": locations[:4],
            "associates": len(associates), "new_associates": len(new_assoc),
            "jurisdictions": len(stations),
            "first_seen": dates[0].isoformat(), "last_seen": dates[-1].isoformat(),
            "days_since_last": (as_of - dates[-1]).days,
            "active_this_period": sum(1 for d in dates if d > cut),
            "vehicles": len(person_vehicles.get(pid, set())),
            "open_cases": sum(1 for r in rs if r["status"] == "Under Investigation"),
            "cases": [r["fir_id"] for r in sorted(rs, key=lambda x: x["occurred_at"],
                                                  reverse=True)[:8]],
        })
    out.sort(key=lambda o: (-o["active_this_period"], -o["linked_cases"], -o["associates"]))
    total = len(persons)
    return {
        "total_offenders": total,
        "repeat_offenders": len(out),
        "repeat_ratio": round(len(out) / total, 3) if total else 0,
        "newly_connected": sum(1 for o in out if o["new_associates"]),
        "active_this_period": sum(1 for o in out if o["active_this_period"]),
        "period_days": NEW_LINK_DAYS,
        "offenders": out[:60],
    }


# --------------------------------------------------------------------------- #
def run() -> dict:
    paths.ensure_dirs()
    districts = _load("districts.json")
    detail = _load("district_detail.json")
    trends = _load("trends.json")
    patterns = _load("intel_patterns.json")
    ml = _load("ml_insights.json")
    queue = _load("fir_queue.json")
    graph = _load("fir_graph.json")

    as_of = dt.date.fromisoformat(queue["as_of"])

    fnd = Findings()
    _cluster_findings(queue, fnd)
    _spike_findings(patterns, detail, fnd)
    _ml_findings(ml, districts, fnd)
    _forecast_findings(ml, fnd)
    _network_findings(queue, graph, as_of, fnd)
    findings = fnd.finalise()

    profiles = _profiles(patterns, ml, districts)
    periods = _period_changes(queue, as_of)
    district_intel = _district_intel(districts, detail, queue, findings, as_of)
    offenders = _offender_intel(queue, graph, as_of)

    def count(pred):
        return sum(1 for f in findings if pred(f))

    overview = {
        "data_note": (
            "Crime Intelligence findings are republished from detections the pipeline "
            "already ran. District crime figures and the anomaly, clustering, forecast "
            "and attribution models run on REAL NCRB + Census 2011 data. FIR-level "
            "clusters, offender links and vehicles come from the SYNTHETIC "
            "schema-shaped FIR record set (see fir_workspace)."
        ),
        "as_of": queue["as_of"],
        "latest_year": patterns["latest_year"],
        "what_changed": [
            {"key": "emerging_cluster", "label": "Emerging hotspots",
             "count": count(lambda f: f["kind"] == "emerging_cluster"),
             "priority": "CRITICAL"},
            {"key": "crime_spike", "label": "Significant crime spikes",
             "count": count(lambda f: f["kind"] == "crime_spike"),
             "priority": "HIGH"},
            {"key": "unusual_pattern", "label": "Unusual patterns",
             "count": count(lambda f: f["kind"] == "unusual_pattern"),
             "priority": "WATCH"},
            {"key": "network_link", "label": "New offender connections",
             "count": count(lambda f: f["kind"] == "network_link"),
             "priority": "HIGH"},
            {"key": "repeat_offender", "label": "Offenders active this period",
             "count": count(lambda f: f["kind"] == "repeat_offender"),
             "priority": "HIGH"},
            {"key": "forecast", "label": "Districts projected to rise",
             "count": count(lambda f: f["kind"] == "forecast"),
             "priority": "INFORMATION"},
        ],
        "priority_counts": [{"priority": b, "count": count(lambda f, b=b: f["priority"] == b)}
                            for b in PRIORITY],
        "claim_types": CLAIM,
        "findings": findings,
        "profiles": profiles,
        "periods": periods,
        "state_trend": trends["series"],
        "facets": {
            "districts": sorted({d["name"] for d in districts}),
            "crime_types": sorted({r["crime_type"] for r in queue["rows"]
                                   if r["crime_type"] != "Other"}),
            "stations": sorted({r["station"] for r in queue["rows"]}),
            "kinds": sorted({f["kind"] for f in findings}),
            "priorities": PRIORITY,
        },
        "model_meta": ml["model_meta"],
    }

    api = paths.API_DIR
    out = {
        "ci_overview.json": overview,
        "ci_districts.json": {"as_of": queue["as_of"], "districts": district_intel},
        "ci_offenders.json": {"as_of": queue["as_of"],
                              "data_note": ("SYNTHETIC person-level records — no open "
                                            "person-level crime data exists."),
                              **offenders},
    }
    for fname, payload in out.items():
        (api / fname).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    return {
        "findings": len(findings),
        "critical": count(lambda f: f["priority"] == "CRITICAL"),
        "high": count(lambda f: f["priority"] == "HIGH"),
        "watch": count(lambda f: f["priority"] == "WATCH"),
        "clusters": count(lambda f: f["kind"] == "emerging_cluster"),
        "spikes": count(lambda f: f["kind"] == "crime_spike"),
        "unusual": count(lambda f: f["kind"] == "unusual_pattern"),
        "forecasts": count(lambda f: f["kind"] == "forecast"),
        "network": count(lambda f: f["kind"] in ("network_link", "repeat_offender")),
        "profiles": len(profiles["profiles"]),
        "districts": len(district_intel),
        "repeat_offenders": offenders["repeat_offenders"],
    }


if __name__ == "__main__":
    import pprint
    pprint.pp(run())
