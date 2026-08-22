# Privacy policy — Consent Audit

*Last updated 22 August 2026. This is the policy for the extension itself. It is
published because the Chrome Web Store requires one, and because a tool that
reports other people's privacy practices has no standing to be vague about its
own.*

Written to the same checklist the extension applies to the sites it audits. If
anything below would fail one of its own rules, that is a defect worth reporting.

## Who is responsible

Consent Audit is published by the operator of `consent-audit.dev`, contactable at
`privacy@consent-audit.dev` for any question about this policy or about data
held under it.

## What stays on your computer, which is nearly everything

The extension is a measuring instrument. What it measures stays where it was
measured:

| Data | Where it lives | For how long |
|---|---|---|
| Audits you have run — the requests, cookies, storage writes and findings | `chrome.storage.local`, on this computer | The last 30 audits; older ones are dropped as new ones arrive, and "Forget all audits" removes them at once |
| Which sites you audited | The same, and nowhere else | As above |
| Your licence key and the date it was last checked | The same | Until you remove it |
| How many audits you have used this month | The same | Reset at the start of each calendar month |

None of this is synced to a Google account, sent to a server, or shared. **There
is no analytics, no error reporting and no telemetry in this extension.** The
count of free audits is deliberately kept on your machine: enforcing it on a
server would mean telling that server every time you audit a page, which is a
record of your browsing, and we would rather not have one.

## What leaves your browser, and only then

Two things, both of which you control:

**The text of a privacy policy**, when you tick "Also analyse the privacy
policy" before an audit. The text of that page — the site's document, not
anything of yours — is sent to `api.consent-audit.dev`, read against the
articles of the GDPR, and the result comes back to your browser. The box is
unticked by default and the rest of the audit works without it.

That text is cached on the service, keyed by its SHA-256 hash, so that the same
policy is not analysed twice; the cache holds the policy's own text and the
analysis of it, and nothing about who asked. It is processed by Anthropic's
Claude API under Anthropic's terms as a data processor, and is not used to train
any model.

**Your licence key**, when the extension checks that it is valid — at most once
a week. The check sends the key and nothing else. It does not say which sites
you audited, because the service is never told.

## What the licence service stores

If you buy a licence: the hash of your key, the plan, its status, the dates it
was issued and expires, your email address if you gave one to Stripe, and the
Stripe identifiers needed to handle a refund.

Payment is taken by **Stripe**, on Stripe's own pages. No card details ever
reach this extension or its service. Stripe's privacy policy governs what Stripe
holds.

The legal basis for holding that record is the performance of the contract you
entered into by buying a licence (GDPR art. 6(1)(b)). It is kept for as long as
the licence is live and then for the period French accounting law requires of
the invoice it belongs to.

## What is never collected

- The contents of pages you visit outside an audit.
- Cookie *values* — the extension records that a cookie was written, by whom and
  when, never what was in it.
- Passwords, form contents, or anything you type into a site.
- Any identifier for you personally. The extension has no account and no sign-in.

## Your rights

You can exercise the rights in articles 15 to 21 of the GDPR — access,
rectification, erasure, restriction, objection and portability — at
`privacy@consent-audit.dev`. In practice, for most users, there is nothing held
to exercise them against: everything is on your computer, and "Forget all
audits" in the report and removing the extension delete it.

You may withdraw from the analysis feature at any time simply by not ticking the
box; there is no consent stored for it, because it is asked each time.

You may lodge a complaint with the CNIL (`cnil.fr`) or with the supervisory
authority of the country you live in.

## Changes

The date at the top of this document changes when the document does. A change
that affects what leaves your browser will be described in the extension's
release notes, not only here.
