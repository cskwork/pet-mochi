<script lang="ts">
  type Props = { onSubmit: (text: string) => void };
  let { onSubmit }: Props = $props();

  let value = $state("");

  function submit() {
    const t = value.trim();
    if (!t) return;
    onSubmit(t);
    value = "";
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
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
  />
  <button onclick={submit} disabled={!value.trim()}>send</button>
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
