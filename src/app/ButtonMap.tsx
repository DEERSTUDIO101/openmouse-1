import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import * as control from "../device/controller";
import { LOGITECH_MOUSE_BUTTON_MASK, type LogitechButtonAction } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import type { ControlSnapshot } from "../device/types";
import { buttonMapLayoutFor, type ButtonSpot } from "../logitech-button-map";
import { COMMAND_SECTIONS, bindingFromKeyEvent, conflictHints, describeAssignment, isAssigned, shortcutText, type CommandEntry } from "../logitech-commands";
import { connectionText } from "../i18n";
import { SetupCodeDialog } from "./SetupCodeDialog";
import { BatteryIcon } from "./ui";

type Layer = "primary" | "g-shift";

/** A key or shortcut (key, modifiers) or a mouse click (mouse, the button mask), with the pause before it. */
interface MacroStep { key?: number; modifiers?: number; mouse?: number; delayMs: number; label: string }

// Browser MouseEvent.button values, as the macro's button mask and the action's name.
const MOUSE_BUTTONS: Record<number, { mask: number; label: string }> = {
  0: { mask: LOGITECH_MOUSE_BUTTON_MASK.left, label: "Left click" },
  1: { mask: LOGITECH_MOUSE_BUTTON_MASK.middle, label: "Middle click" },
  2: { mask: LOGITECH_MOUSE_BUTTON_MASK.right, label: "Right click" },
  3: { mask: LOGITECH_MOUSE_BUTTON_MASK.back, label: "Back" },
  4: { mask: LOGITECH_MOUSE_BUTTON_MASK.forward, label: "Forward" },
};

/** What each unlocked button does out of the box; G-Shift starts with nothing on them. */
const DEFAULT_ACTION: Record<number, CommandEntry["label"]> = { 2: "Middle click", 3: "Back", 4: "Forward" };

function hasButtonMap(snapshot: ControlSnapshot): boolean {
  const status = snapshot.status;
  return snapshot.traits.logitech
    && status !== null
    && buttonMapLayoutFor(status.name) !== null
    && snapshot.profile.entry !== null
    && snapshot.profileFormat?.writable === true;
}

// While a flash runs, the profile is briefly unreadable. The card keeps showing the
// last good state for that mouse instead of vanishing and coming back.
let lastGood: ControlSnapshot | null = null;

function stableSnapshot(snapshot: ControlSnapshot): ControlSnapshot | null {
  if (hasButtonMap(snapshot)) {
    lastGood = snapshot;
    return snapshot;
  }
  return snapshot.settingInProgress && lastGood?.status?.name === snapshot.status?.name ? lastGood : null;
}

/**
 * On the Host profile the mouse runs from software and has no stored profile
 * open, so there is nothing to assign yet. The card then stays, with a way back.
 */
function onHostProfile(snapshot: ControlSnapshot): boolean {
  const status = snapshot.status;
  return snapshot.traits.logitech
    && status !== null
    && buttonMapLayoutFor(status.name) !== null
    && snapshot.editedProfile === "host"
    && (snapshot.onboardProfiles?.length ?? 0) > 0;
}

/** True when this mouse has a known button layout and a profile whose buttons can be written, or the Host profile is open on one that does. */
export function buttonMapAvailable(snapshot: ControlSnapshot): boolean {
  return stableSnapshot(snapshot) !== null || onHostProfile(snapshot);
}

