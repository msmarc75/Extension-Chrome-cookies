# Banner detection and refusal, live

38 sites attempted, 38 reached. Platform named in 33. Refusal succeeded in 21. Acceptance succeeded in 21.

> Taken from inside a sandbox whose egress gateway re-terminates TLS, caps the
> browser at TLS 1.2, and may refuse hosts a normal network would allow. Counts
> here are a floor, not a measurement of what these sites do in the wild.

| Site | Platform | Banner | Refusal | Route | Accept |
|---|---|---|---|---|---|
| lemonde | TCF (vendor unidentified) | heuristic | no | — | yes |
| lefigaro | TCF CMP #2 | none | no | — | no |
| leparisien | Didomi | platform-markup | yes | platform-api | yes |
| 20minutes | Didomi | platform-markup | yes | platform-api | yes |
| liberation | Sourcepoint | frame-only | no | — | yes |
| lequipe | Didomi | heuristic | yes | platform-api | no |
| ouest-france | Didomi | platform-markup | yes | platform-api | yes |
| francetvinfo | Didomi | platform-markup | yes | platform-api | no |
| bfmtv | Didomi | platform-markup | yes | platform-api | yes |
| allocine | Didomi | platform-markup | yes | platform-api | yes |
| marmiton | Didomi | platform-markup | yes | platform-api | yes |
| boursorama | Didomi | platform-markup | yes | platform-api | yes |
| doctissimo | Didomi | platform-markup | yes | platform-api | yes |
| journaldunet | TCF CMP #2 | none | no | — | no |
| futura-sciences | TCF CMP #388 | frame-only | no | — | no |
| linternaute | TCF CMP #2 | none | no | — | no |
| programme-tv | Sourcepoint | platform-markup | yes | button | yes |
| sudouest | Didomi | platform-markup | yes | platform-api | yes |
| ladepeche | Didomi | platform-markup | yes | platform-api | yes |
| seloger | No known consent platform | none | no | — | no |
| theguardian | Sourcepoint | platform-markup | no | — | no |
| bbc | Sourcepoint | none | no | — | no |
| independent | Sourcepoint | frame-only | no | — | no |
| telegraph | No known consent platform | none | no | — | no |
| spiegel | Sourcepoint | platform-markup | no | — | no |
| zeit | Sourcepoint | platform-markup | yes | button-second-layer | yes |
| heise | Sourcepoint | platform-markup | yes | button-second-layer | yes |
| focus | Sourcepoint | none | no | — | yes |
| elpais | Didomi | heuristic | yes | platform-api | yes |
| elmundo | Didomi | platform-markup | yes | platform-api | yes |
| corriere | TCF (vendor unidentified) | heuristic | yes | button | no |
| repubblica | TCF CMP #123 | heuristic | yes | button | yes |
| nu-nl | No known consent platform | none | no | — | no |
| standaard | Didomi | platform-markup | yes | platform-api | yes |
| irishtimes | OneTrust | platform-markup | yes | platform-api | yes |
| cnil | tarteaucitron.js | none | no | — | no |
| wikipedia | No known consent platform | none | no | — | no |
| gov-uk | No known consent platform | heuristic | no | button+trusted | no |
