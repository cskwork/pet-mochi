<script lang="ts">
  import { ACTION_DEFINITIONS, type ActionKey } from "../sim";

  type Props = {
    onAction: (action: ActionKey) => void;
    /** Optional separate handler for the report button (a meta-action that
        doesn't mutate pet state and so isn't an ActionKey). */
    onReport?: () => void;
    /** When set, that action is briefly disabled to prevent double-tap spam. */
    busy?: ActionKey | null;
    /** True while a report request is in flight; shows a writing indicator. */
    reporting?: boolean;
    /** REQ-107 — Feed opens a snack-tray menu; mirrored as aria-expanded. */
    feedExpanded?: boolean;
  };
  let {
    onAction,
    onReport,
    busy = null,
    reporting = false,
    feedExpanded = false,
  }: Props = $props();

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
      aria-haspopup={a.key === "feed" ? "menu" : undefined}
      aria-expanded={a.key === "feed" ? feedExpanded : undefined}
    >
      <span class="icon" aria-hidden="true">{a.icon}</span>
      <span class="label">{a.label}</span>
    </button>
  {/each}

  {#if onReport}
    <span class="divider" aria-hidden="true"></span>
    <button
      type="button"
      class="action report"
      class:busy={reporting}
      onclick={() => onReport?.()}
      disabled={reporting}
      title="Mochi writes a tiny note about your time together"
      aria-label="Generate report"
    >
      <span class="icon" aria-hidden="true">{reporting ? "✏️" : "📔"}</span>
      <span class="label">{reporting ? "Writing" : "Report"}</span>
    </button>
  {/if}
</nav>

<style>
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.94);
    padding: 8px;
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    pointer-events: auto;
  }
  .divider {
    align-self: stretch;
    width: 1px;
    margin: 4px 2px;
    background: rgba(0, 0, 0, 0.08);
  }
  .action.report {
    background: rgba(255, 232, 245, 0.9);
  }
  .action.report:hover {
    background: rgba(255, 200, 225, 0.95);
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
