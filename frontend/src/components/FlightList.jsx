import { useMemo } from 'react';

const M_TO_FT = 3.28084;
const MS_TO_KTS = 1.944;
const MAX_ROWS = 50;

// OpenSky reports `origin_country` as a full name. This covers the common
// hits so we can render a flag emoji; unknowns just render no flag.
const COUNTRY_ISO2 = {
  'United States': 'US',
  'Canada': 'CA',
  'Mexico': 'MX',
  'United Kingdom': 'GB',
  'Ireland': 'IE',
  'France': 'FR',
  'Germany': 'DE',
  'Spain': 'ES',
  'Portugal': 'PT',
  'Italy': 'IT',
  'Netherlands': 'NL',
  'Belgium': 'BE',
  'Luxembourg': 'LU',
  'Switzerland': 'CH',
  'Austria': 'AT',
  'Denmark': 'DK',
  'Norway': 'NO',
  'Sweden': 'SE',
  'Finland': 'FI',
  'Iceland': 'IS',
  'Poland': 'PL',
  'Czech Republic': 'CZ',
  'Slovakia': 'SK',
  'Hungary': 'HU',
  'Romania': 'RO',
  'Bulgaria': 'BG',
  'Greece': 'GR',
  'Turkey': 'TR',
  'Russian Federation': 'RU',
  'Ukraine': 'UA',
  'Belarus': 'BY',
  'Estonia': 'EE',
  'Latvia': 'LV',
  'Lithuania': 'LT',
  'China': 'CN',
  'Japan': 'JP',
  'Republic of Korea': 'KR',
  'India': 'IN',
  'Pakistan': 'PK',
  'Singapore': 'SG',
  'Malaysia': 'MY',
  'Indonesia': 'ID',
  'Thailand': 'TH',
  'Viet Nam': 'VN',
  'Australia': 'AU',
  'New Zealand': 'NZ',
  'Brazil': 'BR',
  'Argentina': 'AR',
  'Chile': 'CL',
  'Colombia': 'CO',
  'Peru': 'PE',
  'United Arab Emirates': 'AE',
  'Saudi Arabia': 'SA',
  'Qatar': 'QA',
  'Israel': 'IL',
  'Egypt': 'EG',
  'South Africa': 'ZA',
  'Morocco': 'MA',
  'Nigeria': 'NG',
};

function flagFromCountry(country) {
  if (!country) return '';
  const code = COUNTRY_ISO2[country];
  if (!code) return '';
  const A = 0x1f1e6;
  return String.fromCodePoint(
    ...code.toUpperCase().split('').map((c) => A + c.charCodeAt(0) - 65),
  );
}

function altitudeRank(flight) {
  // Sort key: on-ground flights pinned to bottom, otherwise descending altitude.
  if (flight.on_ground) return -Infinity;
  return flight.altitude_m ?? -Number.MAX_SAFE_INTEGER + 1;
}

export default function FlightList({ flights, lockedIcao24, onToggleLock, onClose }) {
  const sorted = useMemo(() => {
    return [...flights]
      .sort((a, b) => altitudeRank(b) - altitudeRank(a))
      .slice(0, MAX_ROWS);
  }, [flights]);

  return (
    <aside className="flight-list">
      <header className="fl-header">
        <h2 className="fl-title">Flights</h2>
        <div className="fl-header-actions">
          <div className="fl-count">{flights.length} total</div>
          {onClose && (
            <button
              type="button"
              className="fl-close-btn"
              onClick={onClose}
              aria-label="Close flight list"
            >
              ×
            </button>
          )}
        </div>
      </header>

      {flights.length === 0 ? (
        <div className="fl-empty">No aircraft yet — waiting for data…</div>
      ) : (
        <ul className="fl-rows">
          {sorted.map((f) => {
            const callsign = f.callsign?.trim() || f.icao24;
            const altFt =
              f.altitude_m != null ? Math.round(f.altitude_m * M_TO_FT) : null;
            const speedKts =
              f.velocity_ms != null ? Math.round(f.velocity_ms * MS_TO_KTS) : null;
            const flag = flagFromCountry(f.country);
            const routeText =
              f.from && f.to
                ? `${f.from} → ${f.to}`
                : f.from
                  ? `${f.from} → …`
                  : f.to
                    ? `… → ${f.to}`
                    : '—';

            return (
              <li
                key={f.icao24}
                className={`fl-row ${f.on_ground ? 'on-ground' : ''} ${lockedIcao24 === f.icao24 ? 'locked' : ''}`}
                onClick={() => onToggleLock(f.icao24)}
                title={f.country || ''}
              >
                <div className="fl-row-main">
                  {flag && <span className="fl-flag" aria-hidden="true">{flag}</span>}
                  <span className="fl-callsign">{callsign}</span>
                </div>
                <div className="fl-row-meta">
                  <span>{routeText}</span>
                </div>
                <div className="fl-row-meta">
                  <span>{altFt != null ? `${altFt.toLocaleString()} ft` : '—'}</span>
                  <span className="fl-dot">·</span>
                  <span>{speedKts != null ? `${speedKts} kts` : '—'}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
