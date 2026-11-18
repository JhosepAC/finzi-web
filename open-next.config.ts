import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Authenticated responses stay private/no-store. No paid cache or image bindings.
// Adapter selected for staging evaluation; runtime/CPU acceptance is still pending.
export default defineCloudflareConfig({
  incrementalCache: "dummy",
  tagCache: "dummy",
  enableCacheInterception: false,
  routePreloadingBehavior: "none"
});
