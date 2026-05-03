/** Pure gate logic for autonomous speech re-entry.
 *
 * Why this lives outside Pet.svelte: keeps the gate testable in vitest without
 * mounting the component. The call site in Pet.svelte mirrors this exactly —
 * any divergence is a bug.
 *
 * Two checks combine for defense-in-depth against rapid-fire dispatches:
 *  1. `inFlight` blocks any concurrent invocation while the network call is
 *     pending (regardless of kind). Cleared in a `finally` block.
 *  2. The (kind, ts) timestamp blocks the same kind from re-firing within the
 *     local cooldown window. Updated *before* awaiting, so a failed call still
 *     consumes the cooldown — failure-retry-on-every-event is a spam path.
 */

export type LastAutonomous = { kind: string; ts: number } | null;

export type GateInput = Readonly<{
  inFlight: boolean;
  last: LastAutonomous;
  kind: string;
  now: number;
  cooldownMs: number;
}>;

export type GateDecision =
  | { proceed: false }
  | { proceed: true; nextLast: LastAutonomous };

export function tryEnterAutonomous(input: GateInput): GateDecision {
  if (input.inFlight) return { proceed: false };
  if (
    input.last &&
    input.last.kind === input.kind &&
    input.now - input.last.ts < input.cooldownMs
  ) {
    return { proceed: false };
  }
  return {
    proceed: true,
    nextLast: { kind: input.kind, ts: input.now },
  };
}
