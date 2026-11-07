// Generated from src/core/skill-feature-handlers.ts; edit that source and run npm run build:core.
import type { FeaturePorts, FeatureHandlers } from './feature-handlers';
import type { CatalogRuntime } from './session-catalog-runtime';
export declare function knownWorkspaceCwds(buildSessionCatalog: CatalogRuntime['buildSessionCatalog']): string[];
export declare function createSkillFeatureHandlers(ports: FeaturePorts): Pick<FeatureHandlers, 'skills' | 'skillActivations' | 'skillCoverage'>;
