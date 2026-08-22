# Banner detection over the corpus

38 fixtures. Platform named in 29. Banner located in 22. A refusal control found in 10.

> Taken from inside a sandbox whose egress gateway re-terminates TLS, caps the
> browser at TLS 1.2, and may refuse hosts a normal network would allow. Counts
> here are a floor, not a measurement of what these sites do in the wild.

| Fixture | Platform | Confidence | Banner | Refuse label | Accept label |
|---|---|---|---|---|---|
| 20minutes | Didomi | certain | platform-markup | refuser et s abonner | accepter et fermer |
| allocine | Didomi | certain | platform-markup | — | — |
| bbc | Sourcepoint | certain | none | — | — |
| bfmtv | Didomi | certain | platform-markup | continuer sans accepter | accepter et fermer |
| boursorama | Didomi | certain | platform-markup | continuer sans accepter | tout accepter |
| cnil | tarteaucitron.js | certain | none | — | — |
| corriere | TCF (vendor unidentified) | certain | heuristic | rifiuta e abbonati | accetta e continua |
| doctissimo | Didomi | certain | platform-markup | — | j accepte tout |
| elmundo | Didomi | certain | platform-markup | rechazar y suscribirse | aceptar y continuar |
| elpais | No known consent platform | none | none | — | — |
| focus | Sourcepoint | certain | platform-markup | — | — |
| francetvinfo | No known consent platform | none | none | — | — |
| futura-sciences | TCF CMP #388 | certain | frame-only | — | — |
| gov-uk | No known consent platform | none | heuristic | reject additional cookies | accept additional cookies |
| heise | Sourcepoint | certain | platform-markup | — | — |
| independent | Sourcepoint | certain | frame-only | — | — |
| irishtimes | OneTrust | certain | platform-markup | — | i accept |
| journaldunet | TCF CMP #2 | certain | frame-only | — | — |
| ladepeche | Didomi | certain | platform-markup | refuser et s abonner | accepter et fermer |
| lefigaro | TCF CMP #2 | certain | none | — | — |
| lemonde | TCF (vendor unidentified) | certain | heuristic | — | accepter et continuer |
| leparisien | Didomi | certain | platform-markup | s abonner et refuser les cookies | accepter |
| lequipe | Didomi | certain | heuristic | — | oui j accepte |
| liberation | No known consent platform | none | none | — | — |
| linternaute | TCF CMP #2 | certain | frame-only | — | — |
| marmiton | Didomi | certain | platform-markup | — | j accepte tout |
| nu-nl | No known consent platform | none | none | — | — |
| ouest-france | Didomi | certain | none | — | — |
| programme-tv | Sourcepoint | certain | platform-markup | — | — |
| repubblica | TCF CMP #123 | certain | heuristic | rifiuta e abbonati | accetta |
| seloger | No known consent platform | none | none | — | — |
| spiegel | Sourcepoint | certain | platform-markup | — | — |
| standaard | No known consent platform | none | none | — | — |
| sudouest | Didomi | certain | platform-markup | refuser et s abonner | accepter et continuer |
| telegraph | No known consent platform | none | none | — | — |
| theguardian | Sourcepoint | certain | platform-markup | — | — |
| wikipedia | No known consent platform | none | none | — | — |
| zeit | Sourcepoint | certain | platform-markup | — | — |

## Evidence

### 20minutes

- URL: https://www.20minutes.fr/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7; markup didomi on div#didomi-popup
- Banner: platform-markup, confidence certain
- Controls: accept=accepter et fermer, refuse=refuser et s abonner, preferences=—, policy=—

### allocine

- URL: https://www.allocine.fr/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7; markup didomi on div#didomi-popup
- Banner: platform-markup, confidence certain
- Controls: accept=—, refuse=—, preferences=—, policy=politique de cookies

### bbc

- URL: https://www.bbc.com/
- Platform: Sourcepoint (certain)
- Evidence: window._sp_; window._sp_queue; TCF cmpId 6
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### bfmtv

- URL: https://www.bfmtv.com/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7; markup didomi on div#didomi-popup
- Banner: platform-markup, confidence certain
- Controls: accept=accepter et fermer, refuse=continuer sans accepter, preferences=parametrer vos choix, policy=politique de confidentialite

### boursorama

- URL: https://www.boursorama.com/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7; markup didomi on div#didomi-popup
- Banner: platform-markup, confidence certain
- Controls: accept=tout accepter, refuse=continuer sans accepter, preferences=—, policy=politique de cookies

