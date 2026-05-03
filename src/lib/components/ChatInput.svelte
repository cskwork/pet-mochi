<script lang="ts">
  type Props = { onSubmit: (text: string) => void | Promise<void> };
  let { onSubmit }: Props = $props();

  let value = $state("");
  let sending = $state(false);

  async function submit() {
    const t = value.trim();
    if (!t || sending) return;
    sending = true;
    try {
      await onSubmit(t);
      value = "";
    } finally {
      sending = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }
</script>

<div class="chat-input">
  <input
    type="text"
    bind:value
    onkeydown={onKey}
    placeholder="say hi to mochi…"
    aria-label="Chat with mochi"
    disabled={sending}
  />
  <button
    onclick={submit}
    disabled={!value.trim() || sending}
    aria-busy={sending}
  >
    {sending ? "sending…" : "send"}
  </button>
</div>

<style>
  .chat-input {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  input {
    width: 180px;
  }
</style>
