/**
 * @blackflag/schema — shared entity and sync vocabulary.
 * Client and server import these types so they cannot drift
 * (Offline & Sync Design §5: operations are defined once).
 */

export type ULID = string;
export type ISOLocal = string;

export interface Captain {
  id: ULID;
  email: string;
  created_at: ISOLocal;
}

export interface Vessel {
  id: ULID;
  captain_id: ULID;
  name: string;
  engine_curve: { rpm: number; kn: number; gph: number }[];
  usable_gal: number;
  reserve_frac: number;
  profile_confirmed_at: ISOLocal;
}

export interface Waypoint {
  id: ULID;
  plan_id: ULID;
  name: string;
  lat: number;
  lon: number;
  seq: number;
}

export interface Plan {
  id: ULID;
  captain_id: ULID;
  vessel_id: ULID;
  name: string;
  depart_at: ISOLocal | null;
  arrive_by: ISOLocal | null;
  limits: { max_wind_kn: number; max_seas_ft: number };
}

export interface Voyage {
  id: ULID;
  plan_id: ULID | null;
  departed_at: ISOLocal;
  arrived_at: ISOLocal | null;
  fuel_used_gal: number | null;
}

/** The unit of sync — Offline & Sync Design §5. */
export interface Operation {
  op_id: ULID;
  device_id: string;
  schema_version: number;
  entity: 'vessel' | 'plan' | 'waypoint' | 'voyage' | 'log_entry';
  entity_id: ULID;
  kind: 'create' | 'update' | 'delete' | 'append';
  fields: Record<string, unknown>;
  hlc: string;
  server_seq?: number;
}

export const SCHEMA_VERSION = 1;
