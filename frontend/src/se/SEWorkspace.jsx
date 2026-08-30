import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import '../ops/ops.css';
import { Empty, Skeleton, fmt } from '../ops/ui.jsx';
import { MethodologyDrawer } from './SEParts.jsx';
import DistrictProfile from './DistrictProfile.jsx';
import { Advanced, AssociationDetail, Compare, Explorer, Register, StandOut } from './SEViews.jsx';

// ===========================================================
// Socio-economic Intelligence.
//
// The page used to open on a 30-row correlation matrix and leave the
// officer to interpret Pearson r. It now opens on a district, and
// works outward:
//
//   which district -> what is it like -> what stands out ->
//   how strong is the evidence -> which districts compare ->
//   what should I look at next
//
// The matrix, the r values, the p-values and the methodology are all
// still here in full, one tab across, under Advanced analysis. Nothing
// was removed; the intelligence was put in front of the mathematics.
// ===========================================================

const VIEWS = {
  REGISTER: 'register',
  DISTRICT: 'district',
  STANDOUT: 'standout',
  EXPLORER: 'explorer',
  COMPARE: 'compare',
  ADVANCED: 'advanced',
  ASSOCIATION: 'association',
};

export default function SEWorkspace({ onOpenCrimeIntel, onOpenFirs }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const [view, setView] = useState(VIEWS.DISTRICT);
  const [districtId, setDistrictId] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [indicator, setIndicator] = useState('population_density');
  const [associationId, setAssociationId] = useState(null);

  useEffect(() => {
    let dead = false;
    api.seIntel()
      .then((d) => {
        if (dead) return;
        setData(d);
        // Open on the district with the most recorded cases — a defensible
        // default that is never an empty page.
        const first = Object.values(d.districts)
          .sort((a, b) => (b.total_cognizable_cases || 0) - (a.total_cognizable_cases || 0))[0];
        setDistrictId(first?.geo_unit_id || null);
        setCompareIds(first ? [first.geo_unit_id, first.similar[0]?.geo_unit_id].filter(Boolean) : []);
      })
      .catch((e) => !dead && setError(e.message));
    return () => { dead = true; };
  }, []);

  const go = useCallback((v) => { setView(v); window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);

  const district = data && districtId ? data.districts[districtId] : null;

  const associationsById = useMemo(() => {
    const m = new Map();
    data?.associations.forEach((a) => m.set(a.association_id, a));
    return m;
  }, [data]);

  const openAssociation = useCallback((id) => { setAssociationId(id); go(VIEWS.ASSOCIATION); }, [go]);
  const openDistrict = useCallback((id) => { setDistrictId(id); go(VIEWS.DISTRICT); }, [go]);
  const openExplorer = useCallback((ind) => { setIndicator(ind); go(VIEWS.EXPLORER); }, [go]);
  const openCompare = useCallback((otherId) => {
    setCompareIds([districtId, otherId].filter(Boolean));
    go(VIEWS.COMPARE);
  }, [districtId, go]);

  if (error) {
    return (
      <div className="ops"><div className="ops-body">
        <div className="data-note"><b>API error</b><span>{error}</span></div>
      </div></div>
    );
  }
  if (!data) return <div className="ops"><div className="ops-body"><Skeleton h={420} /></div></div>;

  const districtOptions = Object.values(data.districts)
    .map((d) => ({ id: d.geo_unit_id, name: d.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const tabs = [
    { id: VIEWS.REGISTER, label: 'District register', count: districtOptions.length },
    { id: VIEWS.DISTRICT, label: 'District intelligence' },
    { id: VIEWS.STANDOUT, label: 'What stands out', count: data.headline_ids.length },
    { id: VIEWS.EXPLORER, label: 'Indicator explorer', count: data.indicators.length },
    { id: VIEWS.COMPARE, label: 'Compare districts' },
    { id: VIEWS.ADVANCED, label: 'Advanced analysis', count: data.associations.length },
  ];

  return (
    <div className="ops">
      <div className="ops-head">
        <div className="ops-head-top">
          <div className="ops-title">
            <h1>Socio-economic Intelligence</h1>
            <span className="ops-sub">
              The social and economic context behind crime patterns across Karnataka
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <span className="ops-asof">
            Census 2011 × NCRB {data.crime_year} · n = {data.n_districts} districts
          </span>
        </div>

        <nav className="ops-tabs" aria-label="Socio-economic intelligence sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={view === t.id || (t.id === VIEWS.STANDOUT && view === VIEWS.ASSOCIATION) ? 'on' : ''}
              onClick={() => go(t.id)}
            >
              {t.label}
              {t.count != null && <span className="tab-count">{fmt(t.count)}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="ops-body">
        {/* The selector stays above every view: the chosen district is the page's
            context, not a one-time step the officer has to go back for. */}
        {view !== VIEWS.ADVANCED && view !== VIEWS.REGISTER && (
          <div className="se-select">
            <div className="se-select-lead">
              <h2>Understand a district</h2>
              <p>Pick a district to see its socio-economic context and the crime patterns observed alongside it.</p>
            </div>
            <div className="field">
              <label>District</label>
              <select value={districtId || ''} onChange={(e) => openDistrict(e.target.value)}>
                {districtOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Compare with</label>
              <select
                value={compareIds[1] || ''}
                onChange={(e) => setCompareIds([districtId, e.target.value].filter(Boolean))}
              >
                <option value="">State average</option>
                {districtOptions.filter((d) => d.id !== districtId)
                  .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Period</label>
              <select value={data.crime_year} disabled>
                <option>{data.crime_year} (latest reported)</option>
              </select>
            </div>
            <button className="btn btn-primary" onClick={() => go(VIEWS.DISTRICT)}>
              View district intelligence
            </button>
            {compareIds.length >= 2 && (
              <button className="btn" onClick={() => go(VIEWS.COMPARE)}>Compare districts</button>
            )}
          </div>
        )}

        {view === VIEWS.DISTRICT && (
          district ? (
            <DistrictProfile
              district={district}
              state={data.state}
              associations={data.associations}
              headlineIds={data.headline_ids}
              onOpenAssociation={openAssociation}
              onCompare={openCompare}
              onOpenCrimeIntel={(d) => onOpenCrimeIntel?.(d.geo_unit_id)}
              onOpenFirs={(f) => onOpenFirs?.(f)}
            />
          ) : <Empty>Select a district.</Empty>
        )}

        {view === VIEWS.REGISTER && (
          <Register
            data={data}
            onOpenDistrict={openDistrict}
            onOpenCrimeIntel={(d) => onOpenCrimeIntel?.(d.geo_unit_id)}
          />
        )}

        {view === VIEWS.STANDOUT && (
          <StandOut data={data} onOpen={openAssociation} onExplore={openExplorer} />
        )}

        {view === VIEWS.EXPLORER && (
          <Explorer data={data} indicator={indicator} setIndicator={setIndicator} onOpen={openAssociation} />
        )}

        {view === VIEWS.COMPARE && (
          <Compare
            data={data}
            ids={compareIds}
            setIds={setCompareIds}
            onOpenDistrict={openDistrict}
            onOpenCrimeIntel={(d) => onOpenCrimeIntel?.(d.geo_unit_id)}
          />
        )}

        {view === VIEWS.ADVANCED && <Advanced data={data} onOpen={openAssociation} />}

        {view === VIEWS.ASSOCIATION && (
          <AssociationDetail
            data={data}
            association={associationsById.get(associationId)}
            district={district}
            onBack={() => go(VIEWS.STANDOUT)}
            onOpenDistrict={openDistrict}
            onOpenCrimeIntel={() => onOpenCrimeIntel?.(districtId)}
          />
        )}

        <MethodologyDrawer data={data} />

        <div className="data-note"><b>Data</b><span>{data.data_note}</span></div>
      </div>
    </div>
  );
}
