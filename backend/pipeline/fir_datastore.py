"""Normalise the synthetic FIR records into schema-conforming CSVs for Catalyst Data Store.

The analytics layer (fir_intel) generates a deterministic, schema-shaped synthetic FIR
dataset and serves *aggregates* as JSON. This module reuses the very same records
(`fir_intel._generate`, seed 42) and writes them out **normalised** — one CSV per table
in `catalyst/datastore/schema.sql`, with integer surrogate keys and valid foreign keys.

Load path: Catalyst console -> Data Store -> each table -> Bulk Import -> upload the
matching CSV (import parents before children so FK lookups resolve). Because both the
dashboards and Data Store derive from the same seed, the deployed DB and the analytics
stay consistent.

Run:  python -m pipeline.fir_datastore
"""
from __future__ import annotations

import csv
import random

from . import contracts, fir_intel, paths

DATASTORE_DIR = paths.PROCESSED_DIR / "datastore"

GENDER_ID = {"M": 1, "F": 2, "T": 3}
AGE_BAND_MID = {"18-25": 21, "26-35": 30, "36-45": 40, "46-60": 53, "60+": 65}


def _write_csv(name: str, header: list[str], rows: list[list]):
    path = DATASTORE_DIR / f"{name}.csv"
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)
    return len(rows)


def _case_int(case_id: str) -> int:
    return int(case_id.split("-")[-1])