### cnil

- URL: https://www.cnil.fr/fr
- Platform: tarteaucitron.js (certain)
- Evidence: window.tarteaucitron
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### corriere

- URL: https://www.corriere.it/
- Platform: TCF (vendor unidentified) (certain)
- Evidence: window.__tcfapi
- Banner: heuristic, confidence likely
- Disclosure: TCF (vendor unidentified) was identified, but its banner was located by appearance rather than by its own markup.
- Controls: accept=accetta e continua, refuse=rifiuta e abbonati, preferences=—, policy=cookie policy

### doctissimo

- URL: https://www.doctissimo.fr/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7; markup didomi on div#didomi-popup
- Banner: platform-markup, confidence certain
- Controls: accept=j accepte tout, refuse=—, preferences=parametrer, policy=—

### elmundo

- URL: https://www.elmundo.es/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7; markup didomi on div#didomi-popup
- Banner: platform-markup, confidence certain
- Controls: accept=aceptar y continuar, refuse=rechazar y suscribirse, preferences=—, policy=—

### elpais

- URL: https://elpais.com/us/
- Platform: No known consent platform (none)
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### focus

- URL: https://www.focus.de/
- Platform: Sourcepoint (certain)
- Evidence: window._sp_; window._sp_queue; TCF cmpId 35; markup sp_message on div#sp_message_container_1456518
- Banner: platform-markup, confidence certain
- Controls: accept=—, refuse=—, preferences=—, policy=—

### francetvinfo

- URL: https://www.franceinfo.fr/
- Platform: No known consent platform (none)
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### futura-sciences

- URL: https://www.futura-sciences.com/
- Platform: TCF CMP #388 (certain)
- Evidence: window.__tcfapi
- Banner: frame-only, confidence none
- Disclosure: The banner is rendered inside a separate frame, which this capture could not read into. Its contents were not examined.
- Controls: accept=—, refuse=—, preferences=—, policy=—

### gov-uk

- URL: https://www.gov.uk/
- Platform: No known consent platform (none)
- Banner: heuristic, confidence heuristic
- Disclosure: No known consent platform was identified. The banner was located by appearance and by what its buttons say, so these findings are weaker than usual.
- Controls: accept=accept additional cookies, refuse=reject additional cookies, preferences=—, policy=—

### heise

- URL: https://www.heise.de/
- Platform: Sourcepoint (certain)
- Evidence: window._sp_; window._sp_queue; TCF cmpId 6; markup sp_message on div#sp_message_container_1454968
- Banner: platform-markup, confidence certain
- Controls: accept=—, refuse=—, preferences=—, policy=—

### independent

- URL: https://www.independent.co.uk/us
- Platform: Sourcepoint (certain)
- Evidence: window._sp_; window._sp_queue; TCF cmpId 6
- Banner: frame-only, confidence none
- Disclosure: The banner is rendered inside a separate frame, which this capture could not read into. Its contents were not examined.
- Controls: accept=—, refuse=—, preferences=—, policy=—

### irishtimes

- URL: https://www.irishtimes.com/
- Platform: OneTrust (certain)
- Evidence: window.OneTrust; window.Optanon; window.OptanonWrapper; TCF cmpId 28; markup onetrust on div#onetrust-consent-sdk > div.onetrust-pc-dark-filter.ot-fade-in; markup ot-sdk on div#onetrust-group-container
- Banner: platform-markup, confidence certain
- Controls: accept=i accept, refuse=—, preferences=manage settings, policy=cookie policy

### journaldunet

- URL: https://www.journaldunet.com/
- Platform: TCF CMP #2 (certain)
- Evidence: window.__tcfapi
- Banner: frame-only, confidence none
- Disclosure: The banner is rendered inside a separate frame, which this capture could not read into. Its contents were not examined.
- Controls: accept=—, refuse=—, preferences=—, policy=—

### ladepeche

- URL: https://www.ladepeche.fr/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7; markup didomi on div#didomi-popup
- Banner: platform-markup, confidence certain
- Controls: accept=accepter et fermer, refuse=refuser et s abonner, preferences=—, policy=—

### lefigaro

- URL: https://www.lefigaro.fr/
- Platform: TCF CMP #2 (certain)
- Evidence: window.__tcfapi
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### lemonde

