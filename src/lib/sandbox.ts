// Only this app-owned bootstrap executes in the frame. Generated calculations execute in a worker.
export const calculationSandbox = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-teachback-runner'; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; base-uri 'none'; form-action 'none'"></head><body><script nonce="teachback-runner">
let worker, timer;
window.addEventListener('message', event => {
  if (event.source !== parent || !event.data || event.data.type !== 'calculate') return;
  const { channel, requestId, code, batch } = event.data;
  if (typeof channel !== 'string' || typeof code !== 'string' || code.length > 12000 || !Array.isArray(batch) || batch.length > 64) return;
  if (worker) worker.terminate(); clearTimeout(timer);
  const reply = payload => parent.postMessage({ channel, requestId, ...payload }, '*');
  const source = '"use strict";\\n' + code + '\\nself.onmessage = event => { try { self.postMessage({results:event.data.map(inputs => calculate(Object.freeze(inputs)))}); } catch (_) { self.postMessage({error:true}); } };';
  const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
  try {
    worker = new Worker(url); URL.revokeObjectURL(url);
    timer = setTimeout(() => { worker.terminate(); reply({error:'Calculation timed out'}); }, 500);
    worker.onmessage = e => { clearTimeout(timer); worker.terminate(); reply(e.data); };
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); reply({error:'Calculation unavailable'}); };
    worker.postMessage(batch);
  } catch (_) { URL.revokeObjectURL(url); reply({error:'Calculation unavailable'}); }
});
</script></body></html>`;
