<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import MochiSprite from "./MochiSprite.svelte";
  import ChatBubble from "./ChatBubble.svelte";
  import PetActions from "./PetActions.svelte";
  import PetStatus from "./PetStatus.svelte";
  import {
    deriveTimeOfDay,
    nextWanderPosition,
    findSafeStartPosition,
    newPetState,
    runTick,
    applyAction,
    nextNudge,
    rememberNudge,
    newNudgeState,
    type ActionKey,
    type AnimationStep,
    type NudgeState,
    type Obstacle,
    type PetState,
    type RuntimeContext,
  } from "../sim";
  import { api } from "../bridge/api";
  import { listen } from "../bridge/tauri";
  import { eventBus } from "../events/bus";
  import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";

  type Props = { petSize?: number };
  let { petSize = 140 }: Props = $props();

  let pet = $state<PetState>(newPetState());
  let position = $state({ x: 0, y: 0 });
  let cursor = $state({ x: 0, y: 0 });
  let bubbleText = $state<string | null>(null);
  let bubbleOpen = $state(false);
  let blink = $state(false);
  // Briefly disable a button right after it fires so a double-tap can't stack
  // multiple boredom drops / animation overrides on the same tick.
  let busyAction = $state<ActionKey | null>(null);
  let busyTimer: ReturnType<typeof setTimeout> | undefined;
  // While an action sequence is playing, the sim tick must NOT overwrite the
  // animation — otherwise the chew/yawn frames flicker back to whatever the
  // tick chose. The scheduler clears this flag on the last step.
  let actionPlayingUntil = 0;
  let actionStepTimers: ReturnType<typeof setTimeout>[] = [];
  let reporting = $state(false);
  // Which stat to briefly highlight in PetStatus after an action — gives the
  // user a visible cue even when the underlying value is already at cap.
  let flashedStat = $state<string | null>(null);
  let flashStatTimer: ReturnType<typeof setTimeout> | undefined;
  // Maps each action to the bar that should pulse when the action fires.
  const ACTION_TO_STAT: Record<ActionKey, string> = {
    feed: "hunger",
    play: "boredom",
    pet: "affection",
    rest: "energy",
  };
  // Status panel starts collapsed so it never covers Mochi on first launch.
  // Users can re-open it from the floating chip in the top-left corner.
  let statusOpen = $state(false);
  let positionInitialised = false;
  let facing = $state<"left" | "right">("right");
  let recentPositive = $state(false);
  let lastInteractionAt = $state<number>(Date.now());
  let lastTickAt = $state<number>(Date.now());
  let nudgeState: NudgeState = newNudgeState();
  let saving = $state(false);
  let viewportSize = $state({ width: 360, height: 360 });

  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let blinkTimer: ReturnType<typeof setInterval> | undefined;
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let blinkInnerTimer: ReturnType<typeof setTimeout> | undefined;
  let hitTestTimer: ReturnType<typeof setInterval> | undefined;
  let unlistenInbox: (() => void) | null = null;
  let unsubscribeBus: (() => void) | null = null;
  let lastAutonomousFor: { kind: string; ts: number } | null = null;
  let destroyed = false;
  let clickThroughOn = false;
  let cachedScaleFactor = 1;

  // Drag/click separation state — startDragging fires only after the pointer
  // moves beyond DRAG_THRESHOLD; otherwise the click handler runs normally.
  let dragStart: { x: number; y: number; pointerId: number } | null = null;
  let dragged = false;

  const TICK_MS = 3_000;
  const SAVE_DEBOUNCE_MS = 4_000;
  const AUTONOMOUS_LOCAL_COOLDOWN_MS = 5 * 60_000;
  const HIT_TEST_MS = 80;
  const HIT_PAD = 8;
  const DRAG_THRESHOLD = 6;
  // Stable estimate for bubble dimensions — placement is recomputed reactively
  // but we don't measure the DOM (text changes would re-jitter the layout).
  const BUBBLE_W = 220;
  const BUBBLE_H = 64;
  const BUBBLE_MARGIN = 8;
  const BUBBLE_GAP = 10;
  const TAIL_INSET = 18;

  function buildContext(): RuntimeContext {
    const dx = cursor.x - (position.x + petSize / 2);
    const dy = cursor.y - (position.y + petSize / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minutesSince = (Date.now() - lastInteractionAt) / 60_000;
    return {
      cursorNearPet: dist < 120,
      userJustReturned: minutesSince > 30,
      recentPositiveEvent: recentPositive,
      awayMinutes: minutesSince,
      timeOfDay: deriveTimeOfDay(),
    };
  }

  async function syncFromBackend() {
    if (!api.hasBackend) return;
    try {
      const remote = await api.getPetState();
      pet = remote;
      // Restore the last interaction wall-clock so userJustReturned / awayMinutes
      // are accurate immediately after restart instead of waiting 30 minutes.
      if (remote.lastInteractionAt) {
        const t = Date.parse(remote.lastInteractionAt);
        if (!Number.isNaN(t)) {
          lastInteractionAt = t;
        }
      }
    } catch (err) {
      console.warn("getPetState failed", err);
    }
  }

  function scheduleSave() {
    if (!api.hasBackend || saveTimer) return;
    saveTimer = setTimeout(async () => {
      saveTimer = undefined;
      if (destroyed) return;
      // Capture the latest snapshot at flush time, NOT at schedule time —
      // otherwise intermediate ticks get overwritten by the backend echo.
      const snapshot = pet;
      saving = true;
      try {
        await api.savePetState(snapshot);
      } catch (err) {
        console.warn("savePetState failed", err);
        if (!destroyed) flashBubble("(couldn't save state)", 3_000);
      } finally {
        if (!destroyed) saving = false;
      }
    }, SAVE_DEBOUNCE_MS);
  }

  let wasReturning = false;

  function tick() {
    const now = Date.now();
    const elapsedSec = (now - lastTickAt) / 1000;
    lastTickAt = now;
    const ctx = buildContext();
    const next = runTick(pet, ctx, elapsedSec);

    // Update facing based on cursor side
    if (ctx.cursorNearPet) {
      facing = cursor.x < position.x + petSize / 2 ? "left" : "right";
    }

    // Wander while walking/running. The status panel (when open) and the
    // actions panel are passed as obstacles so Mochi never visually disappears
    // behind UI chrome.
    if (next.currentAnimation === "walk" || next.currentAnimation === "run") {
      const newPos = nextWanderPosition(
        position,
        { width: viewportSize.width, height: viewportSize.height, petSize },
        currentObstacles(),
      );
      facing = newPos.x < position.x ? "left" : newPos.x > position.x ? "right" : facing;
      position = newPos;
    }

    // While a tap-driven action sequence is mid-play, keep its animation pinned
    // — let stat changes through but not the auto-derived animation override.
    if (now < actionPlayingUntil) {
      pet = { ...next, currentAnimation: pet.currentAnimation };
    } else {
      pet = next;
    }

    // Spontaneous canned nudge if any mood threshold is crossed (priority +
    // cooldowns enforced inside `nextNudge`). LLM is intentionally not in this
    // path — nudges must work even when Ollama is offline (PRD §5.2).
    const nudge = nextNudge(pet, nudgeState, now);
    if (nudge) {
      flashBubble(`${pet.name}: ${nudge.bubble}`, 2_500);
      if (nudge.animation && now >= actionPlayingUntil) {
        // Override this tick's animation; the next tick re-derives from stats.
        // Suppressed mid-action so the eat/yawn beats finish cleanly.
        pet = { ...pet, currentAnimation: nudge.animation };
      }
      nudgeState = rememberNudge(nudgeState, nudge, now);
    }

    eventBus.dispatch({ type: "IDLE_TICK" }, pet);

    // Edge-trigger USER_RETURNED on the away→returning transition so
    // subscribers (autonomous speech, future analytics) actually fire instead
    // of the salience gate being dead code. We only dispatch on the *first*
    // tick where userJustReturned becomes true.
    if (ctx.userJustReturned && !wasReturning) {
      wasReturning = true;
      eventBus.dispatch(
        { type: "USER_RETURNED", awayMinutes: ctx.awayMinutes },
        pet,
      );
    } else if (!ctx.userJustReturned) {
      wasReturning = false;
    }

    scheduleSave();

    // Reset transient flags
    if (recentPositive) {
      recentPositive = false;
    }
  }

  function flashBubble(text: string, ms = 5_000) {
    if (bubbleTimer) clearTimeout(bubbleTimer);
    bubbleText = text;
    bubbleOpen = true;
    bubbleTimer = setTimeout(() => {
      bubbleOpen = false;
      bubbleTimer = undefined;
    }, ms);
  }

  async function maybeAutonomousSpeak(kind: string, awayMinutes: number) {
    // Local cooldown so a single dispatched event doesn't hammer the backend
    // every tick. The backend has its own LLM cooldown as a backstop.
    const now = Date.now();
    if (
      lastAutonomousFor &&
      lastAutonomousFor.kind === kind &&
      now - lastAutonomousFor.ts < AUTONOMOUS_LOCAL_COOLDOWN_MS
    ) {
      return;
    }
    lastAutonomousFor = { kind, ts: now };
    try {
      const reply = await api.autonomousSpeak(kind, awayMinutes);
      if (reply && reply.text) {
        flashBubble(`${pet.name}: ${reply.text}`, 5_500);
      }
      // Adopt backend pet state (lastLlmCallAt is set there) so the next
      // debounced save doesn't roll back the LLM call timestamp.
      if (reply && reply.pet) {
        pet = reply.pet;
      }
    } catch {
      // Autonomous speech is best-effort; failure is silent.
    }
  }

  async function handlePetClick() {
    await onAction("pet");
  }

  function flashBusy(key: ActionKey, ms = 700) {
    if (busyTimer) clearTimeout(busyTimer);
    busyAction = key;
    busyTimer = setTimeout(() => {
      busyAction = null;
      busyTimer = undefined;
    }, ms);
  }

  function clearActionTimers() {
    for (const t of actionStepTimers) clearTimeout(t);
    actionStepTimers = [];
  }

  /** Walk through the action's animation steps over wall-clock time.
   *  Sets the first frame immediately; schedules each subsequent frame. The
   *  final frame is the resting pose (already in pet.currentAnimation), so we
   *  just need to clear `actionPlayingUntil` when the sequence finishes. */
  function playSteps(steps: AnimationStep[]) {
    clearActionTimers();
    if (steps.length === 0) return;
    pet = { ...pet, currentAnimation: steps[0].animation };
    let elapsed = 0;
    for (let i = 0; i < steps.length; i++) {
      elapsed += steps[i].durationMs;
      // Schedule the *next* frame at the cumulative offset; the last entry's
      // timer just clears the playing flag (its anim stays as the resting pose).
      const isLast = i === steps.length - 1;
      const nextAnim = isLast ? null : steps[i + 1].animation;
      const timer = setTimeout(() => {
        if (destroyed) return;
        if (nextAnim) {
          pet = { ...pet, currentAnimation: nextAnim };
        }
      }, elapsed);
      actionStepTimers.push(timer);
    }
    actionPlayingUntil = Date.now() + elapsed;
  }

  async function onAction(key: ActionKey) {
    if (busyAction === key) return;
    flashBusy(key);
    lastInteractionAt = Date.now();
    recentPositive = true;
    const { state, bubble, eventType, salience, steps } = applyAction(pet, key);
    pet = state;
    playSteps(steps);
    // Pulse the affected gauge so the user sees the action register, even
    // if the stat was already at its cap.
    const statKey = ACTION_TO_STAT[key];
    if (statKey) {
      // Quickly toggle off-then-on so a rapid second click of the same action
      // re-triggers the pulse animation instead of being swallowed.
      flashedStat = null;
      if (flashStatTimer) clearTimeout(flashStatTimer);
      queueMicrotask(() => { flashedStat = statKey; });
      flashStatTimer = setTimeout(() => { flashedStat = null; }, 700);
    }
    flashBubble(bubble, 2_500);
    await api.logEvent(eventType, undefined, salience).catch(() => undefined);
    scheduleSave();
  }

  async function onReport() {
    if (reporting) return;
    reporting = true;
    flashBubble(`${pet.name}: ✏️ scribbling a little note…`, 30_000);
    if (!api.hasBackend) {
      // Browser preview has no backend — give a friendly explanation rather
      // than a silent no-op.
      flashBubble(`${pet.name}: ✨ (notes only work in the desktop app)`, 4_000);
      reporting = false;
      return;
    }
    try {
      const report = await api.generateInteractionReport();
      const tail = report.usedLlm ? "" : " (saved!)";
      flashBubble(`${pet.name}: ${report.text}${tail}`, 8_000);
      // Surface the file path in the dev console so power users can find it
      // without us cluttering the bubble UI.
      console.info("[mochi] report saved →", report.savedPath);
      pet = { ...pet, currentAnimation: "celebrate" };
    } catch (err) {
      console.warn("generateInteractionReport failed", err);
      flashBubble(`${pet.name}: ✨ couldn't write right now`, 3_000);
    } finally {
      reporting = false;
    }
  }

  function onPointerMove(e: PointerEvent) {
    cursor = { x: e.clientX, y: e.clientY };
  }

  function onResize() {
    viewportSize = {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    dragStart = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    dragged = false;
    (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  }

  function onPetPointerMove(e: PointerEvent) {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (!dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragged = true;
      if (api.hasBackend) {
        // OS takes over the pointer once dragging starts; release our capture
        // so the click that browsers normally synthesize on pointerup won't
        // count as an intentional pet click.
        (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(
          dragStart.pointerId,
        );
        getCurrentWindow().startDragging().catch(() => undefined);
      }
      dragStart = null;
    }
  }

  function onPetPointerUp(e: PointerEvent) {
    (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
    dragStart = null;
    // Reset on cancel/up too — a cancelled drag (e.g., touch interrupted by a
    // system gesture) would otherwise leave dragged=true and silently swallow
    // the next legitimate pet click.
    dragged = false;
  }

  async function onPetClick() {
    if (dragged) {
      dragged = false;
      return;
    }
    await handlePetClick();
  }

  // Place the bubble so it never falls behind the status pill or the actions
  // panel. Default: above the pet. Flip below if above would clip the
  // viewport top OR overlap the status strip. If "below" would overlap the
  // actions panel, fall back to above and accept a touch of clipping rather
  // than hide the dialogue entirely.
  let bubblePlacement = $derived.by(() => {
    const centerX = position.x + petSize / 2;

    // Vertical bounds the bubble must respect.
    const status = statusBox();
    const actions = actionsBox();
    const topClear   = Math.max(BUBBLE_MARGIN, status.bottom + BUBBLE_GAP);
    const bottomClear = Math.min(viewportSize.height - BUBBLE_MARGIN, actions.top - BUBBLE_GAP);

    const aboveTop = position.y - BUBBLE_H - BUBBLE_GAP;
    const belowTop = position.y + petSize + BUBBLE_GAP;

    const aboveFits = aboveTop >= topClear;
    const belowFits = belowTop + BUBBLE_H <= bottomClear;

    let placeBelow: boolean;
    let top: number;
    if (aboveFits) {
      placeBelow = false;
      top = aboveTop;
    } else if (belowFits) {
      placeBelow = true;
      top = belowTop;
    } else {
      // Neither side fully clears; pick the side with the most room.
      const aboveRoom = position.y - topClear;
      const belowRoom = bottomClear - (position.y + petSize);
      placeBelow = belowRoom > aboveRoom;
      top = placeBelow
        ? Math.max(belowTop, bottomClear - BUBBLE_H)
        : Math.min(aboveTop, topClear);
    }

    let left = centerX - BUBBLE_W / 2;
    left = Math.max(
      BUBBLE_MARGIN,
      Math.min(viewportSize.width - BUBBLE_W - BUBBLE_MARGIN, left),
    );
    const tailX = Math.max(TAIL_INSET, Math.min(BUBBLE_W - TAIL_INSET, centerX - left));
    return { left, top, side: (placeBelow ? "below" : "above") as "above" | "below", tailX };
  });

  // Action panel sits bottom-right; estimate generously so the hit-test slop
  // forgives margin/padding/font drift without mis-classifying the cursor.
  // Width grew to accommodate the 5th (Report) button + divider.
  function actionsBox(): { left: number; top: number; right: number; bottom: number } {
    const w = 340;
    const h = 76;
    return {
      left: viewportSize.width - w - 8,
      top: viewportSize.height - h - 8,
      right: viewportSize.width - 8,
      bottom: viewportSize.height - 8,
    };
  }

  // Status anchor sits top-left. When OPEN it is a horizontal pill that may
  // run nearly the full window width on a 360-wide overlay; we treat it as a
  // full-width top strip so the pet just needs to settle below it. When
  // CLOSED it shrinks to a small floating chip.
  function statusBox(): { left: number; top: number; right: number; bottom: number } {
    if (statusOpen) {
      // Full-width strip. Pill may wrap to two rows on narrow windows so the
      // box is generous on height — pet stays comfortably below.
      return {
        left: 0,
        top: 0,
        right: viewportSize.width,
        bottom: 80,
      };
    }
    // Closed chip — just the small top-left blob.
    return { left: 8, top: 8, right: 8 + 100, bottom: 8 + 32 };
  }

  /** Obstacles the pet should avoid wandering into. */
  function currentObstacles(): Obstacle[] {
    const obs: Obstacle[] = [actionsBox()];
    if (statusOpen) obs.push(statusBox());
    return obs;
  }

  function toggleStatus() {
    statusOpen = !statusOpen;
    // If the new panel size now overlaps the pet, gently relocate it to a
    // safe spot. Without this, opening status while Mochi is in the corner
    // would visually swallow her until the next walk tick.
    const obs = currentObstacles();
    const overlaps = obs.some(
      (o) =>
        position.x < o.right &&
        position.x + petSize > o.left &&
        position.y < o.bottom &&
        position.y + petSize > o.top,
    );
    if (overlaps) {
      position = findSafeStartPosition(
        { width: viewportSize.width, height: viewportSize.height, petSize },
        obs,
      );
    }
  }

  function isInsideRect(
    x: number,
    y: number,
    r: { left: number; top: number; right: number; bottom: number },
  ): boolean {
    return (
      x >= r.left - HIT_PAD &&
      x <= r.right + HIT_PAD &&
      y >= r.top - HIT_PAD &&
      y <= r.bottom + HIT_PAD
    );
  }

  function isInsideInteractive(x: number, y: number): boolean {
    if (
      x >= position.x - HIT_PAD &&
      x <= position.x + petSize + HIT_PAD &&
      y >= position.y - HIT_PAD &&
      y <= position.y + petSize + HIT_PAD
    ) return true;
    if (isInsideRect(x, y, actionsBox())) return true;
    if (isInsideRect(x, y, statusBox())) return true;
    if (bubbleOpen) {
      // Bubble is positioned absolutely at bubblePlacement.{left,top}; size is
      // BUBBLE_W x BUBBLE_H. Hit-test that rect with HIT_PAD slop.
      const bx = bubblePlacement.left;
      const by = bubblePlacement.top;
      if (
        x >= bx - HIT_PAD &&
        x <= bx + BUBBLE_W + HIT_PAD &&
        y >= by - HIT_PAD &&
        y <= by + BUBBLE_H + HIT_PAD
      ) return true;
    }
    return false;
  }

  async function applyClickThrough(want: boolean) {
    if (!api.hasBackend || want === clickThroughOn) return;
    clickThroughOn = want;
    try {
      await getCurrentWindow().setIgnoreCursorEvents(want);
    } catch {
      clickThroughOn = !want;
    }
  }

  async function hitTestTick() {
    if (!api.hasBackend || destroyed) return;
    try {
      const cp = await cursorPosition();
      const w = getCurrentWindow();
      const wp = await w.outerPosition();
      const sf = cachedScaleFactor;
      const lx = (cp.x - wp.x) / sf;
      const ly = (cp.y - wp.y) / sf;
      // Keep cursor state alive for facing direction even while click-through.
      if (
        lx >= 0 && ly >= 0 &&
        lx <= viewportSize.width && ly <= viewportSize.height
      ) {
        cursor = { x: lx, y: ly };
      }
      void applyClickThrough(!isInsideInteractive(lx, ly));
    } catch {
      // Tauri call failed (window closed, etc.); leave state untouched.
    }
  }

  onMount(async () => {
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove);

    await syncFromBackend();

    // Place Mochi in a sensible visible spot once the viewport is known.
    // Default (0,0) would put her in the corner under the status chip.
    if (!positionInitialised) {
      position = findSafeStartPosition(
        { width: viewportSize.width, height: viewportSize.height, petSize },
        currentObstacles(),
      );
      positionInitialised = true;
    }

    lastTickAt = Date.now();
    tickTimer = setInterval(tick, TICK_MS);

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (!prefersReducedMotion) {
      blinkTimer = setInterval(() => {
        blink = true;
        if (blinkInnerTimer) clearTimeout(blinkInnerTimer);
        blinkInnerTimer = setTimeout(() => (blink = false), 140);
      }, 4_500 + Math.random() * 2_000);
    }

    if (api.hasBackend) {
      // Click-through hit-test: keep the overlay window cursor-transparent
      // unless the cursor is over the pet, the dock, or the speech bubble.
      // Polling is required because setIgnoreCursorEvents(true) suppresses
      // DOM pointer events, so we cannot rely on pointermove to come back.
      try {
        cachedScaleFactor = await getCurrentWindow().scaleFactor();
      } catch {
        cachedScaleFactor = 1;
      }
      void applyClickThrough(true);
      // Run once immediately so the cursor is correctly classified before the
      // first 80ms tick — avoids a startup blind spot if the overlay mounts
      // under the cursor.
      void hitTestTick();
      hitTestTimer = setInterval(hitTestTick, HIT_TEST_MS);
    }

    // Subscribe to the in-process bus so high-salience autonomous events
    // actually trigger a response (otherwise the salience gate is dead code).
    unsubscribeBus = eventBus.subscribe((event) => {
      if (!api.hasBackend) return;
      if (event.type === "USER_RETURNED" && event.awayMinutes >= 30) {
        void maybeAutonomousSpeak("returned", event.awayMinutes);
      }
    });

    if (api.hasBackend) {
      try {
        unlistenInbox = await listen<{ name: string }>(
          "inbox:file-found",
          (payload) => {
            flashBubble(`📨 found ${payload.name} — open Settings to approve`, 6_000);
            api
              .logEvent("FILE_FOUND_IN_INBOX", payload.name, 55)
              .catch(() => undefined);
          },
        );
      } catch (err) {
        console.warn("listen inbox failed", err);
      }
    }

    flashBubble("I'm awake. I'll stay out of the way.", 5_000);
  });

  onDestroy(() => {
    destroyed = true;
    if (tickTimer) clearInterval(tickTimer);
    if (blinkTimer) clearInterval(blinkTimer);
    if (blinkInnerTimer) clearTimeout(blinkInnerTimer);
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (saveTimer) clearTimeout(saveTimer);
    if (busyTimer) clearTimeout(busyTimer);
    if (flashStatTimer) clearTimeout(flashStatTimer);
    if (hitTestTimer) clearInterval(hitTestTimer);
    clearActionTimers();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onPointerMove);
    if (unlistenInbox) unlistenInbox();
    if (unsubscribeBus) unsubscribeBus();
    // Restore non-click-through state so a future window reuse isn't stuck.
    if (api.hasBackend) {
      getCurrentWindow().setIgnoreCursorEvents(false).catch(() => undefined);
    }
  });
</script>

<div class="pet-stage">
  <button
    class="pet-anchor"
    style="left: {position.x}px; top: {position.y}px; width: {petSize}px; height: {petSize}px;"
    onpointerdown={onPointerDown}
    onpointermove={onPetPointerMove}
    onpointerup={onPetPointerUp}
    onpointercancel={onPetPointerUp}
    onclick={onPetClick}
    aria-label="Mochi"
  >
    <MochiSprite
      mood={pet.mood}
      animation={pet.currentAnimation}
      size={petSize}
      facing={facing}
      blink={blink}
    />
  </button>

  {#if bubbleOpen && bubbleText}
    <div
      class="bubble-anchor"
      style="left: {bubblePlacement.left}px; top: {bubblePlacement.top}px; --tail-x: {bubblePlacement.tailX}px;"
      data-side={bubblePlacement.side}
    >
      <ChatBubble text={bubbleText} mood={pet.mood} side={bubblePlacement.side} />
    </div>
  {/if}

  <div class="status-anchor">
    <PetStatus {pet} {saving} open={statusOpen} onToggle={toggleStatus} {flashedStat} />
  </div>

  <div class="actions-anchor">
    <PetActions onAction={onAction} onReport={onReport} busy={busyAction} reporting={reporting} />
  </div>
</div>

<style>
  .pet-stage {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .pet-anchor {
    position: absolute;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: grab;
    pointer-events: auto;
  }
  .pet-anchor:active {
    cursor: grabbing;
  }
  .bubble-anchor {
    position: absolute;
    width: 220px;
    pointer-events: auto;
  }
  .status-anchor {
    position: absolute;
    left: 8px;
    top: 8px;
    pointer-events: auto;
  }
  .actions-anchor {
    position: absolute;
    right: 8px;
    bottom: 8px;
    pointer-events: auto;
  }
</style>
