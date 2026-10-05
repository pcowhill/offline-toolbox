import { useState } from 'react';
import { Dialog } from '@shared/react/Dialog';
import { toast } from '@shared/react/toasts';
import { isWithinFolder, listFolders, locateItem } from '../core/collections';
import { moveItemInCollections, useStore } from '../state/store';

export function MoveDialog({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const collections = useStore((s) => s.collections);
  const located = itemId ? locateItem(collections, itemId) : undefined;
  const [collectionId, setCollectionId] = useState('');
  const [folderId, setFolderId] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  if (itemId !== current) {
    setCurrent(itemId);
    if (located) {
      setCollectionId(located.collection.id);
      setFolderId(located.parentFolderId ?? '');
    }
  }
  const target = collections.find((c) => c.id === collectionId);
  const item = located?.item;
  const folders = (target ? listFolders(target) : []).filter(
    (f) => !(item?.type === 'folder' && isWithinFolder(item, f.id)),
  );
  return (
    <Dialog
      open={!!itemId}
      onClose={onClose}
      title={`Move "${item?.name ?? ''}"`}
      testId="move-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="move-confirm"
            onClick={() => {
              if (!itemId) return;
              try {
                moveItemInCollections(itemId, { collectionId, folderId: folderId || null });
                onClose();
              } catch (error) {
                toast((error as Error).message, 'error');
              }
            }}
          >
            Move
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor="move-collection">Collection</label>
          <select
            id="move-collection"
            className="select"
            value={collectionId}
            onChange={(e) => {
              setCollectionId(e.target.value);
              setFolderId('');
            }}
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="move-folder">Folder</label>
          <select
            id="move-folder"
            className="select"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          >
            <option value="">(collection root)</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.path}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Dialog>
  );
}
