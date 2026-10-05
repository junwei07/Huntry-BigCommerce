import { Coordinate, isFarEnough } from "@/lib/huntry/eggs/geo";
import { MAX_EGGS_PER_EVENT, MAX_EGGS_PER_REWARD } from "@/lib/huntry/eggs/limits";
import { EggPlacementInput } from "@/lib/huntry/eggs/egg-form-schema";

export interface PlacementPlanInput {
  eventName: string;
  markerRadiusMeters: number;
  // This event's eggs only — proximity is per event (events don't block each
  // other), and the event cap counts these.
  existingEggs: Coordinate[];
  // reward id -> huntry_rewards.egg_capacity
  rewardCapacities: Map<number, number>;
  // reward id -> eggs it already has across *every* event: rewards aren't
  // event-scoped, so egg_capacity is a store-wide per-reward budget.
  rewardEggCounts: Map<number, number>;
  adds: EggPlacementInput[];
}

export interface PlacementPlan {
  accepted: EggPlacementInput[];
  skippedTooClose: number;
  skippedNoCapacity: number;
}

// Port of the plugin's huntry_save_map_changes (huntry/includes/map/save.php):
// the two caps stay independent (per-reward capacity, clamped to
// MAX_EGGS_PER_REWARD, and MAX_EGGS_PER_EVENT); proximity is checked against
// every existing egg *and* every egg accepted earlier in this batch; a blank
// name becomes "<Event name> <N>", continuing from the event's egg count.
// Pure so the client's pre-checks and the Server Action share one rule set.
export function planEggPlacements(input: PlacementPlanInput): PlacementPlan {
  const placed: Coordinate[] = input.existingEggs.map(({ lat, lng }) => ({ lat, lng }));
  const countByReward = new Map(input.rewardEggCounts);

  let eventRemaining = Math.max(0, MAX_EGGS_PER_EVENT - input.existingEggs.length);
  let nextEggNumber = input.existingEggs.length + 1;
  const plan: PlacementPlan = { accepted: [], skippedTooClose: 0, skippedNoCapacity: 0 };

  for (const add of input.adds) {
    const capacity = input.rewardCapacities.get(add.rewardId);
    const used = countByReward.get(add.rewardId) ?? 0;

    if (capacity === undefined || used >= Math.min(capacity, MAX_EGGS_PER_REWARD) || eventRemaining <= 0) {
      plan.skippedNoCapacity++;
      continue;
    }

    if (!isFarEnough(add, placed, input.markerRadiusMeters)) {
      plan.skippedTooClose++;
      continue;
    }

    // An admin-typed name is kept as-is and doesn't consume a counter slot.
    const name = add.name || `${input.eventName} ${nextEggNumber++}`;

    plan.accepted.push({ ...add, name });
    placed.push({ lat: add.lat, lng: add.lng });
    countByReward.set(add.rewardId, used + 1);
    eventRemaining--;
  }

  return plan;
}
