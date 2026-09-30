import type { KsnakeMacroProfile } from "@openmouse/protocol/ksnake";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

/** The same three-slot mental model used by the M2-NEX vendor application. */
export const M2NEX_PROFILE_COUNT = 3;
export const M2NEX_PROFILE_STORAGE_KEY = "openmouse.m2-nex.profiles.v1";

export interface M2NexProfile {
  id: number;
  name: string;
  /** The complete DPI stage table, not only the currently active value. */
  dpiStages: number[];
  activeDpiStage: number;
  pollingRateHz: number;
  buttonMappings: Record<string, string>;
  /** Null means this profile has no trustworthy macro table yet. */
  macros: KsnakeMacroProfile[] | null;
}

interface StoredM2NexProfiles {
  version: 1;
  profiles: M2NexProfile[];
}

export type M2NexProfileSeed = Pick<
  MouseStatus,
  "dpi" | "dpiStages" | "activeDpiStage" | "pollingRateHz" | "buttonMappings"
> & {
  macros?: readonly KsnakeMacroProfile[] | null;
};

function cloneMacros(macros: readonly KsnakeMacroProfile[] | null | undefined): KsnakeMacroProfile[] | null {
  if (macros === null || macros === undefined) return null;
  return macros.map((profile) => ({
    steps: profile.steps.map((step) => ({ ...step })),
  }));
}

export function cloneM2NexProfile(profile: M2NexProfile): M2NexProfile {
  return {
    id: profile.id,
    name: profile.name,
    dpiStages: [...profile.dpiStages],
    activeDpiStage: profile.activeDpiStage,
    pollingRateHz: profile.pollingRateHz,
    buttonMappings: { ...profile.buttonMappings },
    macros: cloneMacros(profile.macros),
  };
}

function seedProfile(id: number, seed: M2NexProfileSeed): M2NexProfile {
  const stages = seed.dpiStages?.length ? [...seed.dpiStages] : [seed.dpi];
  return {
    id,
    name: `Profile ${id + 1}`,
    dpiStages: stages,
    activeDpiStage: Math.min(Math.max(seed.activeDpiStage ?? 0, 0), stages.length - 1),
    pollingRateHz: seed.pollingRateHz,
    buttonMappings: { ...(seed.buttonMappings ?? {}) },
    macros: cloneMacros(seed.macros),
  };
}

export function defaultM2NexProfiles(seed: M2NexProfileSeed): M2NexProfile[] {
  return Array.from({ length: M2NEX_PROFILE_COUNT }, (_, id) => seedProfile(id, seed));
}

function validProfile(value: unknown): value is M2NexProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const profile = value as Partial<M2NexProfile>;
  return Number.isInteger(profile.id)
    && typeof profile.name === "string"
    && Array.isArray(profile.dpiStages)
    && profile.dpiStages.length > 0
    && profile.dpiStages.every((dpi) => typeof dpi === "number" && Number.isFinite(dpi))
    && Number.isInteger(profile.activeDpiStage)
    && typeof profile.pollingRateHz === "number"
    && Number.isFinite(profile.pollingRateHz)
    && typeof profile.buttonMappings === "object"
    && profile.buttonMappings !== null
    && Object.values(profile.buttonMappings).every((action) => typeof action === "string")
    && (profile.macros === null || profile.macros === undefined || Array.isArray(profile.macros));
}

function normalizeProfiles(raw: unknown): M2NexProfile[] | null {
  if (!Array.isArray(raw) || raw.length !== M2NEX_PROFILE_COUNT || !raw.every(validProfile)) return null;
  return raw.map((value, id) => {
    const profile = value as M2NexProfile;
    const stages = profile.dpiStages.slice();
    return {
      id,
      name: profile.name.trim() || `Profile ${id + 1}`,
      dpiStages: stages,
      activeDpiStage: Math.min(Math.max(profile.activeDpiStage, 0), stages.length - 1),
      pollingRateHz: profile.pollingRateHz,
      buttonMappings: { ...profile.buttonMappings },
      macros: cloneMacros(profile.macros),
    };
  });
}

/** Load the three profile slots for M2-NEX from browser-local storage. */
export function loadM2NexProfiles(
  storage: Pick<Storage, "getItem">,
  seed: M2NexProfileSeed,
): M2NexProfile[] {
  const defaults = defaultM2NexProfiles(seed);
  try {
    const raw = storage.getItem(M2NEX_PROFILE_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<StoredM2NexProfiles>;
    return parsed.version === 1
      ? normalizeProfiles(parsed.profiles) ?? defaults
      : defaults;
  } catch {
    return defaults;
  }
}

/** Persist all slots together, matching the vendor app's profile-table model. */
export function saveM2NexProfiles(
  storage: Pick<Storage, "setItem">,
  profiles: readonly M2NexProfile[],
): void {
  const payload: StoredM2NexProfiles = {
    version: 1,
    profiles: profiles.map(cloneM2NexProfile),
  };
  try {
    storage.setItem(M2NEX_PROFILE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // The in-memory profile remains usable when browser storage is blocked or full.
  }
}
