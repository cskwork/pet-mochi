import type { PetEvent, PetState } from "../sim";
import {
  eventImportance,
  moodUrgency,
  relationshipWeight,
  shouldCallLLM,
} from "../sim";
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
    if (api.hasBackend && shouldCallLLM(event, state)) {
      const score =
        eventImportance(event) +
        moodUrgency(state) +
        relationshipWeight(state);
      void api
        .logEvent(event.type, JSON.stringify(event), score)
        .catch(() => undefined);
    }
  }

  recent(): Array<{ event: PetEvent; ts: number }> {
    return [...this.logRing];
  }
}

export const eventBus = new EventBus();
