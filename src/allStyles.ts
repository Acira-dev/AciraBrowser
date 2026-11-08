// Every stylesheet of the interface, in the order they have always loaded after the App's own (component) styles.
// main.tsx imports this after the App so the language is known before any screen runs, and the cascade stays what it was.
import './fonts.css';
import './styles.css';
import './shell-references.css';
import './styles/platform.css';
import './styles/fullscreen-lights.css';
import './styles/selection.css';
import './styles/ux-controls.css';
import './frost-preview.css';
// One button component for every surface; loads after the study so it settles every older button look.
import './styles/buttons.css';
// Subtitles and ledes: the subtitle weight and tracking, in Inter like the titles above them.
import './styles/subtitles.css';
// Panels, popovers and menus: one rhythm, rows on the glass, fade-ended separators between groups only.
import './styles/panels.css';
import './styles/frame.css';
import './styles/mac-material.css';
// Site tint study (dev flag only): re-points the frame's variables while html[data-site-tint] is set.
import './styles/site-tint.css';
// Site glow (item 19): the open site's colour glowing into the frame behind the sidebar; nothing is drawn until main reads a colour.
import './styles/site-glow.css';
import './styles/kbd.css';
import './styles/rtl.css';
// The sidebar on the right: gated on the root's data-sidebar-side, after every layout rule it overrides. It sets places and mirrors, no ink, so it loads before tab-ink.css.
import './styles/sidebar-right.css';
// Tab glow (item 11): the site colour round the selected and a hovered tab. Its selectors are more specific than the rows' own, and the tab ink below still loads last.
import './styles/tab-glow.css';
// Tab ink on the light cards (current sidebar row, current compact tab, carried tabs): last, so it settles every surface above.
import './styles/tab-ink.css';
