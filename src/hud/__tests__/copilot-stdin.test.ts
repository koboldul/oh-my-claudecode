/**
 * Tests for the Copilot CLI statusLine adapter / host-neutral normalization
 * boundary (src/hud/copilot-stdin.ts).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

import {
  adaptCopilotStatusline,
  isCopilotStatuslinePayload,
  normalizeStatuslineStdin,
} from '../copilot-stdin.js';
import type { StatuslineStdin } from '../types.js';

const FIXTURE_PATH = join(
  process.cwd(),
  'src',
  '__tests__',
  'fixtures',
  'hooks',
  'copilot-1.0.72-1',
  'statusLine.json',
);

function loadCopilotFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
}

describe('isCopilotStatuslinePayload', () => {
  it('detects the observed Copilot CLI 1.0.72-1 statusLine fixture', () => {
    expect(isCopilotStatuslinePayload(loadCopilotFixture())).toBe(true);
  });

  it('does not flag a Claude Code statusline payload as Copilot', () => {
    const claudeStdin: StatuslineStdin = {
      cwd: '/tmp/worktree',
      transcript_path: '/tmp/worktree/session.jsonl',
      model: { id: 'claude-sonnet', display_name: 'Claude Sonnet' },
      context_window: { context_window_size: 1000, used_percentage: 10 },
    };

    expect(isCopilotStatuslinePayload(claudeStdin)).toBe(false);
  });

  it('rejects null/non-object input', () => {
    expect(isCopilotStatuslinePayload(null)).toBe(false);
    expect(isCopilotStatuslinePayload(undefined)).toBe(false);
    expect(isCopilotStatuslinePayload('not an object')).toBe(false);
  });
});

describe('adaptCopilotStatusline', () => {
  it('maps common HUD fields from the observed fixture', () => {
    const adapted = adaptCopilotStatusline(loadCopilotFixture());

    expect(adapted.cwd).toBe('<cwd>');
    expect(adapted.transcript_path).toBe('<transcript-path>');
    expect(adapted.model).toEqual({ id: '<model-id>', display_name: '<model-name>' });
    expect(adapted.context_window).toEqual({
      context_window_size: 264000,
      total_input_tokens: 0,
      used_percentage: 0,
    });
  });

  it('preserves host-provided zero metrics rather than dropping them', () => {
    const adapted = adaptCopilotStatusline(loadCopilotFixture());

    expect(adapted.context_window?.total_input_tokens).toBe(0);
    expect(adapted.context_window?.used_percentage).toBe(0);
  });

  it('omits rate_limits and context_window.current_usage when absent from the source', () => {
    const adapted = adaptCopilotStatusline(loadCopilotFixture());

    expect(adapted).not.toHaveProperty('rate_limits');
    expect(adapted.context_window).not.toHaveProperty('current_usage');
  });

  it('prefers current-window fields and preserves current_usage when active-call metrics diverge from cumulative totals', () => {
    const adapted = adaptCopilotStatusline({
      ...loadCopilotFixture(),
      context_window: {
        total_input_tokens: 13,
        total_output_tokens: 4,
        total_cache_read_tokens: 0,
        total_cache_write_tokens: 0,
        total_reasoning_tokens: 0,
        total_tokens: 17,
        context_window_size: 1000000,
        used_percentage: 0.0013,
        remaining_percentage: 99.9987,
        remaining_tokens: 999987,
        last_call_input_tokens: 13,
        last_call_output_tokens: 4,
        current_context_tokens: 132000,
        displayed_context_limit: 264000,
        current_context_used_percentage: 50,
        current_usage: {
          input_tokens: 132000,
          output_tokens: 512,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 2000,
        },
      },
    });

    expect(adapted.context_window).toEqual({
      context_window_size: 264000,
      total_input_tokens: 132000,
      used_percentage: 50,
      current_usage: {
        input_tokens: 132000,
        output_tokens: 512,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 2000,
      },
    });
  });

  it('omits fields entirely when the source payload lacks them', () => {
    const adapted = adaptCopilotStatusline({ version: '1.0.72-1' });

    expect(adapted).not.toHaveProperty('cwd');
    expect(adapted).not.toHaveProperty('transcript_path');
    expect(adapted).not.toHaveProperty('model');
    expect(adapted).not.toHaveProperty('context_window');
    expect(adapted).toEqual({});
  });
});

describe('normalizeStatuslineStdin', () => {
  it('adapts a Copilot statusLine payload', () => {
    const normalized = normalizeStatuslineStdin(loadCopilotFixture());

    expect(normalized.cwd).toBe('<cwd>');
    expect(normalized.model?.id).toBe('<model-id>');
    expect(normalized).not.toHaveProperty('rate_limits');
  });

  it('returns non-Copilot (Claude) payloads unchanged, preserving object identity', () => {
    const claudeStdin: StatuslineStdin = {
      cwd: '/tmp/worktree',
      transcript_path: '/tmp/worktree/session.jsonl',
      model: { id: 'claude-sonnet', display_name: 'Claude Sonnet' },
      context_window: {
        context_window_size: 1000,
        used_percentage: 10,
        current_usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      rate_limits: {
        five_hour: { used_percentage: 5 },
      },
    };

    const normalized = normalizeStatuslineStdin(claudeStdin);

    expect(normalized).toBe(claudeStdin);
    expect(normalized.rate_limits).toEqual({ five_hour: { used_percentage: 5 } });
    expect(normalized.context_window?.current_usage).toEqual({
      input_tokens: 100,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    });
  });
});
