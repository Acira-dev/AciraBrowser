# Local Reader dependencies

Only the directly used browser sources and full licenses are vendored. No runtime download, remote extraction or AI processing occurs.

- Mozilla Readability 0.6.0 source: `Readability.js`, unmodified from commit `ab4027a8b37669745016869a37a504727992b2ba`. Apache-2.0; see readability/LICENSE.md. Upstream package metadata is retained for version/license provenance.
  https://github.com/mozilla/readability/blob/ab4027a8b37669745016869a37a504727992b2ba/Readability.js
- DOMPurify 3.4.17 source: `purify.min.js`, unmodified from signed release commit `a77a3e78b59f72fa4d1c83f22e121ad9cc7d3575`. Apache-2.0 OR MPL-2.0; full dual-license text is dompurify/LICENSE.txt. This distribution uses the Apache-2.0 option.
  https://github.com/cure53/DOMPurify/releases/tag/3.4.17

Both are executed only in the owned website's isolated engine world. Acira's adapter sanitizes an extracted DOM clone to a restricted inert text/semantic-tag allowlist; images and active resource tags are excluded. A successful extraction does not claim support for every paywall, document type or dynamic article layout.
