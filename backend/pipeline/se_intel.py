"""Phase 8 — Socio-economic intelligence, restated for an operational reader.

The correlation work itself is unchanged and stays where it is: ``socioeconomic``
computes Pearson and Spearman coefficients, p-values, strength bands and a
hypothesis check across every indicator x every crime group, and that full matrix
is still published. What was missing was everything between the coefficient and
a decision.

This module builds that layer:

  * a **district profile** — each indicator placed against the other 29 districts
    as a percentile and a plain band ("High", "Above average"), plus its ratio to
    the state figure, so nobody has to do the division,
  * a **crime profile** on the same footing, so the two can be read side by side,
  * **what stands out** — the handful of associations that actually carry signal,
    each with a headline, what it means in plain words, what it cannot be used
    for, and the district scatter behind it,
  * **similar districts** — nearest neighbours in socio-economic space, whose
    value is precisely that their crime patterns often differ,
  * and the full matrix, r, p and methodology, preserved for the analyst view.

Two deliberate changes of language. "Confirms theory / contradicts theory" is an
academic verdict about a criminological hypothesis, not an operational finding;
it becomes "matches / differs from the expected relationship" and moves out of
the primary reading. And protected attributes (SC/ST share, sex ratio) are kept
out of the headline findings entirely — they remain in the analyst matrix with
their existing ethics flag, because dropping them silently would hide a real
limitation of the dataset, but they must not head a page an officer reads fast.

Output: se_intel.json
"""
from __future__ import annotations

import json
import math

from . import contracts, paths, socioeconomic

# Indicators the officer view must never lead with. They stay in the analyst
# matrix (flagged), where their limitations are stated alongside them.
PROTECTED = {"scst_share", "sex_ratio"}

# Plain-language names. The schema's own definitions are shipped too; these are
# what appears on screen.
INDICATOR_PLAIN = {
    "population_density": ("Population density", "How many people live in each square kilometre.", "persons/km²"),
    "urbanization_rate": ("Urbanisation", "Share of households classified as urban.", "%"),
    "literacy_rate": ("Literacy", "Share of the population who are literate.", "%"),
    "graduate_rate": ("Graduate share", "Share of the population who are graduates.", "%"),
    "low_income_share": ("Low-income share", "Share of households in the lowest asset bracket.", "%"),
    "marginal_worker_share": ("Marginal workers", "Share of workers employed under six months a year.", "%"),
    "nonworker_share": ("Non-workers", "Share of the population not in recorded work.", "%"),
    "work_participation_rate": ("Work participation", "Share of the population in recorded work.", "%"),
    "internet_penetration": ("Internet access", "Share of households with an internet connection.", "%"),
    "scst_share": ("SC/ST population share", "Share of the population recorded as SC or ST.", "%"),
    "sex_ratio": ("Sex ratio", "Females per 1,000 males.", "per 1,000"),
}

CRIME_PLAIN = {
    "OVERALL": ("Overall crime", "All recorded cognizable cases."),
    "PROPERTY": ("Property crime", "Theft, burglary, robbery and related offences."),
    "VIOLENT": ("Violent crime", "Murder, attempt to murder, hurt and related offences."),
    "ECONOMIC": ("Economic crime", "Cheating, criminal breach of trust and related offences."),
    "WOMEN": ("Crime against women", "Offences recorded under the crime-against-women head."),
    "PUBLIC_ORDER": ("Public order", "Rioting and offences against public tranquillity."),
    "OTHER_SLL": ("Special & local laws", "Residual special and local law offences."),
    "CHILDREN": ("Crime against children", "Offences recorded under the crime-against-children head."),
    "SCST": ("Crime against SC/ST", "Offences under the SC/ST (Prevention of Atrocities) Act."),
    "CYBER": ("Cyber crime", "Offences recorded under the cyber head."),
    "NARCOTICS": ("Drugs & narcotics", "NDPS Act offences."),
}

