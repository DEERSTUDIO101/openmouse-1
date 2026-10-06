import { factoryDirectoryForFormat } from "@openmouse/protocol/drivers/logitech/onboard-profiles";
import type { MouseStatus } from "@openmouse/protocol/drivers/mouse-types";

/** The sector size of the only factory image captured so far (format 8). */
const CAPTURED_FACTORY_SECTOR_SIZE = 255;

/**
 * Whether OpenMouse can give this mouse the factory onboard profiles. A factory
 * image exists only for the profile format whose sectors were captured:
 * `factoryDirectoryForFormat` returns null for every other format and sector
 * size. `supportsFactoryReset` is the wrong question here because it is also true
 * for profile format 7, whose factory sectors were never captured — the client
 * would then refuse after the user had already confirmed a flash write.
 *
 * The client re-checks the mouse's own sector size before it writes, so this only
 * decides whether the button is offered at all.
 */
export function hasCapturedFactoryProfiles(
  format: MouseStatus["onboardProfileFormat"] | null | undefined,
): boolean {
  return format != null
    && factoryDirectoryForFormat(format.id, CAPTURED_FACTORY_SECTOR_SIZE) !== null;
}
