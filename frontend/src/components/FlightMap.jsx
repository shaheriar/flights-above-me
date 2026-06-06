import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MapContainer,
  TileLayer,
  Marker,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import {
  sendViewport,
  useInterpolatedFlights,
} from '../hooks/useInterpolatedFlights.js';
import FlightTooltip from './FlightTooltip.jsx';
import AirportMarkers from './AirportMarkers.jsx';

const FALLBACK_CENTER = [0, 0];
const FALLBACK_ZOOM = 10;
const USER_ZOOM = 13;

function getUserLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation unavailable'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        }),
      reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}

function zoomFromRadiusDeg(radiusDeg) {
  if (!radiusDeg || radiusDeg <= 0) return FALLBACK_ZOOM;
  return Math.max(2, Math.min(14, Math.round(Math.log2(720 / radiusDeg))));
}

function radiusDegFromBounds(bounds) {
  const latSpan = bounds.getNorth() - bounds.getSouth();
  const lonSpan = bounds.getEast() - bounds.getWest();
  return Math.max(latSpan, lonSpan) / 2;
}

function reportViewport(map) {
  const center = map.getCenter();
  const radiusDeg = radiusDegFromBounds(map.getBounds());
  sendViewport(center.lat, center.lng, radiusDeg);
}

function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const invalidate = () => {
      map.invalidateSize();
    };

    invalidate();
    window.addEventListener('resize', invalidate);

    const container = map.getContainer();
    const observed = container.parentElement ?? container;
    const observer = new ResizeObserver(invalidate);
    observer.observe(observed);

    return () => {
      window.removeEventListener('resize', invalidate);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

function MapViewportReporter() {
  const map = useMapEvents({
    moveend: () => reportViewport(map),
    zoomend: () => reportViewport(map),
  });

  useEffect(() => {
    reportViewport(map);
  }, [map]);

  return null;
}

function MapDragUnlock({ lockedIcao24, onUnlock }) {
  useMapEvents({
    dragstart: () => {
      if (lockedIcao24) onUnlock();
    },
  });
  return null;
}

function FlightTracker({ lockedIcao24, flights, onUnlock }) {
  const map = useMap();
  const flightsRef = useRef(flights);
  flightsRef.current = flights;

  useEffect(() => {
    if (!lockedIcao24) return undefined;

    const flight = flightsRef.current.find((f) => f.icao24 === lockedIcao24);
    if (flight) {
      map.setView(
        [flight.latitude, flight.longitude],
        Math.max(map.getZoom(), USER_ZOOM),
        { animate: true },
      );
    }

    let rafId;
    const tick = () => {
      const f = flightsRef.current.find((x) => x.icao24 === lockedIcao24);
      if (!f) {
        onUnlock();
        return;
      }
      map.panTo([f.latitude, f.longitude], { animate: false });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, [lockedIcao24, map, onUnlock]);

  return null;
}

function LocateIcon() {
  return (
    <svg
      className="map-locate-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
    >
      <path
        d="M3 11 22 2 13 21 11 13 3 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LocateSpinner() {
  return (
    <svg
      className="map-locate-icon map-locate-spinner"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="28 56"
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg
      className="map-locate-icon"
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
    >
      <path
        d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CenterOnUserButton({ onLocated, onUnlock }) {
  const map = useMap();
  const [status, setStatus] = useState('idle');

  const handleClick = () => {
    if (!navigator.geolocation) {
      setStatus('error');
      return;
    }

    onUnlock();
    setStatus('loading');
    getUserLocation()
      .then(({ lat, lon }) => {
        onLocated({ lat, lon });
        const zoom = Math.max(map.getZoom(), USER_ZOOM);
        map.setView([lat, lon], zoom, { animate: true });
        setStatus('idle');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(() => {
    if (status !== 'error') return undefined;
    const timer = setTimeout(() => setStatus('idle'), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  return (
    <button
      type="button"
      className={`map-control-btn map-locate-btn ${status}`}
      onClick={handleClick}
      disabled={status === 'loading'}
      title={
        status === 'error'
          ? 'Could not get your location'
          : 'Center map on your location'
      }
      aria-label="Center map on your location"
    >
      {status === 'loading' ? <LocateSpinner /> : <LocateIcon />}
    </button>
  );
}

function MapControls({ onLocated, onUnlock, listOpen, onToggleList }) {
  const map = useMap();

  return createPortal(
    <div className="map-controls">
      <CenterOnUserButton onLocated={onLocated} onUnlock={onUnlock} />
      <button
        type="button"
        className={`map-control-btn map-flights-btn ${listOpen ? 'active' : ''}`}
        onClick={onToggleList}
        aria-pressed={listOpen}
        aria-expanded={listOpen}
        aria-label="Toggle flight list"
        title="Show flights"
      >
        <ListIcon />
      </button>
    </div>,
    map.getContainer(),
  );
}

const userLocationIcon = L.divIcon({
  className: 'user-location-divicon',
  html: '<div class="user-location-marker"><span class="user-location-pulse"></span><span class="user-location-dot"></span></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function UserLocationMarker({ position }) {
  if (!position) return null;

  return (
    <Marker position={[position.lat, position.lon]} icon={userLocationIcon} zIndexOffset={1000}>
      <Tooltip direction="top" offset={[0, -10]} opacity={0.95} permanent={false}>
        You are here
      </Tooltip>
    </Marker>
  );
}

function buildPlaneIcon(roundedHeading, onGround, isLocked) {
  const classes = ['plane-marker'];
  if (isLocked) classes.push('plane-marker-locked');
  if (onGround) classes.push('plane-marker-ground');
  const scale = isLocked ? 1.1 : 1;
  // The ✈ glyph's nose points east by default, so offset by -90° to align
  // the nose with the compass heading (0° = north).
  const rotation = roundedHeading - 90;
  const html = `
    <div class="${classes.join(' ')}" style="transform: rotate(${rotation}deg) scale(${scale});">✈</div>
  `;
  return L.divIcon({
    className: 'plane-divicon',
    html,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function FlightMarker({ flight, isLocked, onToggleLock }) {
  const heading = flight.heading ?? 0;
  const roundedHeading = Math.round(heading / 5) * 5;
  const onGround = !!flight.on_ground;

  const icon = useMemo(
    () => buildPlaneIcon(roundedHeading, onGround, isLocked),
    [roundedHeading, onGround, isLocked],
  );

  return (
    <Marker
      position={[flight.latitude, flight.longitude]}
      icon={icon}
      zIndexOffset={isLocked ? 500 : 0}
      eventHandlers={{
        click: (e) => {
          L.DomEvent.stopPropagation(e);
          onToggleLock(flight.icao24);
        },
      }}
    >
      <Tooltip direction="top" offset={[0, -12]} opacity={0.95}>
        <FlightTooltip flight={flight} />
      </Tooltip>
    </Marker>
  );
}

export default function FlightMap({
  listOpen,
  onToggleList,
  lockedIcao24,
  onToggleLock,
  onUnlock,
}) {
  const flights = useInterpolatedFlights();
  const [view, setView] = useState(null);
  const [userPosition, setUserPosition] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function initView() {
      let zoom = FALLBACK_ZOOM;

      try {
        const res = await fetch('http://localhost:8000/config');
        if (res.ok) {
          const data = await res.json();
          zoom = zoomFromRadiusDeg(data?.radius_deg);
        }
      } catch {
        // Use default zoom when config is unavailable.
      }

      try {
        const { lat, lon } = await getUserLocation();
        if (cancelled) return;
        setUserPosition({ lat, lon });
        setView({
          center: [lat, lon],
          zoom: Math.max(zoom, USER_ZOOM),
        });
      } catch {
        if (cancelled) return;
        setView({ center: FALLBACK_CENTER, zoom: FALLBACK_ZOOM });
      }
    }

    initView();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!view) {
    return <div className="map-loading map-wrapper">Loading map…</div>;
  }

  return (
    <div className="map-wrapper">
      <MapContainer
        center={view.center}
        zoom={view.zoom}
        className="map-container"
        worldCopyJump
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png"
          attribution=""
          pane="overlayPane"
        />
        <MapResizeHandler />
        <MapViewportReporter />
        <MapDragUnlock lockedIcao24={lockedIcao24} onUnlock={onUnlock} />
        <FlightTracker
          lockedIcao24={lockedIcao24}
          flights={flights}
          onUnlock={onUnlock}
        />
        <MapControls
          onLocated={setUserPosition}
          onUnlock={onUnlock}
          listOpen={listOpen}
          onToggleList={onToggleList}
        />
        <UserLocationMarker position={userPosition} />
        <AirportMarkers />
        {flights.map((f) => (
          <FlightMarker
            key={f.icao24}
            flight={f}
            isLocked={lockedIcao24 === f.icao24}
            onToggleLock={onToggleLock}
          />
        ))}
      </MapContainer>
    </div>
  );
}
