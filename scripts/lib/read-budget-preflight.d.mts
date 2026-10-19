export const READ_BUDGET_STATE_FILENAME: 'read-budget-warnings.json';
export const READ_BUDGET_WARNING_RETENTION_SECONDS: number;

export interface ReadBudgetCandidate {
  readonly path: string;
  readonly displayPath: string;
  readonly maxLines: number;
  readonly maxBytes: number;
  readonly mode: 'warn-then-deny' | 'warn' | 'deny';
}

export interface ReadBudgetMeasurement {
  readonly over: boolean;
  readonly lineCount: number;
  readonly byteSize: number;
  readonly trigger: 'bytes' | 'lines';
}

export interface ReadBudgetDecision {
  readonly decision: 'block' | 'warn';
  readonly reason: string;
  readonly path: string;
  readonly lineCount: number;
  readonly byteSize: number;
  readonly trigger: 'bytes' | 'lines';
}

export function prepareReadBudget(args: {
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly config: Readonly<Record<string, unknown>>;
  readonly cwd: string;
}): ReadBudgetCandidate | null;

export function measureReadBudget(
  candidate: ReadBudgetCandidate,
): ReadBudgetMeasurement | null;

export function evaluateReadBudgetObservation(
  candidate: ReadBudgetCandidate,
  measurement: ReadBudgetMeasurement | null,
  warned: boolean,
): ReadBudgetDecision | null;

export function pruneReadBudgetWarnings(
  warned: Readonly<Record<string, unknown>>,
  referenceSec: number,
): Record<string, number>;

export function evaluateReadBudget(args?: {
  readonly toolName?: string;
  readonly toolInput?: unknown;
  readonly stateDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly loadOmcConfig?: () => unknown;
  readonly cwd?: string;
}): ReadBudgetDecision | null;
