// Earth radius in metres.
const R = 6371000;

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;

/**
 * Advance a position along a heading using the spherical law of cosines.
 * Returns unchanged lat/lon when velocityMs or headingDeg is null/undefined.
 *
 * @param {number} lat        Starting latitude in degrees.
 * @param {number} lon        Starting longitude in degrees.
 * @param {number|null} headingDeg  Bearing in degrees (0=N, 90=E).
 * @param {number|null} velocityMs  Ground speed in m/s.
 * @param {number} elapsedSec       Seconds since the anchor was set.
 * @returns {{ lat: number, lon: number }}
 */
export function deadReckon(lat, lon, headingDeg, velocityMs, elapsedSec) {
  if (velocityMs == null || headingDeg == null) {
    return { lat, lon };
  }

  const distance = velocityMs * elapsedSec;
  const angDist = distance / R;
  const bearing = toRad(headingDeg);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);

  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinAng = Math.sin(angDist);
  const cosAng = Math.cos(angDist);

  const lat2 = Math.asin(sinLat1 * cosAng + cosLat1 * sinAng * Math.cos(bearing));
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * sinAng * cosLat1,
      cosAng - sinLat1 * Math.sin(lat2),
    );

  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}

/**
 * Linear interpolation between two {lat, lon} points. t is clamped to [0, 1].
 *
 * @param {{ lat: number, lon: number }} from
 * @param {{ lat: number, lon: number }} to
 * @param {number} t
 * @returns {{ lat: number, lon: number }}
 */
export function lerpPos(from, to, t) {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return {
    lat: from.lat + (to.lat - from.lat) * clamped,
    lon: from.lon + (to.lon - from.lon) * clamped,
  };
}
