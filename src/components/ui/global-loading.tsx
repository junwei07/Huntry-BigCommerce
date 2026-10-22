"use client";

import { useEffect, useSyncExternalStore, useTransition, TransitionStartFunction } from "react";
import { Flex, ProgressCircle } from "@bigcommerce/big-design";

// One shared pending count for the whole app, same "one manager, one mount
// point" shape as action-alerts.tsx's createAlertsManager — a count rather
// than a boolean so two overlapping useGlobalTransition callers don't hide
// the overlay as soon as the first one finishes.
let pendingCount = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return pendingCount;
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function increment(): void {
  pendingCount += 1;
  notify();
}

function decrement(): void {
  pendingCount = Math.max(0, pendingCount - 1);
  notify();
}

// Drop-in replacement for React's own useTransition: same [isPending,
// startTransition] shape, but isPending also drives the full-page
// GlobalLoadingOverlay below instead of each caller showing its own
// button-level spinner.
//
// autoResolve: true (default) increments on the way up and decrements from
// the effect's own cleanup — covers a same-page transition like SortToggle,
// where the calling component stays mounted for isPending's whole lifecycle
// (including on unmount, since a startTransition navigation can also unmount
// the caller in the very commit that finishes the transition, e.g.
// NewEventButton isn't part of the destination route's tree).
//
// autoResolve: false only increments — nothing here ever decrements it. Use
// this when navigating to a route with its own not-yet-revealed Suspense
// boundary (e.g. new/page.tsx's <Suspense fallback={<ContentFallback />}>):
// React commits that fallback immediately as the transition's result (it
// skips its usual "keep showing old content" rule for a boundary that's
// never been shown before), which flips isPending to false — and unmounts
// the caller — well before the real destination content actually replaces
// the fallback. Pair this with useClearGlobalLoading() called by that real
// destination component, so the overlay spans the whole gap instead of
// dropping the moment the fallback appears.
export function useGlobalTransition(options?: { autoResolve?: boolean }): [boolean, TransitionStartFunction] {
  const autoResolve = options?.autoResolve ?? true;
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isPending) {
      return;
    }

    increment();

    if (autoResolve) {
      return () => decrement();
    }
  }, [isPending, autoResolve]);

  return [isPending, startTransition];
}

// Called once by a destination component reached via a
// useGlobalTransition({ autoResolve: false }) navigation, to signal that the
// real content (not a Suspense fallback) is now showing and the overlay
// should turn off.
export function useClearGlobalLoading(): void {
  useEffect(() => {
    decrement();
  }, []);
}

// Mounted once in the root layout, alongside ActionAlertsManager. Fixed to
// the viewport rather than relative-to-parent,
// since BigDesign has no Overlay primitive to cover the whole page with.
export function GlobalLoadingOverlay() {
  const count = useSyncExternalStore(subscribe, getSnapshot, () => 0);

  if (count === 0) {
    return null;
  }

  return (
    <Flex
      alignItems="center"
      justifyContent="center"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        // Fully opaque, not a translucent dim layer —
        // this overlay has to fully hide whatever's rendering underneath
        // (e.g. a destination route's own small Suspense fallback spinner),
        // not just tint it, or the two spinners show through each other.
        backgroundColor: "#FFFFFF",
      }}
    >
      <ProgressCircle size="large" />
    </Flex>
  );
}
