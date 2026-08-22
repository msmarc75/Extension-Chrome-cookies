/*
 * Report controller.
 *
 * Reads one stored audit and renders it. No measurement happens here and none
 * can: the report is a view of a record, so what a client is shown is exactly
 * what was observed at the time, not a re-run that might disagree with the
 * figure they were quoted.
 *
 * Everything printed comes from ../../shared/report-model.js, which the popup
 * and the exported files use too — the same deposit must not read as "413 ms"
 * on screen and "0.4 s" in the annex.
 */

import { MessageType, request } from '../../shared/messaging.js';
import { classifyHost } from '../../engine/tracker-classifier.js';
import {
  LANES,
  axisTicks,
  buildTimeline,
  depositsCsv,
  exportFilename,
  findingsCsv,
  formatOffset,
  positionOf,
} from '../../shared/report-model.js';

const field = (name) => document.querySelector(`[data-field="${name}"]`);

const VERDICT_MARK = Object.freeze({
  fail: '✕',
  warn: '!',
  pass: '✓',
  not_applicable: '–',
});

const VERDICT_WORD = Object.freeze({
  fail: 'Departure',
  warn: 'To review',
  pass: 'Consistent',
  not_applicable: 'Did not apply',
});

const CATEGORY_TITLE = Object.freeze({
  deposit: 'Before the visitor could answer',
  fairness: 'How the choice was offered',
  information: 'What the banner said',
  policy: 'What the privacy policy states',
});

const PROFILE_WORD = Object.freeze({
  'incognito-fresh': 'clean incognito window (a first visit)',
  'incognito-shared': 'incognito session already open',
  current: 'the visitor’s own profile (a returning visit)',
});

const SUBJECT_LABEL = Object.freeze({
  identity_controller: 'Who the controller is',
  contact_dpo: 'How to reach the DPO',
  data_categories: 'What data is processed',
  purposes: 'What it is used for',
  legal_bases: 'The legal basis for each purpose',
  legitimate_interests: 'Which legitimate interests are relied on',
  recipients: 'Who receives the data',
  third_country_transfers: 'Transfers outside the EEA',
  retention: 'How long the data is kept',
  rights_access_rectify_erase: 'Access, rectification, erasure',
  right_withdraw_consent: 'The right to withdraw consent',
  right_complain_supervisory: 'The right to complain',
  automated_decision_making: 'Automated decisions',
  cookies_described: 'What is stored on the device',
  consent_withdrawal_mechanism: 'How to change the choice later',
});

/** @type {object|null} */
let record = null;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
};

const when = (at) =>
  new Date(at).toLocaleString(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  });

/* ---- Timeline ----------------------------------------------------------- */

function renderTimeline(capture) {
  const timeline = buildTimeline(capture, (host) => classifyHost(host));
  const container = field('timeline');
  const axis = field('axis');

  for (const node of container.querySelectorAll('.ca-lane')) node.remove();

  for (const lane of LANES) {
    const events = timeline.events.filter((event) => event.lane === lane.key);

    const row = element('div', 'ca-lane');
    const label = element('div', 'ca-lane__label');
    label.append(
      element('span', null, `${lane.label} `),
      element('span', 'ca-lane__count', `${events.length}`),
    );
    row.append(label);

    const track = element('div', 'ca-lane__track');
    for (const event of events) {
      const marker = element('button', 'ca-marker');
      marker.type = 'button';
      marker.style.left = `${positionOf(event.tMs, timeline.windowMs)}%`;
      if (event.category) marker.dataset.category = event.category;
      /*
       * The accessible name is the whole observation. A marker whose meaning
       * lives only in a colour would be unreadable to a third of the audience
       * and to every printed copy.
       */
      marker.title = `${formatOffset(event.tMs)} — ${event.label}${event.category ? ` (${event.category})` : ''}`;
      marker.setAttribute('aria-label', marker.title);
      track.append(marker);
    }
    row.append(track);
    container.insertBefore(row, axis);
  }

  axis.replaceChildren();
  const ticks = axisTicks(timeline.windowMs);
  for (const tick of ticks) {
    const mark = element('span', 'ca-tick', tick.label);
    const at = positionOf(tick.tMs, timeline.windowMs);
    /* The closing tick is anchored to the end of the axis: placed by its left
       edge it would hang off the page, and it is the label that says what the
       whole picture is scaled to. */
    if (at >= 100) mark.classList.add('ca-tick--end');
    else mark.style.left = `${at}%`;
    axis.append(mark);
  }

  field('timeline-empty').hidden = timeline.events.length > 0;

  const undated = field('undated');
  undated.replaceChildren();
  for (const event of timeline.undated) {
    const item = element('li', null, event.label);
    item.append(element('span', 'ca-list__detail', `${event.lane} · ${event.detail}`));
    undated.append(item);
  }
  field('undated-details').hidden = timeline.undated.length === 0;
  field('undated-summary').textContent =
    `${timeline.undated.length} observation(s) with no time — recorded, not placed`;

  return timeline;
}