def run() -> dict:
    paths.ensure_dirs()
    DATASTORE_DIR.mkdir(parents=True, exist_ok=True)

    import json
    geo_units = json.loads(paths.GEO_UNITS.read_text(encoding="utf-8"))
    incidents = json.loads(paths.INCIDENTS.read_text(encoding="utf-8"))
    rng = random.Random(fir_intel.SEED)
    tables, ctx = fir_intel._generate(geo_units, incidents, rng)
    latest = ctx["latest"]

    cases = tables["cases"]
    accused_rows = tables["accused"]
    victim_rows = tables["victims"]
    complainant_rows = tables["complainants"]
    arrests = tables["arrests"]
    chargesheets = tables["chargesheets"]
    stations = tables["stations"]

    counts: dict[str, int] = {}

    # ---- geography ----
    state_id = 29  # Karnataka (census state code)
    counts["State"] = _write_csv(
        "State", ["StateID", "StateName", "NationalityID", "Active"],
        [[state_id, "Karnataka", 1, 1]])

    districts = [u for u in geo_units if u["level"] == "DISTRICT"]
    dist_id: dict[str, int] = {}     # geo_unit_id -> DistrictID
    dist_name: dict[str, str] = {}   # district name -> geo_unit_id
    drows = []
    for i, u in enumerate(districts, start=1):
        did = (u["codes"].get("census_district_code") or (2900 + i))
        dist_id[u["geo_unit_id"]] = did
        dist_name[u["name"]] = u["geo_unit_id"]
        drows.append([did, u["name"], state_id, 1])
    counts["District"] = _write_csv(
        "District", ["DistrictID", "DistrictName", "StateID", "Active"], drows)

    # ---- unit type + units (police stations) ----
    counts["UnitType"] = _write_csv(
        "UnitType", ["UnitTypeID", "UnitTypeName", "CityDistState", "Hierarchy", "Active"],
        [[1, "Police Station", "District", 3, 1]])

    unit_id: dict[str, int] = {}  # station string id -> integer UnitID
    urows = []
    for i, s in enumerate(stations, start=1):
        uid = 100000 + i
        unit_id[s["unit_id"]] = uid
        did = dist_id.get(s["geo_unit_id"], state_id)
        urows.append([uid, s["name"], 1, None, 1, state_id, did, 1])
    counts["Unit"] = _write_csv(
        "Unit", ["UnitID", "UnitName", "TypeID", "ParentUnit", "NationalityID",
                 "StateID", "DistrictID", "Active"], urows)

    # ---- rank / designation / employees (one Investigating Officer per station) ----
    counts["Rank"] = _write_csv(
        "Rank", ["RankID", "RankName", "Hierarchy", "Active"],
        [[1, "Inspector", 5, 1], [2, "Sub-Inspector", 6, 1]])
    counts["Designation"] = _write_csv(
        "Designation", ["DesignationID", "DesignationName", "Active", "SortOrder"],
        [[1, "Investigating Officer", 1, 1], [2, "Station House Officer", 1, 2]])

    unit_officer: dict[str, int] = {}  # station string id -> EmployeeID
    emp_rows = []
    for i, s in enumerate(stations, start=1):
        eid = 500000 + i
        unit_officer[s["unit_id"]] = eid
        did = dist_id.get(s["geo_unit_id"], state_id)
        emp_rows.append([eid, did, unit_id[s["unit_id"]], 1, 1,
                         f"KG{eid}", fir_intel.FIRST_NAMES[i % len(fir_intel.FIRST_NAMES)],
                         "1985-01-01", 1, 1, 0, "2010-06-01"])
    counts["Employee"] = _write_csv(
        "Employee", ["EmployeeID", "DistrictID", "UnitID", "RankID", "DesignationID",
                     "KGID", "FirstName", "EmployeeDOB", "GenderID", "BloodGroupID",
                     "PhysicallyChallenged", "AppointmentDate"], emp_rows)

    # ---- court (one district court per district) ----
    court_id: dict[str, int] = {}  # geo_unit_id -> CourtID
    crows = []
    for i, u in enumerate(districts, start=1):
        cid = 700000 + i
        court_id[u["geo_unit_id"]] = cid
        crows.append([cid, f"{u['name']} District Court", dist_id[u["geo_unit_id"]], state_id, 1])
    counts["Court"] = _write_csv(
        "Court", ["CourtID", "CourtName", "DistrictID", "StateID", "Active"], crows)

    # ---- classification lookups ----
    def _lookup(values):
        return {v: i for i, v in enumerate(dict.fromkeys(values), start=1)}

    cat_id = _lookup(c["category"] for c in cases)
    counts["CaseCategory"] = _write_csv(
        "CaseCategory", ["CaseCategoryID", "LookupValue"],
        [[i, v] for v, i in cat_id.items()])

    grav_id = _lookup(c["gravity"] for c in cases)
    counts["GravityOffence"] = _write_csv(
        "GravityOffence", ["GravityOffenceID", "LookupValue"],
        [[i, v] for v, i in grav_id.items()])

    status_id = _lookup(c["status"] for c in cases)
    counts["CaseStatusMaster"] = _write_csv(
        "CaseStatusMaster", ["CaseStatusID", "CaseStatusName"],
        [[i, v] for v, i in status_id.items()])

    # ---- crime heads / sub-heads (from taxonomy, keyed by the labels the cases use) ----
    head_id = _lookup(c["crime_major_head"] for c in cases)
    counts["CrimeHead"] = _write_csv(
        "CrimeHead", ["CrimeHeadID", "CrimeGroupName", "Active"],
        [[i, v, 1] for v, i in head_id.items()])

    sub_parent: dict[str, str] = {}  # minor head label -> major head label
    for c in cases:
        sub_parent.setdefault(c["crime_minor_head"], c["crime_major_head"])
    sub_id = _lookup(c["crime_minor_head"] for c in cases)
    counts["CrimeSubHead"] = _write_csv(
        "CrimeSubHead", ["CrimeSubHeadID", "CrimeHeadID", "CrimeHeadName", "SeqID"],
        [[i, head_id[sub_parent[v]], v, i] for v, i in sub_id.items()])

    # ---- acts & sections ----
    act_codes = _lookup(c["act"] for c in cases if c.get("act"))
    counts["Act"] = _write_csv(
        "Act", ["ActCode", "ActDescription", "ShortName", "Active"],
        [[code, code, code, 1] for code in act_codes])

    sections = {}  # (act, section) -> True
    for c in cases:
        if c.get("act") and c.get("section"):
            sections[(c["act"], str(c["section"]))] = True
    counts["Section"] = _write_csv(
        "Section", ["ActCode", "SectionCode", "SectionDescription", "Active"],
        [[a, s, f"{a} {s}", 1] for (a, s) in sections])

    # ---- demographic masters ----
    caste_id = _lookup(r["caste"] for r in complainant_rows)
    counts["CasteMaster"] = _write_csv(
        "CasteMaster", ["caste_master_id", "caste_master_name"],
        [[i, v] for v, i in caste_id.items()])
    rel_id = _lookup(r["religion"] for r in complainant_rows)
    counts["ReligionMaster"] = _write_csv(
        "ReligionMaster", ["ReligionID", "ReligionName"],
        [[i, v] for v, i in rel_id.items()])
    occ_id = _lookup(r["occupation"] for r in complainant_rows)
    counts["OccupationMaster"] = _write_csv(
        "OccupationMaster", ["OccupationID", "OccupationName"],
        [[i, v] for v, i in occ_id.items()])

    # ---- CaseMaster + 1:1 occurrence ----
    cm_rows, occ_rows = [], []
    case_gid: dict[int, str] = {}
    for c in cases:
        cmid = _case_int(c["case_id"])
        gid = c["geo_unit_id"]
        case_gid[cmid] = gid
        uid = unit_id[c["unit_id"]]
        officer = unit_officer[c["unit_id"]]
        crime_no = c["crime_no"]
        case_no = crime_no[-9:]
        reg_date = f"{c['year']}-{c['month']:02d}-{c['day']:02d}"
        inc_from = f"{reg_date} {c['hour']:02d}:00:00"
        inc_to = f"{reg_date} {min(23, c['hour'] + 1):02d}:00:00"
        cm_rows.append([
            cmid, crime_no, case_no, reg_date, inc_from, inc_to, inc_from,
            c["lat"], c["lon"], f"{c['crime_minor_head']} reported at {c['unit_id']}",
            officer, uid, cat_id[c["category"]], grav_id[c["gravity"]],
            head_id[c["crime_major_head"]], sub_id[c["crime_minor_head"]],
            status_id[c["status"]], court_id.get(gid),
        ])
        occ_rows.append([cmid, inc_from, inc_to, inc_from, c["lat"], c["lon"]])
    counts["CaseMaster"] = _write_csv(
        "CaseMaster",
        ["CaseMasterID", "CrimeNo", "CaseNo", "CrimeRegisteredDate", "IncidentFromDate",
         "IncidentToDate", "InfoReceivedPSDate", "latitude", "longitude", "BriefFacts",
         "PolicePersonID", "PoliceStationID", "CaseCategoryID", "GravityOffenceID",
         "CrimeMajorHeadID", "CrimeMinorHeadID", "CaseStatusID", "CourtID"], cm_rows)
    counts["Inv_OccuranceTime"] = _write_csv(
        "Inv_OccuranceTime",
        ["CaseMasterID", "IncidentFromDate", "IncidentToDate", "InfoReceivedPSDate",
         "latitude", "longitude"], occ_rows)

    # ---- ActSectionAssociation (one row per case that has an act) ----
    asa_rows = []
    for c in cases:
        if not c.get("act"):
            continue
        cmid = _case_int(c["case_id"])
        sec = str(c["section"]) if c.get("section") else None
        asa_rows.append([cmid, c["act"], sec, 1, 1])
    counts["ActSectionAssociation"] = _write_csv(
        "ActSectionAssociation",
        ["CaseMasterID", "ActID", "SectionID", "ActOrderID", "SectionOrderID"], asa_rows)

    # ---- ComplainantDetails / Victim / Accused ----
    comp_rows = []
    for i, r in enumerate(complainant_rows, start=1):
        cmid = _case_int(r["case_id"])
        comp_rows.append([i, cmid, r["name"], r["age"], occ_id[r["occupation"]],
                          rel_id[r["religion"]], caste_id[r["caste"]],
                          GENDER_ID.get(r["gender"], 1)])
    counts["ComplainantDetails"] = _write_csv(
        "ComplainantDetails",
        ["ComplainantID", "CaseMasterID", "ComplainantName", "AgeYear", "OccupationID",
         "ReligionID", "CasteID", "GenderID"], comp_rows)

    vic_rows = []
    for i, r in enumerate(victim_rows, start=1):
        cmid = _case_int(r["case_id"])
        vic_rows.append([i, cmid, r["name"], r["age"], GENDER_ID.get(r["gender"], 1),
                         str(r.get("victim_police", 0))])
    counts["Victim"] = _write_csv(
        "Victim", ["VictimMasterID", "CaseMasterID", "VictimName", "AgeYear",
                   "GenderID", "VictimPolice"], vic_rows)

    # Accused is per-(case, person). Index (case_id, person_id) -> AccusedMasterID
    acc_rows = []
    acc_key: dict[tuple, int] = {}
    for i, r in enumerate(accused_rows, start=1):
        cmid = _case_int(r["case_id"])
        acc_key[(r["case_id"], r["person_id"])] = i
        age = AGE_BAND_MID.get(r.get("age_band"), None)
        acc_rows.append([i, cmid, r["name"], age, GENDER_ID.get(r["gender"], 1), r["sort"]])
    counts["Accused"] = _write_csv(
        "Accused", ["AccusedMasterID", "CaseMasterID", "AccusedName", "AgeYear",
                    "GenderID", "PersonID"], acc_rows)

    # ---- ArrestSurrender + junction ----
    arr_rows, junction_rows = [], []
    for i, a in enumerate(arrests, start=1):
        asid = i
        cmid = _case_int(a["case_id"])
        gid = case_gid.get(cmid)
        amid = acc_key.get((a["case_id"], a["person_id"]))
        uid = unit_id.get(a["unit_id"])
        arr_rows.append([asid, cmid, 1, a["date"], state_id, dist_id.get(gid),
                         uid, unit_officer.get(a["unit_id"]), court_id.get(gid), amid, 1, 0])
        if amid is not None:
            junction_rows.append([asid, amid])
    counts["ArrestSurrender"] = _write_csv(
        "ArrestSurrender",
        ["ArrestSurrenderID", "CaseMasterID", "ArrestSurrenderTypeID", "ArrestSurrenderDate",
         "ArrestSurrenderStateId", "ArrestSurrenderDistrictId", "PoliceStationID", "IOID",
         "CourtID", "AccusedMasterID", "IsAccused", "IsComplainantAccused"], arr_rows)
    counts["inv_arrestsurrenderaccused"] = _write_csv(
        "inv_arrestsurrenderaccused", ["ArrestSurrenderID", "AccusedMasterID"], junction_rows)

    # ---- ChargesheetDetails ----
    cs_rows = []
    for i, cs in enumerate(chargesheets, start=1):
        cmid = _case_int(cs["case_id"])
        officer = None
        cs_rows.append([i, cmid, f"{cs['cs_date']} 10:00:00", cs["cs_type"], officer])
    counts["ChargesheetDetails"] = _write_csv(
        "ChargesheetDetails", ["CSID", "CaseMasterID", "csdate", "cstype", "PolicePersonID"], cs_rows)

    # ---- CrimeHeadActSection (map each sub-head's category to its act/section) ----
    chas_rows = []
    seen_chas = set()
    for c in cases:
        if not c.get("act"):
            continue
        key = (head_id[c["crime_major_head"]], c["act"], str(c["section"]) if c.get("section") else "")
        if key in seen_chas:
            continue
        seen_chas.add(key)
        chas_rows.append([key[0], c["act"], str(c["section"]) if c.get("section") else None])
    counts["CrimeHeadActSection"] = _write_csv(
        "CrimeHeadActSection", ["CrimeHeadID", "ActCode", "SectionCode"], chas_rows)

    return {"tables": len(counts), "rows": sum(counts.values()), "by_table": counts,
            "out_dir": str(DATASTORE_DIR)}


if __name__ == "__main__":
    stats = run()
    print(f"Data Store CSVs -> {stats['out_dir']}")
    print(f"{stats['tables']} tables, {stats['rows']:,} total rows")
    for name, n in stats["by_table"].items():
        print(f"  {name:<28} {n:>7,}")
