import { useEffect, useRef, useState, type ReactNode } from "react";
import { t } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";
import { decodeHitsCode, presetFits, type HitsButtonValues, type HitsLimits, type HitsPreset } from "../hits-presets";

function describe(values: HitsButtonValues): string {
  const rapid = values.rapidTriggerEnabled ? `rapid trigger ${values.rapidTrigger}` : "rapid trigger off";
  return `actuation ${values.actuation}, ${rapid}, haptics ${values.haptics}`;
}

/** Paste a HITS code, see what it holds, and load it (and optionally save it under a name). */
export function ImportHitsCodeDialog({
  open,
  limits,
  locale,
  onClose,
  onImport,
}: {
  open: boolean;
  limits: HitsLimits;
  locale: InterfaceLocale;
  onClose: () => void;
  onImport: (preset: Pick<HitsPreset, "left" | "right">, name: string) => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    if (!open) {
      setText("");
      setName("");
    }
  }, [open]);

  const decoded = text.trim() ? decodeHitsCode(text) : null;
  const fits = decoded !== null && presetFits(decoded, limits);
  const problem = !text.trim() ? null
    : !decoded ? "That is not a valid HITS code."
      : !fits ? "That code has values this mouse cannot do."
        : null;

  return (
    <dialog
      ref={dialog}
      className="support-dialog share-profile-dialog"
      aria-labelledby="import-hits-dialog-title"
      onClose={onClose}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <div className="support-dialog-inner share-profile-dialog-inner">
        <header>
          <div>
            <p className="overline">HITS Tuning</p>
            <h2 id="import-hits-dialog-title">Import code</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={t(locale, "common.close")}>×</button>
        </header>
        <div className="profile-key-fields">
          <label className="profile-key-field">
            <span>HITS code</span>
            <textarea
              rows={3}
              placeholder="HITS1-…"
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              autoFocus
            />
          </label>
          {problem ? <small className="setting-description" role="alert">{problem}</small> : null}
          {decoded && fits ? (
            <small className="setting-description" role="status">
              Left: {describe(decoded.left)}. Right: {describe(decoded.right)}.
            </small>
          ) : null}
          <label className="profile-key-field">
            <span>Save as a preset (optional)</span>
            <input
              type="text"
              value={name}
              maxLength={40}
              placeholder="Name"
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <div className="import-hits-actions">
            <button
              type="button"
              className="connect-button"
              disabled={!decoded || !fits}
              onClick={() => {
                if (!decoded || !fits) return;
                onImport(decoded, name);
              }}
            >
              {t(locale, "set.import")}
            </button>
            <button type="button" className="connect-button" onClick={onClose}>
              {t(locale, "common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
