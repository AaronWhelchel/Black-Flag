/** Trip-planner scenario: Aaron's exact question — a Tahoe T16 from the
 *  Florida Keys to the Bahamas. Demo/test data. */
import type { TripInputs, TripVessel } from '../src/trip.js';
import type { RouteWaypoint } from '../src/distance.js';

export const tahoeT16: TripVessel = {
  // fuel profile
  name: 'Tahoe-T16',
  engine_curve: [
    { rpm: 1000, kn: 4.5, gph: 1.1 },
    { rpm: 2500, kn: 8.0, gph: 3.0 },
    { rpm: 3200, kn: 16.0, gph: 4.6 },   // on plane — the economy sweet spot
    { rpm: 4000, kn: 22.0, gph: 6.8 },
    { rpm: 5000, kn: 28.0, gph: 9.6 },
    { rpm: 5800, kn: 33.0, gph: 12.4 },  // WOT, 115 hp outboard
  ],
  usable_gal: 20,
  reserve_frac: 0.2,
  profile_confirmed_days_ago: 5,
  // risk profile
  type: 'open_bow',
  loa_ft: 16.1,
  max_recommended_seas_ft: 2,
};

export const keysToBimini: RouteWaypoint[] = [
  { name: 'Key Largo (Angelfish Ck)', lat: 25.32, lon: -80.25 },
  { name: 'Gulf Stream mid', lat: 25.55, lon: -79.75 },
  { name: 'Bimini (North Rock)', lat: 25.73, lon: -79.30 },
];

export const t16Trip: TripInputs = {
  waypoints: keysToBimini,
  vessel: tahoeT16,
  cruise_kn: 22,
  speed_choice: 'best_economy',
  crew: 2,
  fuel_price_usd_gal: 4.85,
  provisions_usd_person_day: 35,
  fishing_offset: true,
  forecast: { wind_kn: 12, wind_from_deg: 20, seas_ft: 3, seas_from_deg: 30 },
  forecast_age_hours: 2,
  gulf_stream_crossing: true,
  data_vintage: {
    weather: 'nbm:2026-08-05T11:00Z (fetched 11:32Z)',
    piracy: 'imb:2025-annual (demo snapshot)',
    vessel: 'profile confirmed 2026-07-30',
  },
};

/** A route that deliberately crosses the Gulf of Aden — for piracy tests. */
export const adenRoute: RouteWaypoint[] = [
  { name: 'Djibouti', lat: 11.6, lon: 43.2 },
  { name: 'Gulf of Aden mid', lat: 12.5, lon: 47.0 },
  { name: 'Salalah', lat: 16.9, lon: 54.0 },
];
