<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Mood, MovementState } from "../sim/state";

  type Props = {
    mood: Mood;
    animation: MovementState;
    size?: number;
    facing?: "left" | "right";
    blink?: boolean;
    breathe?: boolean;
  };

  let {
    mood,
    animation,
    size = 140,
    facing = "right",
    // `blink` is intentionally unused: the high-quality PNG sprites have eyes
    // baked in per pose, so a separate vector blink overlay would visibly drift
    // from each frame's eye position. Kept in the prop API for compatibility.
    blink: _blink = false,
    breathe = true,
  }: Props = $props();

  type FrameSrc = string | [string, string];

  // walk/run hold a 2-frame pair that we swap on a timer to drive the
  // step cycle independently from the CSS bob keyframe.
  const SRC: Record<MovementState, FrameSrc> = {
    idle: "/sprites/mochi-idle.png",
    walk: ["/sprites/mochi-walk-1.png", "/sprites/mochi-walk-2.png"],
    run: ["/sprites/mochi-run-1.png", "/sprites/mochi-run-2.png"],
    sleep: "/sprites/mochi-sleep.png",
    jump: "/sprites/mochi-jump.png",
    sit: "/sprites/mochi-sit.png",
    look_cursor: "/sprites/mochi-look-cursor.png",
    hide: "/sprites/mochi-hide.png",
    celebrate: "/sprites/mochi-celebrate.png",
  };

  // Subtle CSS tint per mood so the same base PNG reads as a different state
  // without redrawing the character.
  const MOOD_FILTER: Record<Mood, string> = {
    happy: "none",
    curious: "hue-rotate(-12deg) saturate(1.08)",
    tired: "hue-rotate(25deg) saturate(0.7) brightness(0.96)",
    hungry: "hue-rotate(-22deg) saturate(1.18)",
    bored: "saturate(0.45) brightness(0.97)",
    lonely: "hue-rotate(40deg) saturate(0.78) brightness(0.95)",
    focused: "hue-rotate(70deg) saturate(0.85)",
  };

  let frameIdx = $state(0);
  let cycleTimer: ReturnType<typeof setInterval> | undefined;

  $effect(() => {
    if (cycleTimer) {
      clearInterval(cycleTimer);
      cycleTimer = undefined;
    }
    const src = SRC[animation];
    if (Array.isArray(src)) {
      const periodMs = animation === "run" ? 160 : 280;
      cycleTimer = setInterval(() => {
        frameIdx = (frameIdx + 1) % 2;
      }, periodMs);
    } else {
      frameIdx = 0;
    }
  });

  onDestroy(() => {
    if (cycleTimer) clearInterval(cycleTimer);
  });

  let currentSrc = $derived.by(() => {
    const src = SRC[animation];
    return Array.isArray(src) ? src[frameIdx] : src;
  });

  let scaleX = $derived(facing === "left" ? -1 : 1);
  let isAsleep = $derived(animation === "sleep");
  let moodFilter = $derived(MOOD_FILTER[mood]);
</script>

<div
  class="mochi"
  style="--size: {size}px; --scale-x: {scaleX}; --mood-filter: {moodFilter};"
  class:breathe
  class:asleep={isAsleep}
  data-anim={animation}
>
  <img
    class="sprite"
    src={currentSrc}
    alt="Mochi pet"
    width={size}
    height={size}
    draggable="false"
  />

  {#if mood === "curious" && !isAsleep}
    <div class="mark mark-curious" aria-hidden="true">?</div>
  {/if}

  {#if mood === "happy" && animation === "celebrate"}
    <div class="mark mark-heart-l" aria-hidden="true">♥</div>
    <div class="mark mark-heart-r" aria-hidden="true">♥</div>
  {/if}
</div>

<style>
  .mochi {
    width: var(--size);
    height: var(--size);
    position: relative;
    transform-origin: center bottom;
    will-change: transform;
  }

  .sprite {
    width: 100%;
    height: 100%;
    display: block;
    transform: scaleX(var(--scale-x));
    filter: var(--mood-filter);
    transition: filter 600ms ease;
    image-rendering: auto;
    user-select: none;
    -webkit-user-drag: none;
  }

  .mochi.breathe .sprite {
    animation: breathe 3.6s ease-in-out infinite;
  }

  .mochi.asleep .sprite {
    animation: snore 4s ease-in-out infinite;
  }

  .mochi[data-anim="walk"] .sprite {
    animation: bob 0.6s ease-in-out infinite;
  }

  .mochi[data-anim="run"] .sprite {
    animation: bob 0.32s ease-in-out infinite;
  }

  .mochi[data-anim="jump"] .sprite {
    animation: hop 0.7s ease-out infinite;
  }

  .mochi[data-anim="celebrate"] .sprite {
    animation: wiggle 0.6s ease-in-out infinite;
  }

  @keyframes breathe {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) scale(1, 1);
    }
    50% {
      transform: scaleX(var(--scale-x)) scale(1.02, 0.98);
    }
  }

  @keyframes snore {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) scale(1, 1) translateY(0);
    }
    50% {
      transform: scaleX(var(--scale-x)) scale(1.04, 0.96) translateY(2px);
    }
  }

  @keyframes bob {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) translateY(0);
    }
    50% {
      transform: scaleX(var(--scale-x)) translateY(-4px);
    }
  }

  @keyframes hop {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) translateY(0) scale(1, 1);
    }
    40% {
      transform: scaleX(var(--scale-x)) translateY(-12px) scale(1.05, 0.95);
    }
  }

  @keyframes wiggle {
    0%,
    100% {
      transform: scaleX(var(--scale-x)) rotate(-3deg);
    }
    50% {
      transform: scaleX(var(--scale-x)) rotate(3deg);
    }
  }

  .mark {
    position: absolute;
    pointer-events: none;
    font-weight: 700;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.6);
  }

  .mark-curious {
    top: 6%;
    right: 8%;
    color: #3a2a36;
    font-size: calc(var(--size) * 0.16);
    animation: pop 1.2s ease-in-out infinite;
  }

  .mark-heart-l {
    top: 18%;
    left: 6%;
    color: #ff7aa1;
    font-size: calc(var(--size) * 0.13);
    animation: float 1.8s ease-in-out infinite;
  }

  .mark-heart-r {
    top: 22%;
    right: 8%;
    color: #ff9aaf;
    font-size: calc(var(--size) * 0.11);
    animation: float 1.8s ease-in-out infinite 0.3s;
  }

  @keyframes pop {
    0%,
    100% {
      transform: translateY(0) scale(1);
    }
    50% {
      transform: translateY(-3px) scale(1.1);
    }
  }

  @keyframes float {
    0%,
    100% {
      transform: translateY(0);
      opacity: 0.85;
    }
    50% {
      transform: translateY(-6px);
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .mochi.breathe .sprite,
    .mochi.asleep .sprite,
    .mochi[data-anim="walk"] .sprite,
    .mochi[data-anim="run"] .sprite,
    .mochi[data-anim="jump"] .sprite,
    .mochi[data-anim="celebrate"] .sprite,
    .mark {
      animation: none !important;
    }
  }
</style>
