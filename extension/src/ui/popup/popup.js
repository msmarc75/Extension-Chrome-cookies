/*
 * Popup controller.
 *
 * The popup is a launcher and a summary, not the report. It shows the handful
 * of figures that decide whether the rest is worth reading, and it is honest
 * about the conditions the measurement was taken under: a capture from a
 * profile that already knew the site is worth less, and a banner found by
 * appearance rather than by its platform is weaker evidence. Both say so, here,
 * next to the numbers.
 */

import { MessageType, request } from '../../shared/messaging.js';
import { formatOffset, summarise } from './summary.js';

const ACKNOWLEDGED_KEY = 'debuggerNoticeAcknowledged';

const field = (name) => document.querySelector(`[data-field="${name}"]`);
const views = () => document.querySelectorAll('[data-view]');

function show(view) {
  for (const section of views()) {
    section.hidden = section.dataset.view !== view;
  }
}

const PROFILE_NOTE = Object.freeze({
  'incognito-fresh': 'Measured in a clean incognito window — a genuine first visit.',
  'incognito-shared':
    'Measured in an incognito session that was already open, so it may carry state from earlier browsing in that session.',
  current:
    'Measured in your normal profile. This is a returning visit, not a first one: the site may already hold a stored choice.',
});

async function activeTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? null;
}

const BANNER_METHOD = Object.freeze({
  'platform-markup': 'found by its platform',
  heuristic: 'found by appearance',
  'frame-only': 'in an unreadable frame',
  none: 'not found',
});

function renderScore(report) {
  const block = field('score-block');
  if (!report) {
    block.hidden = true;
    return;
  }
  block.hidden = false;
  /*
   * The plan's rule, kept literally: never the score on its own. The band puts
   * it in words, the counts say what produced it, and a score computed over
   * part of the rulebook says so before anything else.
   */
  block.dataset.band = report.band.key;
  field('score').textContent = String(report.score);
  field('band').textContent = report.provisional
    ? `${report.band.label} — provisional`
    : report.band.label;
  field('finding-counts').textContent =
    `${report.counts.fail} finding(s), ${report.counts.warn} to check, ` +
    `${report.counts.not_applicable} not applicable`;
}

function renderResult(probe) {
  const capture = probe.captureA;
  const summary = summarise(capture);

  renderScore(probe.report ?? null);

  field('result-target').textContent = capture.target.finalUrl ?? capture.target.requestedUrl;
  field('third-party-requests').textContent =
    `${summary.thirdPartyRequests} of ${summary.totalRequests}`;
  field('cookies').textContent =
    summary.cookies === 0
      ? 'none'
      : `${summary.cookies} (${summary.thirdPartyCookies} third-party)`;
  field('storage').textContent = summary.storage === 0 ? 'none' : String(summary.storage);
  field('first-deposit').textContent =
    summary.firstDepositMs === null ? 'nothing observed' : formatOffset(summary.firstDepositMs);

  field('cmp').textContent =
    probe.cmp.id === null ? 'none recognised' : `${probe.cmp.name} (${probe.cmp.confidence})`;
  field('banner').textContent = BANNER_METHOD[probe.banner.method] ?? probe.banner.method;

  field('profile-note').textContent = PROFILE_NOTE[capture.profile] ?? '';

  /*
   * Everything that limits how far these figures can be trusted, on the same
   * screen as the figures. A caveat kept in the documentation is a caveat
   * nobody reads.
   */
  const caveats = [
    ...(probe.report?.disclosures ?? []),
    ...(probe.banner.disclosure ? [probe.banner.disclosure] : []),
    ...(capture.notes.length > 0
      ? [`Limitations recorded: ${capture.notes.map((n) => n.code).join(', ')}.`]
      : []),
  ];
  const notes = field('capture-notes');
  notes.hidden = caveats.length === 0;
  notes.textContent = caveats.join(' ');

  show('result');
}

function fail(message) {
  field('error-message').textContent = message;
  show('error');
}

async function refreshCapability() {
  const [status, capability] = await Promise.all([
    request(MessageType.GET_STATUS),
    request(MessageType.AUDIT_CAPABILITY),
  ]);

  field('version').textContent = status.ok ? `v${status.data.version}` : 'not connected';

  if (!capability.ok) {
    fail('The extension could not reach its background service.');
    return null;
  }
  if (!capability.data.canAudit) {
    show('blocked');
    return null;
  }

  const url = await activeTabUrl();
  if (!url || !/^https?:/.test(url)) {
    fail('This page cannot be audited. Open an http or https page and try again.');
    return null;
  }

  field('target').textContent = url;

  const { [ACKNOWLEDGED_KEY]: acknowledged } = await chrome.storage.local.get(ACKNOWLEDGED_KEY);
  field('debugger-notice').hidden = Boolean(acknowledged);

  show('ready');
  return url;
}

async function runAudit() {
  const url = await activeTabUrl();
  if (!url) {
    fail('No page to audit.');
    return;
  }

  show('running');
  field('running-detail').textContent =
    'Watching the page without touching it. Do not interact with the audit window.';

  /*
   * `act: false` — the popup measures and identifies, it does not refuse or
   * accept on the user's behalf. Driving the banner belongs to the full audit.
   */
  const response = await request(MessageType.PROBE_BANNER, { url, act: false });

  if (response.ok) {
    renderResult(response.data);
    return;
  }
  fail(response.error.message);
}

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  if (action === 'audit') {
    await runAudit();
  } else if (action === 'acknowledge') {
    await chrome.storage.local.set({ [ACKNOWLEDGED_KEY]: true });
    field('debugger-notice').hidden = true;
  } else if (action === 'open-settings') {
    await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
  }
});

refreshCapability();
