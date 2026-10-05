import { ChevronDown, ChevronRight } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import type { JsonNode } from '../core/json';

const PAGE = 200;

function nodeMatches(node: JsonNode, key: string, query: string): boolean {
  if (!query) return false;
  if (key.toLowerCase().includes(query)) return true;
  switch (node.type) {
    case 'string':
      return node.value.toLowerCase().includes(query);
    case 'number':
      return node.raw.includes(query);
    case 'boolean':
      return String(node.value).includes(query);
    case 'null':
      return 'null'.includes(query);
    default:
      return false;
  }
}

/** Paths (JSON-pointer-ish strings) of nodes that match or contain matches. */
function collectMatches(
  node: JsonNode,
  key: string,
  path: string,
  query: string,
  out: Set<string>,
): boolean {
  let found = nodeMatches(node, key, query);
  if (node.type === 'object') {
    for (const [k, child] of node.entries)
      if (collectMatches(child, k, `${path}/${k}`, query, out)) found = true;
  } else if (node.type === 'array') {
    node.items.forEach((child, i) => {
      if (collectMatches(child, String(i), `${path}/${i}`, query, out)) found = true;
    });
  }
  if (found) out.add(path);
  return found;
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

interface TreeProps {
  root: JsonNode;
  query: string;
}

/** Collapsible JSON tree with search. Numbers are shown exactly as received. */
export function JsonTree({ root, query }: TreeProps) {
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    const out = new Set<string>();
    if (q) collectMatches(root, '', '', q, out);
    return out;
  }, [root, q]);
  return (
    <div className="json-tree" role="tree" aria-label="JSON tree" data-testid="json-tree">
      {q && (
        <div className="json-tree__summary muted">
          {matches.size
            ? `Matches highlighted (${matches.size} nodes on match paths)`
            : 'No matches'}
        </div>
      )}
      <TreeNode node={root} name={null} path="" depth={0} query={q} matches={matches} />
    </div>
  );
}

interface NodeProps {
  node: JsonNode;
  name: string | null;
  path: string;
  depth: number;
  query: string;
  matches: Set<string>;
  last?: boolean;
}

const TreeNode = memo(function TreeNode({
  node,
  name,
  path,
  depth,
  query,
  matches,
  last = true,
}: NodeProps) {
  const [open, setOpen] = useState<boolean | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const container = node.type === 'object' || node.type === 'array';
  const forcedOpen = query ? matches.has(path) : null;
  const expanded = open ?? forcedOpen ?? depth < 2;
  const label =
    name === null ? null : (
      <span className="json-tree__key">
        <Highlight text={name} query={query} />
        <span className="json-tree__punct">: </span>
      </span>
    );
  const comma = last ? null : <span className="json-tree__punct">,</span>;

  if (!container) {
    let content;
    switch (node.type) {
      case 'string':
        content = (
          <span className="json-tree__string">
            "<Highlight text={node.value} query={query} />"
          </span>
        );
        break;
      case 'number':
        content = (
          <span className="json-tree__number">
            <Highlight text={node.raw} query={query} />
          </span>
        );
        break;
      case 'boolean':
        content = <span className="json-tree__boolean">{String(node.value)}</span>;
        break;
      default:
        content = <span className="json-tree__null">null</span>;
    }
    return (
      <div className="json-tree__row" role="treeitem" style={{ paddingLeft: depth * 16 + 18 }}>
        {label}
        {content}
        {comma}
      </div>
    );
  }

  const children: Array<[string, JsonNode]> =
    node.type === 'object' ? node.entries : node.items.map((item, i) => [String(i), item]);
  const [openBracket, closeBracket] = node.type === 'object' ? ['{', '}'] : ['[', ']'];
  const summary =
    node.type === 'object'
      ? `${children.length} ${children.length === 1 ? 'key' : 'keys'}`
      : `${children.length} ${children.length === 1 ? 'item' : 'items'}`;

  return (
    <div role="treeitem" aria-expanded={expanded}>
      <div className="json-tree__row" style={{ paddingLeft: depth * 16 }}>
        <button
          type="button"
          className="json-tree__toggle"
          onClick={() => setOpen(!expanded)}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
        </button>
        {label}
        <span className="json-tree__punct">{openBracket}</span>
        {!expanded && (
          <>
            <button type="button" className="json-tree__collapsed" onClick={() => setOpen(true)}>
              {summary}
            </button>
            <span className="json-tree__punct">{closeBracket}</span>
            {comma}
          </>
        )}
      </div>
      {expanded && (
        <>
          <div role="group">
            {children.slice(0, limit).map(([key, child], index) => (
              <TreeNode
                key={key + index}
                node={child}
                name={node.type === 'object' ? key : null}
                path={`${path}/${key}`}
                depth={depth + 1}
                query={query}
                matches={matches}
                last={index === children.length - 1}
              />
            ))}
            {children.length > limit && (
              <div style={{ paddingLeft: (depth + 1) * 16 + 18 }}>
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => setLimit(limit + PAGE * 5)}
                >
                  Show more ({children.length - limit} remaining)
                </button>
              </div>
            )}
          </div>
          <div className="json-tree__row" style={{ paddingLeft: depth * 16 + 18 }}>
            <span className="json-tree__punct">{closeBracket}</span>
            {comma}
          </div>
        </>
      )}
    </div>
  );
});
