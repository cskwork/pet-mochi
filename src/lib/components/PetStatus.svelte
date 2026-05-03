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
    value: number;
    /** Visual hint for the fill colour. "good" = high is good, "bad" = high is bad. */
    polarity: "good" | "bad";
  };

  const bars = $derived<Bar[]>([
    { key: "energy",    label: "Energy",    value: pet.energy,    polarity: "good" },
    { key: "hunger",    label: "Hunger",    value: pet.hunger,    polarity: "bad"  },
    { key: "affection", label: "Affection", value: pet.affection, polarity: "good" },
    { key: "boredom",   label: "Boredom",   value: pet.boredom,   polarity: "bad"  },
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
    <header class="status-head">
      <span class="name">{pet.name}</span>
      <span class="mood">{pet.mood}</span>
      <span class="bond" title="Bond level">♥ {pet.relationshipLevel}</span>
      {#if saving}<span class="saving" aria-live="polite">saving…</span>{/if}
      {#if onToggle}
        <button
          type="button"
          class="close"
          onclick={() => onToggle?.()}
          aria-label="Hide status"
          title="Hide status"
        >×</button>
      {/if}
    </header>

    <ul class="bars">
      {#each bars as b (b.key)}
        <li class="bar-row">
          <span class="bar-label">{b.label}</span>
          <div
            class="bar-track"
            role="progressbar"
            aria-label={b.label}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(b.value)}
          >
            <div
              class="bar-fill"
              style="width: {Math.max(0, Math.min(100, b.value))}%; background: {fillColor(b)};"
            ></div>
          </div>
          <span class="bar-num">{Math.round(b.value)}</span>
        </li>
      {/each}
    </ul>
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
    background: rgba(255, 255, 255, 0.94);
    padding: 10px 12px;
    border-radius: 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    min-width: 200px;
    max-width: 240px;
    font-size: 12px;
    color: var(--mochi-text, #3a2b34);
    pointer-events: auto;
  }
  .status-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-weight: 600;
  }
  .name { font-size: 13px; }
  .mood {
    background: rgba(255, 220, 232, 0.7);
    padding: 2px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 500;
    text-transform: capitalize;
  }
  .bond {
    margin-left: auto;
    color: #c0567a;
    font-weight: 600;
    font-size: 11px;
  }
  .saving {
    font-size: 10px;
    color: #888;
    font-weight: 400;
  }
  .bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .bar-row {
    display: grid;
    grid-template-columns: 64px 1fr 28px;
    align-items: center;
    gap: 8px;
  }
  .bar-label { font-size: 11px; color: #6a5560; }
  .bar-num { font-size: 10px; color: #6a5560; text-align: right; font-variant-numeric: tabular-nums; }
  .bar-track {
    height: 8px;
    background: rgba(0, 0, 0, 0.07);
    border-radius: 999px;
    overflow: hidden;
  }
  .bar-fill {
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
