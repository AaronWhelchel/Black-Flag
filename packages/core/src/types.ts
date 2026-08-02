/**
 * The Explanation object — the defining contract of the Intelligence Core.
 * Per the Recommendation & Explainability Standard v0.1 (§2):
 * no public function of the core returns a bare number.
 */

export type Confidence = 'high' | 'medium' | 'low';

export interface Quantity {
  value: number;
  unit: string;
}

export interface ReasoningStep {
  /** Named rule or model, e.g. "tidal_gate", "fuel_margin" */
  rule: string;
  /** Human-readable detail, written for a captain — not an engineer */
  detail: string;
  /** Data source + issuance, or vessel-profile field */
  source: string;
}

export interface Alternative<T> {
  option: T;
  rejected_because: string;
}

/** Per input source: issuance/fetch identity that makes staleness renderable. */
export type DataVintage = Record<string, string>;

export interface Explanation<T> {
  recommendation: T;
  confidence: Confidence;
  confidence_factors: string[];
  reasoning: ReasoningStep[];
  alternatives: Alternative<Partial<T>>[];
  /** What this answer does NOT account for. Empty list = code-review flag. */
  caveats: string[];
  data_vintage: DataVintage;
  /** True whenever any input was stale past SLO or outside a validated envelope. */
  degraded: boolean;
  degraded_reasons: string[];
  inputs_hash: string;
  core_version: string;
}

export const CORE_VERSION = '0.1.0';

/** Deterministic FNV-1a content hash of the input snapshot (no crypto dep). */
export function inputsHash(inputs: unknown): string {
  const s = JSON.stringify(inputs);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function explanation<T>(
  inputs: unknown,
  partial: Omit<Explanation<T>, 'inputs_hash' | 'core_version'>,
): Explanation<T> {
  if (partial.caveats.length === 0) {
    // The standard treats an empty caveats list as a review flag; the core
    // refuses to fabricate certainty. Callers must state limits.
    throw new Error('Explanation requires at least one caveat (Explainability Standard §2).');
  }
  return { ...partial, inputs_hash: inputsHash(inputs), core_version: CORE_VERSION };
}
