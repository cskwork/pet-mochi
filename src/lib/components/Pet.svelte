<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import MochiSprite from "./MochiSprite.svelte";
  import ChatBubble from "./ChatBubble.svelte";
  import InboxConsent from "./InboxConsent.svelte";
  import PetActions from "./PetActions.svelte";
  import PetStatus from "./PetStatus.svelte";
  import {
    computeAwayMinutes,
    deriveTimeOfDay,
    nextWanderPosition,
    findSafeStartPosition,
    newPetState,
    runTick,
    applyAction,
    nextNudge,
    rememberNudge,
    newNudgeState,
    roundStats,
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
  import { tryEnterAutonomous, type LastAutonomous } from "./autonomousGate";
  import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";

  type Props = { petSize?: number };
  let { petSize = 140 }: Props = $props();

  let pet = $state<PetState>(newPetState());
  let position = $state({ x: 0, y: 0 });
  let cursor = $state({ x: 0, y: 0 });
  let bubbleText = $state<string | null>(null);
  let bubbleOpen = $state(false);
  // Pending inbox files awaiting user consent. Index 0 is the active prompt;
  // newer files queue behind it. Deduped on push so a file emitted twice
  // (initial scan + watcher event) shows up only once.
  let inboxQueue = $state<string[]>([]);
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
  // Counts consecutive save failures. Only the FIRST failure shows a bubble —
  // a persistent backend problem shouldn't replay the same warning every 4s
  // and steal the bubble channel from real pet messages. Reset on success.
  let saveFailureStreak = 0;
  let viewportSize = $state({ width: 360, height: 360 });

  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let blinkTimer: ReturnType<typeof setInterval> | undefined;
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let blinkInnerTimer: ReturnType<typeof setTimeout> | undefined;
  let hitTestTimer: ReturnType<typeof setInterval> | undefined;
  let unlistenInbox: (() => void) | null = null;
  let unsubscribeBus: (() => void) | null = null;
  let lastAutonomousFor: LastAutonomous = null;
  // Blocks a second invocation while one is mid-flight, in addition to the
  // (kind, ts) cooldown window. See autonomousGate.ts for rationale.
  let autonomousInFlight = false;
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
      const now = Date.now();
      const minsAway = computeAwayMinutes(remote.lastInteractionAt, now);
      if (minsAway !== null) {
        lastInteractionAt = now - minsAway * 60_000;
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
      // Round integer stats: the sim accumulates fractional decay each tick
      // for smooth aggregation, but the backend's PetState models them as
      // i32 and serde rejects fractional inputs.
      const snapshot = roundStats(pet);
      saving = true;
      try {
        await api.savePetState(snapshot);
        saveFailureStreak = 0;
      } catch (err) {
        console.warn("savePetState failed", err);
        saveFailureStreak += 1;
        // Show the actual reason on the FIRST failure (so the user can act on
        // it), but stay silent on every subsequent failure in the same streak —
        // a backend that has been down for minutes will keep failing every 4s
        // and the repeated bubble buries real pet messages.
        if (!destroyed && saveFailureStreak === 1) {
          const msg = (err as Error)?.message ?? String(err);
          const short = msg.length > 60 ? msg.slice(0, 60) + "…" : msg;
          flashBubble(`(save failed: ${short})`, 4_000);
        }
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

  /** Add a file to the consent queue, ignoring duplicates so the watcher's
   *  initial scan + a later modify event don't double-prompt. */
  function enqueueInboxFile(name: string) {
    if (!name) return;
    if (inboxQueue.includes(name)) return;
    inboxQueue = [...inboxQueue, name];
  }

  function dropFromInboxQueue(name: string) {
    const idx = inboxQueue.indexOf(name);
    if (idx === -1) return;
    inboxQueue = [...inboxQueue.slice(0, idx), ...inboxQueue.slice(idx + 1)];
  }

  async function onInboxApprove(name: string): Promise<void> {
    // The component owns the in-flight flag; we just call the API and let
    // errors propagate so the consent prompt can surface them.
    const summary = await api.approveFile(name);
    dropFromInboxQueue(name);
    flashBubble(`${pet.name}: ${summary}`, 6_000);
  }

  function onInboxSkip(): void {
    // No backend reject — just dismiss locally. The file stays on disk and
    // unapproved, which is the safe default per REQ-084.
    if (inboxQueue.length === 0) return;
    inboxQueue = inboxQueue.slice(1);
  }

  async function maybeAutonomousSpeak(kind: string, awayMinutes: number) {
    // Local cooldown so a single dispatched event doesn't hammer the backend
    // every tick. The backend has its own LLM cooldown as a backstop.
    // The `autonomousInFlight` guard additionally blocks any concurrent
    // re-entry while the previous request is still pending.
    const decision = tryEnterAutonomous({
      inFlight: autonomousInFlight,
      last: lastAutonomousFor,
      kind,
      now: Date.now(),
      cooldownMs: AUTONOMOUS_LOCAL_COOLDOWN_MS,
    });
    if (!decision.proceed) return;
    // Consume the cooldown *before* awaiting so a failed call still throttles
    // the next attempt — otherwise every event in the window would retry.
    lastAutonomousFor = decision.nextLast;
    autonomousInFlight = true;
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
    } finally {
      autonomousInFlight = false;
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

  // Right-click context menu: the overlay window is frameless, so users have
  // no native way to close the app otherwise. Position the menu at the cursor
  // and clamp into the viewport so it never spills off-screen.
  let menuOpen = $state(false);
  let menuPos = $state({ x: 0, y: 0 });
  const MENU_W = 140;
  const MENU_H = 40;

  function openContextMenu(e: MouseEvent) {
    e.preventDefault();
    const x = Math.min(viewportSize.width - MENU_W - 4, Math.max(4, e.clientX));
    const y = Math.min(viewportSize.height - MENU_H - 4, Math.max(4, e.clientY));
    menuPos = { x, y };
    menuOpen = true;
  }

  function closeContextMenu() {
    menuOpen = false;
  }

  async function quitApp() {
    closeContextMenu();
    if (!api.hasBackend) return;
    try {
      await api.quitApp();
    } catch (err) {
      console.warn("quit_app failed", err);
      flashBubble("(couldn't quit)", 3_000);
    }
  }

  function onMenuKey(e: KeyboardEvent) {
    if (e.key === "Escape") closeContextMenu();
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

  // Consent prompt placement. Try below the pet first; flip above if there's
  // no room (e.g., the pet is near the bottom of the viewport). Avoids the
  // status strip and actions panel obstacles, then clamps to the viewport.
  const CONSENT_W = 250;
  const CONSENT_H = 140;
  const CONSENT_GAP = 10;
  const CONSENT_MARGIN = 8;
  let consentPlacement = $derived.by(() => {
    const status = statusBox();
    const actions = actionsBox();
    const topClear = Math.max(CONSENT_MARGIN, status.bottom + CONSENT_GAP);
    const bottomClear = Math.min(
      viewportSize.height - CONSENT_MARGIN,
      actions.top - CONSENT_GAP,
    );
    const belowTop = position.y + petSize + CONSENT_GAP;
    const aboveTop = position.y - CONSENT_H - CONSENT_GAP;
    let top: number;
    if (belowTop + CONSENT_H <= bottomClear) top = belowTop;
    else if (aboveTop >= topClear) top = aboveTop;
    else top = Math.max(topClear, bottomClear - CONSENT_H);
    let left = position.x + petSize / 2 - CONSENT_W / 2;
    left = Math.max(
      CONSENT_MARGIN,
      Math.min(viewportSize.width - CONSENT_W - CONSENT_MARGIN, left),
    );
    return { left, top };
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
    // While the context menu is open it covers the entire stage with a
    // dismiss scrim — every cursor position is interactive (clicking
    // anywhere closes the menu, clicking the menu item triggers it).
    if (menuOpen) return true;
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
    if (inboxQueue.length > 0) {
      // Consent dialog is interactive — buttons must receive clicks even when
      // the rest of the overlay is click-through.
      const cx = consentPlacement.left;
      const cy = consentPlacement.top;
      if (
        x >= cx - HIT_PAD &&
        x <= cx + CONSENT_W + HIT_PAD &&
        y >= cy - HIT_PAD &&
        y <= cy + CONSENT_H + HIT_PAD
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
            enqueueInboxFile(payload.name);
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
    oncontextmenu={openContextMenu}
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

  {#if inboxQueue.length > 0}
    {#key inboxQueue[0]}
      <div
        class="consent-anchor"
        style="left: {consentPlacement.left}px; top: {consentPlacement.top}px; width: {CONSENT_W}px;"
      >
        <InboxConsent
          fileName={inboxQueue[0]}
          onApprove={onInboxApprove}
          onSkip={onInboxSkip}
          remaining={inboxQueue.length - 1}
        />
      </div>
    {/key}
  {/if}

  <div class="status-anchor">
    <PetStatus {pet} {saving} open={statusOpen} onToggle={toggleStatus} {flashedStat} />
  </div>

  <div class="actions-anchor">
    <PetActions onAction={onAction} onReport={onReport} busy={busyAction} reporting={reporting} />
  </div>

  {#if menuOpen}
    <button
      type="button"
      class="menu-scrim"
      aria-label="Close menu"
      onclick={closeContextMenu}
      oncontextmenu={(e) => { e.preventDefault(); closeContextMenu(); }}
    ></button>
    <div
      class="context-menu"
      role="menu"
      style="left: {menuPos.x}px; top: {menuPos.y}px; width: {MENU_W}px;"
      tabindex="-1"
      onkeydown={onMenuKey}
    >
      <button type="button" role="menuitem" class="menu-item" onclick={quitApp}>
        Close Mochi
      </button>
    </div>
  {/if}
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
  .consent-anchor {
    position: absolute;
    pointer-events: auto;
    z-index: 5;
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
  .menu-scrim {
    position: absolute;
    inset: 0;
    background: transparent;
    border: 0;
    padding: 0;
    pointer-events: auto;
    cursor: default;
    z-index: 9;
  }
  .context-menu {
    position: absolute;
    background: rgba(255, 255, 255, 0.98);
    border-radius: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    padding: 4px;
    pointer-events: auto;
    z-index: 10;
  }
  .menu-item {
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--mochi-text, #3a2b34);
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .menu-item:hover,
  .menu-item:focus {
    background: rgba(255, 218, 232, 0.95);
    outline: none;
  }
</style>
