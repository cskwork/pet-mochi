<script lang="ts">
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
    blink = false,
    breathe = true,
  }: Props = $props();

  const moodPalette: Record<Mood, { body: string; cheek: string; eye: string }> = {
    happy: { body: "#FFE3EA", cheek: "#FFB3C5", eye: "#3a2a36" },
    curious: { body: "#FFF1D6", cheek: "#FFC78F", eye: "#3a2a36" },
    tired: { body: "#E8DCEA", cheek: "#C7A8C5", eye: "#5a4a55" },
    hungry: { body: "#FFE0CC", cheek: "#FF9E7A", eye: "#3a2a36" },
    bored: { body: "#E2E8EE", cheek: "#A4B0BF", eye: "#3a2a36" },
    lonely: { body: "#D9D2EA", cheek: "#9F92BD", eye: "#5a4a55" },
    focused: { body: "#D7EFE2", cheek: "#88BFA4", eye: "#26303a" },
  };

  let palette = $derived(moodPalette[mood]);

  const transformFor = (a: MovementState): string => {
    switch (a) {
      case "walk":
        return "translateY(0px)";
      case "run":
        return "translateY(-2px) scale(1.02)";
      case "jump":
        return "translateY(-12px) scale(1.05, 0.95)";
      case "sleep":
        return "translateY(4px) rotate(-2deg)";
      case "celebrate":
        return "translateY(-6px) rotate(2deg)";
      case "look_cursor":
        return "translateY(0px)";
      case "hide":
        return "translateY(8px) scale(0.9)";
      case "sit":
        return "translateY(2px)";
      default:
        return "translateY(0px)";
    }
  };

  let bodyTransform = $derived(transformFor(animation));
  let scaleX = $derived(facing === "left" ? -1 : 1);
  let isAsleep = $derived(animation === "sleep");
</script>

<div
  class="mochi"
  style="--size: {size}px; --scale-x: {scaleX}; transform: {bodyTransform};"
  class:breathe
  class:asleep={isAsleep}
  data-anim={animation}
>
  <svg
    width={size}
    height={size}
    viewBox="0 0 200 200"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Mochi pet"
  >
    <defs>
      <radialGradient id="bodyGradient" cx="0.5" cy="0.45" r="0.6">
        <stop offset="0%" stop-color="white" stop-opacity="0.9" />
        <stop offset="100%" stop-color={palette.body} />
      </radialGradient>
      <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
        <feOffset dx="0" dy="3" result="offsetBlur" />
        <feFlood flood-color="rgba(0,0,0,0.18)" />
        <feComposite in2="offsetBlur" operator="in" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <!-- ground shadow -->
    <ellipse cx="100" cy="178" rx="55" ry="6" fill="rgba(0,0,0,0.18)" />

    <!-- body (mochi blob) -->
    <g filter="url(#softShadow)">
      <path
        d="M 40 110
           C 40 60, 90 38, 100 38
           C 110 38, 160 60, 160 110
           C 160 160, 130 175, 100 175
           C 70 175, 40 160, 40 110 Z"
        fill="url(#bodyGradient)"
        stroke={palette.cheek}
        stroke-width="1.5"
      />
    </g>

    <!-- ears -->
    <ellipse cx="62" cy="62" rx="14" ry="20" fill={palette.body} stroke={palette.cheek} stroke-width="1.5" />
    <ellipse cx="138" cy="62" rx="14" ry="20" fill={palette.body} stroke={palette.cheek} stroke-width="1.5" />
    <ellipse cx="62" cy="65" rx="6" ry="10" fill={palette.cheek} opacity="0.6" />
    <ellipse cx="138" cy="65" rx="6" ry="10" fill={palette.cheek} opacity="0.6" />

    <!-- cheeks -->
    <ellipse cx="65" cy="118" rx="11" ry="7" fill={palette.cheek} opacity="0.85" />
    <ellipse cx="135" cy="118" rx="11" ry="7" fill={palette.cheek} opacity="0.85" />

    <!-- eyes -->
    <g class="eyes" class:closed={blink || isAsleep}>
      {#if blink || isAsleep}
        <path d="M 75 102 Q 82 108 89 102" stroke={palette.eye} stroke-width="3" fill="none" stroke-linecap="round" />
        <path d="M 111 102 Q 118 108 125 102" stroke={palette.eye} stroke-width="3" fill="none" stroke-linecap="round" />
      {:else}
        <ellipse cx="82" cy="104" rx="5" ry="7" fill={palette.eye} />
        <ellipse cx="118" cy="104" rx="5" ry="7" fill={palette.eye} />
        <circle cx="80" cy="101" r="1.6" fill="white" />
        <circle cx="116" cy="101" r="1.6" fill="white" />
      {/if}
    </g>

    <!-- mouth -->
    {#if mood === "hungry"}
      <ellipse cx="100" cy="130" rx="6" ry="4" fill={palette.eye} />
    {:else if mood === "tired" || isAsleep}
      <path d="M 92 130 Q 100 132 108 130" stroke={palette.eye} stroke-width="2" fill="none" stroke-linecap="round" />
    {:else if mood === "bored"}
      <line x1="92" y1="130" x2="108" y2="130" stroke={palette.eye} stroke-width="2.4" stroke-linecap="round" />
    {:else}
      <path d="M 90 128 Q 100 138 110 128" stroke={palette.eye} stroke-width="2.4" fill="none" stroke-linecap="round" />
    {/if}

    {#if isAsleep}
      <!-- Z's -->
      <text x="155" y="60" font-size="14" fill={palette.eye} opacity="0.7" font-weight="bold">z</text>
      <text x="165" y="48" font-size="11" fill={palette.eye} opacity="0.5" font-weight="bold">z</text>
    {/if}

    {#if mood === "curious"}
      <text x="160" y="50" font-size="22" fill={palette.eye} font-weight="bold">?</text>
    {/if}

    {#if mood === "happy" && animation === "celebrate"}
      <text x="35" y="55" font-size="18" fill="#ff9aaf">♥</text>
      <text x="160" y="55" font-size="18" fill="#ff9aaf">♥</text>
    {/if}
  </svg>
</div>

<style>
  .mochi {
    width: var(--size);
    height: var(--size);
    transition: transform 320ms cubic-bezier(0.34, 1.3, 0.64, 1);
    will-change: transform;
    transform-origin: center bottom;
  }

  .mochi svg {
    transform: scaleX(var(--scale-x));
    transition: transform 240ms ease;
  }

  .mochi.breathe svg {
    animation: breathe 3.6s ease-in-out infinite;
  }

  .mochi.asleep svg {
    animation: snore 4s ease-in-out infinite;
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

  .mochi[data-anim="walk"] svg {
    animation: bob 0.6s ease-in-out infinite;
  }

  .mochi[data-anim="run"] svg {
    animation: bob 0.32s ease-in-out infinite;
  }

  .mochi[data-anim="jump"] svg {
    animation: hop 0.7s ease-out infinite;
  }

  .mochi[data-anim="celebrate"] svg {
    animation: wiggle 0.6s ease-in-out infinite;
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
</style>
