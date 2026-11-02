import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HandoffBody } from "../import-export/PasswordHandoff";
import { usePasswordHandoff } from "../passwords/handoff";
import { useT } from "../../i18n";
import { useSheetModal } from "./sheetModal";

/** "Bring your passwords" over the import step: how to export from the old browser, the file, the summary and the Recycle Bin
 *  reminder. It covers the card like the other sheets (Escape or Done closes it); the passwords themselves go straight into
 *  the vault, so setup never holds one. */
export function PasswordsSheet({ from, reducedMotion, onClose }: { from?: string; reducedMotion: boolean; onClose: () => void }) {
  const t = useT();
  const [card, setCard] = useState<HTMLElement | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const closed = useRef(onClose);
  closed.current = onClose;
  const handoff = usePasswordHandoff();
  useEffect(() => setCard(anchor.current?.closest<HTMLElement>(".fr-card") ?? null), []);
  useSheetModal(card);
  // Escape closes; Enter closes unless it is pressing a button (the sheet owns both ahead of setup's own keys).
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Enter") return;
      event.stopImmediatePropagation();
      if (event.key === "Enter" && (event.target as HTMLElement | null)?.closest?.("button")) return;
      event.preventDefault();
      closed.current();
    };
    window.addEventListener("keydown", keys, true);
    return () => window.removeEventListener("keydown", keys, true);
  }, []);
  const node = (
    <div className="fr-sheet" role="dialog" aria-modal="true" aria-labelledby="fr-passwords-title">
      <div className="fr-sheet-main">
        <h2 id="fr-passwords-title" className="fr-sheet-title">
          {t("handoff.title")}
        </h2>
        <p className="fr-sheet-line">{t("handoff.intro")}</p>
        <HandoffBody handoff={handoff} from={from} variant="setup" reducedMotion={reducedMotion} />
      </div>
      <footer className="fr-foot">
        <div className="fr-foot-start" />
        <span />
        <div className="fr-foot-end">
          <button className="fr-btn fr-btn-primary" type="button" autoFocus onClick={onClose}>
            {t("setup.done")}
          </button>
        </div>
      </footer>
    </div>
  );
  return (
    <>
      <span ref={anchor} hidden />
      {card && createPortal(node, card)}
    </>
  );
}