function HostProfileNotice({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const profiles = snapshot.onboardProfiles ?? [];
  const target = profiles.find((profile) => profile.isCurrent) ?? profiles[0];
  return (
    <div id="logitech-button-map">
      <article className="setting-card superstrike-tuning-card button-map-card button-map-host">
        <div className="setting-heading superstrike-tuning-heading"><div><h2>Button assignments</h2></div></div>
        <p className="setting-description">
          You are on the Host profile, which runs from software. Button assignments and Bunny Hop are stored in the
          mouse's onboard profiles, so open one to edit them.
        </p>
        {target ? (
          <button type="button" className="connect-button" onClick={() => control.openOnboardProfile(target.sector)}>
            Open {control.describeProfileEntry(target).name}
          </button>
        ) : null}
      </article>
    </div>
  );
}

/**
 * Button assignments as a picture: the mouse with a callout per button. Pick a
 * button, then a command; the change goes through the same staged write as the
 * Profiles tab, so instant flash and the Flash bar behave the same.
 */
export function ButtonMap({ snapshot: live }: { snapshot: ControlSnapshot }): ReactNode {
  const snapshot = stableSnapshot(live) ?? live;
  const [layer, setLayer] = useState<Layer>("primary");
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  // What the user picked for a staged button, so the callout can say it before the flash.
  const [pending, setPending] = useState<Record<string, string>>({});
  // "key" assigns the first key pressed; "macro" collects a sequence until it is finished.
  const [recording, setRecording] = useState<false | "key" | "macro">(false);
  const [macro, setMacro] = useState<MacroStep[]>([]);
  const lastKeyAt = useRef(0);
  const [sharing, setSharing] = useState(false);

  const recordable = selected !== null && !(selected <= 1 && layer === "primary") && !live.settingInProgress;
  useEffect(() => {
    if (!recording || !recordable || selected === null) return;
    const onKey = (event: KeyboardEvent): void => {
      event.preventDefault();
      // A bare Escape cancels; Ctrl+Esc and the like are still recordable.
      if (event.code === "Escape" && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        setRecording(false);
        setMacro([]);
        return;
      }
      const binding = bindingFromKeyEvent(event);
      if (!binding || binding.kind !== "keyboard") return;
      if (recording === "macro") {
        const now = performance.now();
        const delayMs = lastKeyAt.current === 0 ? 0 : Math.min(0xffff, Math.round(now - lastKeyAt.current));
        lastKeyAt.current = now;
        setMacro((steps) => [...steps, { key: binding.key, modifiers: binding.modifiers, delayMs, label: shortcutText(binding.key, binding.modifiers) }]);
        return;
      }
      void control.applyLogitechButtonAssignment(layer, selected, binding);
      setPending((previous) => ({ ...previous, [`${layer}-${selected}`]: shortcutText(binding.key, binding.modifiers) }));
      setRecording(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, recordable, selected, layer]);

  const status = snapshot.status;
  const entry = snapshot.profile.entry;
  const estimate = status ? control.batteryEstimateParts(status, snapshot.preferences.locale) : null;
  const layout = status ? buttonMapLayoutFor(status.name) : null;
  if (!status || !entry || !layout) return onHostProfile(live) ? <HostProfileNotice snapshot={live} /> : null;

  const assignments = layer === "primary" ? entry.buttonAssignments : entry.gShiftAssignments;
  const assignmentFor = (button: number) => assignments.find((assignment) => assignment.button === button);
  const isLocked = (spot: ButtonSpot): boolean => spot.locked && layer === "primary";
  const textFor = (spot: ButtonSpot): string => {
    const staged = snapshot.stagedProfileButtonAssignments.find((item) => item.layer === layer && item.button === spot.button);
    if (staged) return pending[`${layer}-${spot.button}`] ?? "Pending";
    const assignment = assignmentFor(spot.button);
    return assignment ? describeAssignment(assignment.action, assignment.raw) : "-";
  };

  const selectedSpot = layout.spots.find((spot) => spot.button === selected) ?? null;
  const canAssign = selectedSpot !== null && !isLocked(selectedSpot) && !live.settingInProgress;
  const current = selected !== null ? assignmentFor(selected) : undefined;

  const assign = (command: CommandEntry): void => {
    if (!canAssign || selected === null) return;
    const binding = command.target.kind === "action" ? command.target.action : command.target;
    void control.applyLogitechButtonAssignment(layer, selected, binding);
    setPending((previous) => ({ ...previous, [`${layer}-${selected}`]: command.label }));
  };

  const defaultFor = (button: number): LogitechButtonAction => (layer === "primary" ? DEFAULT_ACTION[button] : "Disabled") as LogitechButtonAction;
  const reset = async (buttons: number[]): Promise<void> => {
    for (const button of buttons) {
      await control.applyLogitechButtonAssignment(layer, button, defaultFor(button));
      setPending((previous) => ({ ...previous, [`${layer}-${button}`]: defaultFor(button) }));
    }
  };
  const unlocked = layout.spots.filter((spot) => !isLocked(spot)).map((spot) => spot.button);

  const finishMacro = (): void => {
    if (selected === null || macro.length === 0) {
      setRecording(false);
      setMacro([]);
      return;
    }
    const [only] = macro;
    if (macro.length === 1 && only.mouse !== undefined) {
      // One click is just the button's own action, no macro needed.
      void control.applyLogitechButtonAssignment(layer, selected, only.label as LogitechButtonAction);
    } else if (macro.length === 1) {
      void control.applyLogitechButtonAssignment(layer, selected, { kind: "keyboard", key: only.key ?? 0, modifiers: only.modifiers ?? 0 });
    } else {
      void control.applyLogitechKeyboardSequence(layer, selected, macro.map((step) => (step.mouse !== undefined
        ? { mouseButtons: step.mouse, delayMs: step.delayMs }
        : { key: step.key ?? 0, modifiers: step.modifiers ?? 0, delayMs: step.delayMs })));
    }
    setPending((previous) => ({ ...previous, [`${layer}-${selected}`]: macro.length === 1 ? macro[0].label : `${macro.length}-key macro` }));
    setRecording(false);
    setMacro([]);
  };
  const hints = layer === "primary" ? conflictHints(layout.spots.map((spot) => ({ label: spot.label, text: textFor(spot) }))) : [];

  const needle = query.trim().toLowerCase();
  const sections = COMMAND_SECTIONS
    .map((section) => ({
      ...section,
      entries: section.entries.filter((command) => !needle
        || command.label.toLowerCase().includes(needle)
        || (command.hint ?? "").toLowerCase().includes(needle)),
    }))
    .filter((section) => section.entries.length > 0);

  const help = selectedSpot === null
    ? "Pick a button on the mouse, then a command."
    : isLocked(selectedSpot)
      ? "Primary and secondary click are locked so you cannot lose control of the mouse."
      : `Pick a command for ${selectedSpot.label}.`;

  return (
    <div id="logitech-button-map">
      <article className="setting-card superstrike-tuning-card button-map-card">
        <div className="setting-heading superstrike-tuning-heading button-map-heading">
          <div><h2>Button assignments</h2></div>
          <div className="button-map-status" aria-label="Device status">
            <strong>{status.name}</strong>
            {status.connectionType ? <span>{connectionText(snapshot.preferences.locale, status.connectionType)}</span> : null}
            {status.batteryPercent !== null ? (
              <span title={estimate ? `${estimate.time} ${estimate.label}` : undefined}>
                <BatteryIcon percent={status.batteryPercent} state={status.batteryState} />{status.batteryPercent}%
                {estimate ? ` · ${estimate.time}` : ""}
              </span>
            ) : null}
          </div>
          <button type="button" className="icon-button button-map-share" onClick={() => setSharing(true)}>Share setup</button>
        </div>
        <SetupCodeDialog open={sharing} snapshot={snapshot} onClose={() => setSharing(false)} />
        <div className="button-map-body">
          <aside className="button-map-commands" aria-label="Commands">
            <input
              type="search"
              className="button-map-search"
              placeholder="Search commands"
              aria-label="Search commands"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <button
              type="button"
              className="button-map-record"
              aria-pressed={recording === "key"}
              disabled={!canAssign || recording === "macro"}
              onClick={() => setRecording((mode) => (mode === "key" ? false : "key"))}
            >
              {recording === "key" ? "Press a key or shortcut... (Esc cancels)" : "Record a key or shortcut"}
            </button>
            <button
              type="button"
              className="button-map-record"
              aria-pressed={recording === "macro"}
              disabled={!canAssign || recording === "key"}
              onClick={() => {
                if (recording === "macro") finishMacro();
                else {
                  setMacro([]);
                  lastKeyAt.current = 0;
                  setRecording("macro");
                }
              }}
            >
              {recording === "macro"
                ? (macro.length ? `Done: assign ${macro.length} ${macro.length === 1 ? "key" : "keys"}` : "Press keys in order... (Esc cancels)")
                : "Record a macro"}
            </button>
            {recording === "macro" ? (
              <div
                className="button-map-click-pad"
                onMouseDown={(event) => {
                  event.preventDefault();
                  const button = MOUSE_BUTTONS[event.button];
                  if (!button) return;
                  const now = performance.now();
                  const delayMs = lastKeyAt.current === 0 ? 0 : Math.min(0xffff, Math.round(now - lastKeyAt.current));
                  lastKeyAt.current = now;
                  setMacro((steps) => [...steps, { mouse: button.mask, delayMs, label: button.label }]);
                }}
                // Back and Forward would otherwise navigate the browser; a right click would open its menu.
                onMouseUp={(event) => event.preventDefault()}
                onAuxClick={(event) => event.preventDefault()}
                onContextMenu={(event) => event.preventDefault()}
              >
                Click here with any mouse button to add it
              </div>
            ) : null}
            {recording === "macro" && macro.length ? <small className="button-map-help">{macro.map((step) => step.label).join(", ")}</small> : null}
            <div className="button-map-reset">
              <button type="button" disabled={!canAssign} onClick={() => void reset([selected as number])}>Reset button</button>
              <button type="button" disabled={live.settingInProgress} onClick={() => void reset(unlocked)}>Reset all</button>
            </div>
            <small className="button-map-help" role="status">{help}</small>
            <div className="button-map-list">
            {sections.map((section) => (
              <section key={section.id} className="button-map-section">
                <h3>{section.title}</h3>
                {section.entries.map((command) => (
                  <button
                    key={command.id}
                    type="button"
                    className="button-map-command"
                    aria-pressed={current ? isAssigned(command, current.action, current.raw) : false}
                    disabled={!canAssign}
                    onClick={() => assign(command)}
                  >
                    <span>{command.label}</span>
                    {command.hint ? <small>{command.hint}</small> : null}
                  </button>
                ))}
              </section>
            ))}
            {sections.length === 0 ? <small className="button-map-help">No command matches.</small> : null}
            </div>
          </aside>
          <div className="button-map-stage">
            <div className="button-map-canvas" style={{ "--aspect": layout.aspect } as CSSProperties}>
              {snapshot.deviceArtwork ? <img className="button-map-art" src={snapshot.deviceArtwork} alt={status.name} /> : null}
              {layout.spots.map((spot) => (
                <div
                  key={spot.button}
                  className={`button-map-spot is-${spot.side}${selected === spot.button ? " is-selected" : ""}${isLocked(spot) ? " is-locked" : ""}`}
                  style={{ "--sx": spot.x, "--sy": spot.y } as CSSProperties}
                >
                  <span className="button-map-line" aria-hidden="true" />
                  <button
                    type="button"
                    className="button-map-dot"
                    aria-label={`Select ${spot.label}`}
                    onClick={() => setSelected(spot.button)}
                  />
                  <button type="button" className="button-map-label" onClick={() => setSelected(spot.button)}>
                    <strong>{spot.label}</strong>
                    <span>{textFor(spot)}</span>
                  </button>
                </div>
              ))}
            </div>
            {hints.length ? <ul className="button-map-hints" role="status">{hints.map((hint) => <li key={hint}>{hint}</li>)}</ul> : null}
            <div className="button-map-layers" role="tablist" aria-label="Button layer">
              <button type="button" role="tab" aria-selected={layer === "primary"} onClick={() => setLayer("primary")}>Standard</button>
              <button type="button" role="tab" aria-selected={layer === "g-shift"} onClick={() => setLayer("g-shift")}>G-Shift</button>
            </div>
          </div>
        </div>
      </article>
    </div>
  );
}
