import type { z } from "zod";
import { ActionResult } from "@/lib/actions/action-result";
import { toSafeMessage } from "@/lib/errors/app-error";
import { logError } from "@/lib/errors/logger";
import { isAuthorizedForStore, NOT_AUTHORIZED_FOR_STORE_MESSAGE } from "@/lib/session/is-authorized-for-store";

// The fragments every Huntry Server Action repeated. Deliberately plain
// helpers rather than a wrapper around the whole action: each action keeps its
// own try/catch and ordering (several do work outside the try on purpose), and
// this is not a "use server" module, so it can export non-async values.

// A page/layout-level auth check does not extend to Server Actions, since
// they're directly POST-able independent of any page render — see
// isAuthorizedForStore. Returns the refusal to hand straight back, or null
// when the session may act on this store:
//
//   const denied = await denyUnlessAuthorized(storeHash);
//   if (denied) return denied;
export async function denyUnlessAuthorized(storeHash: string | undefined): Promise<ActionResult | null> {
  if (await isAuthorizedForStore(storeHash)) {
    return null;
  }

  return { success: false, message: NOT_AUTHORIZED_FOR_STORE_MESSAGE };
}

// safeParse, with the first issue's message (or `fallbackMessage`) as the
// failure to return:
//
//   const parsed = parseActionInput(schema, input, "Invalid sponsor details.");
//   if (!parsed.ok) return parsed.result;
export function parseActionInput<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
  fallbackMessage: string,
): { ok: true; data: z.output<TSchema> } | { ok: false; result: ActionResult } {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, result: { success: false, message: parsed.error.issues[0]?.message ?? fallbackMessage } };
  }

  return { ok: true, data: parsed.data };
}

// The catch tail shared by most actions: log the real error under `context`,
// and show the user only a message that is safe to surface.
export function actionFailure(context: string, error: unknown, fallbackMessage: string): ActionResult {
  logError(context, error);

  return { success: false, message: toSafeMessage(error, fallbackMessage) };
}
