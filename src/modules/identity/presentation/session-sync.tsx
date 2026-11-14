"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Only a state-change signal crosses tabs; no identity, token or credential is shared or stored.
export function notifyAuthChange() {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel("finzi-auth-state");
  channel.postMessage("changed"); channel.close();
}
export function SessionSync() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const restore = (event: PageTransitionEvent) => { if (event.persisted) router.refresh(); };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("finzi-auth-state");
    if (channel) channel.onmessage = (event: MessageEvent<unknown>) => { if (event.data === "changed") router.refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", restore);
    document.addEventListener("visibilitychange", refresh);
    return () => { channel?.close(); window.removeEventListener("focus", refresh); window.removeEventListener("pageshow", restore); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return null;
}
