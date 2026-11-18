// Inherited by the local test runner and its Next child. Never load hosted secrets.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("PHASE7_EXTERNAL_FETCH_BLOCKED");
  return nativeFetch(input, init);
};
