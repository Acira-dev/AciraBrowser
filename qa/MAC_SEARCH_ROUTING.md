# Local Google language repair

The address bar resolved text against the legacy three-engine setting and passed
an already-built URL to the native runtime. This discarded the configured search
template, including Google's `hl`/`lr` preference. The same omission affected
suggestions, modified Enter, and command search. New-tab submission shared the
address-bar callback.

All of those callers now use the profile's effective saved provider list.
Suggestions also name the actual selected provider, including custom shortcuts.
Explicit addresses and their own language parameters are preserved. The global
stock Google template is unchanged. The user's local provider was restored to
stock defaults after a strict `lr=lang_en` experiment narrowed real results
undesirably. English was saved using Google's own display-language control.

`node qa/mac-search-routing.mjs` exercises the mounted Mac controls using owned
intercepted HTTPS pages in a disposable profile. It checks actual outgoing URLs,
normal Enter, suggestions, Alt+Enter, new-tab search, command search, explicit
French URLs, custom shortcuts and profile-specific providers. It does not claim
to reproduce Google's public rankings. Unit regressions live in
`tests/native-core.test.ts`.

A separate bounded live attempt reached Google's unusual-traffic interstitial
and stopped without retries or solving it. A later manual installed-app check,
compared with Chrome Guest, showed English results with the official YouTube
homepage first and Subscribe/Library sitelinks. A stale native page frame cleared
after a normal restart with both tabs preserved; its root cause is not claimed
repaired. The final screenshot and exact scope are in the separate local receipt.
The product-code repair does not rewrite Google cookies, accounts, region,
security settings, or stock defaults.
