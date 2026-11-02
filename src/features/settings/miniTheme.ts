import type { CSSProperties } from 'react';
import type { Settings } from '../../runtime/types';
import { studyFinish } from '../../ui/theme';

/** The colors of the current finish in Light or Dark, as the `--cc-*` properties the miniature browser reads. */
export function miniTheme(settings: Settings, dark: boolean): CSSProperties {
  const finish = studyFinish(settings, dark);
  return {
    '--cc-frame': finish['--ed-chrome'],
    '--cc-sheet': finish['--chrome-sheet'],
    '--cc-page': finish['--sheet'],
    '--cc-ink': finish['--ink'],
    '--cc-chrome-ink': finish['--chrome-ink'],
    '--cc-accent': finish['--accent'],
    '--cc-wall': dark ? '#1c1e24' : '#dde2eb',
  } as CSSProperties;
}
