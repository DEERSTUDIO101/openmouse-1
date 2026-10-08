import { useEffect, useState, type ReactNode } from "react";
import * as control from "../device/controller";
import { t, tp } from "../i18n";
import type { InterfaceLocale } from "../interface-preferences";
import type { AnalogTuning, ControlSnapshot } from "../device/types";
import { BunnyHop } from "./cards/PerformanceCards";

function SuperstrikeSteps({
  id,
  min,
  max,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  min: number;
  max: number;
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}): ReactNode {
  return (
    <div className="superstrike-steps" role="group" aria-label={id.replace("logitech-", "").replaceAll("-", " ")}>
      <input id={id} type="hidden" value={value} readOnly />
      <div>
        {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((step) => (
          <button
            key={step}
            type="button"
            aria-pressed={step === value}
            disabled={disabled}
            onClick={() => onChange(step)}
          >
            {step}
          </button>
        ))}
      </div>
    </div>
  );
}

// Actuation is read on the same 0..10 scale the mouse streams press depth on
// (both derive from the same wire byte), so it lines up on the bar as-is.
function PressMeter({ actuation }: { actuation: [number, number] }): ReactNode {
  const [depth, setDepth] = useState<[number, number]>([0, 0]);
  useEffect(() => {
    control.startAnalogPressStream();
    // The mouse drops the stream on its own after some time (the arm request's
    // one unexplained byte, 0x3c, may be that timeout) and gives no notice, so
    // it is re-armed well before that could hit rather than only once.
    const keepalive = window.setInterval(() => control.startAnalogPressStream(), 20_000);
    const stop = control.subscribeAnalogPress((left, right) => setDepth([left, right]));
    // A right-click test would otherwise pop the browser's own context menu.
    const suppressContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", suppressContextMenu);
    return () => {
      window.clearInterval(keepalive);
      stop();
      control.stopAnalogPressStream();
      window.removeEventListener("contextmenu", suppressContextMenu);
    };
  }, []);
  return (
    <div className="superstrike-press-meters">
      {(["Left", "Right"] as const).map((side, i) => (
        <div key={side} className="superstrike-press-meter" role="meter" aria-label={`${side} press depth`} aria-valuemin={0} aria-valuemax={10} aria-valuenow={depth[i]}>
          <span>{side}</span>
          <div>
            {Array.from({ length: 10 }, (_, step) => (
              <i key={step} data-on={step < depth[i]} data-actuation={step === actuation[i] - 1} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function TuningControls({
  group,
  tuning,
  limits,
  locale,
}: {
  group: "left" | "right" | "both";
  tuning: AnalogTuning;
  limits: { maxActuation: number; maxRapidTrigger: number; maxHaptics: number };
  locale: InterfaceLocale;
}): ReactNode {
  const rows = [
    {
      setting: "actuation" as const,
      label: t(locale, "super.actuation"),
      low: t(locale, "super.shortClick"),
      high: tp(locale, "super.longClick", { max: limits.maxActuation }),
      min: 1,
      max: limits.maxActuation,
      value: tuning.actuation,
    },
    {
      setting: "rapidTrigger" as const,
      label: "Rapid Trigger",
      low: t(locale, "super.fast"),
      high: tp(locale, "super.slow", { max: limits.maxRapidTrigger }),
      min: 1,
      max: limits.maxRapidTrigger,
      value: tuning.rapidTrigger,
    },
    {
      setting: "haptics" as const,
      label: t(locale, "super.clickHaptics"),
      low: t(locale, "super.off0"),
      high: tp(locale, "super.maxFeedback", { max: limits.maxHaptics }),
      min: 0,
      max: limits.maxHaptics,
      value: tuning.haptics,
    },
  ];
  const slug = { actuation: "actuation", rapidTrigger: "rapid-trigger", haptics: "haptics" } as const;
  // Only shown when the mouse reports it; the sensitivity steps grey out while off.
  const rapidTriggerEnabled = tuning.rapidTriggerEnabled;
  return (
    <>
      {rows.map((row) => {
        const steps = (
          <SuperstrikeSteps
            id={`logitech-${group}-${slug[row.setting]}`}
            min={row.min}
            max={row.max}
            value={row.value}
            disabled={row.setting === "rapidTrigger" && rapidTriggerEnabled === false}
            onChange={(next) => control.setAnalogTuningValue(group, row.setting, next)}
          />
        );
        return (
          <div key={row.setting} className="superstrike-control-row">
            <label>
              {row.label} <small>{row.low} <span>{row.high}</span></small>
            </label>
            {row.setting === "rapidTrigger" && rapidTriggerEnabled !== undefined ? (
              // One grid cell, like every other row: the switch sits beside the steps.
              <div className="superstrike-rapid-controls">
                <div
                  id={`logitech-${group}-rapid-trigger-enabled`}
                  className="superstrike-steps superstrike-switch"
                  role="group"
                  aria-label="rapid trigger on or off"
                >
                  <div>
                    {([false, true] as const).map((on) => (
                      <button
                        key={String(on)}
                        type="button"
                        aria-pressed={rapidTriggerEnabled === on}
                        onClick={() => control.setAnalogTuningValue(group, "rapidTriggerEnabled", on)}
                      >
                        {t(locale, on ? "common.on" : "common.off")}
                      </button>
                    ))}
                  </div>
                </div>
                {steps}
              </div>
            ) : steps}
          </div>
        );
      })}
    </>
  );
}

export function Superstrike({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const tuning = snapshot.traits.logitech ? snapshot.status?.analogButtonTuning : undefined;
  if (!tuning || tuning.buttons.length !== 2) return null;
  const locale = snapshot.preferences.locale;
  const state = snapshot.analogTuning;
  // With instant flash on, a step is written the moment it is picked, so there
  // is nothing to apply. A game-profile draft stages instead of flashing.
  const showApply = !snapshot.preferences.instantFlash || snapshot.gameProfileDraft;

  return (
    // A card in the Buttons tab's card list, so the mouse panel sits beside it.
    // The id scopes this card's styles.
    <div id="logitech-analog-button-settings">
      <article className="setting-card superstrike-tuning-card">
        <div className="setting-heading superstrike-tuning-heading"><div><h2>HITS Tuning</h2></div></div>
        <PressMeter actuation={[state.left.actuation, state.right.actuation]} />
        <div className="superstrike-tabs" role="tablist" aria-label="HITS tuning mode">
          {(["both", "independent"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={state.mode === mode}
              onClick={() => control.setAnalogTuningMode(mode)}
            >
              {mode === "both" ? t(locale, "super.both") : t(locale, "super.independent")}
            </button>
          ))}
        </div>
        <div className="superstrike-tuning-panels" data-superstrike-mode={state.mode}>
          <div className="superstrike-tuning-grid superstrike-independent-panel">
            {(["left", "right"] as const).map((side) => (
              <fieldset key={side} className="superstrike-button-card">
                <legend>
                  <span className="superstrike-button-dot" />
                  {side === "left" ? t(locale, "adv.leftButton") : t(locale, "adv.rightButton")}
                </legend>
                <TuningControls group={side} tuning={state[side]} limits={tuning} locale={locale} />
                {showApply ? (
                  <button
                    id={`apply-logitech-${side}-button`}
                    className="superstrike-apply-button"
                    type="button"
                    onClick={() => control.applyLogitechAnalogButton(side === "left" ? 0 : 1)}
                  >
                    {side === "left" ? t(locale, "super.applyLeft") : t(locale, "super.applyRight")}
                  </button>
                ) : null}
              </fieldset>
            ))}
          </div>
          <fieldset className="superstrike-button-card superstrike-both-panel">
            <legend><span className="superstrike-button-dot" />{t(locale, "super.bothPrimary")}</legend>
            <p>{t(locale, "super.bothBody")}</p>
            <TuningControls group="both" tuning={state.both} limits={tuning} locale={locale} />
            {showApply ? (
              <button
                id="apply-logitech-both-buttons"
                className="superstrike-apply-button"
                type="button"
                onClick={control.applyLogitechAnalogButtons}
              >
                {t(locale, "super.applyBoth")}
              </button>
            ) : null}
          </fieldset>
        </div>
        <BunnyHop snapshot={snapshot} />
      </article>
    </div>
  );
}
