/**
 * Rules Injector Hook
 *
 * Automatically injects relevant rule files when Claude accesses files.
 * Supports project-level (.claude/rules, .github/instructions) and
 * user-level rules under [$CLAUDE_CONFIG_DIR|~/.claude].
 *
 * Ported from oh-my-opencode's rules-injector hook.
 */

import { readFileSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';
import { findProjectRoot, findRuleFiles } from './finder.js';
import {
  createContentHash,
  isDuplicateByContentHash,
  isDuplicateByRealPath,
  shouldApplyRule,
} from './matcher.js';
import { parseRuleFrontmatter } from './parser.js';
import {
  commitInjectedRuleReservation,
  clearInjectedRules,
  releaseInjectedRuleReservation,
  reserveInjectedRules,
} from './storage.js';
import { TRACKED_TOOLS } from './constants.js';
import type {
  PlannedRuleToInject,
  RuleToInject,
  RulesInjectionReservation,
} from './types.js';

// Re-export all submodules
export * from './types.js';
export * from './constants.js';
export * from './finder.js';
export * from './parser.js';
export * from './matcher.js';
export * from './storage.js';

/**
 * Create a rules injector hook for Claude Code.
 *
 * @param workingDirectory - The working directory for resolving paths
 * @returns Hook handlers for tool execution
 */
export function createRulesInjectorHook(workingDirectory: string) {
  function resolveFilePath(filePath: string): string | null {
    if (!filePath) return null;
    if (isAbsolute(filePath)) return filePath;
    return resolve(workingDirectory, filePath);
  }

  /**
   * Process a file path and return rules to inject.
   */
  function planFilePathRules(
    filePath: string,
  ): PlannedRuleToInject[] {
    const resolved = resolveFilePath(filePath);
    if (!resolved) return [];

    const projectRoot = findProjectRoot(resolved);
    const plannedContentHashes = new Set<string>();
    const plannedRealPaths = new Set<string>();

    const ruleFileCandidates = findRuleFiles(projectRoot, resolved);
    const toInject: PlannedRuleToInject[] = [];

    for (const candidate of ruleFileCandidates) {
      if (isDuplicateByRealPath(candidate.realPath, plannedRealPaths)) continue;

      try {
        const rawContent = readFileSync(candidate.path, 'utf-8');
        const { metadata, body } = parseRuleFrontmatter(rawContent);

        let matchReason: string;
        if (candidate.isSingleFile) {
          matchReason = 'copilot-instructions (always apply)';
        } else {
          const matchResult = shouldApplyRule(metadata, resolved, projectRoot);
          if (!matchResult.applies) continue;
          matchReason = matchResult.reason ?? 'matched';
        }

        const contentHash = createContentHash(body);
        if (isDuplicateByContentHash(contentHash, plannedContentHashes)) continue;

        const relativePath = projectRoot
          ? relative(projectRoot, candidate.path)
          : candidate.path;

        toInject.push({
          relativePath,
          matchReason,
          content: body,
          distance: candidate.distance,
          contentHash,
          realPath: candidate.realPath,
        });

        plannedRealPaths.add(candidate.realPath);
        plannedContentHashes.add(contentHash);
      } catch {
        // Skip files that can't be read
      }
    }

    if (toInject.length > 0) {
      // Sort by distance (closest first)
      toInject.sort((a, b) => a.distance - b.distance);
    }

    return toInject;
  }

  function commitReservation(
    sessionId: string,
    reservationId: string,
    rules: readonly PlannedRuleToInject[],
  ): void {
    commitInjectedRuleReservation(sessionId, reservationId, rules);
  }

  function releaseReservation(
    sessionId: string,
    reservationId: string,
  ): void {
    releaseInjectedRuleReservation(sessionId, reservationId);
  }

  /**
   * Format one rule as one canonical context item.
   */
  function formatRuleForInjection(rule: RuleToInject): string {
    return `[Rule: ${rule.relativePath}]\n[Match: ${rule.matchReason}]\n${rule.content}`;
  }

  /**
   * Preserve the legacy Claude presentation, including its leading blank line.
   */
  function formatRulesForInjection(
    rules: readonly RuleToInject[],
  ): string {
    return rules
      .map((rule) => `\n\n${formatRuleForInjection(rule)}`)
      .join('');
  }

  return {
    /**
     * Stage matching rules without marking them as delivered.
     */
    planToolExecution: (
      toolName: string,
      filePath: string,
      sessionId: string,
    ): RulesInjectionReservation => {
      if (!TRACKED_TOOLS.includes(toolName.toLowerCase())) {
        return { rules: [] };
      }

      return reserveInjectedRules(
        sessionId,
        planFilePathRules(filePath),
      );
    },

    formatRuleForInjection,
    formatRulesForInjection,
    commitReservation,
    releaseReservation,

    /**
     * Process a tool execution and inject rules if relevant.
     * Kept for direct callers that own delivery synchronously.
     */
    processToolExecution: (
      toolName: string,
      filePath: string,
      sessionId: string
    ): string => {
      if (!TRACKED_TOOLS.includes(toolName.toLowerCase())) {
        return '';
      }

      const reservation = reserveInjectedRules(
        sessionId,
        planFilePathRules(filePath),
      );
      if (!reservation.reservationId) return '';

      try {
        const output = formatRulesForInjection(reservation.rules);
        commitReservation(
          sessionId,
          reservation.reservationId,
          reservation.rules,
        );
        return output;
      } catch (error) {
        try {
          releaseReservation(sessionId, reservation.reservationId);
        } catch {
          // The reservation expires if immediate cleanup is unavailable.
        }
        throw error;
      }
    },

    /**
     * Get rules for a specific file without marking as injected.
     */
    getRulesForFile: (filePath: string): RuleToInject[] => {
      const resolved = resolveFilePath(filePath);
      if (!resolved) return [];

      const projectRoot = findProjectRoot(resolved);

      const ruleFileCandidates = findRuleFiles(projectRoot, resolved);
      const rules: RuleToInject[] = [];

      for (const candidate of ruleFileCandidates) {
        try {
          const rawContent = readFileSync(candidate.path, 'utf-8');
          const { metadata, body } = parseRuleFrontmatter(rawContent);

          let matchReason: string;
          if (candidate.isSingleFile) {
            matchReason = 'copilot-instructions (always apply)';
          } else {
            const matchResult = shouldApplyRule(metadata, resolved, projectRoot);
            if (!matchResult.applies) continue;
            matchReason = matchResult.reason ?? 'matched';
          }

          const relativePath = projectRoot
            ? relative(projectRoot, candidate.path)
            : candidate.path;

          rules.push({
            relativePath,
            matchReason,
            content: body,
            distance: candidate.distance,
          });
        } catch {
          // Skip files that can't be read
        }
      }

      return rules.sort((a, b) => a.distance - b.distance);
    },

    /**
     * Clear session cache when session ends.
     */
    clearSession: (sessionId: string): void => {
      clearInjectedRules(sessionId);
    },

    /**
     * Check if a tool triggers rule injection.
     */
    isTrackedTool: (toolName: string): boolean => {
      return TRACKED_TOOLS.includes(toolName.toLowerCase());
    },
  };
}

/**
 * Get rules for a file path (simple utility function).
 */
export function getRulesForPath(filePath: string, workingDirectory?: string): RuleToInject[] {
  const cwd = workingDirectory || process.cwd();
  const hook = createRulesInjectorHook(cwd);
  return hook.getRulesForFile(filePath);
}
