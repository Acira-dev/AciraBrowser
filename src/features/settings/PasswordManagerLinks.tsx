import type { BrowserAction } from '../../runtime/types';
import { SettingRow } from './controls';
import './password-manager-links.css';

import { t } from '../../i18n';
/** Password manager extensions for people who keep a vault elsewhere. Store ids follow Helium's onboarding list
 *  (src/lib/password-managers.ts); guides are each maker's "import from Chrome" page. */
export const passwordManagerExtensions = [
  { id: 'nngceckbapebfimnlniiiahkandclblb', name: 'Bitwarden', guide: 'https://bitwarden.com/help/import-from-chrome/' },
  { id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa', name: '1Password', guide: 'https://support.1password.com/import-chrome/' },
  { id: 'ghmbeldphafepmbegfdlkpapadhbakde', name: 'Proton Pass', guide: 'https://proton.me/support/pass-import-chrome' },
] as const;
export const chromeWebStorePage = (id: string) => `https://chromewebstore.google.com/detail/${id}`;

/** One quiet row for the foot of Settings → Passwords (H's page): each name opens its Chrome Web Store page in a new
 *  tab. The store's own add button can't install in Acira, so the detail names the way that does. Anchor id
 *  `passwords-extensions`; register it in the page's settings entries if it should be searchable. */
export function PasswordManagerLinks({ dispatch }: { dispatch: (action: BrowserAction) => void }) {
  return (
    <SettingRow
      id="passwords-extensions"
      title={t("passwordmanagerlinks.preferAPasswordManagerExtension")}
      detail={t("passwordmanagerlinks.detail")}
      stacked
    >
      {passwordManagerExtensions.map((manager) => (
        <button
          key={manager.id}
          type="button"
          className="acira-button acira-button-quiet pml-link"
          aria-label={t("passwordmanagerlinks.nameOnTheChromeWeb", { name: manager.name })}
          onClick={() => dispatch({ type: 'tab.new', url: chromeWebStorePage(manager.id) })}
        >
          {manager.name}
        </button>
      ))}
    </SettingRow>
  );
}
