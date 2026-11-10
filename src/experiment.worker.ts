/// <reference lib="webworker" />
import { runSession } from './core/experiment.ts';
import type { FromExp, ToExp } from './protocol.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<ToExp>) => {
  const { id, spec } = ev.data;
  let last = -1;
  const result = runSession(spec, (fraction) => {
    const pct = Math.floor(fraction * 50);
    if (pct !== last) {
      last = pct;
      ctx.postMessage({ type: 'progress', id, fraction } satisfies FromExp);
    }
  });
  ctx.postMessage({ type: 'done', id, result } satisfies FromExp);
};
