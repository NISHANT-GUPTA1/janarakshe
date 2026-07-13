import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BAND_COLOR, fmt } from './palette.js';

// ===========================================================
// 3D extruded choropleth of Karnataka.
//
// Each district polygon is extruded to a height proportional to the selected
// metric and coloured by its risk band — so magnitude is carried by height
// (a quantitative channel) and state by the reserved status colour, rather than
// overloading one channel. FIR hotspot pillars and per-hour incident points
// can be layered on top of the same projection.
// ===========================================================

const METRICS = [
  { id: 'risk_score', label: 'Risk score', unit: '' },
  { id: 'crime_rate_per_100k', label: 'Crime rate / 100k', unit: '' },
  { id: 'total_cognizable_cases', label: 'Cognizable cases', unit: '' },
  { id: 'severity_weighted_index', label: 'Severity index', unit: '' },
];

// Equirectangular projection, good enough at a single state's extent.
// SCALE is chosen so the state spans ~35 world units, which keeps the extrusion
// heights (0.35–5.6) reading as real relief rather than as a flat sheet.
const LON0 = 76.6;
const LAT0 = 15.0;
const SCALE = 5;
const projX = (lon) => (lon - LON0) * Math.cos((LAT0 * Math.PI) / 180) * SCALE;
const projY = (lat) => (lat - LAT0) * SCALE;

