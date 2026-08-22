/*
 * Getting the policy off the page.
 *
 * Read through the debugger session, like everything else the audit reads: no
 * content script, no host permission, no fetch. That is not only a permissions
 * argument — a great many policies are rendered by script, sit behind a consent
 * gate, or are served as a single-page application route, and fetching the URL
 * would return a shell with none of the text in it. What the visitor sees is
 * what the page renders, and that is what has to be analysed.
 *
 * What comes back is the readable text, in document order, with the furniture
 * removed: navigation, headers, footers, the cookie banner itself. The last one
 * matters — a banner left in the extraction would put its own words into the
 * policy analysis and make every site look as though its policy discussed
 * consent.
 */

import { hostOf, registrableDomain } from '../shared/hosts.js';

/** Beyond this the extraction is an excerpt; the analysis says so downstream. */
const MAX_CHARACTERS = 120_000;

/** Elements that are never the policy, however much text they hold. */
const FURNITURE = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'nav',
  'header',
  'footer',
  'aside',
  'iframe',
  'form',
];

/** Roles and attributes a consent dialog announces itself with. */
const BANNER_HINTS = [
  '[id*="onetrust" i]',
  '[id*="didomi" i]',
  '[id*="axeptio" i]',
  '[id*="cookiebot" i]',
  '[id*="cookie" i][class*="banner" i]',
  '[class*="cookie-consent" i]',
  '[class*="cookie-banner" i]',
  '[class*="consent-banner" i]',
  '[id*="sp_message" i]',
  '[id*="tarteaucitron" i]',
];

/**
 * The expression evaluated in the page.
 *
 * Text is taken from a container chosen by how much of the document's text it
 * holds — `main` and `article` when they exist, the body otherwise — because
 * policies are long documents surrounded by short ones, and the biggest block
 * of prose on a policy page is the policy.
 */
export const POLICY_TEXT_EXPRESSION = `(() => {
  const FURNITURE = ${JSON.stringify(FURNITURE)};
  const BANNER_HINTS = ${JSON.stringify(BANNER_HINTS)};
  const MAX = ${MAX_CHARACTERS};

  const clone = document.body ? document.body.cloneNode(true) : null;
  if (!clone) return JSON.stringify({ url: location.href, title: '', text: '', from: 'none' });

  for (const selector of FURNITURE.concat(BANNER_HINTS)) {
    let found = [];
    try {
      found = Array.from(clone.querySelectorAll(selector));
    } catch (error) {
      found = [];
    }
    for (const node of found) node.remove();
  }

  /*
   * A block element's text needs a line break after it or the whole document
   * arrives as one paragraph, which loses the sentence boundaries the analysis
   * quotes by. innerText would give them, but only for rendered nodes — and
   * this tree is detached, so it renders nothing.
   */
  const BLOCK = new Set(['P','DIV','SECTION','ARTICLE','LI','TR','H1','H2','H3','H4','H5','H6','BR','TD','TH','DT','DD','BLOCKQUOTE','PRE','UL','OL','TABLE','MAIN','FIGCAPTION']);
  const readText = (root) => {
    let out = '';
    const walk = (node) => {
      if (node.nodeType === 3) {
        out += node.nodeValue.replace(/\\s+/g, ' ');
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.tagName;
      if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return;
      for (const child of node.childNodes) walk(child);
      if (BLOCK.has(tag)) out += '\\n';
    };
    walk(root);
    return out;
  };

  const candidates = [];
  for (const selector of ['main', 'article', '[role="main"]', '#content', '.content']) {
    let found = [];
    try {
      found = Array.from(clone.querySelectorAll(selector));
    } catch (error) {
      found = [];
    }
    for (const node of found) candidates.push({ selector, node });
  }

  const whole = readText(clone);
  let best = { from: 'body', text: whole };
  for (const candidate of candidates) {
    const text = readText(candidate.node);
    /* Only prefer a container that holds most of the page's prose: a "main"
       wrapping a teaser and a link to the real policy is worse than the body. */
    if (text.length > best.text.length || (best.from === 'body' && text.length > whole.length * 0.6)) {
      best = { from: candidate.selector, text };
    }
  }

  const text = best.text.replace(/[ \\t]+/g, ' ').replace(/ ?\\n ?/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();

  /*
   * A great many sites answer "privacy" with a hub — a page of links to the
   * policy, the cookie policy and a video about them. Its own links are
   * collected here so the caller can follow one, rather than analysing a
   * table of contents and reporting that the policy says nothing.
   */
  const links = [];
  try {
    const seen = new Set();
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = anchor.href || '';
      if (!href.startsWith('http') || seen.has(href)) continue;
      seen.add(href);
      const label = (anchor.innerText || anchor.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!/privacy|confidentialit|datenschutz|privacidad|privacy|cookie|donnees|policy|beleid|informativa/i.test(href + ' ' + label)) continue;
      links.push({ href: href.slice(0, 500), text: label.slice(0, 120) });
      if (links.length >= 24) break;
    }
  } catch (error) {
    /* Links are a convenience; the text is the point. */
  }

  return JSON.stringify({
    url: location.href,
    title: document.title || '',
    lang: document.documentElement.getAttribute('lang') || null,
    from: best.from,
    truncated: text.length > MAX,
    text: text.slice(0, MAX),
    links,
  });
})()`;

