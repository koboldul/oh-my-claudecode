/**
 * Rules Storage
 *
 * Persistent, cross-process storage for delivered rules and in-flight
 * delivery reservations.
 */
import type { PlannedRuleToInject, RulesInjectionReservation } from './types.js';
export declare function reserveInjectedRules(sessionId: string, candidates: readonly PlannedRuleToInject[]): RulesInjectionReservation;
export declare function commitInjectedRuleReservation(sessionId: string, reservationId: string, deliveredRules: readonly PlannedRuleToInject[]): void;
export declare function releaseInjectedRuleReservation(sessionId: string, reservationId: string): void;
export declare function loadInjectedRules(sessionId: string): {
    contentHashes: Set<string>;
    realPaths: Set<string>;
};
/**
 * Compatibility writer: merge delivered rules without replacing concurrent
 * reservations or previously committed identities.
 */
export declare function saveInjectedRules(sessionId: string, data: {
    contentHashes: Set<string>;
    realPaths: Set<string>;
}): void;
export declare function clearInjectedRules(sessionId: string): void;
//# sourceMappingURL=storage.d.ts.map