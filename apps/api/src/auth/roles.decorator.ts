import { SetMetadata } from '@nestjs/common';
import type { Capability, ModuleKey } from '../packs/types';

export const CAPABILITIES_KEY = 'capabilities';
export const MODULE_KEY = 'module';

/**
 * What the caller must be allowed to do. Each organisation decides which of
 * its roles hold which capability (ADMIN holds all of them).
 */
export const Requires = (...capabilities: Capability[]) => SetMetadata(CAPABILITIES_KEY, capabilities);

/** The endpoint belongs to an optional module the organisation may switch off. */
export const InModule = (module: ModuleKey) => SetMetadata(MODULE_KEY, module);