export default function District3D({ districts, boundaries, firHotspots = [], firPoints = [], hour, selectedId, onSelect }) {
  const mount = useRef(null);
  const scene = useRef(null);
  const [metric, setMetric] = useState('crime_rate_per_100k');
  const [showPillars, setShowPillars] = useState(true);
  const [spin, setSpin] = useState(true);
  const [tip, setTip] = useState(null);

  // The click handler is read through a ref so the boot effect can hold an empty
  // dependency list. Depending on `onSelect` directly would tear the whole WebGL
  // scene down and rebuild it on every parent re-render, orphaning the district
  // and pillar layers (whose build effects would not re-run) and leaving an
  // empty canvas.
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  // ---- boot the renderer once ----
  useEffect(() => {
    const el = mount.current;
    if (!el) return undefined;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const sc = new THREE.Scene();
    sc.fog = new THREE.Fog(0x0e1626, 34, 78);

    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / el.clientHeight, 0.1, 400);
    camera.position.set(0, 30, 30);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 14;
    controls.maxDistance = 70;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.autoRotateSpeed = 0.5;
    controls.target.set(0, 0, 0);

    sc.add(new THREE.AmbientLight(0x8fa8c8, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(18, 30, 14);
    sc.add(key);
    const rim = new THREE.DirectionalLight(0x3987e5, 0.9);
    rim.position.set(-20, 12, -18);
    sc.add(rim);

    // faint ground grid so the extrusions read as standing on a plane
    const grid = new THREE.GridHelper(90, 36, 0x24344e, 0x1a2436);
    grid.position.y = -0.02;
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    sc.add(grid);

    // All data layers live under one world group. Once the districts are built we
    // shift that group so the state's centroid sits on the origin — which keeps the
    // orbit target, the ground grid and the fog all centred on the map for free.
    const world = new THREE.Group();
    const districtGroup = new THREE.Group();
    const pillarGroup = new THREE.Group();
    const pointGroup = new THREE.Group();
    world.add(districtGroup, pillarGroup, pointGroup);
    sc.add(world);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hovered = null;

    const onMove = (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(districtGroup.children, false);
      const hit = hits.find((h) => h.object.userData?.d)?.object ?? null;

      if (hovered && hovered !== hit) hovered.material.emissiveIntensity = hovered.userData.baseEmissive;
      hovered = hit;
      if (hit) {
        hit.material.emissiveIntensity = 0.75;
        setTip({ x: e.clientX - r.left, y: e.clientY - r.top, d: hit.userData.d });
        renderer.domElement.style.cursor = 'pointer';
      } else {
        setTip(null);
        renderer.domElement.style.cursor = 'grab';
      }
    };
    const onLeave = () => {
      if (hovered) hovered.material.emissiveIntensity = hovered.userData.baseEmissive;
      hovered = null;
      setTip(null);
    };
    const onClick = () => { if (hovered?.userData?.d) onSelectRef.current?.(hovered.userData.d.geo_unit_id); };

    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerleave', onLeave);
    renderer.domElement.addEventListener('click', onClick);

    let raf;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      pointGroup.children.forEach((p) => { p.rotation.y += 0.002; });
      renderer.render(sc, camera);
    };
    loop();

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(el);

    scene.current = { renderer, sc, camera, controls, world, districtGroup, pillarGroup, pointGroup, fitted: false };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('click', onClick);
      controls.dispose();
      sc.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      });
      renderer.dispose();
      el.removeChild(renderer.domElement);
      scene.current = null;
    };
  }, []);

  useEffect(() => {
    if (scene.current) scene.current.controls.autoRotate = spin;
  }, [spin]);

  // ---- (re)build the extruded districts whenever data or the metric changes ----
  useEffect(() => {
    const s = scene.current;
    if (!s || !boundaries || !districts.length) return;

    const { districtGroup, world, camera, controls } = s;
    districtGroup.clear();

    const byId = Object.fromEntries(districts.map((d) => [d.geo_unit_id, d]));
    const vals = districts.map((d) => d[metric]).filter((v) => typeof v === 'number');
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;

    for (const f of boundaries.features) {
      const d = byId[f.properties.geo_unit_id];
      if (!d) continue;

      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      const norm = (d[metric] - min) / span;
      const depth = 0.35 + norm * 5.2;
      const color = new THREE.Color(BAND_COLOR[d.risk_band] ?? '#3a4a63');

      for (const rings of polys) {
        const outer = rings[0];
        if (!outer || outer.length < 3) continue;

        const shape = new THREE.Shape();
        outer.forEach(([lon, lat], i) => {
          const x = projX(lon);
          const y = projY(lat);
          if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
        });
        // interior rings become holes so enclaves don't get filled in
        for (let h = 1; h < rings.length; h++) {
          const hole = new THREE.Path();
          rings[h].forEach(([lon, lat], i) => {
            const x = projX(lon);
            const y = projY(lat);
            if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y);
          });
          shape.holes.push(hole);
        }

        const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
        const isSel = selectedId === d.geo_unit_id;
        const baseEmissive = isSel ? 0.55 : 0.18;
        const mat = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: baseEmissive,
          roughness: 0.55,
          metalness: 0.12,
          transparent: true,
          opacity: 0.95,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2; // lay the map flat; extrusion becomes height
        mesh.userData = { d, baseEmissive };
        districtGroup.add(mesh);

        // hairline top edge — reads as a crisp rim rather than a mushy shaded face
        const edges = new THREE.EdgesGeometry(geo, 30);
        const line = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: isSel ? 0xffffff : 0x0b1220, transparent: true, opacity: isSel ? 0.9 : 0.45 })
        );
        line.rotation.x = -Math.PI / 2;
        districtGroup.add(line);
      }
    }

    // Centre the world on the state's footprint and frame the camera to it, once.
    // Re-fitting on every metric change would yank the camera out from under a
    // user who has already orbited somewhere.
    if (!s.fitted) {
      const box = new THREE.Box3().setFromObject(districtGroup);
      const centre = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      world.position.set(-centre.x, 0, -centre.z);

      // The 45-degree tilt foreshortens the north-south extent, so a full-extent fit
      // leaves the map marooned in the middle of the canvas — pad in, not out.
      const extent = Math.max(size.x, size.z);
      const dist = (extent / 2) / Math.tan((camera.fov * Math.PI) / 360) * 0.82;
      camera.position.set(0, dist * 0.80, dist * 0.62);
      controls.target.set(0, 0, 0);
      controls.maxDistance = dist * 1.9;
      controls.minDistance = dist * 0.35;
      controls.update();

      // fog has to track the fitted distance, or it either does nothing or eats the map
      s.sc.fog.near = dist * 0.85;
      s.sc.fog.far = dist * 2.6;
      s.fitted = true;
    }
  }, [districts, boundaries, metric, selectedId]);

  // ---- FIR hotspot pillars ----
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const { pillarGroup } = s;
    pillarGroup.clear();
    if (!showPillars || !firHotspots.length) return;

    const maxC = Math.max(...firHotspots.map((h) => h.count), 1);
    for (const h of firHotspots) {
      const hgt = 1.2 + (h.count / maxC) * 7;
      const heavy = h.heinous > 0;
      const col = new THREE.Color(heavy ? '#e66767' : '#3987e5');
      const geo = new THREE.CylinderGeometry(0.13, 0.13, hgt, 10);
      const mat = new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 1.1, transparent: true, opacity: 0.85,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(projX(h.lon), 6 + hgt / 2, -projY(h.lat));
      pillarGroup.add(m);

      const capGeo = new THREE.SphereGeometry(0.24, 12, 10);
      const cap = new THREE.Mesh(capGeo, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.95 }));
      cap.position.set(projX(h.lon), 6 + hgt, -projY(h.lat));
      pillarGroup.add(cap);
    }
  }, [firHotspots, showPillars]);

  // ---- incident points for the scrubbed hour ----
  useEffect(() => {
    const s = scene.current;
    if (!s) return;
    const { pointGroup } = s;
    pointGroup.clear();
    if (hour == null || !firPoints.length) return;

    const at = firPoints.filter((p) => p.hour === hour);
    if (!at.length) return;

    const pos = new Float32Array(at.length * 3);
    const col = new Float32Array(at.length * 3);
    at.forEach((p, i) => {
      pos[i * 3] = projX(p.lon);
      pos[i * 3 + 1] = 6.4;
      pos[i * 3 + 2] = -projY(p.lat);
      const c = new THREE.Color(p.gravity === 'Heinous' ? '#e66767' : '#fab219');
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true })
    );
    pointGroup.add(pts);
  }, [firPoints, hour]);

  const active = METRICS.find((m) => m.id === metric);

  return (
    <div className="d3d">
      <div className="d3d-bar">
        <div className="d3d-metrics" role="group" aria-label="Extrusion metric">
          {METRICS.map((m) => (
            <button key={m.id} className={metric === m.id ? 'on' : ''} onClick={() => setMetric(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="d3d-toggles">
          <button className={showPillars ? 'on' : ''} onClick={() => setShowPillars((v) => !v)}>
            FIR pillars
          </button>
          <button className={spin ? 'on' : ''} onClick={() => setSpin((v) => !v)}>
            {spin ? 'Pause spin' : 'Auto-rotate'}
          </button>
        </div>
      </div>

      <div className="d3d-canvas" ref={mount}>
        {tip && (
          <div className="d3d-tip" style={{ left: tip.x + 14, top: tip.y + 12 }}>
            <b>{tip.d.name}</b>
            <span className="d3d-tip-row">
              <i style={{ background: BAND_COLOR[tip.d.risk_band] }} />
              {tip.d.risk_band} risk · {tip.d.risk_score}
            </span>
            <span className="d3d-tip-row">{active.label}: <b>{fmt(tip.d[metric])}</b></span>
            <span className="d3d-tip-hint">Click to drill down</span>
          </div>
        )}
        <div className="d3d-hint">Drag to orbit · scroll to zoom · height = {active.label.toLowerCase()}</div>
      </div>

      <div className="d3d-legend">
        <span className="d3d-legend-t">Risk band</span>
        {Object.entries(BAND_COLOR).map(([b, c]) => (
          <span key={b} className="d3d-lg"><i style={{ background: c }} />{b}</span>
        ))}
        <span className="d3d-sep" />
        <span className="d3d-lg"><i className="pill" style={{ background: '#e66767' }} />Heinous hotspot</span>
        <span className="d3d-lg"><i className="pill" style={{ background: '#3987e5' }} />FIR hotspot</span>
        {hour != null && <span className="d3d-lg"><i className="dot" style={{ background: '#fab219' }} />Incidents at {String(hour).padStart(2, '0')}:00</span>}
      </div>
    </div>
  );
}
