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
    shouldCallLLM,
    shouldFireStatusReport,
    STATUS_REPORT_GATE_CONSTANTS,
    pickFallbackPreset,
    stepsForPick,
    validateChoreographyPayload,
    nextQuirk,
    applySnackFeed,
    isFavoriteDiscoveredInMemories,
    SNACK_KEYS,
    SNACKS,
    greetingForReturn,
    ritualForTransition,
    landingSteps,
    resolveStageTheme,
    GRAB_ANIMATION,
    LANDING_STABLE_SAMPLES,
    type ActionKey,
    type AnimationStep,
    type ChoreographyPick,
    type Mood,
    type NudgeState,
    type Obstacle,
    type ParticleKind,
    type Period,
    type PetEvent,
    type PetState,
    type RuntimeContext,
    type SnackKey,
  } from "../sim";
  import { api } from "../bridge/api";
  import { listen } from "../bridge/tauri";
  import { disposeSfx, playSfx, setSfxEnabled } from "../audio/sfx";
  import { eventBus } from "../events/bus";
  import { tryEnterAutonomous, type LastAutonomous } from "./autonomousGate";
  import { createSnackTray, SNACK_TRAY_H, SNACK_TRAY_W } from "./snackTray.svelte";
  import { createGifts } from "./gifts.svelte";
  import { createParticles } from "./particles.svelte";
  import { createRoam } from "./roam.svelte";
  import { createNotify } from "./notify.svelte";
  import { Window, cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";

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

  // ===== v0.2 The Adorable Update (PRD §27) =====
  // REQ-104 squash & stretch juice — one-shot classes on the pet anchor.
  let pressed = $state(false);
  let boing = $state(false);
  let landingPulse = $state(false);
  let boingTimer: ReturnType<typeof setTimeout> | undefined;
  let landingTimer: ReturnType<typeof setTimeout> | undefined;
  // REQ-105 particle bursts — live-particle store lives in
  // particles.svelte.ts (REQ-124.2).
  const particles = createParticles();
  let reducedMotion = false;
  let reducedMotionCleanup: (() => void) | null = null;
  // REQ-106 idle micro-quirks.
  let lastQuirkAt: number | null = null;
  // REQ-107 snack tray + favorite discovery — state machine lives in
  // snackTray.svelte.ts (REQ-124.2).
  const snack = createSnackTray();
  // REQ-109 keepsakes / REQ-110 hatch-day — runtime flags live in
  // gifts.svelte.ts (REQ-124.2). Celebrations drive Pet-owned channels.
  const gifts = createGifts({ playSteps, spawnBurst, flashBubble });
  // REQ-111 time-of-day rituals.
  let lastPeriod: Period | null = null;
  // REQ-102 idle-triggered status report. `idleSince === 0` means "not idle".
  let idleSince = 0;
  let reportGateInFlight = false;
  let lastReportAttemptAt = 0;
  // REQ-112 drag dangle & landing — window movement sampled by hitTestTick.
  let osDragging = false;
  let osDragStartedAt = 0;
  let dragStartWinPos: { x: number; y: number } | null = null;
  let lastWinPos: { x: number; y: number } | null = null;
  let stableWinSamples = 0;
  // REQ-120/121 — screen-edge walking + monitor-crossing state lives in
  // roam.svelte.ts (REQ-124.2). It drives the shared scale-factor cache and
  // reports landings back here.
  const roam = createRoam({
    onScaleFactor: (sf) => {
      cachedScaleFactor = sf;
    },
    onCrossingLanded: (petPos) => {
      position = petPos;
      // A short beat from the existing walk pose so the re-entry reads as
      // continuing motion (no new sprites).
      playSteps([{ animation: "walk", durationMs: 600 }]);
    },
  });
  // REQ-113 animation intensity (0–1.5), live-updated via settings:changed.
  let animationIntensity = 1;
  // REQ-122 — opt-in critical-need desktop notifications: gate runtime lives
  // in notify.svelte.ts (REQ-124.2).
  const notify = createNotify();
  let unlistenSettingsFocus: (() => void) | null = null;
  let unlistenSettingsBlur: (() => void) | null = null;
  let unlistenSettings: (() => void) | null = null;

  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let hitTestTimer: ReturnType<typeof setInterval> | undefined;
  let unlistenInbox: (() => void) | null = null;
  let unsubscribeBus: (() => void) | null = null;
  let lastAutonomousFor: LastAutonomous = null;
  // Tracks the most recent choreography pick for re-entry suppression. Shares
  // the same `autonomousInFlight` flag as chat — REQ-097 says both compete
  // for the same 90s LLM cooldown, so concurrent re-entry must be blocked
  // across both paths.
  let lastChoreography: LastAutonomous = null;
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
  // Local cooldown for choreography. Shorter than chat because the action
  // is silent/lightweight; the backend still enforces the canonical 90s
  // shared LLM cooldown (REQ-097).
  const CHOREO_LOCAL_COOLDOWN_MS = 30_000;
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
  // v0.2 (PRD §27) constants.
  const REPORT_RETRY_BACKOFF_MS = 10 * 60_000;
  // SNACK_TRAY_* constants moved to snackTray.svelte.ts (REQ-124.2).
  // Ignore "window stopped moving" verdicts in the first moments of a drag —
  // the position is briefly stable before the OS loop starts reporting moves.
  const DRAG_MIN_SETTLE_MS = 400;

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

  /**
   * REQ-120/121 — one roam attempt for this tick, delegating the cache +
   * window-shift machinery to the roam composable. Returns true when the
   * window was shifted or a crossing was planned (pet position applied);
   * false means the caller falls back to the classic in-window wander
   * (interior step, no cache yet, or a work-area clamp — which is exactly
   * the pre-REQ-120 behavior).
   */
  function tryRoamStep(now: number, mood: Mood): boolean {
    // Never fight the user's OS drag: a walk/run derived mid-drag must not
    // setPosition the window while the user is holding it (QA M2).
    if (osDragging) return false;
    const result = roam.tryStep({
      now,
      mood,
      petPos: position,
      viewport: viewportSize,
      petSize,
    });
    if (result === null) return false;
    if (result.type === "crossing") {
      // Entering from the target's right edge → she walks in heading left.
      facing = result.entryEdge === "right" ? "left" : "right";
      return true;
    }
    facing = result.step.x < 0 ? "left" : result.step.x > 0 ? "right" : facing;
    position = result.petPos;
    return true;
  }

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
      // REQ-120 — at a viewport edge the window follows the pet's un-clamped
      // step so she appears to walk across the desktop; when the work area or
      // a missing cache blocks that, the classic in-window wander runs
      // unchanged.
      if (!tryRoamStep(now, next.mood)) {
        const newPos = nextWanderPosition(
          position,
          { width: viewportSize.width, height: viewportSize.height, petSize },
          currentObstacles(),
        );
        facing = newPos.x < position.x ? "left" : newPos.x > position.x ? "right" : facing;
        position = newPos;
      }
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

    // REQ-111 — time-of-day transition: dispatch the event and play the
    // deterministic ritual when the pet is unhurried. Runs before the quirk
    // check so a rare period change outranks an ordinary fidget.
    const period = ctx.timeOfDay;
    if (lastPeriod !== null && period !== lastPeriod) {
      const ritual = ritualForTransition(lastPeriod, period, pet.currentAnimation);
      eventBus.dispatch({ type: "TIME_OF_DAY_CHANGED", period }, pet);
      // REQ-118 — in "auto" mode the stage theme follows the new period; this
      // transition branch already runs on every period change, so no new
      // listener is needed for the live swap.
      if (currentStageBackground === "auto") applyStageBackground("auto", period);
      if (ritual && now >= actionPlayingUntil) {
        playSteps(ritual.steps);
        if (ritual.bubble) flashBubble(`${pet.name}: ${ritual.bubble}`, 3_000);
      }
    }
    lastPeriod = period;

    // REQ-106 — idle micro-quirk. Skipped on nudge ticks so the nudge's own
    // animation cue isn't immediately overwritten, and skipped entirely while
    // a status report is due — quirks fire about once a minute, which would
    // otherwise keep resetting the 60s idle window REQ-070 needs.
    if (!nudge && !statusReportDue(now) && now >= actionPlayingUntil) {
      const quirk = nextQuirk(pet, lastQuirkAt, now, Math.random, animationIntensity);
      if (quirk) {
        lastQuirkAt = now;
        playSteps(quirk.steps);
      }
    }

    // REQ-110 — a day rollover mid-session re-checks the hatch-day and
    // re-arms the once-per-session monthly hearts.
    gifts.onDayRollover(now, pet);

    // REQ-109 — keepsake gate, evaluated at most every 10 minutes.
    if (gifts.keepsakeDue(pet, now, () => actionPlayingUntil)) {
      void gifts.leaveKeepsake(pet, now, () => actionPlayingUntil);
    }

    // REQ-102 — idle-window tracking + autonomous §9.8 status report. The
    // dwell set is the gate's own IDLE_STATES so the two can never drift.
    const idleNow =
      STATUS_REPORT_GATE_CONSTANTS.IDLE_STATES.has(pet.currentAnimation) &&
      now >= actionPlayingUntil;
    if (idleNow) {
      if (idleSince === 0) idleSince = now;
    } else {
      idleSince = 0;
    }
    if (
      api.hasBackend &&
      idleSince !== 0 &&
      !reportGateInFlight &&
      now - lastReportAttemptAt >= REPORT_RETRY_BACKOFF_MS &&
      shouldFireStatusReport({
        now,
        lastReportAt: pet.lastReportAt,
        createdAt: pet.createdAt,
        currentAnimation: pet.currentAnimation,
        idleSince,
        inFlight: now < actionPlayingUntil,
      })
    ) {
      reportGateInFlight = true;
      lastReportAttemptAt = now;
      void api
        .runStatusReport()
        .then((report) => {
          // Mirror the backend's new watermark so the next debounced
          // save_pet_state can't roll it back (REQ-102). Silent by design
          // (REQ-073) — the report surfaces in Settings → Recent reports.
          pet = { ...pet, lastReportAt: report.windowEnd };
        })
        .catch(() => undefined)
        .finally(() => {
          reportGateInFlight = false;
        });
    }

    // REQ-122 — opt-in desktop notification when a need crosses critical.
    // Candidate + verdict come from the pure module; the bridge never throws.
    notify.evaluate(pet, now);

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

  function clampIntensity(n: number): number {
    return Number.isFinite(n) ? Math.max(0, Math.min(1.5, n)) : 1;
  }

  // REQ-114 — themed stage backgrounds the stylesheet defines. Anything else
  // (including "transparent") clears the attribute so the overlay stays
  // see-through. Mirrors STAGE_BACKGROUNDS in src-tauri/src/models.rs.
  const STAGE_BACKGROUND_THEMES = new Set(["cream", "blossom", "mint", "night"]);
  // REQ-118 — remembers the raw setting so a period transition can re-resolve
  // the "auto" theme without waiting for the next settings change.
  let currentStageBackground: string | undefined;

  function applyStageBackground(
    value: string | undefined,
    period: Period = deriveTimeOfDay(),
  ) {
    currentStageBackground = value;
    // REQ-118 — "auto" resolves to the theme for the current period; every
    // other value applies (or clears) exactly as before.
    const theme = value === "auto" ? resolveStageTheme(period) : value;
    if (typeof theme === "string" && STAGE_BACKGROUND_THEMES.has(theme)) {
      document.body.dataset.stageBackground = theme;
    } else {
      delete document.body.dataset.stageBackground;
    }
  }

  /** True once 12h have elapsed since the last report — the cadence half of
   *  the REQ-070 gate, checked cheaply so quirks can yield the idle window. */
  function statusReportDue(now: number): boolean {
    if (!api.hasBackend) return false;
    const baseline = pet.lastReportAt ?? pet.createdAt;
    const t = Date.parse(baseline);
    if (Number.isNaN(t)) return false;
    return now - t >= STATUS_REPORT_GATE_CONSTANTS.TWELVE_HOURS_MS;
  }

  /** REQ-104 — one-shot spring-back squash when an action lands on the pet. */
  function triggerBoing() {
    if (reducedMotion) return;
    boing = false;
    if (boingTimer) clearTimeout(boingTimer);
    queueMicrotask(() => {
      boing = true;
    });
    boingTimer = setTimeout(() => {
      boing = false;
      boingTimer = undefined;
    }, 340);
  }

  /** REQ-112 — one-shot landing squash after a window drag settles. */
  function triggerLandingPulse() {
    if (reducedMotion) return;
    landingPulse = false;
    if (landingTimer) clearTimeout(landingTimer);
    queueMicrotask(() => {
      landingPulse = true;
    });
    landingTimer = setTimeout(() => {
      landingPulse = false;
      landingTimer = undefined;
    }, 420);
  }

  /** REQ-105 — spawn a particle burst at the pet's current center. The
   *  position is passed at call time so the store never tracks it. */
  function spawnBurst(kind: ParticleKind) {
    particles.spawn(
      kind,
      { x: position.x + petSize / 2, y: position.y + petSize * 0.35 },
      { reducedMotion, intensity: animationIntensity },
    );
  }

  // ===== REQ-107 snack tray =====
  async function onSnackPick(key: SnackKey) {
    snack.close();
    flashBusy("feed");
    lastInteractionAt = Date.now();
    recentPositive = true;
    const result = applySnackFeed(pet, key, snack.isFavoriteDiscovered());
    pet = result.state;
    playSteps(result.steps);
    triggerBoing();
    spawnBurst(result.favoriteDiscovered ? "hearts_big" : "crumbs");
    playSfx(result.favoriteDiscovered ? "sparkle" : "nom");
    flashedStat = null;
    if (flashStatTimer) clearTimeout(flashStatTimer);
    queueMicrotask(() => {
      flashedStat = "hunger";
    });
    flashStatTimer = setTimeout(() => {
      flashedStat = null;
    }, 700);
    flashBubble(result.bubble, result.favoriteDiscovered ? 4_000 : 2_500);
    await api
      .logEvent(result.eventType, JSON.stringify({ snack: key }), result.salience)
      .catch(() => undefined);
    if (result.memory && api.hasBackend) {
      // Mark discovered regardless of persistence outcome so one session never
      // writes the memory twice; a failed write simply rediscovers next launch.
      snack.markFavoriteDiscovered();
      await api.createMemory(result.memory).catch(() => undefined);
    } else if (result.favoriteDiscovered) {
      snack.markFavoriteDiscovered();
    }
    scheduleSave();
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
    // REQ-101 — the choreography reaction plays for this event, but its
    // bubble is suppressed inside maybeChoreography so the summary below is
    // never replaced (the LLM path resolves seconds later).
    eventBus.dispatch({ type: "FILE_INSPECTION_APPROVED", path: name }, pet);
    flashBubble(`${pet.name}: ${summary}`, 6_000);
  }

  function onInboxSkip(): void {
    // No backend reject — just dismiss locally. The file stays on disk and
    // unapproved, which is the safe default per REQ-084.
    if (inboxQueue.length === 0) return;
    inboxQueue = inboxQueue.slice(1);
  }

  /**
   * §9.11 / REQ-094..099 — react to a salient event by playing a closed-catalog
   * choreography. With `useLlm`, tries the LLM first; on any failure (no
   * provider, cooldown, malformed JSON, network error) falls back to a
   * deterministic preset so the pet ALWAYS reacts visibly (REQ-098). Without
   * `useLlm` (REQ-101: the event didn't clear the salience gate but still
   * deserves a visible reaction), the deterministic preset plays directly —
   * no network, no shared-LLM-cooldown consumption. Bubble tokens are
   * restricted to the closed vocabulary (REQ-096) — no human sentences.
   */
  async function maybeChoreography(event: PetEvent, useLlm: boolean) {
    // Chat path owns USER_SENT_MESSAGE and USER_RETURNED — don't double-fire.
    if (event.type === "USER_SENT_MESSAGE") return;
    if (event.type === "USER_RETURNED") return;
    // REQ-111 — time-of-day is deterministic-ritual-only: an LLM pick here
    // would burn the shared 90s cooldown and stomp the ritual mid-play.
    if (event.type === "TIME_OF_DAY_CHANGED") return;

    const decision = tryEnterAutonomous({
      inFlight: autonomousInFlight,
      last: lastChoreography,
      kind: "choreo",
      now: Date.now(),
      cooldownMs: CHOREO_LOCAL_COOLDOWN_MS,
    });
    if (!decision.proceed) return;
    lastChoreography = decision.nextLast;

    let pick: ChoreographyPick;
    if (useLlm) {
      autonomousInFlight = true;
      try {
        const reply = await api.chooseChoreography(event.type);
        const validated = validateChoreographyPayload(reply);
        pick = validated ?? pickFallbackPreset(pet, event);
      } catch {
        // Network error, missing provider, cooldown rejection — fall back
        // deterministically. The pet must still react (REQ-098).
        pick = pickFallbackPreset(pet, event);
      } finally {
        autonomousInFlight = false;
      }
    } else {
      pick = pickFallbackPreset(pet, event);
    }

    const steps = stepsForPick(pick);
    playSteps(steps);
    // The approval flow shows the file summary in the bubble — the motion
    // plays, but a late LLM token must not replace that summary text.
    const suppressBubble = event.type === "FILE_INSPECTION_APPROVED";
    if (pick.bubble && !suppressBubble) {
      // Closed-vocabulary bubble (REQ-096). The same ChatBubble component
      // renders it as text — but the validator already proved this is one
      // of the allowed glyph/onomatopoeia tokens, so no free-text path is
      // ever exercised here.
      flashBubble(pick.bubble, 1_800);
    }
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

  // Which particle burst goes with each action (REQ-105). Feed is handled by
  // the snack tray (REQ-107) so it has no entry here.
  const ACTION_TO_BURST: Partial<Record<ActionKey, ParticleKind>> = {
    play: "confetti",
    pet: "hearts",
    rest: "sleep",
  };

  // Which chirp goes with each action (REQ-117). User-initiated only —
  // autonomous behaviors never make sound.
  const ACTION_TO_SFX = {
    pet: "boop",
    play: "bounce",
    rest: "settle",
  } as const;

  async function onAction(key: ActionKey) {
    if (busyAction === key) return;
    // REQ-107 — Feed opens the snack tray instead of feeding immediately;
    // pressing Feed again while it's open closes it.
    if (key === "feed") {
      if (snack.open) {
        snack.close();
      } else {
        snack.openTray();
      }
      return;
    }
    snack.close();
    flashBusy(key);
    lastInteractionAt = Date.now();
    recentPositive = true;
    const { state, bubble, eventType, salience, steps } = applyAction(pet, key);
    pet = state;
    playSteps(steps);
    triggerBoing();
    const burst = ACTION_TO_BURST[key];
    if (burst) spawnBurst(burst);
    const sound = key in ACTION_TO_SFX ? ACTION_TO_SFX[key as keyof typeof ACTION_TO_SFX] : null;
    if (sound) playSfx(sound);
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
    pressed = true; // REQ-104 press squish
    (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
  }

  function onPetPointerMove(e: PointerEvent) {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (!dragged && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      dragged = true;
      pressed = false;
      if (api.hasBackend) {
        // OS takes over the pointer once dragging starts; release our capture
        // so the click that browsers normally synthesize on pointerup won't
        // count as an intentional pet click.
        (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(
          dragStart.pointerId,
        );
        beginOsDrag();
        getCurrentWindow().startDragging().catch(() => undefined);
      }
      dragStart = null;
    }
  }

  /** REQ-112 — dangle pose + baseline for landing detection. The pinned grab
   *  pose auto-expires after 15s in case a platform never reports the drop. */
  function beginOsDrag() {
    osDragging = true;
    osDragStartedAt = Date.now();
    stableWinSamples = 0;
    dragStartWinPos = null;
    lastWinPos = null;
    // REQ-120 — the OS drag invalidates the cached window position; the next
    // walk tick re-reads it before any edge-walking shift.
    roam.invalidate();
    playSteps([{ animation: GRAB_ANIMATION, durationMs: 15_000 }]);
    getCurrentWindow()
      .outerPosition()
      .then((p) => {
        dragStartWinPos = { x: p.x, y: p.y };
        lastWinPos = { x: p.x, y: p.y };
      })
      .catch(() => undefined);
  }

  function finishDragLanding(winPos: { x: number; y: number }) {
    osDragging = false;
    const sf = cachedScaleFactor || 1;
    const distance = dragStartWinPos
      ? Math.hypot(winPos.x - dragStartWinPos.x, winPos.y - dragStartWinPos.y) / sf
      : 0;
    dragStartWinPos = null;
    playSteps(landingSteps(distance));
    triggerLandingPulse();
    // The drop may have landed on a different-DPI monitor; refresh the cached
    // scale factor in the background so hit-testing and the next landing use
    // the right density.
    getCurrentWindow()
      .scaleFactor()
      .then((fresh) => {
        cachedScaleFactor = fresh;
      })
      .catch(() => undefined);
  }

  function onPetPointerUp(e: PointerEvent) {
    (e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
    dragStart = null;
    pressed = false;
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
  // Two items now: Settings… + Close Mochi (REQ-115).
  const MENU_H = 76;

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

  /** REQ-115 — the frameless overlay's only path to the settings window. */
  async function openSettingsWindow() {
    closeContextMenu();
    if (!api.hasBackend) {
      flashBubble(`${pet.name}: ✨ (settings only work in the desktop app)`, 3_000);
      return;
    }
    try {
      await api.openSettings();
    } catch (err) {
      console.warn("open_settings failed", err);
      flashBubble("(couldn't open settings)", 3_000);
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

  // REQ-107 — snack tray floats just above the actions panel, right-aligned.
  function snackTrayBox(): { left: number; top: number; right: number; bottom: number } {
    const actions = actionsBox();
    return {
      left: viewportSize.width - SNACK_TRAY_W - 8,
      top: actions.top - SNACK_TRAY_H - 6,
      right: viewportSize.width - 8,
      bottom: actions.top - 6,
    };
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
    if (snack.open && isInsideRect(x, y, snackTrayBox())) return true;
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
      // REQ-112 — landing detection piggybacks on this existing poll: once the
      // window position holds still for LANDING_STABLE_SAMPLES consecutive
      // samples (after a short settle grace), the drag is considered dropped.
      if (osDragging) {
        const settled = Date.now() - osDragStartedAt >= DRAG_MIN_SETTLE_MS;
        if (lastWinPos && wp.x === lastWinPos.x && wp.y === lastWinPos.y) {
          stableWinSamples += 1;
          if (settled && stableWinSamples >= LANDING_STABLE_SAMPLES) {
            finishDragLanding({ x: wp.x, y: wp.y });
          }
        } else {
          stableWinSamples = 0;
        }
        lastWinPos = { x: wp.x, y: wp.y };
      }
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
    gifts.primeDayStamp(Date.now());
    tickTimer = setInterval(tick, TICK_MS);

    // Gates every decorative motion path (REQ-113) and follows OS toggles
    // live (timer-free change listener). The old blink interval was removed —
    // MochiSprite ignores the blink prop by design (eyes are baked into each
    // pose), so the timer was dead weight.
    const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion = reducedMotionQuery.matches;
    const onReducedMotionChange = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
    };
    reducedMotionQuery.addEventListener("change", onReducedMotionChange);
    reducedMotionCleanup = () =>
      reducedMotionQuery.removeEventListener("change", onReducedMotionChange);

    if (api.hasBackend) {
      // REQ-113/114/117 — load animation intensity, stage background, and the
      // sound toggle; follow live changes from the settings window.
      try {
        const settings = await api.getSettings();
        animationIntensity = clampIntensity(settings.animationIntensity);
        notify.setEnabled(settings.desktopNotifications);
        applyStageBackground(settings.stageBackground);
        setSfxEnabled(settings.soundEffects);
      } catch {
        // Defaults stay: intensity 1, transparent stage, sounds on.
      }
      try {
        unlistenSettings = await listen<{
          animationIntensity?: number;
          stageBackground?: string;
          soundEffects?: boolean;
          desktopNotifications?: boolean;
        }>("settings:changed", (payload) => {
          if (payload && typeof payload.animationIntensity === "number") {
            animationIntensity = clampIntensity(payload.animationIntensity);
          }
          if (payload && "stageBackground" in payload) {
            applyStageBackground(payload.stageBackground);
          }
          if (payload && typeof payload.soundEffects === "boolean") {
            setSfxEnabled(payload.soundEffects);
          }
          if (payload && typeof payload.desktopNotifications === "boolean") {
            notify.setEnabled(payload.desktopNotifications);
          }
        });
      } catch {
        // Live updates are a nicety; the mount-time read above still applied.
      }

      // REQ-122 — best-effort focus tracking on the settings window: while it
      // holds focus the user is already looking at Mochi, so the notification
      // gate suppresses. Two one-shot setup listeners; no timer involved.
      try {
        const settingsWin = await Window.getByLabel("settings");
        if (settingsWin) {
          unlistenSettingsFocus = await settingsWin.listen(
            "tauri://focus",
            () => {
              notify.setFocused(true);
            },
          );
          unlistenSettingsBlur = await settingsWin.listen("tauri://blur", () => {
            notify.setFocused(false);
          });
        }
      } catch {
        // Untracked focus simply means no extra suppression.
      }

      // REQ-107/109/110 — restore care-loop flags from durable memories so a
      // restart can't re-discover the favorite, duplicate a keepsake, or
      // repeat this year's hatch-day.
      try {
        const memories = await api.listMemories(200);
        snack.restoreFavorite(isFavoriteDiscoveredInMemories(memories));
        gifts.restore(memories);
      } catch (err) {
        console.warn("memory restore failed", err);
      }
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
    unsubscribeBus = eventBus.subscribe((event, state) => {
      // REQ-108 — the deterministic greeting ritual plays instantly, with or
      // without a backend/LLM; the mood-aware chat line follows if available.
      if (event.type === "USER_RETURNED" && event.awayMinutes >= 30) {
        const greeting = greetingForReturn(event.awayMinutes);
        if (greeting) {
          playSteps(greeting.steps);
          flashBubble(`${pet.name}: ${greeting.bubble}`, 4_000);
          if (greeting.burst) spawnBurst(greeting.burst);
          // The user just came back — a welcome counts as user-initiated.
          playSfx("chime");
        }
        if (api.hasBackend) {
          void maybeAutonomousSpeak("returned", event.awayMinutes);
        }
        return;
      }
      if (!api.hasBackend) return;
      // §9.11 behavior choreography for other high-salience events.
      // shouldCallLLM also consumes the shared 90s autonomous LLM cooldown,
      // so chat and choreography compete for the same LLM budget (REQ-097).
      if (shouldCallLLM(event, state)) {
        void maybeChoreography(event, true);
        return;
      }
      // REQ-101 — inbox moments always earn a visible deterministic reaction,
      // even when they don't clear the LLM salience gate.
      if (
        event.type === "FILE_FOUND_IN_INBOX" ||
        event.type === "FILE_INSPECTION_APPROVED"
      ) {
        void maybeChoreography(event, false);
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
            // REQ-101 — route the moment through the bus so Mochi visibly
            // notices the letter (curious peek) instead of only logging it.
            eventBus.dispatch(
              { type: "FILE_FOUND_IN_INBOX", path: payload.name },
              pet,
            );
          },
        );
      } catch (err) {
        console.warn("listen inbox failed", err);
      }
    }

    // REQ-101 — boot is a real event now: a wake-up beat plus APP_STARTED on
    // the bus. REQ-110 — check the hatch-day once the memory flags are in.
    playSteps([
      { animation: "stretch", durationMs: 600 },
      { animation: "wiggle", durationMs: 450 },
    ]);
    eventBus.dispatch({ type: "APP_STARTED" }, pet);
    gifts.maybeCelebrateHatchday(pet, Date.now());
    flashBubble("I'm awake. I'll stay out of the way.", 5_000);
  });

  onDestroy(() => {
    destroyed = true;
    if (tickTimer) clearInterval(tickTimer);
    if (bubbleTimer) clearTimeout(bubbleTimer);
    if (saveTimer) clearTimeout(saveTimer);
    if (busyTimer) clearTimeout(busyTimer);
    if (flashStatTimer) clearTimeout(flashStatTimer);
    if (hitTestTimer) clearInterval(hitTestTimer);
    if (boingTimer) clearTimeout(boingTimer);
    if (landingTimer) clearTimeout(landingTimer);
    snack.dispose();
    clearActionTimers();
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onPointerMove);
    if (unlistenInbox) unlistenInbox();
    if (unlistenSettings) unlistenSettings();
    if (unlistenSettingsFocus) unlistenSettingsFocus();
    if (unlistenSettingsBlur) unlistenSettingsBlur();
    if (unsubscribeBus) unsubscribeBus();
    if (reducedMotionCleanup) reducedMotionCleanup();
    delete document.body.dataset.stageBackground;
    disposeSfx();
    // Restore non-click-through state so a future window reuse isn't stuck.
    if (api.hasBackend) {
      getCurrentWindow().setIgnoreCursorEvents(false).catch(() => undefined);
    }
  });
</script>

<div class="pet-stage">
  <button
    class="pet-anchor"
    class:pressed
    class:boing
    class:landing={landingPulse}
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
    />
  </button>

  {#if particles.list.length > 0}
    <div class="particle-layer" aria-hidden="true">
      {#each particles.list as p (p.id)}
        <span
          class="particle color-{p.colorIndex}"
          style="left: {p.x}px; top: {p.y}px; font-size: {p.sizePx}px; --dx: {p.dx}px; --rise: {p.rise}px; animation-duration: {p.durationMs}ms; animation-delay: {p.delayMs}ms;"
          onanimationend={() => particles.remove(p.id)}
        >{p.glyph}</span>
      {/each}
    </div>
  {/if}

  {#if snack.open}
    <div
      class="snack-tray"
      bind:this={snack.trayEl}
      style="left: {snackTrayBox().left}px; top: {snackTrayBox().top}px; width: {SNACK_TRAY_W}px;"
      role="menu"
      aria-label="Pick a snack for Mochi"
      tabindex="-1"
      onkeydown={snack.onKey}
    >
      {#each SNACK_KEYS as key (key)}
        <button
          type="button"
          role="menuitem"
          class="snack"
          onclick={() => onSnackPick(key)}
          aria-label={`Feed ${SNACKS[key].label}`}
          title={SNACKS[key].label}
        >
          <span class="snack-icon" aria-hidden="true">{SNACKS[key].icon}</span>
          <span class="snack-label">{SNACKS[key].label}</span>
        </button>
      {/each}
    </div>
  {/if}

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
    <PetStatus
      {pet}
      {saving}
      open={statusOpen}
      onToggle={toggleStatus}
      {flashedStat}
      onOpenSettings={openSettingsWindow}
    />
  </div>

  <div class="actions-anchor">
    <PetActions
      onAction={onAction}
      onReport={onReport}
      busy={busyAction}
      reporting={reporting}
      feedExpanded={snack.open}
    />
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
      <button type="button" role="menuitem" class="menu-item" onclick={openSettingsWindow}>
        Settings…
      </button>
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
    /* REQ-104 — squash pivots at the feet so squishes read as body weight. */
    transform-origin: center bottom;
  }
  .pet-anchor:active {
    cursor: grabbing;
  }
  /* REQ-104 — press squish + spring-back boing. Transform-only (GPU). */
  .pet-anchor.pressed {
    transform: scale(1.05, 0.92);
    transition: transform 90ms ease;
  }
  .pet-anchor.boing {
    animation: boing 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  /* REQ-112 — landing squash after a window drag settles. */
  .pet-anchor.landing {
    animation: land-squash 380ms ease-out;
  }
  @keyframes boing {
    0% {
      transform: scale(1.1, 0.88);
    }
    55% {
      transform: scale(0.96, 1.06);
    }
    100% {
      transform: scale(1, 1);
    }
  }
  @keyframes land-squash {
    0% {
      transform: scale(1.14, 0.84);
    }
    50% {
      transform: scale(0.94, 1.07);
    }
    100% {
      transform: scale(1, 1);
    }
  }
  /* REQ-105 — particle bursts. Decorative: never intercepts the cursor. */
  .particle-layer {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .particle {
    position: absolute;
    pointer-events: none;
    user-select: none;
    font-weight: 700;
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
    will-change: transform, opacity;
    animation-name: particle-float;
    animation-timing-function: ease-out;
    animation-fill-mode: both;
  }
  .particle.color-0 {
    color: #ff7aa1;
  }
  .particle.color-1 {
    color: #ffb347;
  }
  .particle.color-2 {
    color: #7fd8be;
  }
  .particle.color-3 {
    color: #b39ddb;
  }
  @keyframes particle-float {
    0% {
      transform: translate(-50%, 0) scale(0.7);
      opacity: 0;
    }
    15% {
      opacity: 1;
    }
    100% {
      transform: translate(calc(-50% + var(--dx)), calc(-1 * var(--rise))) scale(1);
      opacity: 0;
    }
  }
  /* REQ-107 — snack tray. */
  .snack-tray {
    position: absolute;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.96);
    padding: 6px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    pointer-events: auto;
    z-index: 4;
  }
  .snack {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    width: 68px;
    height: 54px;
    border: 0;
    border-radius: 10px;
    background: rgba(255, 240, 245, 0.85);
    color: var(--mochi-text, #3a2b34);
    cursor: pointer;
    transition: transform 0.08s ease, background 0.15s ease;
  }
  .snack:hover,
  .snack:focus-visible {
    background: rgba(255, 218, 232, 0.95);
  }
  .snack:active {
    transform: scale(0.94);
  }
  .snack-icon {
    font-size: 18px;
    line-height: 1;
  }
  .snack-label {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }
  @media (prefers-reduced-motion: reduce) {
    .pet-anchor.pressed {
      transform: none;
      transition: none;
    }
    .pet-anchor.boing,
    .pet-anchor.landing {
      animation: none;
    }
    /* Bursts are never spawned under reduced motion; this is belt-and-braces
       so a stray node can't linger without its removing animationend. */
    .particle {
      display: none;
    }
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
