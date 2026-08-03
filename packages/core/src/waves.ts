/**
 * Named rule "fetch_limited_waves" — inland/enclosed-water chop estimate.
 *
 * No agency forecasts waves for small lakes; but wind-driven wave growth over
 * limited open water is textbook physics (Sverdrup-Munk-Bretschneider,
 * deep-water fetch-limited form). This is an ESTIMATE, explainable by
 * construction, and always labeled as such — never presented as a forecast.
 *
 *   Hs = 0.283 · (U²/g) · tanh( 0.0125 · (gF/U²)^0.42 )
 *
 * U = wind speed (m/s), F = fetch — the open-water distance the wind blows
 * across (m), g = 9.81. Valid envelope: U ≤ ~40 kn, F ≤ ~30 nm (beyond that,
 * duration-limits and real forecasts take over).
 */

export interface LakeWaveEstimate {
  seas_ft: number;
  fetch_nm: number;
  wind_kn: number;
  in_envelope: boolean;
  detail: string;
}

export function estimateFetchLimitedWaves(wind_kn: number, fetch_nm: number): LakeWaveEstimate {
  const g = 9.81;
  const U = Math.max(0.5, wind_kn * 0.5144);      // kn → m/s
  const F = Math.max(50, fetch_nm * 1852);        // nm → m
  const x = 0.0125 * Math.pow((g * F) / (U * U), 0.42);
  const hsM = 0.283 * ((U * U) / g) * Math.tanh(x);
  const seas_ft = Math.round(hsM * 3.281 * 10) / 10;
  const in_envelope = wind_kn <= 40 && fetch_nm <= 30;
  return {
    seas_ft, fetch_nm: Math.round(fetch_nm * 10) / 10, wind_kn: Math.round(wind_kn),
    in_envelope,
    detail: `~${seas_ft} ft wind chop estimated from ${Math.round(wind_kn)} kt over ~${Math.round(fetch_nm * 10) / 10} nm of open water (fetch-limited wave physics — an estimate, not a forecast)`,
  };
}
