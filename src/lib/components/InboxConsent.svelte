<script lang="ts">
  /**
   * Consent prompt for inbox files. Asks the user before Mochi reads any file
   * dropped into the sandbox (PRD §21.10 / REQ-084).
   *
   * - "Read" calls `approve_file` and dismisses on success.
   * - "Skip" dismisses locally — there's no backend reject command, so the file
   *   simply stays in the inbox unapproved (the safe default).
   * - The parent owns the queue: when the user resolves one prompt, it advances
   *   to the next file. We never auto-dismiss — consent must be explicit.
   */
  import { onMount, tick } from "svelte";
  import { nextTrapIndex } from "./focusTrap";

  type Props = {
    fileName: string;
    onApprove: (name: string) => Promise<void>;
    onSkip: () => void;
    /** How many more requests are queued behind this one (>=0). */
    remaining?: number;
  };
  let { fileName, onApprove, onSkip, remaining = 0 }: Props = $props();

  let busy = $state(false);
  let errorMsg = $state<string | null>(null);
  let primaryBtn: HTMLButtonElement | null = null;
  let secondaryBtn: HTMLButtonElement | null = null;

  async function clickRead() {
    if (busy) return;
    busy = true;
    errorMsg = null;
    try {
      await onApprove(fileName);
      // Parent dismisses on success.
    } catch (e: unknown) {
      errorMsg = e instanceof Error ? e.message : "could not read this file";
    } finally {
      busy = false;
    }
  }

  function clickSkip() {
    if (busy) return;
    onSkip();
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape" && !busy) {
      e.preventDefault();
      clickSkip();
      return;
    }
    if (e.key !== "Tab") return;
    // While busy, both buttons are `disabled` and would be filtered out below,
    // leaving the trap empty and Tab able to escape into the underlying pet UI.
    // Block Tab unconditionally for the brief async window — focus stays put.
    if (busy) {
      e.preventDefault();
      return;
    }
    // Focus trap: cycle Tab/Shift+Tab among the dialog's focusable buttons so
    // keyboard users can't escape the alertdialog into the underlying pet UI.
    const order: Array<HTMLButtonElement | null> = [primaryBtn, secondaryBtn];
    const focusables = order.filter((b): b is HTMLButtonElement => b !== null && !b.disabled);
    const currentIndex = focusables.indexOf(document.activeElement as HTMLButtonElement);
    const target = nextTrapIndex({
      currentIndex,
      count: focusables.length,
      shift: e.shiftKey,
    });
    if (target === -1) return;
    e.preventDefault();
    focusables[target]?.focus();
  }

  onMount(async () => {
    await tick();
    primaryBtn?.focus();
  });
</script>

<div
  class="consent"
  role="alertdialog"
  aria-modal="true"
  aria-labelledby="inbox-consent-title"
  aria-describedby="inbox-consent-desc"
  onkeydown={onKeydown}
  tabindex="-1"
>
  <p id="inbox-consent-title" class="title">May I read this?</p>
  <p id="inbox-consent-desc" class="desc">
    I found <code>{fileName}</code> in my inbox.
  </p>
  {#if errorMsg}
    <p class="error" role="alert">{errorMsg}</p>
  {/if}
  <div class="row">
    <button
      bind:this={primaryBtn}
      type="button"
      class="primary"
      onclick={clickRead}
      disabled={busy}
      aria-busy={busy}
    >
      {busy ? "Reading…" : "Read"}
    </button>
    <button
      bind:this={secondaryBtn}
      type="button"
      class="secondary"
      onclick={clickSkip}
      disabled={busy}
    >
      Skip
    </button>
  </div>
  {#if remaining > 0}
    <p class="queue" aria-live="polite">+{remaining} more waiting</p>
  {/if}
</div>

<style>
  .consent {
    background: #fff;
    color: var(--mochi-text);
    border-radius: 14px;
    padding: 12px 14px 10px;
    font-size: 13px;
    line-height: 1.4;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.18);
    border: 1px solid rgba(0, 0, 0, 0.06);
    min-width: 220px;
    max-width: 260px;
    animation: pop 220ms cubic-bezier(0.34, 1.4, 0.64, 1) both;
  }
  .title {
    margin: 0 0 4px;
    font-weight: 600;
  }
  .desc {
    margin: 0 0 10px;
    word-break: break-word;
  }
  .desc code {
    background: rgba(0, 0, 0, 0.06);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12px;
  }
  .error {
    margin: 0 0 8px;
    color: #b3261e;
    font-size: 12px;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  button {
    flex: 1;
    border: 0;
    border-radius: 10px;
    padding: 7px 10px;
    font-size: 13px;
    cursor: pointer;
    font-weight: 500;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .primary {
    background: #ffb3c1;
    color: var(--mochi-text);
  }
  .primary:hover:not(:disabled) {
    background: #ff9bad;
  }
  .secondary {
    background: rgba(0, 0, 0, 0.06);
    color: var(--mochi-text);
  }
  .secondary:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.1);
  }
  .queue {
    margin: 8px 0 0;
    font-size: 11px;
    color: rgba(0, 0, 0, 0.55);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.94);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
