// Generated from src/core/harness-launch-spec.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor, HarnessEnvironment } from './contracts';
export interface HarnessLaunchSpec {
    env: HarnessEnvironment;
    argv: string[];
}
export declare function harnessLaunchSpec(descriptor: HarnessDescriptor): HarnessLaunchSpec;
export declare function getPiLaunchSpec(): HarnessLaunchSpec;