/* ---- Findings ----------------------------------------------------------- */

function renderFindings(report) {
  const container = field('findings');
  container.replaceChildren();

  for (const [category, title] of Object.entries(CATEGORY_TITLE)) {
    const findings = report.findings.filter((finding) => finding.category === category);
    if (findings.length === 0) continue;

    const group = element('section', 'ca-group');
    group.append(element('h3', 'ca-group__title', title));

    /* Departures first: a reader who stops after the first screen must have
       seen the worst of it. */
    const order = { fail: 0, warn: 1, pass: 2 };
    const judged = findings.filter((finding) => finding.verdict !== 'not_applicable');
    const skipped = findings.filter((finding) => finding.verdict === 'not_applicable');

    for (const finding of judged.sort(
      (a, b) => order[a.verdict] - order[b.verdict] || b.weight - a.weight,
    )) {
      group.append(renderFinding(finding));
    }

    /*
     * A rule that did not apply is worth stating and not worth a card each: on
     * an audit with no policy analysis that would be five identical panels
     * saying the same sentence, in a document a client is meant to read.
     */
    if (skipped.length > 0) {
      const details = element('details', 'ca-details');
      details.append(
        element(
          'summary',
          'ca-details__summary',
          `${skipped.length} rule(s) did not apply to this page`,
        ),
      );
      const list = element('ul', 'ca-list');
      for (const finding of skipped) {
        const item = element('li', null, finding.title);
        item.append(
          element('span', 'ca-list__detail', `${finding.id} — ${finding.because ?? 'no reason recorded'}`),
        );
        list.append(item);
      }
      details.append(list);
      group.append(details);
    }

    container.append(group);
  }
}

function renderFinding(finding) {
  const card = element('article', 'ca-finding');
  card.dataset.verdict = finding.verdict;

  const head = element('div', 'ca-finding__head');
  head.append(
    element('span', 'ca-finding__mark', VERDICT_MARK[finding.verdict] ?? '·'),
    element('h4', 'ca-finding__title', finding.title),
    element('span', 'ca-finding__id', `${VERDICT_WORD[finding.verdict]} · ${finding.id}`),
  );
  card.append(head);

  const body = element('div', 'ca-finding__body');

  if (finding.verdict === 'not_applicable') {
    body.append(
      element('p', 'ca-list__detail', `Did not apply: ${finding.because ?? 'no reason recorded'}.`),
    );
  } else if (finding.evidence.length > 0) {
    const list = element('ul', 'ca-list');
    for (const observation of finding.evidence) {
      const item = element('li', null, observation.what);
      if (observation.detail) item.append(element('span', 'ca-list__detail', observation.detail));
      /* Rules that carry a moment usually put it in their own wording too, and
         "first at 767 ms / at 767 ms" reads like a defect in the report. */
      const moment = formatOffset(observation.tMs);
      if (observation.tMs !== null && observation.tMs !== undefined && !String(observation.detail ?? '').includes(moment)) {
        item.append(element('span', 'ca-list__detail', `at ${moment}`));
      }
      list.append(item);
    }
    body.append(list);
  }

  if (finding.temperedBecause) {
    body.append(element('p', 'ca-list__detail', finding.temperedBecause));
  }
  card.append(body);

  /* A departure that does not say what to do about it is a complaint. */
  if (finding.verdict === 'fail' || finding.verdict === 'warn') {
    const foot = element('div', 'ca-finding__foot');
    foot.append(
      element(
        'span',
        'ca-finding__basis',
        finding.legalBasis.map((basis) => `${basis.source} ${basis.ref}`).join(' · '),
      ),
      element('span', 'ca-finding__remedy', finding.remediation),
    );
    card.append(foot);
  }

  return card;
}

/* ---- Policy ------------------------------------------------------------- */

function renderPolicy(policy) {
  const section = field('policy-section');
  const analysis = policy?.analysis ?? null;
  if (!analysis) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  field('policy-source').textContent =
    `${analysis.source.characters.toLocaleString()} characters read from ${analysis.source.url ?? policy.finalUrl ?? policy.url}` +
    `${analysis.source.truncated ? ', truncated at the analysis ceiling' : ''}. ` +
    'Every sentence below was found in that document before this report was written.';

  const rows = field('policy-rows');
  rows.replaceChildren();

  for (const mention of analysis.mentions) {
    const row = element('tr');
    row.append(element('th', null, SUBJECT_LABEL[mention.subject] ?? mention.subject));

    const status = element('td');
    const badge = element('span', 'ca-status', mention.status);
    badge.dataset.status = mention.status;
    status.append(badge);
    row.append(status);

    const said = element('td');
    if (mention.quote) {
      const quote = element('blockquote', null, mention.quote);
      said.append(quote);
    }
    if (mention.note) said.append(element('span', 'ca-table__note', mention.note));
    if (!mention.quote && !mention.note) said.append(element('span', 'ca-table__note', '—'));
    row.append(said);

    rows.append(row);
  }
}

