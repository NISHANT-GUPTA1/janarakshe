"""Phase 1+6 pipeline orchestrator: ingest -> build KPIs -> data quality -> intelligence
-> socioeconomic -> advanced ML pattern detection.

Runs on REAL data in data/raw/ (see data/manifest.json):
  - karnataka_districts.geojson
  - ncrb_district_ipc_2001_2012.csv
  - india_districts_census2011.csv

Usage:  python -m pipeline.run
"""
from __future__ import annotations

import sys

from . import (build_kpis, crime_intel, data_quality, fir_intel, fir_workspace, ingest,
               intelligence, ml_patterns, paths, se_intel, socioeconomic)


def main() -> int:
    paths.ensure_dirs()
    missing = [p.name for p in (paths.GEOJSON_RAW, paths.NCRB_RAW, paths.CENSUS_SE_RAW) if not p.exists()]
    if missing:
        print("ERROR: missing real source files in data/raw/:", ", ".join(missing))
        print("Download them per data/manifest.json (the geojson + NCRB IPC csv).")
        return 2

    print("=" * 64)
    print("Crime Analytics pipeline — Karnataka (REAL data)")
    print("=" * 64)

    ing = ingest.run()
    rec = ing["ncrb"]["reconciliation"]
    print(f"[ 1/10] ingest     : {ing['districts']} districts, {ing['incidents']} incidents, "
          f"{ing['total_cases']:,} cases, years {ing['years'][0]}-{ing['years'][-1]}")
    print(f"                   NCRB reconciliation: ingested {rec['ingested_leaf_sum']:,} vs "
          f"reported {rec['ncrb_reported_total']:,} -> {'MATCH' if rec['matches'] else 'MISMATCH'}")

    kpi = build_kpis.build()
    hr = kpi["highest_risk"]
    print(f"[ 2/10] build kpis : {kpi['kpi_facts']} facts, {kpi['hotspots']} hotspot(s); "
          f"highest risk = {hr['name']} ({hr['risk_band']} {hr['risk_score']})")

    rep = data_quality.run()
    s = rep["summary"]
    print(f"[ 3/10] data qual  : {rep['status']} — {s['errors']} error(s), {s['warnings']} warning(s)")

    intel = intelligence.run()
    net = intel["network"]
    print(f"[ 4/10] intelligence: {intel['entities']} synthetic offenders "
          f"({intel['repeat_offenders']} repeat), network {net['nodes']}n/{net['edges']}e "
          f"in {net['components']} components; {intel['clusters']} pattern clusters, "
          f"{intel['anomalies']} anomalies")

    se = socioeconomic.run()
    print(f"[ 5/10] socio-econ : {se['districts']} districts, {se['correlations']} correlations "
          f"({se['significant']} significant; {se['confirmed']} confirm / {se['contradicted']} contradict hypotheses)")
    for c in se["top"]:
        print(f"                   {c['indicator']} ~ {c['crime_group']}: r={c['pearson_r']} (p={c['pearson_p']}) {c['verdict']}")

    sei = se_intel.run()
    print(
        f"[ 6/10] se intel  : {sei['districts']} district profiles, {sei['associations']} associations "
        f"({sei['strong']} strong / {sei['moderate']} moderate), "
        f"{sei['headline']} headline findings surfaced"
    )

    ml = ml_patterns.run()
    print(
        f"[ 7/10] ml patterns: {ml['districts']} districts × {ml['features']} features; "
        f"{ml['clusters']} clusters (silhouette={ml['silhouette_score']}); "
        f"RF OOB R²={ml['rf_oob_r2']}; "
        f"{ml['isolation_anomalies_flagged']} multi-dim anomalies; "
        f"{ml['forecasts_generated']} district forecasts"
    )
    print(f"                   PCA variance explained: {ml['pca_variance_explained']:.0%}")

    fir = fir_intel.run()
    print(
        f"[ 8/10] fir intel  : {fir['cases']} FIR records across {fir['stations']} stations; "
        f"{fir['accused']} accused ({fir['repeat']} repeat); "
        f"co-accused network {fir['network_nodes']}n/{fir['network_edges']}e "
        f"in {fir['components']} crews; detection rate {fir['detection_rate']:.0%}"
    )

    ws = fir_workspace.run()
    print(
        f"[ 9/10] fir workspc: {ws['cases']} cases on the queue as of {ws['as_of']} — "
        f"{ws['critical']} critical / {ws['high']} high / {ws['watch']} watch, "
        f"{ws['sla_risk']} at SLA risk; {ws['patterns']} emerging patterns, "
        f"{ws['alerts']} alerts"
    )
    print(
        f"                   entities: {ws['vehicles']} vehicles, {ws['phones']} phones, "
        f"{ws['localities']} localities, {ws['officers']} officers; "
        f"link graph {ws['graph_nodes']}n/{ws['graph_edges']}e; "
        f"search index {ws['search_entities']} entities"
    )

    ci = crime_intel.run()
    print(
        f"[10/10] crime intel: {ci['findings']} findings — {ci['critical']} critical / "
        f"{ci['high']} high / {ci['watch']} watch; {ci['clusters']} emerging clusters, "
        f"{ci['spikes']} spikes, {ci['unusual']} unusual, {ci['network']} network, "
        f"{ci['forecasts']} projections"
    )
    print(
        f"                   {ci['profiles']} crime profiles; {ci['districts']} district "
        f"drill-downs; {ci['repeat_offenders']} repeat offenders"
    )

    print("-" * 64)
    print(f"outputs -> {paths.PROCESSED_DIR}")
    print(f"api     -> {paths.API_DIR}")
    print(f"map     -> {paths.FRONTEND_PUBLIC / 'karnataka_districts.geojson'}")
    return 1 if rep["status"] == "FAIL" else 0


if __name__ == "__main__":
    sys.exit(main())
