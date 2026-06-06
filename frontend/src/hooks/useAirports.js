const AIRPORTS_URL =
  'https://raw.githubusercontent.com/mwgg/Airports/master/airports.json';

let airportsPromise = null;

export function loadAirports() {
  if (!airportsPromise) {
    airportsPromise = fetch(AIRPORTS_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`Airports fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) =>
        Object.values(data).filter((airport) => airport.iata && airport.lat != null),
      )
      .catch(() => []);
  }
  return airportsPromise;
}

export function airportsInBounds(airports, bounds, max = 150) {
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  const west = bounds.getWest();
  const east = bounds.getEast();

  const visible = [];
  for (const airport of airports) {
    if (
      airport.lat >= south &&
      airport.lat <= north &&
      airport.lon >= west &&
      airport.lon <= east
    ) {
      visible.push(airport);
      if (visible.length >= max) break;
    }
  }
  return visible;
}
