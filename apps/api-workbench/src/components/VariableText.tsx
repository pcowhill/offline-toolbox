import { DYNAMIC_VARIABLE_NAMES, tokenizeVariables } from '../core/variables';
import { useVariables } from '../state/store';

/** Renders text with {{variables}} highlighted; unresolved ones are shown in red. */
export function VariableText({ text }: { text: string }) {
  const variables = useVariables();
  return (
    <>
      {tokenizeVariables(text).map((part, i) =>
        part.variable ? (
          <span
            key={i}
            className={
              variables.has(part.variable) || DYNAMIC_VARIABLE_NAMES.includes(part.variable)
                ? 'var-token'
                : 'var-token var-token--unresolved'
            }
            title={
              variables.has(part.variable) ? undefined : `Unresolved variable "${part.variable}"`
            }
          >
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
