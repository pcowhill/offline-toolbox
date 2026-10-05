// {{variable}} substitution.
import { createId } from '@shared/lib/id';
import type { Environment } from './types';

export const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export type VariableMap = Map<string, string>;

/** Built-in dynamic variables, evaluated at send time. */
const DYNAMIC: Record<string, () => string> = {
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomUUID: () => createId(),
  $guid: () => createId(),
  $randomInt: () => String(Math.floor(Math.random() * 1001)),
};

export const DYNAMIC_VARIABLE_NAMES = Object.keys(DYNAMIC);

/**
 * Builds the variable lookup for an environment. `sessionValues` holds values of variables
 * that are not persisted (kept in memory only); they take precedence over stored values.
 */
export function environmentVariables(
  environment: Environment | undefined,
  sessionValues: Record<string, string> = {},
): VariableMap {
  const map: VariableMap = new Map();
  for (const variable of environment?.variables ?? []) {
    const key = variable.key.trim();
    if (!variable.enabled || !key) continue;
    map.set(key, sessionValues[variable.id] ?? variable.value);
  }
  return map;
}

export interface SubstitutionResult {
  value: string;
  unresolved: string[];
}

/**
 * Replaces {{name}} references. Values may themselves reference variables (resolved up to a
 * small depth so cycles cannot hang the UI). Unknown references are left untouched and
 * reported in `unresolved`.
 */
export function substitute(input: string, variables: VariableMap, depth = 0): SubstitutionResult {
  const unresolved = new Set<string>();
  const value = input.replace(VARIABLE_PATTERN, (match, rawName: string) => {
    const name = rawName.trim();
    if (variables.has(name)) {
      const inner = variables.get(name) ?? '';
      if (depth < 5 && inner.includes('{{')) {
        const nested = substitute(inner, variables, depth + 1);
        nested.unresolved.forEach((n) => unresolved.add(n));
        return nested.value;
      }
      return inner;
    }
    const dynamic = DYNAMIC[name];
    if (dynamic) return dynamic();
    unresolved.add(name);
    return match;
  });
  return { value, unresolved: [...unresolved] };
}

/** Names referenced in a string, in order of first appearance. */
export function referencedVariables(input: string): string[] {
  const names = new Set<string>();
  for (const match of input.matchAll(VARIABLE_PATTERN)) names.add(match[1].trim());
  return [...names];
}

/** True when the string consists solely of variable references (e.g. "{{token}}"). */
export function isOnlyVariableReferences(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed.replace(VARIABLE_PATTERN, '').trim() === '';
}

/** Splits text into literal and variable segments, for highlighting in the UI. */
export function tokenizeVariables(input: string): Array<{ text: string; variable?: string }> {
  const parts: Array<{ text: string; variable?: string }> = [];
  let last = 0;
  for (const match of input.matchAll(VARIABLE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: input.slice(last, index) });
    parts.push({ text: match[0], variable: match[1].trim() });
    last = index + match[0].length;
  }
  if (last < input.length) parts.push({ text: input.slice(last) });
  return parts;
}
