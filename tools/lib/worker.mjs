// Worker thread entry for tools/lib/pool.mjs: run one named task at a time until told to stop.
import { parentPort } from 'node:worker_threads';
import * as tasks from './tasks.mjs';

parentPort.on('message', (job) => {
  if (job === null) { process.exit(0); }
  try { parentPort.postMessage({ result: tasks[job.fn](job.args || {}) }); }
  catch (e) { parentPort.postMessage({ error: String((e && e.stack) || e) }); }
});
