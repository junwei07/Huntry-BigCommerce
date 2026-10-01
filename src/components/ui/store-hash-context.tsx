"use client";

import { createContext, useContext } from "react";
import { useParams } from "next/navigation";

const StoreHashContext = createContext<string | undefined>(undefined);

// Single source of storeHash for every client component in the tree, read
// the same way MainNav/AppExtensionStatusBanner/NotFoundFallback each used
// to independently (useParams(), not a prop) — centralizing it here means
// only this one component calls useParams(), and nothing below it needs
// storeHash prop-drilled down from a server-component page anymore.
export function StoreHashProvider({ children }: { children: React.ReactNode }) {
  const params = useParams<{ storeHash?: string }>();

  return <StoreHashContext.Provider value={params.storeHash}>{children}</StoreHashContext.Provider>;
}

export function useStoreHash(): string | undefined {
  return useContext(StoreHashContext);
}
