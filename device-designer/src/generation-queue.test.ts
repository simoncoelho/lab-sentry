import { describe, expect, it } from 'vitest';
import { GenerationQueue } from './generation-queue';

describe('generation lookahead', () => {
  it('plans only one batch ahead and consumes it without another request', async () => {
    const queue = new GenerationQueue<number>();
    let calls = 0;
    const load = async () => ++calls;
    queue.prepare(load); queue.prepare(load);
    expect(await queue.take(load)).toBe(1);
    expect(calls).toBe(1);
    expect(await queue.take(load)).toBe(2);
  });
  it('discards stale plans after feedback, even if the server ignores abort', async () => {
    const queue = new GenerationQueue<string>();
    let finish!: (value: string) => void;
    let signal!: AbortSignal;
    const old = queue.take(s => { signal = s; return new Promise(resolve => { finish = resolve; }); });
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); queue.cancel();
    expect(signal.aborted).toBe(true);
    queue.prepare(async () => 'new guidance');
    finish('old guidance'); await rejected;
    expect(await queue.take(async () => 'unexpected')).toBe('new guidance');
  });
  it('surfaces planning failure only when the renderer asks for that batch', async () => {
    const queue = new GenerationQueue<string>();
    queue.prepare(async () => { throw new Error('offline'); });
    await Promise.resolve();
    await expect(queue.take(async () => 'unexpected')).rejects.toThrow('offline');
    expect(await queue.take(async () => 'retry')).toBe('retry');
  });
});
