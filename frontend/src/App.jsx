import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import Dashboard from './dash/Dashboard.jsx';
import { AboutPage, FAQPage, ContactPage } from './Pages.jsx';

// Primary navigation — mirrors the official KSP portal's menu.
// `caret` marks a menu that shows a dropdown chevron on the real portal.
const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About Us' },
  { id: 'faq', label: 'FAQ' },
  { id: 'contact', label: 'Contact Us' },
];

const ROUTE_IDS = NAV.map((n) => n.id);

function currentRoute() {
  const h = window.location.hash.replace(/^#\/?/, '');
  return ROUTE_IDS.includes(h) ? h : 'home';
}

export default function App() {
  const [meta, setMeta] = useState(null);
  const [route, setRoute] = useState(currentRoute());

  useEffect(() => {
    api.meta().then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    const onHash = () => { setRoute(currentRoute()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (id) => { window.location.hash = `/${id}`; };

  return (
    <Shell meta={meta} route={route} go={go}>
      {route === 'home' && <Dashboard meta={meta} />}
      {route === 'about' && <AboutPage />}
      {route === 'faq' && <FAQPage />}
      {route === 'contact' && <ContactPage />}
    </Shell>
  );
}

// ===========================================================
// Karnataka State Police chrome, reproducing the official portal's
// three-row masthead: a teal→purple utility bar, a white masthead with
// the Chief Minister & Home Minister banners flanking the state emblem
// and bilingual title, and a blue→purple primary navigation bar.
// ===========================================================
function Shell({ meta, route, go, children }) {
  const active = NAV.find((n) => n.id === route)?.label ?? '';
  const [searchOpen, setSearchOpen] = useState(false);
  const [sq, setSq] = useState('');
  const results = sq.trim()
    ? NAV.filter((n) => n.label.toLowerCase().includes(sq.trim().toLowerCase()))
    : NAV.filter((n) => n.id !== 'home');
  const pickSearch = (id) => { setSearchOpen(false); setSq(''); go(id); };

  // Font Size controls — scale the root font size (rem-based layout follows).
  const setFont = (delta) => {
    const html = document.documentElement;
    const cur = parseFloat(html.style.fontSize) || 16;
    const next = delta === 0 ? 16 : Math.min(22, Math.max(12, cur + delta));
    html.style.fontSize = `${next}px`;
  };

  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>

      {/* Row 1 — top utility bar (solid navy) */}
      <div className="ksp-topbar">
        <div className="ksp-topbar-in">
          <div className="ktb-left">
            <a href="https://ksp.karnataka.gov.in/" target="_blank" rel="noreferrer" className="ktb-item">Official Website of GoK</a>
          </div>
          <div className="ktb-right">
            {/* Accessibility statement lives in the About page's a11y section. */}
            <a href="#/about" className="ktb-item ktb-hide-sm">Accessibility</a>
            <span className="ktb-font">
              Font Size
              <button type="button" aria-label="Decrease font size" onClick={() => setFont(-1)}>A-</button>
              <button type="button" aria-label="Reset font size" onClick={() => setFont(0)}>A</button>
              <button type="button" aria-label="Increase font size" onClick={() => setFont(1)}>A+</button>
            </span>
            <SocialBar />
            <span className="ktb-emergency"><span className="ktb-phone" aria-hidden="true">📞</span> Emergency Number : <b>112</b></span>
          </div>
        </div>
      </div>

      {/* Row 2 — masthead: state emblem + bilingual title */}
      <header className="ksp-masthead">
        <div className="ksp-masthead-in ksp-masthead-center">
          <a
            className="ksp-brand"
            href="#/home"
            onClick={(e) => { e.preventDefault(); go('home'); }}
          >
            <img className="ksp-emblem" src="/ksp-main-logo.png" alt="Karnataka State Emblem" />
            <span className="ksp-brand-text">
              <b>Karnataka State Police</b>
              <span className="ksp-brand-sub">Government of Karnataka</span>
            </span>
          </a>
        </div>
      </header>

      {/* Row 3 — primary navigation (solid blue) */}
      <nav className="ksp-nav" aria-label="Primary">
        <div className="ksp-nav-in">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={route === n.id ? 'on' : ''}
              onClick={() => go(n.id)}
              aria-current={route === n.id ? 'page' : undefined}
            >
              {n.id === 'home' && (
                <svg className="nav-home-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v9h5v-5h4v5h5v-9" /></svg>
              )}
              {n.label}
              {n.caret && <span className="nav-caret" aria-hidden="true">▾</span>}
            </button>
          ))}
          <button
            className={`ksp-nav-search ${searchOpen ? 'on' : ''}`}
            aria-label="Search"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </button>
        </div>

        {searchOpen && (
          <div className="ksp-search-panel">
            <div className="ksp-search-in">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                autoFocus
                type="search"
                value={sq}
                placeholder="Search the portal…"
                onChange={(e) => setSq(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) pickSearch(results[0].id); if (e.key === 'Escape') setSearchOpen(false); }}
              />
              <button type="button" aria-label="Close search" onClick={() => setSearchOpen(false)}>✕</button>
            </div>
            <ul className="ksp-search-results">
              {results.map((n) => (
                <li key={n.id}><button onClick={() => pickSearch(n.id)}>{n.label}</button></li>
              ))}
              {!results.length && <li className="ksp-search-empty">No matching sections.</li>}
            </ul>
          </div>
        )}
      </nav>

      {route !== 'home' && <div className="gov-context">
        <div className="gov-context-in">
          <span className="crumb">
            <a href="#/home" onClick={(e) => { e.preventDefault(); go('home'); }}>Home</a>
            {route !== 'home' && <><span className="crumb-sep">›</span> {active}</>}
          </span>
          {meta && (
            <span className="ctx-meta">
              {meta.district_count} districts · {meta.years[0]}–{meta.years[meta.years.length - 1]} ·
              latest {meta.latest_year}
            </span>
          )}
        </div>
      </div>}

      {/* The home console is full-bleed; the content pages keep the centred gov column. */}
      <main id="main" className={route === 'home' ? 'wrap wrap-full' : 'wrap'}>{children}</main>

      <GovFooter />
    </>
  );
}

