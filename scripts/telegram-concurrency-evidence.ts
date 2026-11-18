import assert from "node:assert/strict";

/** Call after runBatch returns: its intentional crash handler catches errors. */
export async function verifyConfirmationRace(
  outcomes: PromiseSettledResult<unknown>[],
  replay: () => Promise<unknown>,
) {
  assert.equal(outcomes.length, 2, "Two financial requests must complete");
  const successes = outcomes.filter((x): x is PromiseFulfilledResult<unknown> => x.status === "fulfilled");
  const rejected = outcomes.filter((x): x is PromiseRejectedResult => x.status === "rejected");
  assert(successes.length >= 1, "No financial confirmation succeeded");
  assert(rejected.every(x => (x.reason as { code?: string } | null)?.code === "55P03"), "Unexpected financial race failure");
  const canonical = successes[0].value;
  for (const success of successes) assert.deepEqual(success.value, canonical, "Financial receipts differ");
  assert.deepEqual(await replay(), canonical, "Replay receipt differs");
  return {
    concurrentRequests: 2,
    successfulRequests: successes.length,
    busyRequests: rejected.length,
    busyCodes: rejected.map(() => "55P03"),
    allSuccessfulReceiptsEqual: true,
    explicitReplayReceiptEqual: true,
  };
}
