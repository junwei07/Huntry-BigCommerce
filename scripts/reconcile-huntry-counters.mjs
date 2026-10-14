#!/usr/bin/env node
// Compares Huntry's claim counters with the claims they summarise and reports
// drift. The counters are the capacity authority (docs/FIREBASE-MIGRATION.md,
// Phase 3), so run this after any import and whenever capacity looks wrong.
//
//   FIRESTORE_DATABASE_ID=huntry-bc FIREBASE_PROJECT_ID=evms-demo-d1477 \
//     node scripts/reconcile-huntry-counters.mjs <storeHash | --all> [--fix]
//
// Credentials are Application Default Credentials (ideally impersonating the
// huntry-bc-app service account); FIRESTORE_EMULATOR_HOST works too. Counted per
// store, over every claim whether `issued` or `pending`, because reserved
// capacity is capacity:
//   counters/egg_{eggId}      count = claims on the egg, forced = forced ones
//   counters/reward_{id}      count = claims on the reward
//   customers/{id}            eventCounts[eventId] = the customer's claims in the event
// Without --fix nothing is written. Exit code 1 when drift is found.
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const fix = args.includes("--fix");
const target = args.find((arg) => !arg.startsWith("--"));

if (!target) {
  console.error("Usage: node scripts/reconcile-huntry-counters.mjs <storeHash | --all> [--fix]");
  process.exit(2);
}

const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();

if (!databaseId) {
  console.error("FIRESTORE_DATABASE_ID must be set (it is never defaulted: \"(default)\" belongs to another app).");
  process.exit(2);
}

const app = getApps()[0] ?? initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || undefined });
const db = getFirestore(app, databaseId);

db.settings({ ignoreUndefinedProperties: true });

async function reconcileStore(storeHash) {
  const store = db.collection("stores").doc(storeHash);
  const claims = await store.collection("claims").get();
  const eggs = new Map();
  const rewards = new Map();
  const customers = new Map();

  for (const doc of claims.docs) {
    const { eggId, rewardId, eventId, bcCustomerId, isForced } = doc.data();
    const egg = eggs.get(eggId) ?? { eventId, count: 0, forced: 0 };

    egg.count += 1;
    egg.forced += isForced ? 1 : 0;
    eggs.set(eggId, egg);
    rewards.set(rewardId, (rewards.get(rewardId) ?? 0) + 1);

    const perEvent = customers.get(bcCustomerId) ?? {};

    perEvent[String(eventId)] = (perEvent[String(eventId)] ?? 0) + 1;
    customers.set(bcCustomerId, perEvent);
  }

  const drift = [];
  const writes = [];
  const counters = await store.collection("counters").get();

  for (const doc of counters.docs) {
    if (doc.id.startsWith("egg_")) {
      const expected = eggs.get(doc.id.slice(4)) ?? { count: 0, forced: 0 };

      if (doc.get("count") !== expected.count || (doc.get("forced") ?? 0) !== expected.forced) {
        drift.push(`${doc.id}: count ${doc.get("count")} -> ${expected.count}, forced ${doc.get("forced") ?? 0} -> ${expected.forced}`);
        writes.push([doc.ref, { count: expected.count, forced: expected.forced }]);
      }
    } else if (doc.id.startsWith("reward_")) {
      const expected = rewards.get(Number(doc.id.slice(7))) ?? 0;

      if (doc.get("count") !== expected) {
        drift.push(`${doc.id}: count ${doc.get("count")} -> ${expected}`);
        writes.push([doc.ref, { count: expected }]);
      }
    }
  }

  // Claims whose counter doc is missing altogether.
  const seen = new Set(counters.docs.map((doc) => doc.id));

  for (const [eggId, egg] of eggs) {
    if (!seen.has(`egg_${eggId}`)) {
      drift.push(`egg_${eggId}: missing counter -> count ${egg.count}, forced ${egg.forced}`);
      writes.push([store.collection("counters").doc(`egg_${eggId}`), { eventId: egg.eventId, count: egg.count, forced: egg.forced }]);
    }
  }

  for (const [rewardId, count] of rewards) {
    if (!seen.has(`reward_${rewardId}`)) {
      drift.push(`reward_${rewardId}: missing counter -> count ${count}`);
      writes.push([store.collection("counters").doc(`reward_${rewardId}`), { count }]);
    }
  }

  for (const [customerId, expected] of customers) {
    const ref = store.collection("customers").doc(String(customerId));
    const current = (await ref.get()).get("eventCounts") ?? {};

    for (const [eventKey, count] of Object.entries(expected)) {
      if ((current[eventKey] ?? 0) !== count) {
        drift.push(`customers/${customerId}: eventCounts[${eventKey}] ${current[eventKey] ?? 0} -> ${count}`);
        writes.push([ref, { eventCounts: { ...current, ...expected } }]);
      }
    }
  }

  if (fix) {
    for (const [ref, data] of writes) {
      await ref.set(data, { merge: true });
    }
  }

  return drift;
}

const storeHashes = target === "--all" ? (await db.collection("stores").listDocuments()).map((ref) => ref.id) : [target];
let total = 0;

for (const storeHash of storeHashes) {
  const drift = await reconcileStore(storeHash);

  total += drift.length;
  console.log(`${storeHash}: ${drift.length === 0 ? "ok" : `${drift.length} drift(s)${fix ? " (fixed)" : ""}`}`);

  for (const line of drift) {
    console.log(`  ${line}`);
  }
}

process.exit(total > 0 && !fix ? 1 : 0);
