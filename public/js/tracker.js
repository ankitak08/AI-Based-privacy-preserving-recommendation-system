import { apiPost } from '/js/api.js';

export class ActivityTracker {
  constructor() {
    this.queue = [];
    this.timer = null;
    this.maxBatch = 12;
    this.flushEveryMs = 4000;
    this.inflight = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.flushEveryMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  emit(event) {
    this.queue.push(event);
    if (this.queue.length >= this.maxBatch) this.flush();
  }

  async flush() {
    if (this.inflight) return;
    if (this.queue.length === 0) return;
    const events = this.queue.splice(0, this.maxBatch);
    this.inflight = true;
    try {
      const resp = await apiPost('/api/track', { events });
      return resp;
    } catch {
      this.queue.unshift(...events);
    } finally {
      this.inflight = false;
    }
  }

  flushBeacon() {
    if (this.queue.length === 0) return false;
    if (!('sendBeacon' in navigator)) return false;

    const events = this.queue.splice(0, this.maxBatch);
    const payload = JSON.stringify({ events });
    const blob = new Blob([payload], { type: 'application/json' });
    const ok = navigator.sendBeacon('/api/track', blob);

    if (!ok) {
      this.queue.unshift(...events);
      return false;
    }

    return true;
  }
}