/**
 * @param {unknown} raw the JSON string the expression returned
 * @returns {{url: string|null, title: string, lang: string|null, from: string, truncated: boolean, text: string}}
 */
export function parsePolicyText(raw) {
  const empty = { url: null, title: '', lang: null, from: 'none', truncated: false, text: '', links: [] };
  if (typeof raw !== 'string') return empty;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return empty;

  return {
    url: typeof parsed.url === 'string' ? parsed.url : null,
    title: typeof parsed.title === 'string' ? parsed.title : '',
    lang: typeof parsed.lang === 'string' ? parsed.lang : null,
    from: typeof parsed.from === 'string' ? parsed.from : 'none',
    truncated: parsed.truncated === true,
    text: typeof parsed.text === 'string' ? parsed.text : '',
    links: Array.isArray(parsed.links)
      ? parsed.links
          .filter((link) => typeof link?.href === 'string')
          .map((link) => ({ href: link.href, text: String(link.text ?? '') }))
      : [],
  };
}

/**
 * Where to go next when the page reached turns out to be a hub.
 *
 * Only ever one hop, and only towards a link that scores better than the page
 * it is on: following links about privacy until something long enough turns up
 * is how a tool ends up analysing a blog post.
 *
 * @param {{url: string|null, links: Array<{href: string, text: string}>}} read
 * @returns {string|null}
 */
export function nextPolicyHop(read) {
  /* Compared without their fragments: "#maincontent" on the page you are
     already on is not somewhere else to look. */
  const withoutFragment = (value) => String(value ?? '').split('#')[0];
  const here = withoutFragment(read?.url);
  const siteHost = hostOf(read?.url ?? '') ?? null;
  const ranked = (read?.links ?? [])
    .filter((link) => withoutFragment(link.href) !== here)
    .map((link) => ({ link, score: scorePolicyLink(link, siteHost) }))
    .filter((candidate) => candidate.score >= 6)
    .sort((a, b) => b.score - a.score);

  return ranked.length > 0 ? ranked[0].link.href : null;
}

/* A path that names the document. */
const STRONG_PATH =
  /(privacy|confidentialit|datenschutz|privacidad|privatezza|informativa|donnees-personnelles|protection-des-donnees|personal-data|privacybeleid|privacyverklaring|gegevensbescherming|dati-personali|datos-personales)/;

/* A path that names a neighbouring document — better than nothing, worse. */
const WEAK_PATH = /(cookie|rgpd|gdpr|tracker|consent)/;

/*
 * A news site publishes articles about privacy, and the first link on the page
 * matching "privacy" is as likely to be a headline as a policy. These are what
 * a headline URL looks like and a policy URL does not.
 */
