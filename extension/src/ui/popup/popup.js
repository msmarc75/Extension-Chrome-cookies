/*
 * Popup controller.
 *
 * Phase 1 scope: prove the popup ↔ service worker channel end to end and show
 * the result in the report register (mark + label + measured value), never a
 * bare colour.
 */

import { MessageType, request } from '../../shared/messaging.js';

const VERDICT = Object.freeze({
  pending: { state: '', mark: '·', label: 'Checking…' },
  clear: { state: 'clear', mark: '✓', label: 'Service worker responding' },
  breach: { state: 'breach', mark: '✕', label: 'Service worker unreachable' },
});

const field = (name) => document.querySelector(`[data-field="${name}"]`);

function setVerdict(kind) {
  const verdict = VERDICT[kind];
  const container = field('verdict');
  container.dataset.state = verdict.state;
  field('verdict-mark').textContent = verdict.mark;
  field('verdict-label').textContent = verdict.label;
}

function setFacts({ worker, protocol, latency, version }) {
  field('worker').textContent = worker;
  field('protocol').textContent = protocol;
  field('latency').textContent = latency;
  field('version').textContent = version;
}

async function runSelfCheck() {
  const button = document.querySelector('[data-action="self-check"]');
  button.disabled = true;
  setVerdict('pending');

  const start = performance.now();
  const status = await request(MessageType.GET_STATUS);
  const elapsed = performance.now() - start;

  if (status.ok) {
    setVerdict('clear');
    setFacts({
      worker: `up ${Math.round(status.data.workerUptimeMs)} ms`,
      protocol: `v${status.data.protocol}`,
      latency: `${elapsed.toFixed(1)} ms`,
      version: `v${status.data.version}`,
    });
  } else {
    setVerdict('breach');
    setFacts({
      worker: status.error.code,
      protocol: '—',
      latency: '—',
      version: 'not connected',
    });
  }

  button.disabled = false;
}

document.querySelector('[data-action="self-check"]').addEventListener('click', runSelfCheck);
runSelfCheck();