# The association scale that replaces the academic verdict on the officer view.
def _strength(r: float, significant: bool):
    a = abs(r)
    if not significant and a < 0.4:
        return "LIMITED", "Limited evidence"
    if a >= 0.6:
        return "STRONG", "Strong association"
    if a >= 0.4:
        return "MODERATE", "Moderate association"
    if a >= 0.2:
        return "WEAK", "Weak association"
    return "NONE", "No clear association"


def _band(pct: float):
    """Percentile -> a word. Five bands, so a profile reads at a glance."""
    if pct >= 0.85:
        return "High"
    if pct >= 0.62:
        return "Above average"
    if pct >= 0.38:
        return "Near average"
    if pct >= 0.15:
        return "Below average"
    return "Low"


def _percentile(value, series):
    below = sum(1 for v in series if v < value)
    equal = sum(1 for v in series if v == value)
    return round((below + equal / 2) / len(series), 3) if series else 0.5


def _vs_state(value, state):
    if not state:
        return None, "—"
    ratio = value / state
    if ratio >= 1.15:
        return round(ratio, 2), f"{ratio:.1f}× state average"
    if ratio <= 0.85:
        return round(ratio, 2), f"{ratio:.1f}× state average"
    return round(ratio, 2), "Near state average"


def _mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def _stdev(xs):
    if len(xs) < 2:
        return 1.0
    m = _mean(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1)) or 1.0


# --------------------------------------------------------------------------- #
# Plain-language rendering of one association.
# --------------------------------------------------------------------------- #
def _describe(cell, ind_name, crime_name):
    r = cell["pearson_r"]
    up = r > 0
    code, label = _strength(r, cell["significant"])
    direction = "higher" if up else "lower"

    headline = f"{ind_name} & {crime_name.lower()}"
    meaning = (
        f"Across the districts in this dataset, higher {ind_name.lower()} tends to occur "
        f"alongside {direction} recorded {crime_name.lower()} rates."
    )
    if code == "NONE":
        meaning = (f"{ind_name} and recorded {crime_name.lower()} rates do not move together "
                   "in any consistent way across these districts.")
    elif code == "LIMITED":
        meaning = (f"There is a hint that {ind_name.lower()} and recorded {crime_name.lower()} "
                   "rates move together, but the evidence in 30 districts is too thin to rely on.")

    evidence = [
        f"Association strength {r:+.2f} on {cell['n']} districts",
        ("Statistically significant" if cell["significant"]
         else "Not statistically significant at the 5% level"),
        f"Rank-based check agrees at {cell['spearman_r']:+.2f}"
        if abs(cell["spearman_r"] - r) < 0.25 else
        f"Rank-based check gives {cell['spearman_r']:+.2f} — weaker than the linear figure, "
        "so a few districts may be driving it",
    ]

    # The hypothesis check survives, restated. It is genuinely informative when a
    # relationship runs opposite to the criminological expectation — that is a
    # finding — but "contradicts theory" is not how to say it to a station officer.
    expectation = None
    if cell.get("hypothesized_sign"):
        matches = cell["observed_sign"] == cell["hypothesized_sign"]
        expectation = {
            "matches": matches,
            "label": ("Matches the expected relationship" if matches
                      else "Runs opposite to the expected relationship"),
            "theory": cell.get("theory"),
            "note": (None if matches else
                     "The expected relationship comes from criminological literature. Where the "
                     "recorded data runs the other way it usually says something about reporting "
                     "and registration in these districts, and is worth understanding before it "
                     "is used."),
        }

    return {
        "headline": headline, "meaning": meaning, "strength_code": code,
        "strength_label": label, "evidence": evidence, "expectation": expectation,
        "limitation": (
            "This is a district-level statistical association. It does not establish that "
            f"{ind_name.lower()} causes crime, and it says nothing about any individual. "
            "Recorded crime also reflects reporting and registration practice."
        ),
        "use_for": ["Situational awareness", "Resource planning",
                    "Choosing districts to compare", "Framing hotspot investigation"],
        "not_for": ["Profiling individuals", "Predicting individual criminality",
                    "Assuming one causes the other", "Any decision about a community"],
    }


