<script lang="ts">
  import type { PetState } from "../sim";

  type Props = {
    pet: PetState;
    saving?: boolean;
    /** When false, renders a tiny floating chip instead of the full panel. */
    open?: boolean;
    /** Toggle handler — clicked from both the chip and the panel close button. */
    onToggle?: () => void;
    /** Stat key currently being flashed (briefly highlighted). Lets the user
        see that an action registered even when the value is already at cap. */
    flashedStat?: string | null;
  };
  let {
    pet,
    saving = false,
    open = false,
    onToggle,
    flashedStat = null,
  }: Props = $props();

  type Bar = {
    /** Stable key — matches Pet.svelte's ACTION_TO_STAT map for the flash cue. */
    key: string;
    label: string;
    icon: string;
    /** Display value 0-100. All gauges read "high = good" so action presses
        always make the bar fill UP. Internally the sim still tracks hunger/
        boredom as bad-when-high; we invert only at the display layer. */
    value: number;
  };

  const bars = $derived<Bar[]>([
    { key: "energy",    label: "Energy",   icon: "⚡", value: pet.energy },
    { key: "hunger",    label: "Fullness", icon: "🍡", value: 100 - pet.hunger },
    { key: "affection", label: "Affection", icon: "♥",  value: pet.affection },
    { key: "boredom",   label: "Fun",      icon: "🎾", value: 100 - pet.boredom },
  ]);

  function fillColor(b: Bar): string {
    // All gauges are "high = good" now, so the colour logic is uniform.
    const pct = Math.max(0, Math.min(100, b.value));
    if (pct < 25) return "var(--mochi-bar-danger, #e57373)";
    if (pct < 45) return "var(--mochi-bar-warn,   #f5b955)";
    return "var(--mochi-bar-ok, #6dc28a)";
  }
</script>

{#if open}
  <aside class="status" aria-label="Pet status">
    <span class="meta name">{pet.name}</span>
    <span class="meta mood">{pet.mood}</span>
    <span class="meta bond" title="Bond level">♥{pet.relationshipLevel}</span>
    {#each bars as b (b.key)}
      <span
        class="gauge"
        class:flash={flashedStat === b.key}
        role="progressbar"
        aria-label={b.label}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(b.value)}
        title="{b.label}: {Math.round(b.value)}"
      >
        <span class="g-icon" aria-hidden="true">{b.icon}</span>
        <span class="g-track">
          <span
            class="g-fill"
            style="width: {Math.max(0, Math.min(100, b.value))}%; background: {fillColor(b)};"
          ></span>
        </span>
        <span class="g-num">{Math.round(b.value)}</span>
      </span>
    {/each}
    {#if saving}<span class="meta saving" aria-live="polite">saving…</span>{/if}
    {#if onToggle}
      <button
        type="button"
        class="close"
        onclick={() => onToggle?.()}
        aria-label="Hide status"
        title="Hide status"
      >×</button>
    {/if}
  </aside>
{:else if onToggle}
  <button
    type="button"
    class="status-chip"
    onclick={() => onToggle?.()}
    aria-label="Show status"
    title="Show {pet.name}'s status"
  >
    <span class="chip-icon" aria-hidden="true">📊</span>
    <span class="chip-mood">{pet.mood}</span>
  </button>
{/if}

<style>
  .status {
    display: flex;
    align-items: center;
    /* Wrap if items don't fit on a 360px-wide overlay so the close button is
       never pushed off-screen. */
    flex-wrap: wrap;
    gap: 6px;
    row-gap: 4px;
    background: rgba(255, 255, 255, 0.94);
    padding: 6px 10px;
    border-radius: 16px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15);
    font-size: 11px;
    color: var(--mochi-text, #3a2b34);
    pointer-events: auto;
    /* Stays within the viewport even on the small 360×360 overlay. */
    max-width: calc(100vw - 16px);
  }
  .meta {
    font-weight: 600;
    white-space: nowrap;
  }
  .name { font-size: 12px; }
  .mood {
    background: rgba(255, 220, 232, 0.75);
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    text-transform: capitalize;
  }
  .bond {
    color: #c0567a;
    font-size: 10px;
  }
  .saving {
    font-size: 9px;
    color: #888;
    font-weight: 400;
  }
  .gauge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 4px;
    border-radius: 999px;
    transition: background 0.25s ease, transform 0.2s ease;
  }
  .gauge.flash {
    background: rgba(255, 220, 232, 0.85);
    animation: gauge-pulse 0.6s ease-out;
  }
  @keyframes gauge-pulse {
    0%   { transform: scale(1.0); }
    35%  { transform: scale(1.15); }
    100% { transform: scale(1.0); }
  }
  .g-num {
    font-size: 9px;
    color: #6a5560;
    font-variant-numeric: tabular-nums;
    min-width: 14px;
    text-align: right;
  }
  .g-icon { font-size: 12px; line-height: 1; }
  .g-track {
    /* Wider so a 30→0 hunger drop or a 80→100 energy gain is visibly an
       inch-and-a-half of bar movement, not a few pixels. */
    display: inline-block;
    width: 44px;
    height: 7px;
    background: rgba(0, 0, 0, 0.07);
    border-radius: 999px;
    overflow: hidden;
  }
  .g-fill {
    display: block;
    height: 100%;
    border-radius: 999px;
    transition: width 0.4s ease, background 0.4s ease;
  }
  .close {
    /* Always sits at the end of the row; always visible. Slightly bigger
       hitbox + faint pink tint so users can see + click it. */
    margin-left: auto;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 50%;
    background: rgba(255, 220, 232, 0.55);
    font-size: 17px;
    line-height: 1;
    color: var(--mochi-text, #3a2b34);
    opacity: 0.85;
    cursor: pointer;
    transition: opacity 0.15s ease, background 0.15s ease;
  }
  .close:hover {
    opacity: 1;
    background: rgba(255, 200, 225, 0.95);
  }
  .status-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 0;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.92);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
    font-size: 11px;
    font-weight: 600;
    color: var(--mochi-text, #3a2b34);
    cursor: pointer;
    pointer-events: auto;
    transition: transform 0.08s ease, background 0.15s ease;
  }
  .status-chip:hover {
    background: rgba(255, 240, 245, 0.98);
  }
  .status-chip:active {
    transform: scale(0.96);
  }
  .chip-icon { font-size: 14px; line-height: 1; }
  .chip-mood { text-transform: capitalize; }
</style>