- URL: https://www.lemonde.fr/
- Platform: TCF (vendor unidentified) (certain)
- Evidence: window.__tcfapi
- Banner: heuristic, confidence likely
- Disclosure: TCF (vendor unidentified) was identified, but its banner was located by appearance rather than by its own markup.
- Controls: accept=accepter et continuer, refuse=—, preferences=—, policy=—

### leparisien

- URL: https://www.leparisien.fr/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7; markup didomi on div#didomi-popup
- Banner: platform-markup, confidence certain
- Controls: accept=accepter, refuse=s abonner et refuser les cookies, preferences=—, policy=—

### lequipe

- URL: https://www.lequipe.fr/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7
- Banner: heuristic, confidence likely
- Disclosure: Didomi was identified, but its banner was located by appearance rather than by its own markup.
- Controls: accept=oui j accepte, refuse=—, preferences=parametrer mon consentement, policy=politique de confidentialite

### liberation

- URL: https://www.liberation.fr/
- Platform: No known consent platform (none)
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### linternaute

- URL: https://www.linternaute.com/
- Platform: TCF CMP #2 (certain)
- Evidence: window.__tcfapi
- Banner: frame-only, confidence none
- Disclosure: The banner is rendered inside a separate frame, which this capture could not read into. Its contents were not examined.
- Controls: accept=—, refuse=—, preferences=—, policy=—

### marmiton

- URL: https://www.marmiton.org/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7; markup didomi on div#didomi-popup
- Banner: platform-markup, confidence certain
- Controls: accept=j accepte tout, refuse=—, preferences=parametrer, policy=—

### nu-nl

- URL: https://myprivacy.dpgmedia.nl/consent?siteKey=ucf98legs1caotgh&callbackUrl=https%3A%2F%2Fwww.nu.nl%2Fprivacy-gate%2Faccept%3FredirectUri%3D%252F&isLoggedIn=false
- Platform: No known consent platform (none)
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### ouest-france

- URL: https://www.ouest-france.fr/
- Platform: Didomi (certain)
- Evidence: window.didomiOnReady
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### programme-tv

- URL: https://www.programme-tv.net/
- Platform: Sourcepoint (certain)
- Evidence: window._sp_; window._sp_queue; TCF cmpId 6; markup sp_message on div#sp_message_container_1460331
- Banner: platform-markup, confidence certain
- Controls: accept=—, refuse=—, preferences=—, policy=—

### repubblica

- URL: https://www.repubblica.it/
- Platform: TCF CMP #123 (certain)
- Evidence: window.__tcfapi
- Banner: heuristic, confidence likely
- Disclosure: TCF CMP #123 was identified, but its banner was located by appearance rather than by its own markup.
- Controls: accept=accetta, refuse=rifiuta e abbonati, preferences=—, policy=—

### seloger

- URL: https://www.seloger.com/
- Platform: No known consent platform (none)
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### spiegel

- URL: https://www.spiegel.de/
- Platform: Sourcepoint (certain)
- Evidence: window._sp_; window._sp_queue; TCF cmpId 6; markup sp_message on div#sp_message_container_1426772
- Banner: platform-markup, confidence certain
- Controls: accept=—, refuse=—, preferences=—, policy=—

### standaard

- URL: https://www.standaard.be/
- Platform: No known consent platform (none)
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### sudouest

- URL: https://www.sudouest.fr/
- Platform: Didomi (certain)
- Evidence: window.Didomi; window.didomiOnReady; TCF cmpId 7; markup didomi on div#didomi-popup
- Banner: platform-markup, confidence certain
- Controls: accept=accepter et continuer, refuse=refuser et s abonner, preferences=—, policy=—

### telegraph

- URL: https://www.telegraph.co.uk/
- Platform: No known consent platform (none)
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### theguardian

- URL: https://www.theguardian.com/us
- Platform: Sourcepoint (certain)
- Evidence: window._sp_; window._sp_queue; markup sp_message on div#sp_message_container_1498198
- Banner: platform-markup, confidence certain
- Controls: accept=—, refuse=—, preferences=—, policy=—

### wikipedia

- URL: https://www.wikipedia.org/
- Platform: No known consent platform (none)
- Banner: none, confidence none
- Controls: accept=—, refuse=—, preferences=—, policy=—

### zeit

- URL: https://www.zeit.de/index
- Platform: Sourcepoint (certain)
- Evidence: window._sp_; window._sp_queue; TCF cmpId 6; markup sp_message on div#sp_message_container_1476394
- Banner: platform-markup, confidence certain
- Controls: accept=—, refuse=—, preferences=—, policy=—

