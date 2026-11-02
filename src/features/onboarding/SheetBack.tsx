import { ChevronLeft } from "../../components/AppIcons";
import { t, useT } from "../../i18n";
import "./connection-sheet.css";

/** The way back out of a setup sheet (R4-06): an arrow at the sheet's top-left, the same action as "Back" on its footer and as
 * Esc (shown in the tooltip). Going back never applies anything the sheet was still editing. Every sheet over a setup card
 * uses this one control. */
export function SheetBack({ onClick }: { onClick: () => void }) {
  useT();
  const label = t("setup.back");
  return (
    <button className="fr-btn fr-btn-text fr-sheet-back" type="button" aria-label={label} title={`${label} · Esc`} onClick={onClick}>
      <ChevronLeft size={16} aria-hidden="true" />
    </button>
  );
}
