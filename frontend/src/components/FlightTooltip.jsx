const M_TO_FT = 3.28084;
const MS_TO_KTS = 1.944;

export default function FlightTooltip({ flight }) {
  if (!flight) return null;

  const callsign = flight.callsign?.trim() || flight.icao24;
  const altFt =
    flight.altitude_m != null ? Math.round(flight.altitude_m * M_TO_FT) : null;
  const speedKts =
    flight.velocity_ms != null ? Math.round(flight.velocity_ms * MS_TO_KTS) : null;

  const parts = [];
  if (altFt != null) parts.push(`${altFt.toLocaleString()} ft`);
  if (speedKts != null) parts.push(`${speedKts} kts`);

  return (
    <div className="flight-tooltip">
      <div className="ft-callsign">{callsign}</div>
      {parts.length > 0 && <div className="ft-brief">{parts.join(' · ')}</div>}
    </div>
  );
}
