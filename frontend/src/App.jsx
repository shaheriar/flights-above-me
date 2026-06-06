import { useCallback, useEffect, useState } from 'react';
import FlightMap from './components/FlightMap.jsx';
import FlightList from './components/FlightList.jsx';
import {
  useInterpolatedFlights,
  usePollStatus,
} from './hooks/useInterpolatedFlights.js';

function formatRelativePast(now, then) {
  if (!then) return '—';
  const sec = Math.floor((now - then) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function formatNextUpdate(now, lastUpdateAt, pollIntervalSec) {
  if (!lastUpdateAt) return 'waiting…';
  const sec = Math.ceil((lastUpdateAt + pollIntervalSec * 1000 - now) / 1000);
  if (sec <= 0) return 'any moment';
  if (sec === 1) return 'in 1s';
  return `in ${sec}s`;
}

export default function App() {
  const flights = useInterpolatedFlights();
  const { lastUpdateAt, pollIntervalSec } = usePollStatus();
  const [listOpen, setListOpen] = useState(false);
  const [lockedIcao24, setLockedIcao24] = useState(null);
  const [now, setNow] = useState(Date.now());

  const handleToggleLock = useCallback((icao24) => {
    setLockedIcao24((prev) => (prev === icao24 ? null : icao24));
  }, []);

  const handleUnlock = useCallback(() => {
    setLockedIcao24(null);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="app-root">
      <main className="app-main">
        <section className="map-pane">
          <FlightMap
            listOpen={listOpen}
            onToggleList={() => setListOpen((open) => !open)}
            lockedIcao24={lockedIcao24}
            onToggleLock={handleToggleLock}
            onUnlock={handleUnlock}
          />
          <div className={`flight-list-drawer ${listOpen ? 'open' : ''}`}>
            <FlightList
              flights={flights}
              lockedIcao24={lockedIcao24}
              onToggleLock={handleToggleLock}
              onClose={() => setListOpen(false)}
            />
          </div>
        </section>
      </main>
      <footer className="status-bar">
        <span>{flights.length} aircraft overhead</span>
        <span className="status-dot">·</span>
        <span>last update {formatRelativePast(now, lastUpdateAt)}</span>
        <span className="status-dot">·</span>
        <span>
          next update {formatNextUpdate(now, lastUpdateAt, pollIntervalSec)}
        </span>
      </footer>
    </div>
  );
}
