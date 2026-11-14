import "server-only";
// Public server contract: a request-scoped client with the caller's official Auth cookies.
export { createAuthClient as createUserScopedClient } from "./infrastructure/supabase-server";
