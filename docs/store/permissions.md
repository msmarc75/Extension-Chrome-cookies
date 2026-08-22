# Permissions, and why each one is asked for

The Chrome Web Store asks for a written justification per permission, and a
reviewer reads them beside the code. These are those justifications; they are
also what the extension's own users are owed, so they say what the permission
allows in principle, not only what this extension does with it.

The rule this project applied to itself: **a permission whose only use is a
convenience is not requested.** Two were removed during development for exactly
that reason — `scripting`, which would have needed `<all_urls>` host access to
reach the page's main world, and `downloads`, which the report does not need
because an extension page can hand a file to the browser directly.

---

## `debugger`

**Single purpose: observing the first requests a page makes.**

The measurement this product exists to make is *what a site sends and stores
before the visitor can answer the banner*. That means observing the very first
requests of a page load, and under Manifest V3 `webRequest` does not reliably
see them: the service worker may not be running when they go out, and the
blocking form of the API no longer exists. The Chrome DevTools Protocol's
`Network` domain does see them, and `chrome.debugger` is the only way an
extension can attach it.

What the extension does with it, in one audit:

- attaches to a tab **it opened itself**, before that tab navigates anywhere;
- enables `Network`, `Page` and `Runtime`, and reads what the page does;
- evaluates one expression to read the banner's structure, and one to read the
  policy page's text;
- detaches, always — in a `finally`, under a watchdog, on tab close, and by a
  sweep at every service-worker start for the case where the worker was evicted
  mid-audit.

It never attaches to a tab the user opened. It sends no `Input` command of any
kind: the observation window is invalid if anything touches the page, so there
is no click, no scroll and no keystroke in the audit path at all.

Chrome shows a "Consent Audit started debugging this browser" bar on the audited
window while this is happening. The extension warns the user about that bar
before the first audit rather than letting them discover it.

## `cookies`

Reading which cookies exist after the observation window, and their attributes —
domain, expiry, whether they were set by a response header or by script. That
is half the finding: the other half is *when*, which comes from the protocol.

Cookie **values are never read into the report**. What matters is that something
was written, by whom, and when; the content is the visitor's business.

## `storage`

Three things, all local:

- the audits already run, so a report can be reopened and exported;
- the licence key and the last verification of it;
- the count of audits used this month against the free allowance.

Nothing here is synced and nothing is sent anywhere. In particular the count is
kept locally *on purpose*: enforcing a quota on a server would mean telling that
server every time somebody audits a page, which is a record of their browsing.

## `activeTab`

Reading the URL of the tab the user is looking at when they open the popup, so
the audit has something to audit. It is granted only on that click and expires
with it — which is why the extension asks for it rather than for host access to
every site.

## `host_permissions: https://api.consent-audit.dev/*`

One host, and only for the analysis and licence service:

- the text of a privacy policy, **when the user ticks the box that says so**,
  for the analysis described in `docs/methodology.md`;
- the licence key, to check that it is valid.

No page content leaves the browser otherwise. There is no analytics endpoint, no
error reporting service and no telemetry of any kind in this extension.

## `incognito: spanning`

A first-visit measurement needs a profile that holds none of the site's data.
The alternative — clearing the site's data in the user's own profile — would
destroy something they own in order to measure it, so the audit opens an
incognito window instead.

Chrome only allows this if the user turns on "Allow in Incognito" themselves.
Until they do, the extension says so and offers to audit in the normal profile
instead, labelling the result as a *returning* visit everywhere it appears.

---

## What the extension does not do

- No `<all_urls>` host permission, and no content script on any site.
- No code is fetched or evaluated from a remote source. Everything that runs is
  in the package the store reviewed.
- No account, no sign-in, no user identifier. A licence key is the only thing
  that identifies anything, and it identifies a purchase rather than a person.
- No advertising, no analytics, no fingerprinting — which would be a strange
  thing for this product to do.
