import { HuntryEgg } from "@/lib/huntry/eggs/types";

export type Dialog =
  | { kind: "place"; lat: number; lng: number }
  | { kind: "edit"; egg: HuntryEgg }
  | { kind: "delete"; egg: HuntryEgg }
  | { kind: "forceClaim"; egg: HuntryEgg }
  | { kind: "limit" }
  | { kind: "proximity" }
  | { kind: "unsaved"; onLeave: () => void };

// "Edit Location" mode: the egg's own marker becomes draggable on the
// full-screen map; confirm saves lat/lng (plus any name/reward edits carried
// over from the Edit dialog) via updateHuntryEgg, which preserves the egg id.
export interface EditLocation {
  egg: HuntryEgg;
  name: string;
  rewardId: number;
  lat: number;
  lng: number;
  valid: boolean;
}
