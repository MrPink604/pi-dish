// Generated from src/core/skill-feature-handlers.ts; edit that source and run npm run build:core.
import type { FeaturePorts, FeatureHandlers } from './feature-handlers';
export declare function knownWorkspaceCwds(buildSessionCatalog: FeaturePorts['buildSessionCatalog']): string[];
export declare function createSkillFeatureHandlers(ports: FeaturePorts): Pick<FeatureHandlers, 'skills' | 'skillActivations' | 'skillCoverage'>;
