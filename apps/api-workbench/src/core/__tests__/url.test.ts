import { describe, expect, it } from 'vitest';
import { createKeyValue } from '../factory';
import {
  buildFinalUrl,
  ensureScheme,
  paramsFromUrl,
  parseQuery,
  splitUrl,
  urlWithParams,
} from '../url';

describe('URL and query parameters', () => {
  it('splits base, query and fragment', () => {
    expect(splitUrl('http://h/p?a=1&b=2#frag')).toEqual({
      base: 'http://h/p',
      query: 'a=1&b=2',
      hash: '#frag',
    });
    expect(splitUrl('http://h/p')).toEqual({ base: 'http://h/p', query: null, hash: '' });
  });

  it('parses and decodes query strings', () => {
    expect(parseQuery('a=1&b=hello%20world&flag&c=x%3Dy')).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: 'hello world' },
      { key: 'flag', value: '' },
      { key: 'c', value: 'x=y' },
    ]);
    expect(parseQuery('bad=%E0%A4%A')).toEqual([{ key: 'bad', value: '%E0%A4%A' }]);
  });

  it('syncs URL edits into params while keeping disabled rows', () => {
    const disabled = createKeyValue({ key: 'debug', value: '1', enabled: false });
    const first = createKeyValue({ key: 'a', value: '1' });
    const params = paramsFromUrl('http://h/?a=2&b=3', [first, disabled]);
    expect(params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['a', '2', true],
      ['b', '3', true],
      ['debug', '1', false],
    ]);
    expect(params[0].id).toBe(first.id);
  });

  it('syncs param edits into a readable URL', () => {
    const params = [
      createKeyValue({ key: 'q', value: 'hello world & more' }),
      createKeyValue({ key: 'off', value: 'x', enabled: false }),
      createKeyValue({ key: 'id', value: '{{userId}}' }),
    ];
    expect(urlWithParams('http://h/search?old=1#top', params)).toBe(
      'http://h/search?q=hello world %26 more&id={{userId}}#top',
    );
    expect(urlWithParams('http://h/search?old=1', [])).toBe('http://h/search');
  });

  it('round-trips special characters through URL bar and table', () => {
    const params = [createKeyValue({ key: 'a=b', value: '50%&#' })];
    const url = urlWithParams('http://h/', params);
    expect(paramsFromUrl(url, []).map((p) => [p.key, p.value])).toEqual([['a=b', '50%&#']]);
  });

  it('builds a fully encoded final URL', () => {
    expect(
      buildFinalUrl('api.example.test/v1/items', [
        { key: 'q', value: 'a b/ü' },
        { key: 'tag', value: '' },
      ]),
    ).toBe('http://api.example.test/v1/items?q=a%20b%2F%C3%BC&tag');
    expect(() => buildFinalUrl('http://', [])).toThrow(/not a valid URL/);
    expect(() => buildFinalUrl('ftp://host/file', [])).toThrow(/Only http/);
  });

  it('adds a default scheme', () => {
    expect(ensureScheme('localhost:8080/x')).toBe('http://localhost:8080/x');
    expect(ensureScheme('https://x')).toBe('https://x');
  });
});
