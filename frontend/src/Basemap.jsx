import React from 'react';
import { TileLayer } from 'react-leaflet';

// Shared basemap for every Leaflet map in the app.
//
// This replaced CARTO's `light_all` tiles, which now require an API key: requests
// without one still return HTTP 200, but the image is stamped "API KEY REQUIRED",
// so the map silently degrades instead of failing loudly.
//
// Esri's World Light Gray Canvas is the closest key-free equivalent — the same pale
// canvas that keeps a choropleth readable on top. Esri splits it into two layers:
// the base geometry, and a reference layer carrying place labels. Both sit in
// Leaflet's tilePane, so labels render above the base and below the data overlays,
// which is exactly how the CARTO layer behaved.
//
// Note the axis order: Esri serves {z}/{y}/{x}, not the {z}/{x}/{y} most XYZ
// providers use. Getting this backwards yields a valid-looking but wrong map.
//
// If these ever need replacing, update `img-src` in BOTH copies of the CSP —
// frontend/index.html and backend/app/config.py — or the tiles are blocked outright.

const ESRI = 'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas';
const MAX_ZOOM = 16; // the Light Gray Canvas service stops here

export default function Basemap() {
  return (
    <>
      <TileLayer
        url={`${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`}
        attribution="Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ"
        maxZoom={MAX_ZOOM}
      />
      <TileLayer
        url={`${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`}
        maxZoom={MAX_ZOOM}
      />
    </>
  );
}
