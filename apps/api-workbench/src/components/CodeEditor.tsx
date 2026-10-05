import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  MatchDecorator,
  placeholder as placeholderExtension,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';

export type EditorLanguage = 'json' | 'xml' | 'html' | 'text';

const highlightStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: 'var(--syntax-key)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: [tags.bool, tags.atom], color: 'var(--syntax-boolean)' },
  { tag: tags.null, color: 'var(--syntax-null)' },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: 'var(--syntax-punct)' },
  { tag: [tags.tagName, tags.angleBracket], color: 'var(--syntax-tag)' },
  { tag: tags.attributeName, color: 'var(--syntax-attr)' },
  { tag: tags.attributeValue, color: 'var(--syntax-string)' },
  { tag: tags.comment, color: 'var(--text-faint)', fontStyle: 'italic' },
  { tag: tags.keyword, color: 'var(--syntax-boolean)' },
]);

const theme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12.5px',
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text)',
  },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text-faint)',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent-soft) 45%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent) !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-searchMatch': {
    backgroundColor: 'var(--warning-soft)',
    outline: '1px solid var(--warning)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--warning) 45%, transparent)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    borderColor: 'var(--border)',
  },
  '.cm-panel.cm-search': { padding: '6px 8px', fontFamily: 'var(--font-sans)' },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': { fontFamily: 'var(--font-sans)' },
  '.cm-textfield': {
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'var(--bg-active)',
    border: 'none',
    color: 'var(--text-muted)',
  },
  '.cm-tooltip': { backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-placeholder': { color: 'var(--text-faint)' },
  '.cm-template-variable': {
    color: 'var(--accent)',
    backgroundColor: 'var(--accent-soft)',
    borderRadius: '3px',
  },
});

const variableMatcher = new MatchDecorator({
  regexp: /\{\{\s*[^{}]+?\s*\}\}/g,
  decoration: Decoration.mark({ class: 'cm-template-variable' }),
});

const variableHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = variableMatcher.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = variableMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

function languageExtension(language: EditorLanguage, lint: boolean): Extension {
  switch (language) {
    case 'json':
      return lint ? [json(), linter(jsonParseLinter(), { delay: 400 }), lintGutter()] : json();
    case 'xml':
      return xml();
    case 'html':
      return html();
    default:
      return [];
  }
}

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language?: EditorLanguage;
  readOnly?: boolean;
  /** Highlight {{variables}}. */
  variables?: boolean;
  lint?: boolean;
  placeholder?: string;
  lineWrapping?: boolean;
  ariaLabel: string;
  testId?: string;
}

/** CodeMirror 6 editor (syntax highlighting, folding, search with Ctrl/Cmd+F, linting). */
export function CodeEditor({
  value,
  onChange,
  language = 'text',
  readOnly = false,
  variables = false,
  lint = false,
  placeholder,
  lineWrapping = false,
  ariaLabel,
  testId,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const compartments = useRef({
    language: new Compartment(),
    readOnly: new Compartment(),
    wrap: new Compartment(),
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const c = compartments.current;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          codeFolding(),
          drawSelection(),
          history(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          syntaxHighlighting(highlightStyle),
          keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          theme,
          variables ? variableHighlighter : [],
          placeholder ? placeholderExtension(placeholder) : [],
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
          c.language.of(languageExtension(language, lint)),
          c.readOnly.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          c.wrap.of(lineWrapping ? EditorView.lineWrapping : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; props are synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.language.reconfigure(languageExtension(language, lint)),
    });
  }, [language, lint]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.readOnly.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.wrap.reconfigure(lineWrapping ? EditorView.lineWrapping : []),
    });
  }, [lineWrapping]);

  return <div className="code-editor" ref={hostRef} data-testid={testId} />;
}
