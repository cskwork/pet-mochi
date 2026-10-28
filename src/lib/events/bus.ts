import type { PetEvent, PetState } from "../sim";
import { isSalient, salienceScore } from "../sim";
import { api } from "../bridge/api";

type Handler = (event: PetEvent, state: PetState) => void;

class EventBus {
  private handlers: Set<Handler> = new Set();
  private logRing: Array<{ event: PetEvent; ts: number }> = [];
  private maxLog = 200;

  subscribe(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  dispatch(event: PetEvent, state: PetState): void {
    this.logRing.push({ event, ts: Date.now() });
    if (this.logRing.length > this.maxLog) this.logRing.shift();
    for (const h of this.handlers) {
      try {
        h(event, state);
      } catch (e) {
        console.warn("event handler error", e);
      }
    }
    // Log salient events. Score-only: calling shouldCallLLM here would
    // consume the shared LLM cooldown a second time (the handler already
    // did), which also made this log branch almost never run.
    if (api.hasBackend && isSalient(event, state)) {
      void api
        .logEvent(event.type, JSON.stringify(event), salienceScore(event, state))
        .catch(() => undefined);
    }
  }

  recent(): Array<{ event: PetEvent; ts: number }> {
    return [...this.logRing];
  }
}

export const eventBus = new EventBus();
