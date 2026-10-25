import { afterEach, expect, it, vi } from "vitest";
import { LiveTarget } from "./live-target";
afterEach(() => vi.useRealTimers());
it("coalesces a drag to its latest target", async () => {
  vi.useFakeTimers(); const send = vi.fn(async (_value: number) => {});
  const queue = new LiveTarget(send, vi.fn());
  queue.push(1); queue.push(2); queue.push(3);
  await vi.advanceTimersByTimeAsync(120);
  expect(send.mock.calls).toEqual([[3]]);
});
it("does not overlap slow requests, and sends the latest update afterward", async () => {
  vi.useFakeTimers(); let finish!: () => void;
  const send = vi.fn((_value: number) => new Promise<void>(resolve => { finish = resolve; }));
  const queue = new LiveTarget(send, vi.fn());
  queue.push(1); await vi.advanceTimersByTimeAsync(120);
  queue.push(2); queue.push(9); await vi.advanceTimersByTimeAsync(1000);
  expect(send).toHaveBeenCalledTimes(1);
  finish(); await vi.advanceTimersByTimeAsync(120);
  expect(send.mock.calls).toEqual([[1], [9]]); finish();
});
it("stop clears pending targets and waits for the active request", async () => {
  vi.useFakeTimers(); let finish!: () => void;
  const send = vi.fn((_value: number) => new Promise<void>(resolve => { finish = resolve; }));
  const queue = new LiveTarget(send, vi.fn());
  queue.push(1); await vi.advanceTimersByTimeAsync(120); queue.push(2);
  let stopped = false; const stop = queue.pause().then(() => { stopped = true; });
  await vi.advanceTimersByTimeAsync(500); expect(stopped).toBe(false);
  finish(); await stop; await vi.advanceTimersByTimeAsync(500);
  expect(send.mock.calls).toEqual([[1]]); expect(stopped).toBe(true);
});
it("a failed request drops queued motion until explicitly resumed", async () => {
  vi.useFakeTimers(); const fail = vi.fn();
  const send = vi.fn(async (_value: number) => { throw new Error("offline"); });
  const queue = new LiveTarget(send, fail);
  queue.push(1); await vi.advanceTimersByTimeAsync(120); queue.push(2);
  await vi.advanceTimersByTimeAsync(1000); expect(send).toHaveBeenCalledTimes(1); expect(fail).toHaveBeenCalledTimes(1);
});