# --------------------------------------------------------------------------- #
def run() -> dict:
    paths.ensure_dirs()
    geo_units = json.loads(paths.GEO_UNITS.read_text(encoding="utf-8"))
    incidents = json.loads(paths.INCIDENTS.read_text(encoding="utf-8"))

    se = json.loads((paths.API_DIR / "se_indicators.json").read_text(encoding="utf-8"))
    corr = json.loads((paths.API_DIR / "se_correlations.json").read_text(encoding="utf-8"))
    schema = json.loads((paths.API_DIR / "se_schema.json").read_text(encoding="utf-8"))
    districts = json.loads((paths.API_DIR / "districts.json").read_text(encoding="utf-8"))
    detail = json.loads((paths.API_DIR / "district_detail.json").read_text(encoding="utf-8"))

    # the very same per-group rates the correlations were computed on
    crime_df, crime_year = socioeconomic._crime_group_rates(geo_units, incidents)
    # columns come back as crime_PROPERTY / crime_overall; map group code -> column
    col_of = {("OVERALL" if c == "crime_overall" else c[len("crime_"):]): c
              for c in crime_df.columns}
    rate_cols = [g for g in col_of if g != "OVERALL"]

    ind_ids = [i for i in se["indicators"]]
    rows = {d["geo_unit_id"]: d for d in se["districts"]}
    summary = {d["geo_unit_id"]: d for d in districts}
    schema_by_id = {i["id"]: i for i in schema.get("indicators", [])}

    # ---- state-level reference figures ----
    state_ind = {}
    for ind in ind_ids:
        vals = [r[ind] for r in se["districts"] if r.get(ind) is not None]
        state_ind[ind] = {
            "mean": round(_mean(vals), 2), "median": round(sorted(vals)[len(vals) // 2], 2),
            "min": round(min(vals), 2), "max": round(max(vals), 2),
        }
    state_crime = {}
    for code, col in col_of.items():
        vals = [float(v) for v in crime_df[col].tolist()]
        state_crime[code] = {
            "mean": round(_mean(vals), 1), "median": round(sorted(vals)[len(vals) // 2], 1),
            "min": round(min(vals), 1), "max": round(max(vals), 1),
        }

    # ---- z-scored indicator space, for "similar districts" ----
    z = {}
    stats = {ind: (_mean([r[ind] for r in se["districts"]]),
                   _stdev([r[ind] for r in se["districts"]])) for ind in ind_ids}
    for r in se["districts"]:
        z[r["geo_unit_id"]] = [
            (r[ind] - stats[ind][0]) / stats[ind][1] for ind in ind_ids if ind not in PROTECTED
        ]

    # ---- per-district profile ----
    profiles = {}
    for r in se["districts"]:
        gid = r["geo_unit_id"]
        s = summary.get(gid, {})
        det = detail.get(gid, {})

        indicators = []
        for ind in ind_ids:
            series = [x[ind] for x in se["districts"]]
            pct = _percentile(r[ind], series)
            name, plain, unit = INDICATOR_PLAIN.get(ind, (ind, "", ""))
            ratio, ratio_label = _vs_state(r[ind], state_ind[ind]["mean"])
            indicators.append({
                "id": ind, "name": name, "plain": plain, "unit": unit,
                "value": r[ind], "percentile": pct, "band": _band(pct),
                # band = rank against the other 29 districts; ratio = against the
                # state mean. They can disagree where one district skews the mean,
                # and the UI labels each so that reads as information, not conflict.
                "state_mean": state_ind[ind]["mean"], "state_median": state_ind[ind]["median"],
                "ratio": ratio, "ratio_label": ratio_label,
                "protected": ind in PROTECTED,
                "definition": schema_by_id.get(ind, {}).get("definition"),
            })

        crime = []
        for g in rate_cols:
            if gid not in crime_df.index:
                continue
            val = float(crime_df.loc[gid, col_of[g]])
            series = [float(v) for v in crime_df[col_of[g]].tolist()]
            pct = _percentile(val, series)
            name, plain = CRIME_PLAIN.get(g, (g.replace("_", " ").title(), ""))
            crime.append({
                "group": g, "name": name, "plain": plain, "rate": round(val, 1),
                "percentile": pct, "band": _band(pct),
                "state_mean": state_crime[g]["mean"],
                "state_median": state_crime[g]["median"],
                "ratio_label": _vs_state(val, state_crime[g]["mean"])[1],
            })
        crime.sort(key=lambda c: -c["percentile"])

        # a short, honest context summary — the bands, in words
        notable = [i for i in indicators
                   if not i["protected"] and i["band"] in ("High", "Low", "Above average")]
        notable.sort(key=lambda i: -abs(i["percentile"] - 0.5))
        context = [f"{i['band']} {i['name'].lower()}" for i in notable[:4]]

        # nearest neighbours in socio-economic space
        me = z[gid]
        dists = []
        for other in se["districts"]:
            if other["geo_unit_id"] == gid:
                continue
            ov = z[other["geo_unit_id"]]
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(me, ov)))
            dists.append((d, other["geo_unit_id"], other["name"]))
        dists.sort()
        similar = []
        for d, ogid, oname in dists[:4]:
            osum = summary.get(ogid, {})
            similar.append({
                "geo_unit_id": ogid, "name": oname,
                # Absolute closeness in profile space, not a rank. A district with
                # no near neighbour must not be told it has a 100% match.
                "distance": round(d, 2),
                "similarity": round(1 / (1 + d / 2), 2),
                "similarity_label": _closeness(d),
                "crime_rate_per_100k": osum.get("crime_rate_per_100k"),
                "risk_band": osum.get("risk_band"),
                "rate_gap_pct": _pct_gap(s.get("crime_rate_per_100k"), osum.get("crime_rate_per_100k")),
            })

        trend = det.get("trend", [])
        change = None
        if len(trend) >= 2:
            change = {
                "from_year": trend[-2]["year"], "to_year": trend[-1]["year"],
                "from": trend[-2]["total"], "to": trend[-1]["total"],
                "pct": _pct_gap(trend[-1]["total"], trend[-2]["total"]),
            }

        profiles[gid] = {
            "geo_unit_id": gid, "name": r["name"], "population": det.get("population"),
            "crime_rate_per_100k": s.get("crime_rate_per_100k"),
            "total_cognizable_cases": s.get("total_cognizable_cases"),
            "risk_score": s.get("risk_score"), "risk_band": s.get("risk_band"),
            "risk_components": (det.get("risk") or {}).get("components", []),
            "hotspot_status": s.get("hotspot_status"),
            "centroid": s.get("centroid"),
            "indicators": indicators, "crime": crime,
            "context_summary": context,
            "dominant_crime": crime[0]["name"] if crime else None,
            "similar": similar, "trend": trend, "change": change,
        }

    # ---- associations, ranked, in plain language ----
    associations = []
    for cell in corr["matrix"]:
        ind, group = cell["indicator"], cell["crime_group"]
        ind_name = INDICATOR_PLAIN.get(ind, (ind, "", ""))[0]
        crime_name = CRIME_PLAIN.get(group, (group.title(), ""))[0]
        desc = _describe(cell, ind_name, crime_name)
        protected = ind in PROTECTED or cell.get("ethics_flag")

        scatter = []
        for r in se["districts"]:
            gid = r["geo_unit_id"]
            col = col_of.get(group)
            if not col or gid not in crime_df.index:
                continue
            scatter.append({
                "name": r["name"], "geo_unit_id": gid,
                "x": r[ind], "y": round(float(crime_df.loc[gid, col]), 1),
            })

        associations.append({
            "association_id": f"ASC-{len(associations) + 1:03d}",
            "indicator": ind, "indicator_name": ind_name,
            "crime_group": group, "crime_name": crime_name,
            "r": cell["pearson_r"], "spearman_r": cell["spearman_r"],
            "p": cell["pearson_p"], "n": cell["n"],
            "significant": cell["significant"], "direction": cell["observed_sign"],
            "protected": bool(protected),
            **desc,
            "scatter": scatter,
        })

    # "What stands out" — strong or moderate, significant, not protected, and not
    # the OVERALL bucket (which is just the sum of the others restated).
    standout = [a for a in associations
                if not a["protected"] and a["significant"]
                and a["strength_code"] in ("STRONG", "MODERATE")]
    standout.sort(key=lambda a: (-abs(a["r"]), a["p"]))
    seen_pairs = set()
    headline_ids = []
    for a in standout:
        key = (a["indicator"], a["crime_group"])
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        headline_ids.append(a["association_id"])
        if len(headline_ids) >= 5:
            break

    by_indicator = {}
    for a in associations:
        by_indicator.setdefault(a["indicator"], []).append(a["association_id"])

    payload = {
        "data_note": (
            "District-level (ecological) analysis. Socio-economic indicators are Census 2011; "
            f"crime figures are recorded NCRB cognizable cases for {crime_year}. n = 30 districts. "
            "Every relationship here is an association between district aggregates — never a "
            "statement about an individual, a household or a community."
        ),
        "crime_year": crime_year,
        "n_districts": corr["n_districts"],
        "indicators": [
            {"id": i, "name": INDICATOR_PLAIN.get(i, (i, "", ""))[0],
             "plain": INDICATOR_PLAIN.get(i, (i, "", ""))[1],
             "unit": INDICATOR_PLAIN.get(i, (i, "", ""))[2],
             "protected": i in PROTECTED,
             "definition": schema_by_id.get(i, {}).get("definition"),
             "derivation": schema_by_id.get(i, {}).get("derivation")}
            for i in ind_ids
        ],
        "crime_groups": [
            {"code": g, "name": CRIME_PLAIN.get(g, (g, ""))[0], "plain": CRIME_PLAIN.get(g, ("", ""))[1]}
            for g in sorted({a["crime_group"] for a in associations})
        ],
        "state": {"indicators": state_ind, "crime": state_crime},
        "districts": profiles,
        "associations": associations,
        "headline_ids": headline_ids,
        "by_indicator": by_indicator,
        "strength_scale": [
            {"code": "STRONG", "label": "Strong association", "range": "0.60 and above"},
            {"code": "MODERATE", "label": "Moderate association", "range": "0.40 – 0.60"},
            {"code": "WEAK", "label": "Weak association", "range": "0.20 – 0.40"},
            {"code": "NONE", "label": "No clear association", "range": "below 0.20"},
            {"code": "LIMITED", "label": "Limited evidence", "range": "not statistically significant"},
        ],
        "method": corr["method"],
        "ethics": corr["ethical_constraints"],
        "matrix": corr["matrix"],
        "protected_indicators": sorted(PROTECTED),
        "protected_note": (
            "SC/ST population share and sex ratio are retained in the analyst matrix because "
            "removing them would hide a real limitation of the dataset — but they are kept out "
            "of the headline findings. They are included in the source analysis to help explain "
            "victimisation and reporting patterns, and must never be read as characteristics of "
            "offenders or of a community."
        ),
    }

    (paths.API_DIR / "se_intel.json").write_text(
        json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    return {
        "districts": len(profiles), "associations": len(associations),
        "headline": len(headline_ids), "crime_year": crime_year,
        "indicators": len(ind_ids),
        "strong": sum(1 for a in associations if a["strength_code"] == "STRONG"),
        "moderate": sum(1 for a in associations if a["strength_code"] == "MODERATE"),
    }


def _closeness(d: float) -> str:
    """Calibrated on this dataset: a typical district's nearest neighbour sits
    around 0.5-1.4 in nine-dimensional z-space; a handful sit at 2-2.5; Bengaluru
    Urban has no neighbour inside 8. So the label has to be able to say so."""
    if d < 1.2:
        return "Very similar profile"
    if d < 2.0:
        return "Similar profile"
    if d < 3.0:
        return "Broadly similar"
    return "Nearest match, but not a close one"


def _pct_gap(now, before):
    if not before or now is None:
        return None
    return round((now - before) / before * 100)


if __name__ == "__main__":
    import pprint
    pprint.pp(run())