const ARTICLE_PATH =
  /(\/(?:19|20)\d{2}[/-](?:\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[/-]|\/news\/|\/article|\/story\/|\/live\/|\/video\/|-a-[0-9a-f]{8}|\/\d{6,})/;

/** A nav label is short. A headline is not. */
const LABEL_LIMIT = 60;

/**
 * Score one candidate link. Exported because the ranking is the part of policy
 * discovery that can be wrong in a way nobody notices — a plausible document
 * arrives, gets analysed, and the report is about the wrong page.
 *
 * @param {{href: string, text?: string}} link
 * @param {string|null} [siteHost] the host of the page the link was found on
 */
export function scorePolicyLink(link, siteHost = null) {
  let path = '';
  try {
    const parsed = new URL(link.href);
    /* The host carries the signal as often as the path — datenschutz.zeit.de,
       mentions-legales.lefigaro.fr — and costs nothing to read. */
    /* The query string is excluded on purpose: a subscription funnel that
       carries the page you came from as a parameter would otherwise score as
       the policy you came from. */
    path = `${parsed.host}${parsed.pathname}`.toLowerCase();
    /* A PDF is a policy a browser cannot read into text. */
    if (/\.(?:pdf|docx?|odt|zip|jpe?g|png)$/.test(parsed.pathname.toLowerCase())) return -Infinity;
  } catch {
    return -Infinity;
  }

  const text = String(link.text ?? '').toLowerCase();
  let score = 0;

  /*
   * A site's policy is on the site. Following an off-site link produced the
   * corpus's most embarrassing near-miss: a Belgian publisher behind a
   * Cloudflare interstitial, whose "privacy policy" link led to Cloudflare's
   * own policy — a real document, professionally written, about the wrong
   * company.
   */
  if (siteHost) {
    const same = registrableDomain(hostOf(link.href) ?? '') === registrableDomain(siteHost);
    score += same ? 2 : -6;
  }

  if (STRONG_PATH.test(path)) score += 6;
  else if (WEAK_PATH.test(path)) score += 3;

  if (STRONG_PATH.test(text)) score += 3;
  else if (WEAK_PATH.test(text)) score += 1;

  if (ARTICLE_PATH.test(path)) score -= 9;
  if (text.length > LABEL_LIMIT) score -= 3;
  /* A policy page is a page, not a query parameter on a subscription funnel. */
  try {
    const search = new URL(link.href).search.toLowerCase();
    if (/(redirect|origine|acquisitiondata|intcmp|utm_)/.test(search)) score -= 4;
  } catch {
    /* Already parsed once above; nothing to do. */
  }

  return score;
}

/**
 * Which link leads to the policy.
 *
 * The banner's own policy control is the best answer available: the site chose
 * that document as the answer to the question it is asking. Where the banner
 * offers none, the page's own links are ranked — and ranked rather than taken
 * in order, because on a news homepage the first link containing the word
 * "privacy" is usually an article about somebody else's privacy scandal. That
 * is not a hypothetical: it is what the first run of the corpus recorded for
 * three publishers.
 *
 * @param {object} banner the located banner
 * @param {object} profile the page profile
 * @returns {{url: string|null, via: string, score?: number}}
 */
export function policyUrlFrom(banner, profile) {
  const siteHost = hostOf(profile?.url ?? '') ?? null;
  const fromBanner =
    banner?.controls?.policy?.control?.href ?? banner?.controls?.policy?.href ?? null;
  /*
   * The banner's own link is scored without the same-site preference: a
   * consent platform legitimately hosts the vendor list on its own domain, and
   * the site chose that document as its answer.
   */
  if (fromBanner && scorePolicyLink({ href: fromBanner, text: '' }) > -4) {
    return { url: fromBanner, via: 'banner' };
  }

  const ranked = (profile?.policyLinks ?? [])
    .map((link) => ({ link, score: scorePolicyLink(link, siteHost) }))
    .filter((candidate) => candidate.score >= 4)
    .sort((a, b) => b.score - a.score);

  if (ranked.length > 0) {
    return { url: ranked[0].link.href, via: 'page-link', score: ranked[0].score };
  }
  /* A banner link that scored badly is still the site's own answer, and better
     than nothing once the ranked list has come up empty. */
  if (fromBanner) return { url: fromBanner, via: 'banner-weak' };

  return { url: null, via: 'none' };
}
