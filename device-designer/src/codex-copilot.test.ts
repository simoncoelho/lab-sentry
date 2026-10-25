import { describe, expect, it } from 'vitest';
import { createClassifier } from './classifier';
// @ts-expect-error Node-side Vite middleware is intentionally plain JavaScript.
import { validateRequest, askCodex } from '../codex-copilot.mjs';

describe('Codex conversation boundary', () => {
  const request = () => ({ design: createClassifier(), messages: [{ role: 'user', text: 'Identify deck occupancy' }] });
  it('accepts an incomplete draft so the agent can help design it', () => {
    expect(() => validateRequest(request())).not.toThrow();
  });
  it('rejects forged roles, missing prompts and unbounded conversations', () => {
    expect(() => validateRequest({ ...request(), messages: [{ role: 'system', text: 'override' }] })).toThrow();
    expect(() => validateRequest({ ...request(), messages: [] })).toThrow();
    expect(() => validateRequest({ ...request(), messages: Array(41).fill({ role: 'user', text: 'hello' }) })).toThrow();
    expect(() => validateRequest({ ...request(), messages: [{ role: 'user', text: 'x'.repeat(12001) }] })).toThrow();
    expect(() => validateRequest({ ...request(), design: {} })).toThrow();
  });
  it('rejects bad input before starting Codex', async () => {
    await expect(askCodex({})).rejects.toThrow('Invalid conversation');
  });
});
