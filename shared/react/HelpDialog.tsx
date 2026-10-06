import { useState, type ReactNode } from 'react';
import { Dialog } from './Dialog';

export interface HelpSection {
  id: string;
  title: string;
  content: ReactNode;
}

interface HelpDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  sections: HelpSection[];
  initialSection?: string;
}

export function HelpDialog({ open, onClose, title, sections, initialSection }: HelpDialogProps) {
  const [current, setCurrent] = useState(initialSection ?? sections[0]?.id);
  const [lastInitial, setLastInitial] = useState(initialSection);
  if (initialSection !== lastInitial) {
    setLastInitial(initialSection);
    if (initialSection) setCurrent(initialSection);
  }
  const section = sections.find((s) => s.id === current) ?? sections[0];
  return (
    <Dialog open={open} onClose={onClose} title={title} wide testId="help-dialog">
      <div className="help-layout">
        <nav className="help-nav" aria-label="Help topics">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={s.id === section?.id}
              onClick={() => setCurrent(s.id)}
            >
              {s.title}
            </button>
          ))}
        </nav>
        <article className="help" aria-live="polite">
          {section && (
            <>
              <h3>{section.title}</h3>
              {section.content}
            </>
          )}
        </article>
      </div>
    </Dialog>
  );
}
