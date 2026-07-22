import type { CanonicalHookEnvelope } from '../hook-protocol.js';
import { type PreToolBatchSnapshot, type PreToolSnapshotDependencies } from './types.js';
/**
 * Load every observation needed by the PreToolUse planner exactly once and
 * freeze the resulting batch snapshot. No planner function performs I/O.
 */
export declare function loadPreToolBatchSnapshot(envelope: CanonicalHookEnvelope, dependencies?: PreToolSnapshotDependencies): PreToolBatchSnapshot;
//# sourceMappingURL=snapshot.d.ts.map