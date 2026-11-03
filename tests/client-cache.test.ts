import test from 'node:test';
import assert from 'node:assert/strict';
import { call, peek } from '../src/components/client';

test('concurrent reads share one network request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  let release!: (r: Response) => void;
  globalThis.fetch = (() => { calls++; return new Promise<Response>((resolve) => { release = resolve; }); }) as typeof fetch;
  try {
    const first = call('/test/coalesce');
    const second = call('/test/coalesce');
    assert.equal(calls, 1);
    release(Response.json({ ok: true, data: { value: 4 } }));
    assert.deepEqual(await Promise.all([first, second]), [{ value: 4 }, { value: 4 }]);
  } finally { globalThis.fetch = original; }
});

test('a write invalidates pending reads and prevents stale cache replacement', async () => {
  const original = globalThis.fetch;
  let release!: (r: Response) => void;
  let reads = 0;
  globalThis.fetch = ((_url, init) => {
    if (init?.method === 'POST') return Promise.resolve(Response.json({ ok: true, data: true }));
    reads++;
    if (reads === 1) return new Promise<Response>((resolve) => { release = resolve; });
    return Promise.resolve(Response.json({ ok: true, data: 'new' }));
  }) as typeof fetch;
  try {
    const oldRead = call('/test/invalidate');
    await call('/test/write', { method: 'POST' });
    assert.equal(await call('/test/invalidate'), 'new');
    release(Response.json({ ok: true, data: 'old' }));
    await oldRead;
    assert.equal(reads, 2);
    assert.equal(peek('/test/invalidate'), 'new');
  } finally { globalThis.fetch = original; }
});
