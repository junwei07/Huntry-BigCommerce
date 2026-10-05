// camelCase, matching HuntryReward/HuntryEvent's convention — our own
// schema, not a wire passthrough. id is an app-generated UUID
// (crypto.randomUUID(), see huntry_eggs in db/migrations/0001_huntry_schema.sql);
// claims key off it via huntry_claims.egg_id, so it must never change on edit.
export interface HuntryEgg {
  id: string;
  storeHash: string;
  rewardId: number;
  eventId: number;
  name: string;
  lat: number;
  lng: number;
  createdAt: Date;
  updatedAt: Date;
}

// A new egg's caller-supplied fields — id/storeHash/timestamps are assigned
// by the DAL (id via crypto.randomUUID()).
export type CreateEggInput = Pick<HuntryEgg, "eventId" | "rewardId" | "name" | "lat" | "lng">;

// The editable fields. Never includes id/eventId: edit-in-place keeps the
// egg's id (claims key off it) and an egg can't move between events.
export type UpdateEggInput = Pick<HuntryEgg, "rewardId" | "name" | "lat" | "lng">;

// A placement queued client-side while the admin is in placement mode — not
// persisted until Stop Placing commits the whole batch (saveHuntryEggPlacements).
// `key` is a client-only React/marker identity; the real id is assigned on insert.
export interface PendingEgg {
  key: string;
  rewardId: number;
  name: string;
  lat: number;
  lng: number;
}
