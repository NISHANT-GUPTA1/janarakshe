"""Phase 8 — FIR investigation workspace payloads.

Phase 7 (``fir_intel``) answers *analyst* questions: how many cases, what mix,
which stations, which offenders. This module answers the *investigating
officer's* questions, in the order an officer actually asks them:

    what needs my attention -> what happened -> who is involved ->
    what is connected -> why does it matter -> what do I do next

It reuses the very same seeded synthetic FIR records that ``fir_intel``
generates (``fir_intel._generate`` with ``random.Random(SEED)`` is
deterministic, so both modules see byte-identical tables) and layers the
operational model on top:

  * an operational calendar — the FIR day/month is already synthetic, so it is
    re-based onto a rolling 12-month window ending at ``as_of`` to give real
    ageing, SLA and "last activity" semantics. Case *volumes and category mix*
    stay anchored to the real NCRB latest-year figures.
  * investigation stages, assignment, SLA and an explainable priority band,
  * investigative entities the ER model implies but does not enumerate —
    vehicles, phone identifiers and named localities — generated as persistent
    objects so they legitimately recur across FIRs and create real links,
  * related-FIR linkage where every link carries its *reason*, never a bare
    similarity score,
  * AI insights that always ship their evidence, supporting records and a
    confidence level,
  * a typed case timeline, actionable alerts and a multi-entity link graph.

Outputs: fir_queue.json, fir_case_detail.json, fir_search.json,
fir_alerts.json, fir_graph.json.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import random

from . import fir_intel, paths

SEED = 8021                  # workspace overlay seed (independent of fir_intel's)
WINDOW_DAYS = 180            # operational calendar span ending at as_of
CLUSTER_TYPE_DAYS = 60       # window for a specific-offence cluster (Burglary, Theft...)
CLUSTER_HEAD_DAYS = 45       # window for the broader crime-head rise (Property Crime...)
CLUSTER_MIN = 3              # fewest FIRs that can constitute a cluster
SLA_DAYS = 90                # statutory-ish chargesheet target used for SLA state
STALE_DAYS = 14              # no activity for this long => "needs attention"
NEARBY_KM = 6.0              # geographic proximity threshold for MO linkage
NEARBY_DAYS = 45             # temporal proximity threshold for MO linkage
MAX_RELATED = 8              # related FIRs surfaced per case
MAX_SEARCH_FIRS = 12         # FIR ids carried per search-index entity

# ---- investigation checklist (the 7 stages an officer works through) ----
STAGES = [
    ("fir_registered", "FIR Registered"),
    ("scene_inspection", "Scene Inspection"),
    ("evidence_collected", "CCTV / Evidence Collected"),
    ("witness_statements", "Witness Statements"),
    ("forensic_report", "Forensic Report"),
    ("suspect_interrogation", "Suspect Interrogation"),
    ("chargesheet", "Chargesheet Filed"),
]
STAGE_TOTAL = len(STAGES)

# how far through the checklist a case of each status has typically got
STATUS_STAGES = {
    "Under Investigation": (2, 5),
    "Charge Sheeted": (7, 7),
    "Pending Trial": (7, 7),
    "Disposed": (6, 7),
    "Closed": (4, 6),
}
CLOSED_STATUSES = {"Charge Sheeted", "Pending Trial", "Disposed", "Closed"}
OPEN_STATUSES = {"Under Investigation"}

# Real Karnataka RTO series, so a plate reads like a plate an officer would see.
RTO = {
    "Bengaluru Urban": ["01", "02", "03", "04", "05", "41", "50", "51"],
    "Bengaluru Rural": ["43"], "Ramanagara": ["42"], "Kolar": ["07"],
    "Chikkaballapura": ["40"], "Tumakuru": ["06"], "Mysuru": ["09", "55"],
    "Mandya": ["11"], "Chamarajanagar": ["10"], "Hassan": ["13"], "Kodagu": ["12"],
    "Dakshina Kannada": ["19", "70"], "Udupi": ["20"], "Chikkamagaluru": ["18"],
    "Shivamogga": ["14", "15"], "Davanagere": ["17"], "Chitradurga": ["16"],
    "Ballari": ["34", "35"], "Koppal": ["37"], "Raichur": ["36"],
    "Kalaburagi": ["32", "33"], "Yadgir": ["33"], "Bidar": ["38", "39"],
    "Vijayapura": ["28"], "Bagalkot": ["29"], "Belagavi": ["22", "23", "24"],
    "Dharwad": ["25"], "Gadag": ["26"], "Haveri": ["27"], "Uttara Kannada": ["30", "31"],
}
PLATE_ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ"
VEHICLE_MAKES = [
    "Bajaj Pulsar", "Hero Splendor", "Honda Activa", "TVS Apache", "Royal Enfield",
    "Maruti Swift", "Hyundai i20", "Tata Indica", "Mahindra Bolero", "Toyota Innova",
    "Ashok Leyland Dost", "Tata Ace", "Yamaha FZ", "Honda Shine",
]
VEHICLE_COLOURS = ["White", "Black", "Silver", "Blue", "Red", "Grey", "Maroon"]

# Locality naming, so "location" is a place an officer can drive to.
LOC_PREFIX = [
    "Vidyanagar", "Basaveshwara", "Gandhi", "Nehru", "Market", "Station", "Old Town",
    "New Extension", "Industrial", "Lake View", "Shivaji", "Kempegowda", "Ambedkar",
    "Sangam", "Hosahalli", "Ganesh", "Rail", "Temple", "College", "Bus Stand",
]
LOC_SUFFIX = [
    "Main Road", "2nd Cross", "Layout", "Circle", "Extension", "Nagar", "Colony",
    "Bazaar", "Junction", "Road", "Park", "Gate",
]
DISTRICT_ABBR = {
    "Bengaluru Urban": "BLR", "Bengaluru Rural": "BNR", "Ramanagara": "RMN",
    "Mysuru": "MYS", "Mandya": "MDY", "Chamarajanagar": "CJN", "Tumakuru": "TMK",
    "Kolar": "KLR", "Chikkaballapura": "CKB", "Hassan": "HSN", "Kodagu": "KDG",
    "Dakshina Kannada": "DKN", "Udupi": "UDP", "Chikkamagaluru": "CKM",
    "Shivamogga": "SMG", "Davanagere": "DVG", "Chitradurga": "CTD", "Ballari": "BLY",
    "Koppal": "KPL", "Raichur": "RCR", "Kalaburagi": "KLB", "Yadgir": "YDG",
    "Bidar": "BID", "Vijayapura": "VJP", "Bagalkot": "BGK", "Belagavi": "BGM",
    "Dharwad": "DWD", "Gadag": "GDG", "Haveri": "HVR", "Uttara Kannada": "UKN",
}

# Rank ladder for the investigating officer, weighted by case gravity.
IO_RANKS = ["PSI", "ASI", "Inspector", "PI", "Dy.SP"]

# Priority bands. Order matters — it is the semantic colour scale the UI uses.
BANDS = ["CRITICAL", "HIGH", "WATCH", "INFO", "RESOLVED"]


# --------------------------------------------------------------------------- #
# small helpers
# --------------------------------------------------------------------------- #
def _abbr(district: str) -> str:
    if district in DISTRICT_ABBR:
        return DISTRICT_ABBR[district]
    letters = [c for c in district.upper() if c.isalpha()]
    return "".join(letters[:3]) or "KAR"


def _haversine_km(a_lat, a_lon, b_lat, b_lon) -> float:
    r = 6371.0
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp = math.radians(b_lat - a_lat)
    dl = math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _iso(d: dt.date) -> str:
    return d.isoformat()


def _isodt(d: dt.datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M")


def _confidence_label(c: float) -> str:
    if c >= 0.8:
        return "High"
    if c >= 0.55:
        return "Medium"
    return "Low"


def _operational_date(month: int, day: int, as_of: dt.date) -> dt.date:
    """Re-base a synthetic (month, day) onto the WINDOW_DAYS ending at as_of.

    The generator drew day and month uniformly at random, so there is no real
    seasonality to preserve here — only the case *volume and category mix* are
    anchored to real NCRB figures. Spreading the same cases over a six-month
    operational window is what gives the queue meaningful ageing, SLA state,
    recency and cluster density; a 12-month spread leaves the caseload too thin
    for a 30-day window to say anything.
    """
    offset = round(((month - 1) * 31 + (day - 1)) / 372 * WINDOW_DAYS)
    return as_of - dt.timedelta(days=min(offset, WINDOW_DAYS))


# --------------------------------------------------------------------------- #
# Investigative entities the ER model implies but does not enumerate.
# Persistent objects (pooled per district) so they genuinely recur across FIRs —
# that recurrence is what makes "same vehicle" / "same phone" a real link and
# not a coincidence the UI invented.
# --------------------------------------------------------------------------- #
def _build_entities(cases, accused_index, person_cases, complainants, rng):
    by_district: dict[str, list] = {}
    for c in cases:
        by_district.setdefault(c["district"], []).append(c)

    vehicles: dict[str, dict] = {}
    localities: dict[str, dict] = {}
    case_vehicle: dict[str, str] = {}
    case_locality: dict[str, str] = {}
    vehicle_cases: dict[str, list] = {}
    locality_cases: dict[str, list] = {}

    veh_serial = 0
    loc_serial = 0
    for district, dcases in sorted(by_district.items()):
        series = RTO.get(district) or [f"{(abs(hash(district)) % 60) + 1:02d}"]

        # vehicle pool ~ 22% of the district's caseload => healthy reuse
        n_veh = max(3, round(len(dcases) * 0.22))
        pool = []
        for _ in range(n_veh):
            veh_serial += 1
            plate = "KA-%s-%s%s-%04d" % (
                rng.choice(series), rng.choice(PLATE_ALPHA), rng.choice(PLATE_ALPHA),
                rng.randint(1000, 9999),
            )
            vid = f"VEH-{veh_serial:05d}"
            vehicles[vid] = {
                "entity_id": vid, "kind": "vehicle", "label": plate,
                "make": rng.choice(VEHICLE_MAKES), "colour": rng.choice(VEHICLE_COLOURS),
                "district": district,
            }
            pool.append(vid)
        # power-law weighting: a handful of vehicles show up again and again
        veh_wts = [1.0 / (i + 1) ** 0.5 for i in range(len(pool))]

        # locality pool — every FIR happens somewhere named
        n_loc = max(4, round(len(dcases) * 0.35))
        lpool = []
        seen_names = set()
        for _ in range(n_loc):
            name = f"{rng.choice(LOC_PREFIX)} {rng.choice(LOC_SUFFIX)}"
            if name in seen_names:
                continue
            seen_names.add(name)
            loc_serial += 1
            lid = f"LOC-{loc_serial:05d}"
            localities[lid] = {
                "entity_id": lid, "kind": "location", "label": f"{name}, {district}",
                "area": name, "district": district,
            }
            lpool.append(lid)
        loc_wts = [1.0 / (i + 1) ** 0.4 for i in range(len(lpool))]

        for c in dcases:
            lid = rng.choices(lpool, weights=loc_wts, k=1)[0]
            case_locality[c["case_id"]] = lid
            locality_cases.setdefault(lid, []).append(c["case_id"])
            # a vehicle features in crimes where one plausibly would
            p_veh = 0.62 if c["crime_major_head"] in ("Property Crime", "Violent Crime") else 0.28
            if rng.random() < p_veh:
                vid = rng.choices(pool, weights=veh_wts, k=1)[0]
                case_vehicle[c["case_id"]] = vid
                vehicle_cases.setdefault(vid, []).append(c["case_id"])

    # phone identifiers: every accused carries one; a few numbers are shared
    # between co-offenders (a burner passed around), which is itself a signal.
    phones: dict[str, dict] = {}
    person_phone: dict[str, str] = {}
    phone_persons: dict[str, list] = {}
    shared_pool: list[str] = []
    for pid in sorted(accused_index):
        if shared_pool and rng.random() < 0.08:
            phid = rng.choice(shared_pool)
        else:
            num = f"9{rng.randint(100000000, 999999999)}"
            phid = f"PHN-{len(phones) + 1:05d}"
            phones[phid] = {"entity_id": phid, "kind": "phone", "label": num,
                            "district": accused_index[pid]["district"]}
            if len(person_cases.get(pid, [])) >= 2:
                shared_pool.append(phid)
        person_phone[pid] = phid
        phone_persons.setdefault(phid, []).append(pid)

    # complainants get a contact number too (for the case file, not for linking)
    comp_phone = {}
    for row in complainants:
        comp_phone[row["case_id"]] = f"9{rng.randint(100000000, 999999999)}"

    return {
        "vehicles": vehicles, "localities": localities, "phones": phones,
        "case_vehicle": case_vehicle, "case_locality": case_locality,
        "vehicle_cases": vehicle_cases, "locality_cases": locality_cases,
        "person_phone": person_phone, "phone_persons": phone_persons,
        "comp_phone": comp_phone,
    }


# --------------------------------------------------------------------------- #
# Investigating officers — drawn from the station roster so a case always has a
# named, contactable owner (the ER model's CaseMaster.PolicePersonID).
# --------------------------------------------------------------------------- #
def _build_officers(stations, rng):
    officers: dict[str, dict] = {}
    station_officers: dict[str, list] = {}
    for s in sorted(stations, key=lambda x: x["unit_id"]):
        for i in range(rng.randint(2, 4)):
            oid = f"IO-{len(officers) + 1:05d}"
            rank = rng.choices(IO_RANKS, weights=[34, 20, 26, 14, 6], k=1)[0]
            officers[oid] = {
                "officer_id": oid, "rank": rank,
                "name": f"{rng.choice(fir_intel.FIRST_NAMES)} {rng.choice(fir_intel.LAST_INITIALS)}.",
                "unit_id": s["unit_id"], "station": s["name"], "district": s["district"],
            }
            station_officers.setdefault(s["unit_id"], []).append(oid)
    return officers, station_officers


# --------------------------------------------------------------------------- #
# Operational overlay for one case: calendar, ownership, checklist, SLA.
# --------------------------------------------------------------------------- #
def _stage_state(case, rng):
    lo, hi = STATUS_STAGES.get(case["status"], (2, 5))
    done = rng.randint(lo, hi)
    if case["status"] == "Closed" and case["cs_type"] == "B":
        done = min(done, 4)          # a false case never reaches interrogation
    if case["gravity"] == "Heinous" and case["status"] == "Under Investigation":
        done = max(done, 3)          # heinous cases get worked harder, faster
    return min(done, STAGE_TOTAL)


def _sla_state(days_open, status):
    if status in CLOSED_STATUSES:
        return "met", None
    left = SLA_DAYS - days_open
    if left < 0:
        return "breached", left
    if left <= 15:
        return "due", left
    return "ok", left


def _priority(case, ops, links):
    """Explainable priority. Every point added is recorded as a reason, so the
    UI can always answer "why is this case red?" — the colour is an argument,
    not decoration."""
    score = 0
    reasons: list[str] = []

    if case["gravity"] == "Heinous":
        score += 3
        reasons.append("Heinous offence")
    head = case["crime_major_head"]
    if head == "Violent Crime":
        score += 2
        reasons.append("Violent crime head")
    elif head == "Crime Against Women":
        score += 2
        reasons.append("Crime against women")
    elif head in ("Property Crime", "Economic & Financial Crime"):
        score += 1
        reasons.append(f"{head} head")

    if ops["sla_state"] == "breached":
        score += 2
        reasons.append(f"SLA breached by {abs(ops['sla_days_left'])} days")
    elif ops["sla_state"] == "due":
        score += 1
        reasons.append(f"SLA due in {ops['sla_days_left']} days")

    if ops["days_since_activity"] >= STALE_DAYS and case["status"] in OPEN_STATUSES:
        score += 1
        reasons.append(f"No activity for {ops['days_since_activity']} days")

    if links["repeat_accused"]:
        score += 1
        reasons.append(f"Accused has {links['repeat_accused']} prior FIRs")
    if links["linked_firs"] >= 3:
        score += 1
        reasons.append(f"{links['linked_firs']} linked FIRs")
    if links["in_cluster"]:
        score += 1
        reasons.append("Falls inside an emerging cluster")

    if case["status"] in ("Disposed", "Closed") or (
        case["status"] == "Charge Sheeted" and ops["stage_done"] == STAGE_TOTAL
    ):
        return "RESOLVED", score, (reasons or ["Investigation concluded"])
    if score >= 7:
        band = "CRITICAL"
    elif score >= 5:
        band = "HIGH"
    elif score >= 3:
        band = "WATCH"
    else:
        band = "INFO"
    return band, score, (reasons or ["Routine registration, no escalating factors"])


# --------------------------------------------------------------------------- #
# Related-FIR linkage.
#
# Every link is produced by a *named rule*, and the rule's own words travel with
# the link. An officer is never shown a bare similarity number: they are shown
# "same vehicle KA-03-HJ-4417", with the record that proves it.
# --------------------------------------------------------------------------- #
RULES = {
    "same_accused":  {"label": "Same accused", "weight": 0.42},
    "same_vehicle":  {"label": "Same vehicle", "weight": 0.34},
    "shared_phone":  {"label": "Shared phone identifier", "weight": 0.22},
    "same_location": {"label": "Same location", "weight": 0.16},
    "similar_mo":    {"label": "Similar modus operandi", "weight": 0.20},
    "geo_proximity": {"label": "Geographically close", "weight": 0.12},
    "temporal":      {"label": "Temporal pattern", "weight": 0.10},
    "same_station":  {"label": "Shared jurisdiction", "weight": 0.05},
}


def _related_firs(case, meta, idx):
    """Return related cases for one FIR, each with its reasons and confidence."""
    cid = case["case_id"]
    hits: dict[str, dict] = {}

    def add(other_id, code, detail):
        if other_id == cid or other_id not in meta:
            return
        h = hits.setdefault(other_id, {"reasons": [], "codes": set()})
        if code in h["codes"]:
            return
        h["codes"].add(code)
        h["reasons"].append({"code": code, "detail": detail})

    # -- shared people ------------------------------------------------------
    for pid in idx["case_people"].get(cid, []):
        person = idx["accused_index"][pid]
        for other in idx["person_cases"].get(pid, []):
            add(other, "same_accused", f"{person['name']} ({pid}) is named in both FIRs")
        # a phone shared between two accused links their cases too
        phid = idx["ent"]["person_phone"].get(pid)
        for other_pid in idx["ent"]["phone_persons"].get(phid, []):
            if other_pid == pid:
                continue
            num = idx["ent"]["phones"][phid]["label"]
            for other in idx["person_cases"].get(other_pid, []):
                add(other, "shared_phone", f"Number {num} is used by both accused")

    # -- shared vehicle -----------------------------------------------------
    vid = idx["ent"]["case_vehicle"].get(cid)
    if vid:
        plate = idx["ent"]["vehicles"][vid]["label"]
        for other in idx["ent"]["vehicle_cases"].get(vid, []):
            add(other, "same_vehicle", f"Vehicle {plate} recorded against both FIRs")

    # -- same named locality ------------------------------------------------
    lid = idx["ent"]["case_locality"].get(cid)
    if lid:
        area = idx["ent"]["localities"][lid]["area"]
        for other in idx["ent"]["locality_cases"].get(lid, []):
            add(other, "same_location", f"Both incidents occurred at {area}")


    # -- modus operandi within reach, in space and in time -------------------
    m = meta[cid]
    for other_id in idx["by_minor_head"].get(case["crime_minor_head"], []):
        if other_id == cid:
            continue
        o = meta[other_id]
        km = _haversine_km(m["lat"], m["lon"], o["lat"], o["lon"])
        if km > NEARBY_KM:
            continue
        gap = abs((m["occurred_date"] - o["occurred_date"]).days)
        if gap > NEARBY_DAYS:
            continue
        section = f" {case['section']}" if case["section"] else ""
        add(other_id, "similar_mo",
            f"Both registered under {case['crime_minor_head']} ({case['act']}{section})")
        add(other_id, "geo_proximity", f"{km:.1f} km apart")
        if abs(m["hour"] - o["hour"]) <= 2:
            add(other_id, "temporal",
                f"{gap} days apart, both around {m['hour']:02d}:00")
        else:
            add(other_id, "temporal", f"{gap} days apart")

    out = []
    for other_id, h in hits.items():
        residual = 1.0
        for r in h["reasons"]:
            residual *= 1 - RULES[r["code"]]["weight"]
        conf = round(min(1 - residual, 0.97), 2)
        # every other field about `other_id` already travels in fir_queue.json,
        # which the workspace always has loaded - carry the link, not a copy of the row
        out.append({"fir_id": other_id, "reasons": h["reasons"], "confidence": conf,
                    "confidence_label": _confidence_label(conf)})
    out.sort(key=lambda r: (-r["confidence"], -len(r["reasons"]), r["fir_id"]))
    return out[:MAX_RELATED]


# --------------------------------------------------------------------------- #
# AI intelligence insights.
#
# Contract for every insight emitted here: a headline the officer can act on,
# the evidence that produced it, the records that back it, and a confidence
# level. Nothing is asserted as fact — each one is a lead to verify, and the
# payload carries everything the "Why am I seeing this?" panel needs to show.
# --------------------------------------------------------------------------- #
def _insights(case, meta, idx, related, cluster):
    cid = case["case_id"]
    m = meta[cid]
    out = []

    def emit(kind, headline, detail, evidence, records, conf, action):
        out.append({
            "id": f"{cid}-{kind}", "kind": kind, "headline": headline, "detail": detail,
            "evidence": evidence, "records": records, "confidence": round(conf, 2),
            "confidence_label": _confidence_label(conf), "action": action,
        })

    # 1. prior history of a named accused
    for pid in idx["case_people"].get(cid, []):
        priors = [c for c in idx["person_cases"].get(pid, []) if c != cid]
        if len(priors) < 2:
            continue
        person = idx["accused_index"][pid]
        recent = [p for p in priors
                  if 0 <= (m["occurred_date"] - meta[p]["occurred_date"]).days <= 60]
        heads = sorted({meta[p]["crime_type"] for p in priors})
        stations = {meta[p]["station"] for p in priors}
        ev = [
            f"{len(priors)} other FIRs name {person['name']} ({pid})",
            f"Offending recorded across {len(stations)} police station(s)",
            f"Crime types on record: {', '.join(heads)}",
        ]
        if recent:
            ev.append(f"{len(recent)} of those fall in the 60 days before this incident")
        emit(
            "prior_history",
            f"Accused {person['name']} is linked to {len(priors)} previous FIRs",
            "The same accused identity appears on other FIR records. Read the prior "
            "case files before framing the interrogation.",
            ev,
            [{"kind": "fir", "id": p}
             for p in priors[:6]],
            min(0.55 + 0.06 * len(priors), 0.92),
            "Pull the prior case files and check MO consistency.",
        )
        break

    # 2. vehicle recurrence — an exact-match link, not an estimate
    vid = idx["ent"]["case_vehicle"].get(cid)
    if vid:
        others = [c for c in idx["ent"]["vehicle_cases"].get(vid, []) if c != cid]
        if others:
            v = idx["ent"]["vehicles"][vid]
            districts = sorted({meta[o]["district"] for o in others} | {m["district"]})
            emit(
                "vehicle_link",
                f"Vehicle {v['label']} appears in {len(others) + 1} incidents",
                f"A {v['colour'].lower()} {v['make']} bearing {v['label']} is recorded "
                f"against this FIR and {len(others)} other(s).",
                [f"Registration {v['label']} recorded on {len(others) + 1} FIRs",
                 f"Districts touched: {', '.join(districts)}",
                 "Registration numbers match exactly — this is a record link, not a similarity score"],
                [{"kind": "fir", "id": o}
                 for o in others[:6]],
                min(0.70 + 0.05 * len(others), 0.95),
                "Raise a vehicle check and request RTO ownership details.",
            )

    # 3. emerging cluster membership
    if cluster:
        emit(
            "cluster",
            f"Incident falls within an emerging {cluster['crime_type'].lower()} cluster",
            f"{cluster['case_count']} {cluster['crime_type'].lower()} FIRs were registered "
            f"in {cluster['district']} within {cluster['window_days']} days, against "
            f"{cluster['baseline']} in the preceding window.",
            [f"{cluster['case_count']} cases in {cluster['window_days']} days",
             f"Preceding {cluster['window_days']}-day baseline: {cluster['baseline']}",
             f"Concentrated around {cluster['area']}",
             f"Peak reporting hour {cluster['peak_hour']:02d}:00"],
            [{"kind": "fir", "id": c}
             for c in cluster["cases"][:6] if c != cid],
            cluster["confidence"],
            "Consider a coordinated beat response with neighbouring stations.",
        )

    # 4. time-of-day pattern across the linked set
    hours = [meta[r["fir_id"]]["hour"] for r in related] + [m["hour"]]
    if len(hours) >= 4:
        lo, hi = min(hours), max(hours)
        if hi - lo <= 4:
            emit(
                "temporal_pattern",
                f"Similar incidents occurred between {lo:02d}:00–{(hi + 1) % 24:02d}:30",
                "The linked incidents share a narrow offence window. This is a "
                "deployment signal, not a suspect signal.",
                [f"{len(hours)} linked incidents fall inside a {hi - lo + 1}-hour band",
                 f"This FIR's recorded offence hour: {m['hour']:02d}:00",
                 "Derived from recorded offence time only"],
                [{"kind": "fir", "id": r["fir_id"],
                  "note": f"{meta[r['fir_id']]['hour']:02d}:00"} for r in related[:5]],
                0.62,
                "Align night-beat timings to the observed window.",
            )

    # 5. station clearance context — about workload, never about the officer
    st = idx["station_stats"].get(case["unit_id"])
    if st and st["cases"] >= 8 and st["detection_rate"] + 0.12 < st["district_rate"]:
        gap = round((st["district_rate"] - st["detection_rate"]) * 100)
        emit(
            "station_context",
            f"{m['station']} clearance is {gap} points below the {m['district']} average",
            "A workload and clearance signal about the station, to be read alongside "
            "the case rather than as a judgement on this investigation.",
            [f"Station chargesheet rate {st['detection_rate'] * 100:.0f}% over {st['cases']} FIRs",
             f"{m['district']} district average {st['district_rate'] * 100:.0f}%",
             "Computed on closed cases in this dataset only"],
            [{"kind": "station", "id": case["unit_id"], "label": m["station"],
              "note": f"{st['cases']} FIRs on this station's rolls"}],
            0.50,
            "Review the pending investigation load at this station.",
        )
    return out


# --------------------------------------------------------------------------- #
# Case timeline — typed, so an officer can tell a system record apart from
# their own action, an evidence addition, and something intelligence surfaced.
# --------------------------------------------------------------------------- #
def _timeline(case, meta, idx, related, stage_dates, rng):
    cid = case["case_id"]
    m = meta[cid]
    section = f" {case['section']}" if case["section"] else ""
    ev = [
        {"at": _isodt(m["occurred_dt"]), "kind": "system", "title": "Incident reported",
         "detail": f"Information received at {m['station']}", "actor": "Control Room"},
        {"at": _isodt(m["registered_dt"]), "kind": "system", "title": "FIR registered",
         "detail": f"{m['fir_no']} · {case['category']} · {case['act']}{section}",
         "actor": m["io_name"]},
    ]
    stage_detail = {
        "scene_inspection": "Scene of offence inspected, mahazar drawn",
        "evidence_collected": "CCTV footage and scene exhibits taken into custody",
        "witness_statements": "Witness statements recorded under Sec. 161 CrPC",
        "forensic_report": "Exhibits forwarded to FSL; report received",
        "suspect_interrogation": "Suspect examined in custody",
        "chargesheet": "Final report filed before the jurisdictional court",
    }
    for key, label in STAGES[1:]:
        when = stage_dates.get(key)
        if not when:
            continue
        kind = "evidence" if key in ("evidence_collected", "forensic_report") else "officer"
        ev.append({"at": _isodt(when), "kind": kind, "title": label,
                   "detail": stage_detail.get(key, label), "actor": m["io_name"]})

    # intelligence discoveries are their own event type, never dressed as facts
    vid = idx["ent"]["case_vehicle"].get(cid)
    if vid and related:
        when = m["registered_dt"] + dt.timedelta(days=rng.randint(2, 9), hours=rng.randint(0, 9))
        if when.date() <= m["as_of"]:
            ev.append({"at": _isodt(when), "kind": "intelligence", "title": "Vehicle identified",
                       "detail": f"{idx['ent']['vehicles'][vid]['label']} associated with the incident",
                       "actor": "Intelligence layer"})
            link = next((r for r in related
                         if any(x["code"] == "same_vehicle" for x in r["reasons"])), None)
            if link:
                when2 = when + dt.timedelta(days=rng.randint(1, 5))
                if when2.date() <= m["as_of"]:
                    ev.append({"at": _isodt(when2), "kind": "intelligence",
                               "title": "Vehicle linked to previous FIR",
                               "detail": "Same registration recorded against "
                                         f"{meta[link['fir_id']]['fir_no']}",
                               "actor": "Intelligence layer"})

    if case["status"] != "Under Investigation":
        ev.append({"at": _isodt(m["status_dt"]), "kind": "status",
                   "title": f"Status → {case['status']}",
                   "detail": {"A": "Chargesheet (A) filed",
                              "B": "Reported as false case (B)",
                              "C": "Reported undetected (C)"}.get(case["cs_type"], "Case status updated"),
                   "actor": m["io_name"]})
    else:
        ev.append({"at": _isodt(dt.datetime.combine(m["as_of"], dt.time(9, 0))),
                   "kind": "system", "title": "Investigation pending",
                   "detail": f"{m['stage_done']} of {STAGE_TOTAL} stages complete · "
                             f"{m['days_since_activity']} days since last activity",
                   "actor": "—"})
    ev.sort(key=lambda e: e["at"])
    return ev


# --------------------------------------------------------------------------- #
# Emerging clusters — a rise in one crime type, in one district, inside a
# rolling window, measured against the window before it.
# --------------------------------------------------------------------------- #
def _rise(ids, meta, as_of, window_days):
    """Split a bucket of FIRs into the current window and the one before it."""
    recent_cut = as_of - dt.timedelta(days=window_days)
    prior_cut = as_of - dt.timedelta(days=window_days * 2)
    recent = [i for i in ids if meta[i]["occurred_date"] > recent_cut]
    prior = [i for i in ids if prior_cut < meta[i]["occurred_date"] <= recent_cut]
    return recent, prior


def _clusters(cases, meta, as_of):
    """Emerging clusters, detected at two levels of granularity.

    A specific offence rising in one district ("burglary in Jayanagar") is the
    strongest signal, and is looked for first over a 60-day window. Where the
    caseload is too thin for that to say anything, the same test is applied to
    the broader crime head ("property crime in Belagavi") over 45 days - a
    softer finding, and labelled as one so the officer can weigh it accordingly.
    The residual "Other" SLL bucket is excluded at both levels: it is not an
    offence anyone can be deployed against.
    """
    by_type: dict[tuple, list] = {}
    by_head: dict[tuple, list] = {}
    for c in cases:
        if c["crime_minor_head"] != "Other":
            by_type.setdefault((c["district"], c["crime_minor_head"]), []).append(c["case_id"])
        if c["crime_major_head"] != "Other Special & Local Laws":
            by_head.setdefault((c["district"], c["crime_major_head"]), []).append(c["case_id"])

    out: list[dict] = []
    covered: set[tuple] = set()

    def build(district, label, tier, recent, prior, window_days):
        hours = [meta[i]["hour"] for i in recent]
        areas: dict[str, int] = {}
        for i in recent:
            areas[meta[i]["area"]] = areas.get(meta[i]["area"], 0) + 1
        top_area = max(areas, key=areas.get)
        lift = (len(recent) - len(prior)) / max(len(prior), 1)
        base = 0.40 if tier == "offence" else 0.32
        return {
            "cluster_id": "", "tier": tier,
            "district": district, "crime_type": label,
            "case_count": len(recent), "baseline": len(prior),
            "change_pct": round(lift * 100) if prior else None,
            "window_days": window_days,
            "area": f"{top_area}, {district}",
            "peak_hour": max(set(hours), key=hours.count),
            "confidence": round(min(base + 0.07 * len(recent)
                                    + (0.05 * min(lift, 3) if prior else 0.0), 0.88), 2),
            "cases": sorted(recent, key=lambda i: meta[i]["occurred_date"], reverse=True),
        }

    for (district, crime_type), ids in sorted(by_type.items()):
        recent, prior = _rise(ids, meta, as_of, CLUSTER_TYPE_DAYS)
        if len(recent) < CLUSTER_MIN or len(recent) <= len(prior):
            continue
        out.append(build(district, crime_type, "offence", recent, prior, CLUSTER_TYPE_DAYS))
        covered.add((district, meta[recent[0]]["major_head"]))

    for (district, head), ids in sorted(by_head.items()):
        if (district, head) in covered:
            continue                       # already reported at the sharper level
        recent, prior = _rise(ids, meta, as_of, CLUSTER_HEAD_DAYS)
        if len(recent) < CLUSTER_MIN or len(recent) <= len(prior):
            continue
        out.append(build(district, head, "head", recent, prior, CLUSTER_HEAD_DAYS))

    out.sort(key=lambda c: (0 if c["tier"] == "offence" else 1, -c["case_count"], c["district"]))
    for i, c in enumerate(out, 1):
        c["cluster_id"] = f"CL-{i:03d}"
    return out


# --------------------------------------------------------------------------- #
# Global intelligence search index.
#
# One flat list of every searchable thing, so an officer never has to know which
# module holds the answer: a plate, a number, a name, a locality and an FIR
# number all resolve the same way.
# --------------------------------------------------------------------------- #
def _search_index(cases, meta, idx, complainants_by_case):
    ent = idx["ent"]
    out = []

    def entry(eid, kind, label, subtitle, fir_ids, extra=None):
        fir_ids = sorted(set(fir_ids), key=lambda i: meta[i]["occurred_date"], reverse=True)
        last = meta[fir_ids[0]]["occurred_at"][:10] if fir_ids else None
        row = {
            "entity_id": eid, "kind": kind, "label": label, "subtitle": subtitle,
            "fir_count": len(fir_ids), "firs": fir_ids[:MAX_SEARCH_FIRS],
            "last_seen": last,
            "districts": sorted({meta[i]["district"] for i in fir_ids})[:4],
        }
        if extra:
            row.update(extra)
        out.append(row)

    for c in cases:
        m = meta[c["case_id"]]
        entry(c["case_id"], "fir", m["fir_no"],
              f"{m['crime_type']} · {m['station']} · {m['occurred_at'][:10]}",
              [c["case_id"]],
              {"priority": m["priority"], "status": c["status"], "crime_no": c["crime_no"]})

    for pid, prof in sorted(idx["accused_index"].items()):
        cids = idx["person_cases"].get(pid, [])
        if not cids:
            continue
        phid = ent["person_phone"].get(pid)
        entry(pid, "person", prof["name"],
              f"Accused · {len(cids)} FIR(s) · {prof['district']}", cids,
              {"role": "accused", "gender": prof["gender"], "age_band": prof["age_band"],
               "phone": ent["phones"][phid]["label"] if phid else None,
               "person_count": len(idx["adj"].get(pid, {}))})

    for cid, row in sorted(complainants_by_case.items()):
        if cid not in meta:
            continue
        entry(f"CMP-{cid}", "person", row["name"],
              f"Complainant · {meta[cid]['fir_no']}", [cid],
              {"role": "complainant"})

    for vid, v in sorted(ent["vehicles"].items()):
        cids = ent["vehicle_cases"].get(vid, [])
        if not cids:
            continue
        persons = {p for c in cids for p in idx["case_people"].get(c, [])}
        locs = {ent["case_locality"].get(c) for c in cids} - {None}
        entry(vid, "vehicle", v["label"], f"{v['colour']} {v['make']}", cids,
              {"person_count": len(persons), "location_count": len(locs)})

    for phid, p in sorted(ent["phones"].items()):
        pids = ent["phone_persons"].get(phid, [])
        cids = [c for pid in pids for c in idx["person_cases"].get(pid, [])]
        if not cids:
            continue
        names = sorted({idx["accused_index"][pid]["name"] for pid in pids})
        entry(phid, "phone", p["label"],
              f"Linked to {', '.join(names[:2])}" + (" +more" if len(names) > 2 else ""),
              cids, {"person_count": len(pids)})

    for lid, l in sorted(ent["localities"].items()):
        cids = ent["locality_cases"].get(lid, [])
        if not cids:
            continue
        persons = {p for c in cids for p in idx["case_people"].get(c, [])}
        entry(lid, "location", l["label"], f"{len(cids)} FIR(s) recorded here", cids,
              {"person_count": len(persons)})

    st_cases: dict[str, list] = {}
    for c in cases:
        st_cases.setdefault(c["unit_id"], []).append(c["case_id"])
    for uid, cids in sorted(st_cases.items()):
        s = idx["stations"][uid]
        entry(uid, "station", s["name"], f"{s['district']} district · {len(cids)} FIR(s)", cids)

    type_cases: dict[str, list] = {}
    for c in cases:
        type_cases.setdefault(c["crime_minor_head"], []).append(c["case_id"])
    for name, cids in sorted(type_cases.items()):
        entry(f"TYPE-{name.upper().replace(' ', '-')}", "crime_type", name,
              f"{len(cids)} FIR(s) statewide", cids)

    dist_cases: dict[str, list] = {}
    for c in cases:
        dist_cases.setdefault(c["district"], []).append(c["case_id"])
    for name, cids in sorted(dist_cases.items()):
        entry(f"DIST-{name.upper().replace(' ', '-')}", "district", name,
              f"{len(cids)} FIR(s) on the rolls", cids)

    return out


# --------------------------------------------------------------------------- #
# Link-analysis graph: a typed, multi-entity graph an officer can expand node by
# node — person, vehicle, phone, location, FIR and station, with named edges.
# --------------------------------------------------------------------------- #
def _graph(cases, meta, idx):
    ent = idx["ent"]
    nodes, edges = [], []

    def node(nid, kind, label, sub, **kw):
        nodes.append({"id": nid, "kind": kind, "label": label, "sub": sub, **kw})

    def edge(src, dst, kind, label):
        edges.append({"source": src, "target": dst, "kind": kind, "label": label})

    for c in cases:
        m = meta[c["case_id"]]
        node(c["case_id"], "fir", m["fir_no"],
             f"{m['crime_type']} · {m['occurred_at'][:10]}",
             priority=m["priority"], status=c["status"], district=c["district"])
        edge(c["unit_id"], c["case_id"], "jurisdiction", "registered at")

    for pid, prof in sorted(idx["accused_index"].items()):
        cids = idx["person_cases"].get(pid, [])
        if not cids:
            continue
        node(pid, "person", prof["name"], f"Accused · {len(cids)} FIR(s)",
             district=prof["district"], degree=len(cids))
        for cid in cids:
            edge(pid, cid, "named_in", "named in")

    for vid, v in sorted(ent["vehicles"].items()):
        cids = ent["vehicle_cases"].get(vid, [])
        if not cids:
            continue
        node(vid, "vehicle", v["label"], f"{v['colour']} {v['make']}",
             district=v["district"], degree=len(cids))
        for cid in cids:
            edge(vid, cid, "recorded_on", "recorded on")

    for phid, p in sorted(ent["phones"].items()):
        pids = [pid for pid in ent["phone_persons"].get(phid, []) if idx["person_cases"].get(pid)]
        if not pids:
            continue
        node(phid, "phone", p["label"], f"Used by {len(pids)} person(s)",
             district=p["district"], degree=len(pids))
        for pid in pids:
            edge(phid, pid, "used_by", "used by")

    for lid, l in sorted(ent["localities"].items()):
        cids = ent["locality_cases"].get(lid, [])
        if not cids:
            continue
        node(lid, "location", l["area"], f"{l['district']} · {len(cids)} FIR(s)",
             district=l["district"], degree=len(cids))
        for cid in cids:
            edge(lid, cid, "scene_of", "scene of")

    for uid, s in sorted(idx["stations"].items()):
        node(uid, "station", s["name"], f"{s['district']} district", district=s["district"])

    return {"nodes": nodes, "edges": edges,
            "kinds": ["fir", "person", "vehicle", "phone", "location", "station"],
            "edge_kinds": sorted({e["kind"] for e in edges})}


# --------------------------------------------------------------------------- #
# Intelligence alerts. Each one answers three questions in order:
# what happened, why it matters, and what the officer can do about it.
# --------------------------------------------------------------------------- #
def _alerts(cases, meta, idx, clusters, details, as_of):
    ent = idx["ent"]
    out = []

    def alert(sev, title, why, actions, fir_id=None, evidence=None, at=None):
        out.append({
            "alert_id": f"ALR-{len(out) + 1:04d}", "severity": sev, "title": title,
            "why": why, "fir_id": fir_id,
            "fir_no": meta[fir_id]["fir_no"] if fir_id else None,
            "district": meta[fir_id]["district"] if fir_id else None,
            "station": meta[fir_id]["station"] if fir_id else None,
            "evidence": evidence or [], "actions": actions,
            "at": at or _iso(as_of),
        })

    # 1. a suspect on a live case is already named on other FIRs
    seen_person = set()
    for c in cases:
        cid = c["case_id"]
        if meta[cid]["priority"] not in ("CRITICAL", "HIGH"):
            continue
        for pid in idx["case_people"].get(cid, []):
            priors = [p for p in idx["person_cases"].get(pid, []) if p != cid]
            if len(priors) < 3 or pid in seen_person:
                continue
            seen_person.add(pid)
            person = idx["accused_index"][pid]
            alert("CRITICAL",
                  f"Suspect {person['name']} linked to {meta[priors[0]]['fir_no']}",
                  f"The accused named on this FIR is also named on {len(priors)} other FIRs "
                  f"across {len({meta[p]['station'] for p in priors})} station(s). "
                  "Prior history changes how this interrogation should be framed.",
                  [{"label": "Investigate", "kind": "open_case", "target": cid},
                   {"label": "View network", "kind": "open_graph", "target": pid},
                   {"label": "View related FIR", "kind": "open_case", "target": priors[0]}],
                  fir_id=cid,
                  evidence=[f"{len(priors)} prior FIRs name {person['name']} ({pid})",
                            f"Most recent: {meta[priors[0]]['fir_no']} on {meta[priors[0]]['occurred_at'][:10]}"],
                  at=meta[cid]["last_activity_at"])
            break
        if len(out) >= 14:
            break

    # 2. emerging clusters — a nearby repeat of the same offence
    for cl in clusters[:12]:
        head = cl["cases"][0]
        alert("HIGH",
              f"{cl['case_count']} {cl['crime_type'].lower()} FIRs in {cl['district']} "
              f"in {cl['window_days']} days",
              f"Registrations are up from {cl['baseline']} in the preceding window, "
              f"concentrated around {cl['area']}. An emerging cluster is a deployment "
              "decision, not a conviction.",
              [{"label": "View cluster", "kind": "open_cluster", "target": cl["cluster_id"]},
               {"label": "Open latest FIR", "kind": "open_case", "target": head},
               {"label": "View on map", "kind": "open_map", "target": cl["district"]}],
              fir_id=head,
              evidence=[f"{cl['case_count']} cases vs {cl['baseline']} baseline",
                        f"Peak hour {cl['peak_hour']:02d}:00",
                        f"Centred on {cl['area']}"],
              at=meta[head]["occurred_at"][:10])

    # 3. a vehicle turning up on several FIRs
    for vid, cids in sorted(ent["vehicle_cases"].items(), key=lambda kv: -len(kv[1]))[:10]:
        if len(cids) < 3:
            break
        v = ent["vehicles"][vid]
        newest = max(cids, key=lambda i: meta[i]["occurred_date"])
        alert("WATCH",
              f"Vehicle {v['label']} recorded on {len(cids)} FIRs",
              f"The same registration appears across {len({meta[i]['district'] for i in cids})} "
              "district(s). Registration matches are exact, so this is a lead worth a vehicle check.",
              [{"label": "View network", "kind": "open_graph", "target": vid},
               {"label": "Open latest FIR", "kind": "open_case", "target": newest}],
              fir_id=newest,
              evidence=[f"{v['colour']} {v['make']} · {v['label']}",
                        f"FIRs: {', '.join(meta[i]['fir_no'] for i in cids[:4])}"],
              at=meta[newest]["occurred_at"][:10])

    # 4. investigation-hygiene alerts: SLA and stalled files
    breached = sorted(
        (c for c in cases if meta[c["case_id"]]["sla_state"] == "breached"),
        key=lambda c: meta[c["case_id"]]["sla_days_left"])[:10]
    for c in breached:
        cid, m = c["case_id"], meta[c["case_id"]]
        pending = [label for (key, label) in STAGES[m["stage_done"]:]]
        alert("INVESTIGATION",
              f"{pending[0] if pending else 'Chargesheet'} pending on {m['fir_no']}",
              f"The 90-day chargesheet window passed {abs(m['sla_days_left'])} days ago and "
              f"{len(pending)} investigation stage(s) are still open.",
              [{"label": "Open case", "kind": "open_case", "target": cid},
               {"label": "Add investigation update", "kind": "update_case", "target": cid},
               {"label": "Reassign", "kind": "assign", "target": cid}],
              fir_id=cid,
              evidence=[f"Registered {m['registered_at'][:10]} · {m['age_days']} days old",
                        f"{m['stage_done']} of {STAGE_TOTAL} stages complete",
                        f"Pending: {', '.join(pending[:3])}"],
              at=m["last_activity_at"])

    order = {"CRITICAL": 0, "HIGH": 1, "WATCH": 2, "INVESTIGATION": 3}
    out.sort(key=lambda a: (order.get(a["severity"], 9), a["at"]), reverse=False)
    return out


# --------------------------------------------------------------------------- #
def run(as_of: dt.date | None = None) -> dict:
    paths.ensure_dirs()
    as_of = as_of or dt.date.today()
    geo_units = json.loads(paths.GEO_UNITS.read_text(encoding="utf-8"))
    incidents = json.loads(paths.INCIDENTS.read_text(encoding="utf-8"))

    # identical seed => byte-identical tables to the ones fir_intel publishes
    tables, ctx = fir_intel._generate(geo_units, incidents, random.Random(fir_intel.SEED))
    rng = random.Random(SEED)

    cases = tables["cases"]
    accused_index = ctx["accused_index"]
    person_cases = ctx["person_cases"]
    case_people = ctx["case_people"]
    stations = {s["unit_id"]: s for s in tables["stations"]}

    note = (
        "SYNTHETIC FIR records, schema-shaped to the KSP Police FIR System ER model "
        "(record-level data is confidential). Case volumes and category mix are anchored "
        "to the real NCRB latest-year district figures; the operational calendar, "
        "assignment, vehicle/phone/locality entities and investigation progress are "
        "generated deterministically (seed %d) to exercise the investigation workflow."
        % SEED
    )

    complainants_by_case = {r["case_id"]: r for r in tables["complainants"]}
    victims_by_case: dict[str, list] = {}
    for v in tables["victims"]:
        victims_by_case.setdefault(v["case_id"], []).append(v)
    accused_by_case: dict[str, list] = {}
    for a in tables["accused"]:
        accused_by_case.setdefault(a["case_id"], []).append(a)

    officers, station_officers = _build_officers(tables["stations"], rng)
    ent = _build_entities(cases, accused_index, person_cases, tables["complainants"], rng)

    # ---- station clearance stats (context for the insight layer) ----
    station_stats: dict[str, dict] = {}
    district_closed: dict[str, list] = {}
    for c in cases:
        s = station_stats.setdefault(c["unit_id"], {"cases": 0, "closed": 0, "cleared": 0,
                                                    "district": c["district"]})
        s["cases"] += 1
        if c["cs_type"]:
            s["closed"] += 1
            s["cleared"] += 1 if c["cs_type"] == "A" else 0
            district_closed.setdefault(c["district"], []).append(1 if c["cs_type"] == "A" else 0)
    district_rate = {d: (sum(v) / len(v) if v else 0) for d, v in district_closed.items()}
    for uid, s in station_stats.items():
        s["detection_rate"] = round(s["cleared"] / s["closed"], 3) if s["closed"] else 0.0
        s["district_rate"] = round(district_rate.get(s["district"], 0), 3)

    # ---- pass 1: the operational overlay for every case ----
    meta: dict[str, dict] = {}
    stage_dates_by_case: dict[str, dict] = {}
    for c in cases:
        cid = c["case_id"]
        occurred_date = _operational_date(c["month"], c["day"], as_of)
        occurred_dt = dt.datetime.combine(occurred_date, dt.time(c["hour"], rng.randint(0, 59)))
        registered_dt = occurred_dt + dt.timedelta(minutes=rng.randint(25, 260))
        age_days = (as_of - occurred_date).days

        uid = c["unit_id"]
        roster = station_officers.get(uid) or list(officers)
        io_id = roster[(abs(hash(cid)) % len(roster))]
        io = officers[io_id]

        stage_done = _stage_state(c, rng)
        span = max(3, min(age_days, 120))
        stage_dates: dict[str, dt.datetime] = {}
        last_stage_dt = registered_dt
        for i, (key, _label) in enumerate(STAGES[:stage_done]):
            if i == 0:
                continue
            frac = i / max(stage_done - 1, 1)
            when = registered_dt + dt.timedelta(days=round(frac * span * 0.9),
                                                hours=rng.randint(0, 10))
            if when.date() > as_of:
                when = dt.datetime.combine(as_of, dt.time(rng.randint(9, 18), 0))
            stage_dates[key] = when
            last_stage_dt = max(last_stage_dt, when)
        stage_dates_by_case[cid] = stage_dates

        last_activity_dt = last_stage_dt
        days_since_activity = max((as_of - last_activity_dt.date()).days, 0)
        last_stage_label = (STAGES[stage_done - 1][1] if stage_done else "FIR Registered")
        sla_state, sla_left = _sla_state(age_days, c["status"])

        lid = ent["case_locality"].get(cid)
        locality = ent["localities"].get(lid, {})

        meta[cid] = {
            "fir_id": cid,
            "fir_no": f"KA-{_abbr(c['district'])}-{occurred_date.year}-{int(cid[-6:]):06d}",
            "crime_no": c["crime_no"],
            "crime_type": c["crime_minor_head"],
            "major_head": c["crime_major_head"],
            "gravity": c["gravity"],
            "district": c["district"], "unit_id": uid, "station": stations[uid]["name"],
            "area": locality.get("area", c["district"]),
            "location": locality.get("label", c["district"]),
            "lat": c["lat"], "lon": c["lon"], "hour": c["hour"],
            "occurred_date": occurred_date, "occurred_dt": occurred_dt,
            "occurred_at": _isodt(occurred_dt),
            "registered_dt": registered_dt, "registered_at": _isodt(registered_dt),
            "status_dt": last_stage_dt,
            "age_days": age_days,
            "io_id": io_id, "io_name": f"{io['rank']} {io['name']}", "io_rank": io["rank"],
            "stage_done": stage_done,
            "last_activity": last_stage_label,
            "last_activity_at": _iso(last_activity_dt.date()),
            "days_since_activity": days_since_activity,
            "sla_state": sla_state, "sla_days_left": sla_left,
            "status": c["status"],
            "as_of": as_of,
        }

    # ---- pass 2: emerging clusters over the operational calendar ----
    clusters = _clusters(cases, meta, as_of)
    case_cluster: dict[str, dict] = {}
    for cl in clusters:
        for cid in cl["cases"]:
            case_cluster.setdefault(cid, cl)

    # ---- pass 3: explainable priority (needs cheap link counts) ----
    for c in cases:
        cid = c["case_id"]
        crew = case_people.get(cid, [])
        repeat_accused = max((len(person_cases.get(p, [])) - 1 for p in crew), default=0)
        linked = {o for p in crew for o in person_cases.get(p, [])}
        vid = ent["case_vehicle"].get(cid)
        if vid:
            linked |= set(ent["vehicle_cases"].get(vid, []))
        linked.discard(cid)
        links = {"repeat_accused": repeat_accused, "linked_firs": len(linked),
                 "in_cluster": cid in case_cluster}
        band, score, reasons = _priority(c, meta[cid], links)
        meta[cid].update({"priority": band, "priority_score": score,
                          "priority_reasons": reasons, "linked_firs": len(linked),
                          "repeat_accused": repeat_accused})

    idx = {
        "accused_index": accused_index, "person_cases": person_cases,
        "case_people": case_people, "adj": ctx["adj"], "ent": ent,
        "stations": stations, "station_stats": station_stats, "officers": officers,
        "by_minor_head": {},
    }
    for c in cases:
        idx["by_minor_head"].setdefault(c["crime_minor_head"], []).append(c["case_id"])

    # ---- pass 4: per-case investigation workspace ----
    details: dict[str, dict] = {}
    for c in cases:
        cid = c["case_id"]
        m = meta[cid]
        related = _related_firs(c, meta, idx)
        cluster = case_cluster.get(cid)
        insights = _insights(c, meta, idx, related, cluster)
        timeline = _timeline(c, meta, idx, related, stage_dates_by_case[cid], rng)

        comp = complainants_by_case.get(cid)
        crew = case_people.get(cid, [])
        accused_out = []
        for a in accused_by_case.get(cid, []):
            pid = a["person_id"]
            others = [o for o in person_cases.get(pid, []) if o != cid]
            phid = ent["person_phone"].get(pid)
            arrested = any(x["case_id"] == cid and x["person_id"] == pid for x in tables["arrests"])
            accused_out.append({
                "person_id": pid, "name": a["name"], "sort": a["sort"],
                "gender": a["gender"], "age_band": a["age_band"],
                "alias": f"{a['name'].split()[0]} ({pid[-3:]})",
                "phone": ent["phones"][phid]["label"] if phid else None,
                "prior_firs": len(others),
                "custody_status": "In custody" if arrested else (
                    "Absconding" if c["status"] == "Under Investigation" and others else "Not arrested"),
                "associates": len(idx["adj"].get(pid, {})),
                "cases": sorted(others, key=lambda x: meta[x]["occurred_date"],
                                reverse=True)[:6],
            })

        vid = ent["case_vehicle"].get(cid)
        lid = ent["case_locality"].get(cid)
        entity_persons = {p for p in crew}
        for r in related:
            entity_persons |= set(case_people.get(r["fir_id"], []))
        entity_vehicles = {vid} if vid else set()
        entity_vehicles |= {ent["case_vehicle"].get(r["fir_id"]) for r in related}
        entity_vehicles.discard(None)
        entity_locs = {lid} if lid else set()
        entity_locs |= {ent["case_locality"].get(r["fir_id"]) for r in related}
        entity_locs.discard(None)
        entity_phones = {ent["person_phone"].get(p) for p in entity_persons}
        entity_phones.discard(None)

        details[cid] = {
            "fir_id": cid, "fir_no": m["fir_no"], "crime_no": c["crime_no"],
            "crime_type": m["crime_type"], "major_head": m["major_head"],
            "category": c["category"], "act": c["act"], "section": c["section"],
            "gravity": c["gravity"], "status": c["status"], "cs_type": c["cs_type"],
            "priority": m["priority"], "priority_score": m["priority_score"],
            "priority_reasons": m["priority_reasons"],
            "district": m["district"], "station": m["station"], "unit_id": m["unit_id"],
            "location": m["location"], "area": m["area"], "lat": m["lat"], "lon": m["lon"],
            "occurred_at": m["occurred_at"], "registered_at": m["registered_at"],
            "age_days": m["age_days"], "sla_state": m["sla_state"],
            "sla_days_left": m["sla_days_left"], "sla_days": SLA_DAYS,
            "io": {"officer_id": m["io_id"], "name": m["io_name"], "rank": m["io_rank"],
                   "station": m["station"]},
            "stages": [{"done": i < m["stage_done"],
                        "at": _iso(stage_dates_by_case[cid][k].date())
                        if k in stage_dates_by_case[cid] else (
                            m["registered_at"][:10] if i == 0 else None)}
                       for i, (k, _lbl) in enumerate(STAGES)],
            "stage_done": m["stage_done"], "stage_total": STAGE_TOTAL,
            "complainant": {
                "name": comp["name"], "age": comp["age"], "gender": comp["gender"],
                "occupation": comp["occupation"],
                "phone": ent["comp_phone"].get(cid),
                "address": f"{m['area']}, {m['district']}",
            } if comp else None,
            "accused": accused_out,
            "victims": [{"name": v["name"], "age": v["age"], "gender": v["gender"]}
                        for v in victims_by_case.get(cid, [])],
            "entities": {
                "persons": len(entity_persons), "vehicles": len(entity_vehicles),
                "phones": len(entity_phones), "locations": len(entity_locs),
                "related_firs": len(related),
                "items": (
                    [{"kind": "vehicle", "id": v, "label": ent["vehicles"][v]["label"],
                      "sub": f"{ent['vehicles'][v]['colour']} {ent['vehicles'][v]['make']}",
                      "primary": v == vid}
                     for v in sorted(entity_vehicles)][:4]
                    + [{"kind": "location", "id": l, "label": ent["localities"][l]["area"],
                        "sub": ent["localities"][l]["district"], "primary": l == lid}
                       for l in sorted(entity_locs)][:4]
                    + [{"kind": "phone", "id": p, "label": ent["phones"][p]["label"],
                        "sub": f"{len(ent['phone_persons'].get(p, []))} person(s)",
                        "primary": False}
                       for p in sorted(entity_phones)][:4]
                ),
            },
            "related": related,
            "insights": insights,
            "timeline": timeline,
            "cluster": cluster["cluster_id"] if cluster else None,
            "brief_facts": f"{m['crime_type']} reported at {m['location']} on "
                           f"{m['occurred_at'][:10]} around {m['hour']:02d}:00 hrs. "
                           f"Registered at {m['station']} under {c['act']}"
                           f"{' ' + str(c['section']) if c['section'] else ''}.",
        }

    # ---- queue rows ----
    rows = []
    for c in cases:
        cid = c["case_id"]
        m = meta[cid]
        names = [a["name"] for a in accused_by_case.get(cid, [])]
        rows.append({
            "fir_id": cid, "fir_no": m["fir_no"], "crime_type": m["crime_type"],
            "major_head": m["major_head"], "gravity": m["gravity"],
            "occurred_at": m["occurred_at"], "registered_at": m["registered_at"],
            "district": m["district"], "station": m["station"], "unit_id": m["unit_id"],
            "location": m["location"], "lat": m["lat"], "lon": m["lon"],
            "complainant": complainants_by_case[cid]["name"] if cid in complainants_by_case else "—",
            "accused": names[:3], "accused_count": len(names),
            "io": m["io_name"], "io_id": m["io_id"],
            "status": m["status"], "priority": m["priority"],
            "priority_reasons": m["priority_reasons"],
            "stage_done": m["stage_done"], "stage_total": STAGE_TOTAL,
            "last_activity": m["last_activity"], "last_activity_at": m["last_activity_at"],
            "days_since_activity": m["days_since_activity"],
            "age_days": m["age_days"], "sla_state": m["sla_state"],
            "sla_days_left": m["sla_days_left"],
            "linked_firs": m["linked_firs"], "insight_count": len(details[cid]["insights"]),
        })
    rows.sort(key=lambda r: (BANDS.index(r["priority"]), -r["age_days"]))

    def bucket(pred):
        return [r["fir_id"] for r in rows if pred(r)]

    summary = {
        "total": len(rows),
        "critical": bucket(lambda r: r["priority"] == "CRITICAL"),
        "high": bucket(lambda r: r["priority"] == "HIGH"),
        "watch": bucket(lambda r: r["priority"] == "WATCH"),
        "info": bucket(lambda r: r["priority"] == "INFO"),
        "resolved": bucket(lambda r: r["priority"] == "RESOLVED"),
        "attention": bucket(lambda r: r["status"] in OPEN_STATUSES
                            and r["days_since_activity"] >= STALE_DAYS),
        "sla_risk": bucket(lambda r: r["sla_state"] in ("due", "breached")),
        "recent": bucket(lambda r: r["days_since_activity"] <= 7),
    }

    def facet(key):
        agg: dict[str, int] = {}
        for r in rows:
            agg[r[key]] = agg.get(r[key], 0) + 1
        return [{"value": k, "count": v} for k, v in sorted(agg.items(), key=lambda x: (-x[1], x[0]))]

    queue = {
        "data_note": note, "as_of": _iso(as_of), "sla_days": SLA_DAYS,
        "stale_days": STALE_DAYS, "stages": [{"key": k, "label": l} for k, l in STAGES],
        "summary": {k: (v if isinstance(v, int) else len(v)) for k, v in summary.items()},
        "buckets": {k: v[:400] for k, v in summary.items() if isinstance(v, list)},
        "patterns": [{k: cl[k] for k in
                      ("cluster_id", "tier", "district", "crime_type", "case_count",
                       "baseline", "change_pct", "window_days", "area", "peak_hour",
                       "confidence")} | {"cases": cl["cases"][:14]}
                     for cl in clusters],
        "facets": {
            "districts": facet("district"), "stations": facet("station"),
            "crime_types": facet("crime_type"), "statuses": facet("status"),
            "priorities": [{"value": b, "count": len(summary[b.lower()])} for b in BANDS],
            "major_heads": facet("major_head"),
        },
        "rows": rows,
    }

    search = _search_index(cases, meta, idx, complainants_by_case)
    graph = _graph(cases, meta, idx)
    alerts = _alerts(cases, meta, idx, clusters, details, as_of)

    api = paths.API_DIR
    out = {
        "fir_queue.json": queue,
        "fir_case_detail.json": {
            "data_note": note, "as_of": _iso(as_of),
            "stages": [{"key": k, "label": l} for k, l in STAGES],
            "rules": {code: r["label"] for code, r in RULES.items()},
            "cases": details,
        },
        "fir_search.json": {"data_note": note, "as_of": _iso(as_of), "entities": search},
        "fir_alerts.json": {"data_note": note, "as_of": _iso(as_of), "alerts": alerts},
        "fir_graph.json": {"data_note": note, "as_of": _iso(as_of), **graph},
    }
    for fname, payload in out.items():
        (api / fname).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    return {
        "as_of": _iso(as_of), "cases": len(rows),
        "critical": queue["summary"]["critical"], "high": queue["summary"]["high"],
        "watch": queue["summary"]["watch"], "sla_risk": queue["summary"]["sla_risk"],
        "patterns": len(clusters), "alerts": len(alerts),
        "search_entities": len(search),
        "graph_nodes": len(graph["nodes"]), "graph_edges": len(graph["edges"]),
        "vehicles": len(ent["vehicles"]), "phones": len(ent["phones"]),
        "localities": len(ent["localities"]), "officers": len(officers),
    }


if __name__ == "__main__":
    import pprint
    pprint.pp(run())
