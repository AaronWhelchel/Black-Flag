/** The Dana scenario — Manasquan Inlet → Block Island, Aug 4 2026. Demo/test data. */
import type { DepartureInputs } from '../src/windows.js';
import type { VesselFuelProfile } from '../src/fuel.js';

export const vessel: VesselFuelProfile = {
  name: 'Restless-31',
  engine_curve: [
    { rpm: 1000, kn: 6.0, gph: 2.8 },
    { rpm: 2000, kn: 8.5, gph: 7.5 },
    { rpm: 3000, kn: 14.0, gph: 13.5 },
    { rpm: 3500, kn: 18.0, gph: 17.0 },
    { rpm: 4000, kn: 22.0, gph: 22.5 },
    { rpm: 4600, kn: 27.0, gph: 30.0 },
  ],
  usable_gal: 200,
  reserve_frac: 0.2,
  profile_confirmed_days_ago: 12,
};

const D = '2026-08-04T';
const TZ = '-04:00';
const t = (hhmm: string) => `${D}${hhmm}${TZ}`;

export const scenario: DepartureInputs = {
  candidates: ['05:30', '06:00', '07:00', '08:00', '09:00', '09:30', '10:00', '11:00', '12:00'].map(t),
  forecast: [
    { time: t('05:00'), wind_kn: 15, wind_from_deg: 320, gust_kn: 21, seas_ft: 3.5, seas_from_deg: 135 },
    { time: t('06:00'), wind_kn: 15, wind_from_deg: 320, gust_kn: 20, seas_ft: 3.5, seas_from_deg: 135 },
    { time: t('07:00'), wind_kn: 14, wind_from_deg: 325, gust_kn: 19, seas_ft: 3.0, seas_from_deg: 135 },
    { time: t('08:00'), wind_kn: 13, wind_from_deg: 330, gust_kn: 18, seas_ft: 3.0, seas_from_deg: 135 },
    { time: t('09:00'), wind_kn: 12, wind_from_deg: 335, gust_kn: 16, seas_ft: 2.5, seas_from_deg: 130 },
    { time: t('10:00'), wind_kn: 10, wind_from_deg: 340, gust_kn: 14, seas_ft: 2.5, seas_from_deg: 130 },
    { time: t('11:00'), wind_kn: 9, wind_from_deg: 345, gust_kn: 12, seas_ft: 2.0, seas_from_deg: 125 },
    { time: t('12:00'), wind_kn: 8, wind_from_deg: 350, gust_kn: 11, seas_ft: 2.0, seas_from_deg: 125 },
    { time: t('13:00'), wind_kn: 8, wind_from_deg: 355, gust_kn: 11, seas_ft: 2.0, seas_from_deg: 120 },
    { time: t('14:00'), wind_kn: 9, wind_from_deg: 0, gust_kn: 12, seas_ft: 2.0, seas_from_deg: 120 },
    { time: t('15:00'), wind_kn: 10, wind_from_deg: 5, gust_kn: 13, seas_ft: 2.5, seas_from_deg: 120 },
    { time: t('16:00'), wind_kn: 11, wind_from_deg: 10, gust_kn: 15, seas_ft: 2.5, seas_from_deg: 120 },
    { time: t('17:00'), wind_kn: 12, wind_from_deg: 10, gust_kn: 16, seas_ft: 2.5, seas_from_deg: 120 },
    { time: t('18:00'), wind_kn: 12, wind_from_deg: 15, gust_kn: 16, seas_ft: 3.0, seas_from_deg: 120 },
  ],
  forecast_issued: '2026-08-04T05:00Z (NBM)',
  forecast_age_hours: 1,
  tide_events: [
    { time: t('03:40'), type: 'max_flood', current_kn: 2.1 },
    { time: t('06:10'), type: 'slack' },
    { time: t('07:50'), type: 'max_ebb', current_kn: 2.6 },
    { time: t('09:20'), type: 'slack' },
    { time: t('12:30'), type: 'max_flood', current_kn: 2.2 },
    { time: t('15:20'), type: 'slack' },
  ],
  swell: { from_deg: 135, height_ft: 3.5, period_s: 9 },
  inlet_faces_deg: 100,          // Manasquan mouth faces roughly E-SE
  inlet_transit_minutes: 12,
  legs: [
    { name: 'Manasquan → Fire Island offing', dist_nm: 52, course_deg: 65 },
    { name: 'Fire Island offing → Montauk', dist_nm: 60, course_deg: 70 },
    { name: 'Montauk → Block Island', dist_nm: 16, course_deg: 63 },
  ],
  cruise_kn: 17,
  vessel,
  limits: { max_wind_kn: 18, max_seas_ft: 4, arrive_by: t('18:30') },
  data_vintage: {
    weather: 'nbm:2026-08-04T05:00Z (fetched 05:41Z)',
    tides: 'co-ops:8533051/2026-annual',
    vessel: 'profile confirmed 2026-07-23',
  },
};
