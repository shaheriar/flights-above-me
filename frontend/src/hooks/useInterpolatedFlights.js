import { useEffect, useRef, useState } from 'react';
import { deadReckon, lerpPos } from '../utils/geo.js';

const API_BASE = 'http://localhost:8000';
const EVENTS_URL = `${API_BASE}/events`;
const SNAP_DUR_MS = 800;

/**
 * Module-level singleton state. Multiple components can call
 * useInterpolatedFlights() and share a single SSE stream + rAF loop.
 * Anchors live here (not in React state) so per-frame updates do not
 * cascade through the React tree.
 */
const anchors = new Map();
const subscribers = new Set();

let eventSource = null;
let clientId = null;
let rafHandle = null;
let activeCount = 0;
/** @type {{ lat: number, lon: number, radiusDeg: number } | null} */
let pendingViewport = null;
let lastUpdateAt = null;
let pollIntervalSec = 10;
const metaSubscribers = new Set();

function notifyMeta() {
  const meta = { lastUpdateAt, pollIntervalSec };
  for (const setter of metaSubscribers) setter(meta);
}

async function loadPollInterval() {
  try {
    const res = await fetch(`${API_BASE}/config`);
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.poll_interval === 'number' && data.poll_interval > 0) {
      pollIntervalSec = data.poll_interval;
      notifyMeta();
    }
  } catch {
    // Keep default poll interval when config is unavailable.
  }
}

function smoothstep(t) {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

function canDeadReckon(anchor) {
  return (
    !anchor.on_ground &&
    anchor.velocity_ms != null &&
    anchor.heading != null
  );
}

function positionsClose(a, b, thresholdDeg = 0.00005) {
  return (
    Math.abs(a.lat - b.lat) < thresholdDeg &&
    Math.abs(a.lon - b.lon) < thresholdDeg
  );
}

function currentDisplayPos(anchor, now) {
  if (
    anchor.snapFrom &&
    anchor.snapTo &&
    now < anchor.snapStart + anchor.snapDur
  ) {
    const t = (now - anchor.snapStart) / anchor.snapDur;
    return lerpPos(anchor.snapFrom, anchor.snapTo, smoothstep(t));
  }
  if (canDeadReckon(anchor)) {
    return drPosition(anchor, now);
  }
  return { lat: anchor.baseLat, lon: anchor.baseLon };
}

/** True when our displayed position is ahead of the new fix along track. */
function isAheadOfFix(current, fix, headingDeg, velocityMs) {
  if (headingDeg == null || velocityMs == null || velocityMs < 1) {
    return false;
  }
  const midLat = (current.lat + fix.lat) / 2;
  const latRad = (midLat * Math.PI) / 180;
  const dNorth = current.lat - fix.lat;
  const dEast = (current.lon - fix.lon) * Math.cos(latRad);
  const h = (headingDeg * Math.PI) / 180;
  const alongTrack = dNorth * Math.cos(h) + dEast * Math.sin(h);
  return alongTrack > 0.00001;
}

function mergeAnchor(prev, flight, now) {
  return {
    ...prev,
    ...flight,
    baseLat: prev.baseLat,
    baseLon: prev.baseLon,
    anchorTime: prev.anchorTime,
    snapFrom: null,
    snapTo: null,
    snapStart: 0,
    snapDur: 0,
  };
}

function setAnchorAtPos(flight, lat, lon, anchorTime, snap = null) {
  const snapStart = snap ? Date.now() : 0;
  return {
    ...flight,
    baseLat: lat,
    baseLon: lon,
    anchorTime,
    snapFrom: snap?.from ?? null,
    snapTo: snap?.to ?? null,
    snapStart,
    snapDur: snap ? SNAP_DUR_MS : 0,
  };
}

function drPosition(anchor, now) {
  if (!canDeadReckon(anchor)) {
    return { lat: anchor.baseLat, lon: anchor.baseLon };
  }
  const elapsed = (now - anchor.anchorTime) / 1000;
  return deadReckon(
    anchor.baseLat,
    anchor.baseLon,
    anchor.heading,
    anchor.velocity_ms,
    elapsed,
  );
}

function ingestPayload(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.flights)
      ? payload.flights
      : [];
  const now = Date.now();
  const seen = new Set();

  for (const f of list) {
    if (!f || !f.icao24 || f.latitude == null || f.longitude == null) continue;
    seen.add(f.icao24);

    const realPos = { lat: f.latitude, lon: f.longitude };
    const prev = anchors.get(f.icao24);

    if (prev) {
      const prevBase = { lat: prev.baseLat, lon: prev.baseLon };
      const displayPos = currentDisplayPos(prev, now);

      if (positionsClose(realPos, prevBase) || positionsClose(realPos, displayPos)) {
        anchors.set(f.icao24, mergeAnchor(prev, f, now));
        continue;
      }

      if (
        isAheadOfFix(displayPos, realPos, f.heading, f.velocity_ms) ||
        isAheadOfFix(displayPos, realPos, prev.heading, prev.velocity_ms)
      ) {
        // OpenSky fix is stale relative to dead reckoning — keep moving forward.
        anchors.set(
          f.icao24,
          setAnchorAtPos(f, displayPos.lat, displayPos.lon, now),
        );
        continue;
      }

      anchors.set(
        f.icao24,
        setAnchorAtPos(f, f.latitude, f.longitude, now + SNAP_DUR_MS, {
          from: displayPos,
          to: realPos,
        }),
      );
    } else {
      anchors.set(f.icao24, setAnchorAtPos(f, f.latitude, f.longitude, now));
    }
  }

  for (const key of anchors.keys()) {
    if (!seen.has(key)) anchors.delete(key);
  }
}

