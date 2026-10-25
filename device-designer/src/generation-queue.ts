/** At most one planning request ahead of the renderer. Errors are observed on take,
 * so an aborted/failed speculative request never becomes an unhandled rejection. */
export class GenerationQueue<T> {
  private pending?: { controller: AbortController; result: Promise<{ value: T } | { error: unknown }> };
  prepare(load: (signal: AbortSignal) => Promise<T>) {
    if (this.pending) return;
    const controller = new AbortController();
    const result = Promise.resolve().then(() => load(controller.signal)).then(value => ({ value }), error => ({ error }));
    this.pending = { controller, result };
  }
  async take(load: (signal: AbortSignal) => Promise<T>) {
    this.prepare(load);
    const pending = this.pending!;
    const result = await pending.result;
    if (this.pending === pending) this.pending = undefined;
    if (pending.controller.signal.aborted) throw new DOMException('Planning cancelled', 'AbortError');
    if ('error' in result) throw result.error;
    return result.value;
  }
  cancel() { this.pending?.controller.abort(); this.pending = undefined; }
}
