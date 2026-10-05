import type { HttpMethod } from '../core/types';

export function MethodBadge({ method, small }: { method: HttpMethod | string; small?: boolean }) {
  return (
    <span className={`method method--${method.toLowerCase()}${small ? ' method--sm' : ''}`}>
      {method === 'DELETE' ? 'DEL' : method === 'OPTIONS' ? 'OPT' : method}
    </span>
  );
}
