import { createPortal } from 'react-dom';
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Check, ChevronDown } from '../../components/AppIcons';
import {SettingInfo} from '../../components/SettingInfo';
import { t, translateText } from '../../i18n';
import { macKeys } from '../../i18n/platform';
import { isMac } from '../../ui/platform';

/** Acira Settings controls. No native <select> or switch chrome. Styles live in settings.css. */

export function Switch({ checked, onChange, label, disabled, id }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean; id?: string }) {
  return (
    <button id={id} type="button" role="switch" className="st-switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
      <span aria-hidden="true" />
    </button>
  );
}

export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
}

const LIST_MAX = 288;

export function Select<T extends string | number>({ value, options, onChange, label, disabled, id }: { value: T; options: readonly SelectOption<T>[]; onChange: (value: T) => void; label: string; disabled?: boolean; id?: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const openedScroll = useRef(new Map<Element, {top: number; left: number}>());
  const typed = useRef({ text: '', at: 0 });
  const uid = useId();
  const selected = Math.max(0, options.findIndex((option) => option.value === value));
  const current = options[selected];

  const show = () => {
    if (disabled) return;
    setActive(selected);
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  };
  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    close();
  };

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    // Settings panes are scroll/size containers. Keep the list outside that
    // scroller and express its position in the Settings root's coordinates.
    const host = trigger.current.closest<HTMLElement>('.browser-settings');
    const origin = host?.getBoundingClientRect();
    const left = origin?.left ?? 0, top = origin?.top ?? 0;
    const right = Math.min(window.innerWidth, origin?.right ?? window.innerWidth);
    const bottom = Math.min(window.innerHeight, origin?.bottom ?? window.innerHeight);
    const height = Math.min(LIST_MAX, options.length * 34 + 12);
    const below = bottom - rect.bottom - 8;
    const above = rect.top - Math.max(0, top) - 8;
    const up = below < height && above > below;
    const room = Math.max(0, Math.min(height, up ? above : below));
    // Clamp the actual list width, not an assumed 200px: at enlarged interface
    // sizes that assumption shifted a 120px list away from its trigger.
    const width = Math.max(rect.width, list.current?.getBoundingClientRect().width ?? 0);
    setBox({ position: host ? 'absolute' : 'fixed', left: Math.max(8, Math.min(rect.left - left, right - left - width - 8)), minWidth: rect.width, maxHeight: room, ...(up ? { bottom: (origin?.bottom ?? window.innerHeight) - rect.top + 6 } : { top: rect.bottom - top + 6 }) });
    openedScroll.current.clear();
    for (let node: Element | null = trigger.current.parentElement; node; node = node.parentElement) openedScroll.current.set(node, {top: node.scrollTop, left: node.scrollLeft});
    list.current?.focus({ preventScroll: true });
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    const dismissScroll = (event: Event) => {
      if (list.current?.contains(event.target as Node)) return;
      const node = event.target instanceof Element ? event.target : document.scrollingElement;
      const before = node && openedScroll.current.get(node);
      // Focusing/clicking an offscreen trigger can queue its scroll event before
      // the list opens. Only a NEW scroll movement should dismiss the list.
      if (before && node && node.scrollTop === before.top && node.scrollLeft === before.left) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    document.addEventListener('scroll', dismissScroll, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
      document.removeEventListener('scroll', dismissScroll, true);
    };
  }, [open]);

  useEffect(() => {
    const root = list.current, item = root?.querySelector<HTMLElement>('[data-active="true"]');
    if (!open || !root || !item) return;
    // scrollIntoView also scrolls ancestors, which dismisses this very list.
    if (item.offsetTop < root.scrollTop) root.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > root.scrollTop + root.clientHeight) root.scrollTop = item.offsetTop + item.offsetHeight - root.clientHeight;
  }, [open, active]);

  const onTriggerKey = (event: KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      show();
    }
  };
  const onListKey = (event: KeyboardEvent) => {
    const last = options.length - 1;
    if (event.key === 'ArrowDown') setActive((index) => Math.min(last, index + 1));
    else if (event.key === 'ArrowUp') setActive((index) => Math.max(0, index - 1));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(last);
    else if (event.key === 'Enter' || event.key === ' ') choose(active);
    else if (event.key === 'Escape') close();
    else if (event.key === 'Tab') {
      // The list is portalled to the end of Settings. Resume normal traversal
      // from its trigger, rather than swallowing Tab or jumping from the portal.
      close();
      event.stopPropagation();
      return;
    }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at > 700 ? '' : typed.current.text) + event.key.toLowerCase(), at: now };
      const hit = options.findIndex((option) => option.label.toLowerCase().startsWith(typed.current.text));
      if (hit >= 0) setActive(hit);
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const host = trigger.current?.closest<HTMLElement>('.browser-settings');
  // Stay out of layout on the first commit, before the layout effect measures
  // the trigger. A static portal briefly becomes a third Settings flex column
  // and measures the trigger in that squeezed layout.
  const optionsList = <ul ref={list} id={`${uid}-list`} role="listbox" tabIndex={-1} aria-label={label} aria-activedescendant={`${uid}-o${active}`} className="st-select-list" style={{ position: host ? 'absolute' : 'fixed', ...box }} onKeyDown={onListKey}>
          {options.map((option, index) => (
            <li key={String(option.value)} id={`${uid}-o${index}`} role="option" aria-selected={index === selected} data-active={index === active} onPointerEnter={() => setActive(index)} onClick={() => choose(index)}>
              <span>
                {option.label}
                {option.hint && <small>{option.hint}</small>}
              </span>
              {index === selected && <Check size={15} />}
            </li>
          ))}
        </ul>;

  return (
    <div className="st-select">
      <button
        ref={trigger}
        id={id}
        type="button"
        className="st-select-trigger"
        aria-label={`${label}: ${current?.label ?? ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKey}
      >
        <span>{current?.label}</span>
        <ChevronDown size={15} />
      </button>
      {open && (host ? createPortal(optionsList, host) : optionsList)}
    </div>
  );
}

/** One setting: title + detail on the left, control on the right. `id` is the registry anchor. */
export function SettingRow({ id, title, detail, info, children, stacked }: { id?: string; title: string; detail?: string; info?: string; children?: ReactNode; stacked?: boolean }) {
  const mac = isMac();
  return (
    <div className="st-row" data-setting={id} data-stacked={stacked || undefined}>
      <div className="st-copy">
        <span className="st-title">{mac ? macKeys(title) : title}{info && <SettingInfo text={info}/>}</span>
        {detail && <p>{mac ? macKeys(detail) : detail}</p>}
      </div>
      {children && <div className="st-control">{children}</div>}
    </div>
  );
}

export function SettingGroup({ title, children, id, bodyRef, fold, foldDetail }: { title?: string; children: ReactNode; id?: string; /** The rows' container, for list motion (useFlip). */ bodyRef?: Ref<HTMLDivElement>; /** A rarely used group: its title is a row that opens it, closed until then (needs a title). Search and links still open it. */ fold?: boolean; /** One line under a folded group's title. */ foldDetail?: string }) {
  const heading = useId();
  if (fold && title) {
    return (
      <section className="st-group st-fold" data-group={id} data-setting={id} data-form-item>
        {/* Its ::details-content height transition already moves everything
            below it. The generic disclosure spring would move those rows a
            second time and sweep them through this section's text. */}
        <details className="st-fold-details" data-no-disclosure-motion>
          <summary>
            <span className="st-fold-copy">
              <h2 id={heading}>{title}</h2>
              {foldDetail && <p>{foldDetail}</p>}
            </span>
            <span className="st-fold-chevron" aria-hidden="true"><ChevronDown size={15} /></span>
          </summary>
          <div className="st-group-body" ref={bodyRef}>{children}</div>
        </details>
      </section>
    );
  }
  return (
    <section className="st-group" aria-labelledby={title ? heading : undefined} data-group={id} data-setting={id} data-form-item>
      {title && <h2 id={heading}>{title}</h2>}
      <div className="st-group-body" ref={bodyRef}>{children}</div>
    </section>
  );
}

export function SettingNote({ children }: { children: ReactNode }) {
  return <p className="st-note" data-form-item>{children}</p>;
}

/** Opens a registry setting wherever it lives (BrowserSettings provides it: the same jump Settings search uses). */
export const SettingsNavContext = createContext<(settingId: string) => void>(() => {});

/** A setting people look for in two places (R3-74): its home is `section`; this row, in the other place, names it and opens it. */
export function SettingCrossLink({ to, section, title }: { to: string; section: string; title: string }) {
  const go = useContext(SettingsNavContext);
  return (
    <SettingRow id={`also-${to}`} title={title} detail={t('settings.alsoIn', { section: translateText(section) })}>
      <button type="button" className="st-button" aria-label={`${t('app.open')}: ${title}`} onClick={() => go(to)}>{t('app.open')}</button>
    </SettingRow>
  );
}
