<script lang="ts">
  import { ACTION_DEFINITIONS, type ActionKey } from "../sim";

  type Props = {
    onAction: (action: ActionKey) => void;
    /** When set, that action is briefly disabled to prevent double-tap spam. */
    busy?: ActionKey | null;
  };
  let { onAction, busy = null }: Props = $props();

  // Order is intentional: feed/play together (active), pat/rest together (calm).
  const ORDER: ActionKey[] = ["feed", "play", "pet", "rest"];
  const HINTS: Record<ActionKey, string> = {
    feed: "Give Mochi a treat",
    play: "Play together",
    pet:  "Pat Mochi",
    rest: "Let Mochi nap",
  };

  const actions = ORDER.map((key) => ({
    key,
    label: ACTION_DEFINITIONS[key].label,
    icon:  ACTION_DEFINITIONS[key].icon,
    hint:  HINTS[key],
  }));
</script>

<nav class="actions" aria-label="Pet actions">
  {#each actions as a (a.key)}
    <button
      type="button"
      class="action"
      class:busy={busy === a.key}
      onclick={() => onAction(a.key)}
      disabled={busy === a.key}
      title={a.hint}
      aria-label={a.label}
    >
      <span class="icon" aria-hidden="true">{a.icon}</span>
      <span class="label">{a.label}</span>
    </button>
  {/each}
</nav>

<style>
  .actions {
    display: flex;
    gap: 6px;
    background: rgba(255, 255, 255, 0.94);
    padding: 8px;
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    pointer-events: auto;
  }
  .action {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 56px;
    height: 56px;
    border: 0;
    border-radius: 12px;
    background: rgba(255, 240, 245, 0.85);
    color: var(--mochi-text, #3a2b34);
    cursor: pointer;
    transition: transform 0.08s ease, background 0.15s ease;
  }
  .action:hover {
    background: rgba(255, 218, 232, 0.95);
  }
  .action:active {
    transform: scale(0.94);
  }
  .action:disabled,
  .action.busy {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .icon { font-size: 20px; line-height: 1; }
  .label { font-size: 10px; font-weight: 600; letter-spacing: 0.02em; }
</style>
