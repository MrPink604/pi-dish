import { record } from './helper-values';
export type BounceMode = 'reload' | 'restart';
export interface BounceTarget {
  readonly sessionId: string; readonly name: string; readonly harnessId: string;
  readonly eligible: boolean; readonly reason: string; readonly blockers: readonly string[];
}
export interface BounceResult {
  readonly sessionId: string; readonly name: string; readonly harnessId: string;
  readonly status: string; readonly reason: string; readonly replacementId: string;
}
export interface BounceOperation {
  readonly id: string; readonly mode: BounceMode; readonly createdAt: string | number;
  readonly targets: readonly BounceResult[];
}
const text = (value: unknown) => typeof value === 'string' ? value : '';
export const bounceMode = (value: unknown): BounceMode => value === 'restart' ? 'restart' : 'reload';
export function decodeBouncePreview(value: unknown): readonly BounceTarget[] {
  if (!record(value) || !Array.isArray(value.targets)) throw new Error('Invalid preview response');
  return value.targets.flatMap((target: unknown) => record(target) && typeof target.sessionId === 'string' && target.sessionId ? [{
    sessionId: target.sessionId, name: text(target.name), harnessId: text(target.harnessId), eligible: target.eligible === true,
    reason: text(target.reason), blockers: Array.isArray(target.blockers) ? target.blockers.filter((v): v is string => typeof v === 'string') : [],
  }] : []);
}
export function decodeBounceOperation(value: unknown): BounceOperation {
  if (!record(value) || typeof value.id !== 'string' || !value.id || !Array.isArray(value.targets)
    || (value.mode !== 'reload' && value.mode !== 'restart')) throw new Error('Invalid operation response');
  return { id: value.id, mode: value.mode,
    createdAt: typeof value.createdAt === 'string' || typeof value.createdAt === 'number' ? value.createdAt : '',
    targets: value.targets.flatMap((target: unknown) => record(target) && typeof target.sessionId === 'string' && target.sessionId ? [{
      sessionId: target.sessionId, name: text(target.name), harnessId: text(target.harnessId), status: text(target.status),
      reason: text(target.reason), replacementId: text(target.replacementId),
    }] : []),
  };
}
export function decodeBounceOperations(value: unknown): readonly BounceOperation[] {
  if (!record(value) || !Array.isArray(value.operations)) throw new Error('Invalid operations response');
  return value.operations.map(decodeBounceOperation);
}
