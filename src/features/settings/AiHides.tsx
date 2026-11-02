import './ai-free.css';

import { t } from '../../i18n';
/** "What it hides" under the AI-free mode switch: one short line per search engine, then what is not covered. The lines come from
 *  the filter itself (aiCoverage, "Engine: surfaces"), so this list never promises more than the filter does. */
export function AiHides({ coverage, on }: { coverage?: string[]; on: boolean }) {
  const rows = (coverage?.length ? coverage : [
    'Google: AI Overviews and the AI Mode button and tab',
    'Bing: Copilot answers and the Copilot buttons',
    'DuckDuckGo: Search Assist answers and the Duck.ai prompt',
    'Brave: AI answers and the Ask button',
  ]).map((line) => { const cut = line.indexOf(':'); return cut > 0 ? { engine: line.slice(0, cut), what: line.slice(cut + 1).trim() } : { engine: line, what: '' }; });
  return <div className="st-row ai-hides" data-on={on || undefined} data-setting="filters-ai-hides">
    <div className="ai-hides-body">
      <span className="ai-hides-title">{t("aihides.whatItHides")}</span>
      <dl className="ai-hides-list">{rows.map((row) => <div key={row.engine}><dt>{row.engine}</dt><dd>{row.what}</dd></div>)}</dl>
      <p className="ai-hides-note">{t("aihides.aciraHidesWhatItRecognizes")}</p>
    </div>
  </div>;
}
