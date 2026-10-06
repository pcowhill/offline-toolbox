import { describe, expect, it } from 'vitest';
import { createEnvironment, createVariable } from '../factory';
import {
  environmentVariables,
  isOnlyVariableReferences,
  referencedVariables,
  substitute,
  tokenizeVariables,
} from '../variables';

describe('variable substitution', () => {
  const vars = new Map([
    ['baseUrl', 'https://api.example.test'],
    ['version', 'v2'],
    ['nested', '{{baseUrl}}/{{version}}'],
    ['loop', '{{loop}}'],
  ]);

  it('replaces known variables, tolerating whitespace', () => {
    expect(substitute('{{baseUrl}}/users', vars)).toEqual({
      value: 'https://api.example.test/users',
      unresolved: [],
    });
    expect(substitute('{{ baseUrl }}/x', vars).value).toBe('https://api.example.test/x');
  });

  it('reports unresolved variables and leaves them in place', () => {
    const result = substitute('{{baseUrl}}/{{missing}}/{{other}}', vars);
    expect(result.value).toBe('https://api.example.test/{{missing}}/{{other}}');
    expect(result.unresolved).toEqual(['missing', 'other']);
  });

  it('resolves nested variables and does not hang on cycles', () => {
    expect(substitute('{{nested}}', vars).value).toBe('https://api.example.test/v2');
    expect(() => substitute('{{loop}}', vars)).not.toThrow();
  });

  it('supports dynamic variables', () => {
    expect(substitute('{{$timestamp}}', new Map()).value).toMatch(/^\d{10}$/);
    expect(substitute('{{$randomUUID}}', new Map()).value).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('builds a map from enabled environment variables, preferring session values', () => {
    const secret = createVariable({ key: 'token', value: '', persist: false });
    const env = createEnvironment('Dev', [
      createVariable({ key: 'baseUrl', value: 'http://localhost:3000' }),
      createVariable({ key: 'disabled', value: 'x', enabled: false }),
      secret,
    ]);
    const map = environmentVariables(env, { [secret.id]: 's3cr3t' });
    expect(map.get('baseUrl')).toBe('http://localhost:3000');
    expect(map.has('disabled')).toBe(false);
    expect(map.get('token')).toBe('s3cr3t');
  });

  it('switching environment changes the resolved value', () => {
    const dev = createEnvironment('Development', [
      createVariable({ key: 'baseUrl', value: 'http://dev' }),
    ]);
    const test = createEnvironment('Testing', [
      createVariable({ key: 'baseUrl', value: 'http://test' }),
    ]);
    expect(substitute('{{baseUrl}}/a', environmentVariables(dev)).value).toBe('http://dev/a');
    expect(substitute('{{baseUrl}}/a', environmentVariables(test)).value).toBe('http://test/a');
  });

  it('helpers', () => {
    expect(referencedVariables('{{a}} {{ b }} {{a}}')).toEqual(['a', 'b']);
    expect(isOnlyVariableReferences('{{token}}')).toBe(true);
    expect(isOnlyVariableReferences('abc{{token}}')).toBe(false);
    expect(tokenizeVariables('x{{a}}y')).toEqual([
      { text: 'x' },
      { text: '{{a}}', variable: 'a' },
      { text: 'y' },
    ]);
  });

  it('marks sensitive-looking variables as secret and not persisted by default', () => {
    expect(createVariable({ key: 'apiToken' })).toMatchObject({ secret: true, persist: false });
    expect(createVariable({ key: 'baseUrl' })).toMatchObject({ secret: false, persist: true });
  });
});
