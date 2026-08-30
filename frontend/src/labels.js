// Shared display labels.
//
// The analytics model uses "Medium"; the portal presents it as "Moderate". That
// mapping was duplicated in three components, so a change in one left the others
// inconsistent — it lives here now.

export const BAND_LABEL = {
  Critical: 'Critical',
  High: 'High',
  Medium: 'Moderate',
  Low: 'Low',
};

export const bandLabel = (band) => BAND_LABEL[band] ?? band ?? '—';

export const STATUS_LABEL = {
  none: 'Stable',
  emerging: 'Emerging',
  established: 'Hotspot',
};

export const statusLabel = (status) => STATUS_LABEL[status] ?? status ?? '—';