/* ---- History ------------------------------------------------------------ */

async function renderHistory(currentId) {
  const response = await request(MessageType.HISTORY_LIST);
  const list = field('history');
  list.replaceChildren();

  const entries = response.ok ? response.data : [];
  if (entries.length === 0) {
    list.append(element('li', 'ca-history__row', 'No audits kept yet.'));
    return;
  }

  for (const entry of entries) {
    const row = element('li', 'ca-history__row');
    row.append(
      element('span', 'ca-history__score', entry.score === null ? '—' : String(entry.score)),
    );

    const site = element('span', 'ca-history__site');
    if (entry.id === currentId) {
      site.append(element('strong', null, entry.site ?? 'unknown'));
    } else {
      const link = element('a', 'ca-link', entry.site ?? 'unknown');
      link.href = `report.html?audit=${encodeURIComponent(entry.id)}`;
      site.append(link);
    }
    row.append(site, element('span', 'ca-history__when', when(entry.at)));
    list.append(row);
  }
}

/* ---- Export ------------------------------------------------------------- */

function download(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  /* Revoked on the next turn: revoking synchronously can cancel the download
     in Chromium before it has read the blob. */
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportContext() {
  return {
    site: record.finalUrl ?? record.target ?? '',
    auditedAt: new Date(record.at).toISOString(),
    profile: record.profile ?? '',
  };
}

/* ---- Boot --------------------------------------------------------------- */

async function load() {
  const id = new URL(location.href).searchParams.get('audit');
  const response = id
    ? await request(MessageType.HISTORY_GET, { id })
    : { ok: true, data: null };

  /* No id, or an id that no longer exists: show the newest kept audit rather
     than an empty page — the history is right there and usually has one. */
  if (response.ok && !response.data) {
    const list = await request(MessageType.HISTORY_LIST);
    const newest = list.ok ? list.data[0] : null;
    if (newest) {
      const again = await request(MessageType.HISTORY_GET, { id: newest.id });
      record = again.ok ? again.data : null;
    }
  } else {
    record = response.ok ? response.data : null;
  }

  await renderHistory(record?.id ?? null);

  if (!record) {
    field('empty').hidden = false;
    field('actions').hidden = true;
    return;
  }

  field('site').textContent = record.finalUrl ?? record.target ?? 'unknown page';
  field('meta').textContent =
    `Audited ${when(record.at)} · ${PROFILE_WORD[record.profile] ?? record.profile ?? 'unknown profile'}` +
    ` · observation window ${formatOffset(record.capture.window?.durationMs ?? null)}`;
  field('footer-meta').textContent =
    `Report ${record.id}. ${record.capture.requestsThirdParty} third-party request(s) of ` +
    `${record.capture.requestsTotal} observed` +
    `${record.capture.requestsDropped > 0 ? `, of which ${record.capture.requestsDropped} are not listed individually` : ''}.`;

  const report = record.report;
  if (report) {
    field('verdict-section').hidden = false;
    field('score-block').dataset.band = report.band.key;
    field('score').textContent = String(report.score);
    field('band').textContent = report.provisional
      ? `${report.band.label} — provisional`
      : report.band.label;
    field('finding-counts').textContent =
      `${report.counts.fail} departure(s) · ${report.counts.warn} to review · ` +
      `${report.counts.pass} consistent · ${report.counts.not_applicable} did not apply`;

    const disclosures = field('disclosures');
    disclosures.replaceChildren();
    for (const line of report.disclosures) disclosures.append(element('li', null, line));

    field('findings-section').hidden = false;
    renderFindings(report);
  }

  field('timeline-section').hidden = false;
  renderTimeline(record.capture);
  renderPolicy(record.policy);
}

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action || !record) return;

  if (action === 'print') {
    window.print();
  } else if (action === 'csv-findings') {
    download(
      exportFilename(record.finalUrl ?? record.target, record.at, 'findings', 'csv'),
      findingsCsv(record.report, exportContext()),
    );
  } else if (action === 'csv-deposits') {
    download(
      exportFilename(record.finalUrl ?? record.target, record.at, 'deposits', 'csv'),
      depositsCsv(buildTimeline(record.capture, (host) => classifyHost(host)), exportContext()),
    );
  } else if (action === 'clear-history') {
    await request(MessageType.HISTORY_CLEAR);
    location.reload();
  }
});

await load();
