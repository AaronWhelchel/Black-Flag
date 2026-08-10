/** Trip-planner scenario: Aaron's exact question — a Tahoe T16 from the
 *  Florida Keys to the Bahamas. Demo/test data. */
import type { TripInputs, TripVessel } from '../src/trip.js';
import type { RouteWaypoint } from '../src/distance.js';

export const tahoeT16: TripVessel = {
  // fuel profile
  name: 'Tahoe-T16',
  engine_curve: [
    // A 75 hp Mercury FourStroke on a 1500 lb hull — the old curve was a
    // 115 hp motor's, which flattered both the speed and the economy.
    { rpm: 1000, kn: 3.5, gph: 0.6 },
    { rpm: 2500, kn: 6.5, gph: 1.8 },    // plowing, before it climbs on plane
    { rpm: 3500, kn: 17.0, gph: 3.4 },   // just on plane — the economy sweet spot
    { rpm: 4500, kn: 23.0, gph: 4.8 },
    { rpm: 5500, kn: 29.0, gph: 6.4 },
    { rpm: 6000, kn: 34.0, gph: 7.8 },   // WOT ≈ 39 mph, matching Aaron's ~40
  ],
  usable_gal: 13,          // published Tahoe capacity — was 20, which was wrong
  reserve_frac: 0.2,
  profile_confirmed_days_ago: 5,
  // risk profile
  type: 'open_bow',
  loa_ft: 16.42,           // 16 ft 5 in
  draft_ft: 2.21,          // 26.5 in with the leg DOWN — the number that matters at idle
  air_draft_ft: 4.17,      // 4 ft 2 in bridge clearance
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
