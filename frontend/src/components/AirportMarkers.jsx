import { useCallback, useEffect, useRef, useState } from 'react';
import { Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { airportsInBounds, loadAirports } from '../hooks/useAirports.js';

const MIN_ZOOM = 8;

const airportIconCache = new Map();

function getAirportIcon(iata) {
  if (!airportIconCache.has(iata)) {
    airportIconCache.set(
      iata,
      L.divIcon({
        className: 'airport-divicon',
        html: `<div class="airport-marker"><span class="airport-code">${iata}</span></div>`,
        iconSize: [34, 18],
        iconAnchor: [17, 9],
      }),
    );
  }
  return airportIconCache.get(iata);
}

export default function AirportMarkers() {
  const map = useMap();
  const airportsRef = useRef(null);
  const [visible, setVisible] = useState([]);

  const updateVisible = useCallback(() => {
    const zoom = map.getZoom();
    if (zoom < MIN_ZOOM || !airportsRef.current?.length) {
      setVisible([]);
      return;
    }
    setVisible(airportsInBounds(airportsRef.current, map.getBounds()));
  }, [map]);

  useEffect(() => {
    let cancelled = false;
    loadAirports().then((airports) => {
      if (cancelled) return;
      airportsRef.current = airports;
      updateVisible();
    });
    return () => {
      cancelled = true;
    };
  }, [updateVisible]);

  useMapEvents({
    moveend: updateVisible,
    zoomend: updateVisible,
  });

  if (!visible.length) return null;

  return visible.map((airport) => (
    <Marker
      key={airport.icao}
      position={[airport.lat, airport.lon]}
      icon={getAirportIcon(airport.iata)}
      zIndexOffset={-200}
      interactive
    >
      <Tooltip direction="top" offset={[0, -8]} opacity={0.95} permanent={false}>
        <div className="airport-tooltip">
          <div className="airport-tooltip-code">{airport.iata}</div>
          <div className="airport-tooltip-name">{airport.name}</div>
          {airport.city && (
            <div className="airport-tooltip-city">{airport.city}</div>
          )}
        </div>
      </Tooltip>
    </Marker>
  ));
}
