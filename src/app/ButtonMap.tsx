import { useState, type CSSProperties, type ReactNode } from "react";
import * as control from "../device/controller";
import type { ControlSnapshot } from "../device/types";
import { buttonMapLayoutFor, type ButtonSpot } from "../logitech-button-map";
import { COMMAND_SECTIONS, describeAssignment, isAssigned, type CommandEntry } from "../logitech-commands";
import { connectionText } from "../i18n";
import { BatteryIcon } from "./ui";

type Layer = "primary" | "g-shift";

/** True when this mouse has a known button layout and a profile whose buttons can be written. */
export function buttonMapAvailable(snapshot: ControlSnapshot): boolean {
  const status = snapshot.status;
  return snapshot.traits.logitech
    && status !== null
    && buttonMapLayoutFor(status.name) !== null
    && snapshot.profile.entry !== null
    && snapshot.profileFormat?.writable === true;
}

/**
 * Button assignments as a picture: the mouse with a callout per button. Pick a
 * button, then a command; the change goes through the same staged write as the
 * Profiles tab, so instant flash and the Flash bar behave the same.
 */
export function ButtonMap({ snapshot }: { snapshot: ControlSnapshot }): ReactNode {
  const [layer, setLayer] = useState<Layer>("primary");
  const [selected, setSelected] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  // What the user picked for a staged button, so the callout can say it before the flash.
  const [pending, setPending] = useState<Record<string, string>>({});

  const status = snapshot.status;
  const entry = snapshot.profile.entry;
  const estimate = status ? control.batteryEstimateParts(status, snapshot.preferences.locale) : null;
  const layout = status ? buttonMapLayoutFor(status.name) : null;
  if (!status || !entry || !layout) return null;

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
  const canAssign = selectedSpot !== null && !isLocked(selectedSpot) && !snapshot.settingInProgress;
  const current = selected !== null ? assignmentFor(selected) : undefined;

  const assign = (command: CommandEntry): void => {
    if (!canAssign || selected === null) return;
    const binding = command.target.kind === "action" ? command.target.action : command.target;
    void control.applyLogitechButtonAssignment(layer, selected, binding);
    setPending((previous) => ({ ...previous, [`${layer}-${selected}`]: command.label }));
  };

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
        </div>
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
            <small className="button-map-help" role="status">{help}</small>
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
