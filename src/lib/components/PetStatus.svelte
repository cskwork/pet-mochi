<script lang="ts">
  import type { PetState } from "../sim";

  type Props = {
    pet: PetState;
    saving?: boolean;
    /** When false, renders a tiny floating chip instead of the full panel. */
    open?: boolean;
    /** Toggle handler — clicked from both the chip and the panel close button. */
    onToggle?: () => void;
  };
  let { pet, saving = false, open = false, onToggle }: Props = $props();

  type Bar = {
    key: string;
    label: string;
    icon: string;
    value: number;
    /** Visual hint for the fill colour. "good" = high is good, "bad" = high is bad. */
    polarity: "good" | "bad";
  };

  const bars = $derived<Bar[]>([
    { key: "energy",    label: "Energy",    icon: "⚡", value: pet.energy,    polarity: "good" },
    { key: "hunger",    label: "Hunger",    icon: "🍡", value: pet.hunger,    polarity: "bad"  },
    { key: "affection", label: "Affection", icon: "♥",  value: pet.affection, polarity: "good" },
    { key: "boredom",   label: "Boredom",   icon: "💤", value: pet.boredom,   polarity: "bad"  },
  ]);

  function fillColor(b: Bar): string {
    const pct = Math.max(0, Math.min(100, b.value));
    // For "good" stats: low is bad (red), high is fine (green).
    // For "bad" stats: high is bad (red), low is fine (green).
    const danger = b.polarity === "good" ? pct < 25 : pct > 75;
    const warn   = b.polarity === "good" ? pct < 45 : pct > 55;
    if (danger) return "var(--mochi-bar-danger, #e57373)";
    if (warn)   return "var(--mochi-bar-warn,   #f5b955)";
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
    gap: 6px;
    background: rgba(255, 255, 255, 0.94);
    padding: 5px 8px;
    border-radius: 999px;
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
  }
  .g-icon { font-size: 11px; line-height: 1; }
  .g-track {
    display: inline-block;
    width: 26px;
    height: 6px;
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
    margin-left: 4px;
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    font-size: 16px;
    line-height: 1;
    color: var(--mochi-text, #3a2b34);
    opacity: 0.55;
    cursor: pointer;
    transition: opacity 0.15s ease, background 0.15s ease;
  }
  .close:hover {
    opacity: 1;
    background: rgba(0, 0, 0, 0.06);
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
