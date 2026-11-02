// Every stylesheet of the interface, in the order they have always loaded after the App's own (component) styles.
// main.tsx imports this after the App so the language is known before any screen runs, and the cascade stays what it was.
import './fonts.css';
import './styles.css';
import './shell-references.css';
import './styles/platform.css';
import './styles/selection.css';
import './styles/ux-controls.css';
import './frost-preview.css';
// One button component for every surface; loads after the study so it settles every older button look.
import './styles/buttons.css';
// Subtitles and ledes in IBM Plex Sans, under the Inter display titles.
import './styles/subtitles.css';
// Panels, popovers and menus: one rhythm, rows on the glass, fade-ended separators between groups only.
import './styles/panels.css';
import './styles/frame.css';
import './styles/mac-material.css';
import './styles/kbd.css';
import './styles/rtl.css';
