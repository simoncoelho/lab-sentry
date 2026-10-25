// Throttle without a backlog: retain just the newest unsent target, and never
// overlap requests. Stop waits for the in-flight acknowledgement before halting.
export class LiveTarget<T> {
  private pending: T | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  private paused = false;
  constructor(private send: (target: T) => Promise<void>, private failure: (error: unknown) => void, private interval = 120) {}
  push(target: T) {
    if (this.paused) return;
    this.pending = target;
    if (!this.timer && !this.active) this.schedule();
  }
  private schedule() { this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, this.interval); }
  private async flush() {
    if (this.paused || this.pending === undefined) return;
    const value = this.pending; this.pending = undefined;
    this.active = this.send(value).catch(error => { this.pending = undefined; this.paused = true; this.failure(error); });
    await this.active; this.active = undefined;
    if (!this.paused && this.pending !== undefined) this.schedule();
  }
  async pause() {
    this.paused = true; this.pending = undefined;
    clearTimeout(this.timer); this.timer = undefined;
    await this.active;
  }
  resume() { this.paused = false; }
}
