<script lang="ts">
  import type { Mood } from "../sim/state";

  type Props = { text: string; mood: Mood };
  let { text, mood }: Props = $props();

  const moodColor: Record<Mood, string> = {
    happy: "#FFE3EA",
    curious: "#FFF1D6",
    tired: "#E8DCEA",
    hungry: "#FFE0CC",
    bored: "#E2E8EE",
    lonely: "#D9D2EA",
    focused: "#D7EFE2",
  };
</script>

<div
  class="bubble"
  style="--bg: {moodColor[mood]};"
  role="status"
  aria-live="polite"
  aria-atomic="true"
>
  <p>{text}</p>
  <div class="tail" aria-hidden="true"></div>
</div>

<style>
  .bubble {
    position: relative;
    background: var(--bg);
    color: var(--mochi-text);
    border-radius: 14px;
    padding: 10px 14px;
    max-width: 220px;
    font-size: 13px;
    line-height: 1.4;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
    animation: pop 220ms cubic-bezier(0.34, 1.4, 0.64, 1) both;
  }
  .bubble p {
    margin: 0;
    word-break: break-word;
  }
  .tail {
    position: absolute;
    left: 22px;
    bottom: -8px;
    width: 0;
    height: 0;
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-top: 8px solid var(--bg);
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.92);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
