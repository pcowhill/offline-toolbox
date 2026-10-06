import { Eraser, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { pickFiles } from '@shared/lib/download';
import { Dialog } from '@shared/react/Dialog';
import { Tabs } from '@shared/react/Tabs';
import { toast } from '@shared/react/toasts';
import { loadInsertImage } from '../state/actions';
import { setPendingImage } from '../state/store';

type Mode = 'draw' | 'type' | 'upload';

const TYPE_FONTS = [
  { label: 'Script', css: "'Segoe Script', 'Brush Script MT', 'URW Chancery L', 'Z003', cursive" },
  { label: 'Elegant', css: "'Lucida Handwriting', 'Apple Chancery', 'URW Chancery L', cursive" },
  { label: 'Plain', css: "Georgia, 'Times New Roman', 'Liberation Serif', serif" },
];

/**
 * Creates a visual signature (drawn, typed or uploaded image). It is an image placed on the page —
 * not a cryptographic digital signature.
 */
export function SignatureDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('draw');
  const [typed, setTyped] = useState('');
  const [font, setFont] = useState(0);
  const [color, setColor] = useState('#1e3a8a');
  const [hasInk, setHasInk] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!open) return;
    setHasInk(false);
    requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    });
  }, [open, mode]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * e.currentTarget.width) / rect.width,
      y: ((e.clientY - rect.top) * e.currentTarget.height) / rect.height,
    };
  };

  const finish = async (blob: Blob) => {
    try {
      const { id, aspect } = await loadInsertImage(blob, 'signature');
      setPendingImage({ imageId: id, signature: true, aspect });
      toast('Click or drag on the page to place the signature.', 'info');
      onClose();
    } catch (error) {
      toast((error as Error).message, 'error');
    }
  };

  /** Crops transparent margins so the placed image hugs the signature. */
  const croppedBlob = (canvas: HTMLCanvasElement): Promise<Blob> => {
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width,
      minY = height,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const pad = 8;
    const out = document.createElement('canvas');
    if (maxX < 0) {
      out.width = 1;
      out.height = 1;
    } else {
      out.width = maxX - minX + pad * 2;
      out.height = maxY - minY + pad * 2;
      out
        .getContext('2d')!
        .drawImage(
          canvas,
          minX - pad,
          minY - pad,
          out.width,
          out.height,
          0,
          0,
          out.width,
          out.height,
        );
    }
    return new Promise((resolve, reject) =>
      out.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Could not create image'))),
        'image/png',
      ),
    );
  };

  const useDrawn = async () => {
    if (canvasRef.current) await finish(await croppedBlob(canvasRef.current));
  };

  const useTyped = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = color;
    ctx.font = `110px ${TYPE_FONTS[font].css}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(typed, 30, 150, 1140);
    await finish(await croppedBlob(canvas));
  };

  const upload = async () => {
    const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp,image/gif' });
    if (file) await finish(file);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add signature"
      wide
      testId="signature-dialog"
      footer={
        <>
          <span className="dialog__footer-start muted">
            A visual signature mark — not a cryptographic digital signature.
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {mode === 'draw' && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={!hasInk}
              onClick={useDrawn}
              data-testid="signature-use"
            >
              Use signature
            </button>
          )}
          {mode === 'type' && (
            <button
              type="button"
              className="btn btn--primary"
              disabled={!typed.trim()}
              onClick={useTyped}
              data-testid="signature-use-typed"
            >
              Use signature
            </button>
          )}
        </>
      }
    >
      <Tabs<Mode>
        label="Signature source"
        value={mode}
        onChange={setMode}
        items={[
          { id: 'draw', label: 'Draw', testId: 'sig-draw' },
          { id: 'type', label: 'Type', testId: 'sig-type' },
          { id: 'upload', label: 'Upload image', testId: 'sig-upload' },
        ]}
      />
      <div className="signature">
        <label className="prop">
          <span className="prop__label">Ink colour</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        {mode === 'draw' && (
          <>
            <canvas
              ref={canvasRef}
              className="signature__pad"
              width={900}
              height={260}
              data-testid="signature-pad"
              onPointerDown={(e) => {
                drawing.current = true;
                e.currentTarget.setPointerCapture(e.pointerId);
                const ctx = e.currentTarget.getContext('2d')!;
                const p = point(e);
                ctx.strokeStyle = color;
                ctx.lineWidth = 4;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x + 0.1, p.y);
                ctx.stroke();
                setHasInk(true);
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                const ctx = e.currentTarget.getContext('2d')!;
                const p = point(e);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
              }}
              onPointerUp={() => {
                drawing.current = false;
              }}
            />
            <div className="toolbar">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => {
                  const c = canvasRef.current;
                  c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
                  setHasInk(false);
                }}
              >
                <Eraser aria-hidden /> Clear
              </button>
              <span className="muted">Draw with the mouse, a pen or your finger.</span>
            </div>
          </>
        )}
        {mode === 'type' && (
          <>
            <input
              className="input signature__typed-input"
              placeholder="Your name"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              data-testid="signature-typed"
              autoFocus
            />
            <div className="signature__fonts">
              {TYPE_FONTS.map((f, i) => (
                <button
                  key={f.label}
                  type="button"
                  className={`signature__font${font === i ? ' is-active' : ''}`}
                  onClick={() => setFont(i)}
                  style={{ fontFamily: f.css, color }}
                >
                  {typed || 'Signature'}
                </button>
              ))}
            </div>
            <p className="muted">
              Uses handwriting-style fonts installed on this computer (none are downloaded).
            </p>
          </>
        )}
        {mode === 'upload' && (
          <div className="signature__upload">
            <button type="button" className="btn" onClick={upload}>
              <Upload aria-hidden /> Choose image…
            </button>
            <p className="muted">A PNG with a transparent background looks best.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