// Social links shown in the KSP top utility bar.
function SocialBar() {
  return (
    <span className="ktb-social">
      <a href="https://www.youtube.com/@karnatakastatepolice6684" target="_blank" rel="noreferrer" aria-label="YouTube" title="YouTube">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M23 7.5a3 3 0 0 0-2.1-2.1C19 4.9 12 4.9 12 4.9s-7 0-8.9.5A3 3 0 0 0 1 7.5 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.5a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23.5 12 31 31 0 0 0 23 7.5zM9.7 15.4V8.6l5.8 3.4z"/></svg>
      </a>
      <a href="https://www.instagram.com/karnatakacops/" target="_blank" rel="noreferrer" aria-label="Instagram" title="Instagram">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.3 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.3 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.3-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.3-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 3.2A6.6 6.6 0 1 0 18.6 12 6.6 6.6 0 0 0 12 5.4zm0 10.9A4.3 4.3 0 1 1 16.3 12 4.3 4.3 0 0 1 12 16.3zm6.8-11.2a1.5 1.5 0 1 1-1.5-1.5 1.5 1.5 0 0 1 1.5 1.5z"/></svg>
      </a>
      <a href="https://www.facebook.com/KarnatakaCops/" target="_blank" rel="noreferrer" aria-label="Facebook" title="Facebook">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.3-1.5 1.6-1.5h1.7V3.6c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.1H7.3V13h2.5v8z"/></svg>
      </a>
      <a href="https://twitter.com/DgpKarnataka" target="_blank" rel="noreferrer" aria-label="Twitter / X" title="Twitter / X">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.2 2.5h3.3l-7.2 8.2 8.5 11.3h-6.7l-5.2-6.9-6 6.9H1.3l7.7-8.8L.8 2.5h6.8l4.7 6.3zm-1.2 17.8h1.8L7.1 4.3H5.1z"/></svg>
      </a>
    </span>
  );
}

function GovFooter() {
  return (
    <footer className="gov-footer">
      <div className="gov-footer-in">
        <div className="gf-col">
          <h4>Karnataka State Police</h4>
          <p className="gf-text">
            Crime Analytics &amp; Intelligence Platform — a decision-support tool
            for data-driven policing across Karnataka districts.
          </p>
          <p className="gf-text gf-warn">
            ⚠ Person-level offender &amp; network data shown here is synthetic
            (no open person-level crime data exists) and anchored to real district
            crime volumes. District crime figures are real (NCRB).
          </p>
        </div>
        <div className="gf-col">
          <h4>Quick Links</h4>
          <ul className="gf-links">
            <li><a href="#/home">Crime Analytics</a></li>
            <li><a href="#/about">About Us</a></li>
            <li><a href="#/faq">FAQ</a></li>
            <li><a href="#/contact">Contact Us</a></li>
          </ul>
        </div>
        <div className="gf-col">
          <h4>Related Links</h4>
          <ul className="gf-links">
            <li><a href="https://karnataka.gov.in" target="_blank" rel="noreferrer">Government of Karnataka</a></li>
            <li><a href="https://ksp.karnataka.gov.in" target="_blank" rel="noreferrer">Karnataka State Police</a></li>
            <li><a href="https://ncrb.gov.in" target="_blank" rel="noreferrer">NCRB</a></li>
            <li><a href="https://www.india.gov.in" target="_blank" rel="noreferrer">India.gov.in</a></li>
            <li><a href="https://www.digitalindia.gov.in" target="_blank" rel="noreferrer">Digital India</a></li>
          </ul>
        </div>
        <div className="gf-col">
          <h4>Help &amp; Emergency</h4>
          <ul className="gf-links">
            <li>Police Control Room: <a href="tel:100"><b>100</b></a></li>
            <li>Emergency Response: <a href="tel:112"><b>112</b></a></li>
            <li>Women Helpline: <a href="tel:1091"><b>1091</b></a></li>
            <li>Childline: <a href="tel:1098"><b>1098</b></a></li>
            <li>Cyber Crime: <a href="tel:1930"><b>1930</b></a></li>
          </ul>
        </div>
      </div>
      <div className="gov-footer-bar">
        <span>
          © {new Date().getFullYear()} Karnataka State Police, Government of Karnataka.
          Content owned and maintained by Karnataka State Police.
        </span>
        <span>Best viewed in modern browsers · Built for the AI-Driven Crime Analytics pilot</span>
      </div>
    </footer>
  );
}
