import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import { deleteRefs } from "@/lib/huntry/repository/firestore/convert";
import { storeCollection, storeDoc } from "@/lib/huntry/repository/firestore/paths";

// Deletes every egg of an event or reward, plus each egg's claim counter. The
// SQL schema cascades eggs from both parents; claims are denormalized and are
// deliberately never touched (a deleted egg's past claims stay intact).
export async function deleteEggsOf(
  db: Firestore,
  storeHash: string,
  field: "eventId" | "rewardId",
  id: number,
): Promise<void> {
  const eggs = await storeCollection(db, storeHash, "eggs").where(field, "==", id).get();
  const refs: DocumentReference[] = [];

  for (const egg of eggs.docs) {
    refs.push(egg.ref, storeDoc(db, storeHash, "counters", `egg_${egg.id}`));
  }

  await deleteRefs(db, refs);
}