function handleFlightPayload(payload) {
  if (typeof payload?.timestamp === 'number') {
    lastUpdateAt = payload.timestamp * 1000;
  } else {
    lastUpdateAt = Date.now();
  }
  notifyMeta();
  ingestPayload(payload);
}

function tick() {
  const now = Date.now();
  const out = [];

  for (const anchor of anchors.values()) {
    let pos;
    if (
      anchor.snapFrom &&
      anchor.snapTo &&
      now < anchor.snapStart + anchor.snapDur
    ) {
      const t = (now - anchor.snapStart) / anchor.snapDur;
      pos = lerpPos(anchor.snapFrom, anchor.snapTo, smoothstep(t));
    } else if (canDeadReckon(anchor)) {
      pos = drPosition(anchor, now);
    } else {
      pos = { lat: anchor.baseLat, lon: anchor.baseLon };
    }

    out.push({ ...anchor, latitude: pos.lat, longitude: pos.lon });
  }

  for (const setter of subscribers) setter(out);
  rafHandle = requestAnimationFrame(tick);
}

function connect() {
  if (eventSource) return;

  eventSource = new EventSource(EVENTS_URL);

  eventSource.addEventListener('connected', (event) => {
    try {
      const data = JSON.parse(event.data);
      clientId = data.client_id ?? null;
      if (pendingViewport && clientId) {
        sendViewport(
          pendingViewport.lat,
          pendingViewport.lon,
          pendingViewport.radiusDeg,
        );
      }
    } catch {
      // Ignore malformed connected event.
    }
  });

  eventSource.onmessage = (event) => {
    try {
      handleFlightPayload(JSON.parse(event.data));
    } catch {
      // Ignore malformed frames; the next poll will resync state.
    }
  };

  eventSource.onerror = () => {
    // EventSource auto-reconnects; server assigns a new client_id on reconnect.
    clientId = null;
  };
}

function startLoop() {
  if (rafHandle == null) {
    rafHandle = requestAnimationFrame(tick);
  }
  loadPollInterval();
  connect();
}

function stopLoop() {
  if (rafHandle != null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  clientId = null;
  anchors.clear();
  lastUpdateAt = null;
  notifyMeta();
}

export function sendViewport(lat, lon, radiusDeg) {
  pendingViewport = { lat, lon, radiusDeg };
  if (!clientId) return;

  fetch(`${API_BASE}/viewport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      lat,
      lon,
      radius_deg: radiusDeg,
    }),
  }).catch(() => {
    // Viewport will be resent on the next map move or SSE reconnect.
  });
}

export function useInterpolatedFlights() {
  const [flights, setFlights] = useState([]);
  const setterRef = useRef(setFlights);
  setterRef.current = setFlights;

  useEffect(() => {
    const setter = (next) => setterRef.current(next);
    subscribers.add(setter);
    activeCount += 1;
    if (activeCount === 1) startLoop();

    return () => {
      subscribers.delete(setter);
      activeCount -= 1;
      if (activeCount === 0) stopLoop();
    };
  }, []);

  return flights;
}

export function usePollStatus() {
  const [meta, setMeta] = useState({ lastUpdateAt, pollIntervalSec });

  useEffect(() => {
    metaSubscribers.add(setMeta);
    setMeta({ lastUpdateAt, pollIntervalSec });

    return () => {
      metaSubscribers.delete(setMeta);
    };
  }, []);

  return meta;
}
