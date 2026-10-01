// Run named tasks (tools/lib/tasks.mjs) across CPU cores with worker_threads, results back in order.
//   const out = await pool([{ fn: 'claw', args: {...} }, ...], 4);
import { Worker } from 'node:worker_threads';
import os from 'node:os';

export function pool(tasks, jobs = Math.min(os.cpus().length, 8)) {
  const results = new Array(tasks.length);
  let next = 0;
  const lanes = Math.max(1, Math.min(jobs, tasks.length));
  return Promise.all(Array.from({ length: lanes }, () => new Promise((resolve, reject) => {
    const w = new Worker(new URL('./worker.mjs', import.meta.url));
    const feed = () => {
      if (next >= tasks.length) { w.postMessage(null); return; }
      const i = next++;
      w.once('message', (m) => { if (m.error) { reject(new Error(m.error)); w.terminate(); return; } results[i] = m.result; feed(); });
      w.postMessage({ ...tasks[i] });
    };
    w.on('error', reject);
    w.on('exit', resolve);
    feed();
  }))).then(() => results);
}
