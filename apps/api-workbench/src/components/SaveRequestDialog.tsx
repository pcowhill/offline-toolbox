import { useState } from 'react';
import { Dialog } from '@shared/react/Dialog';
import { listFolders } from '../core/collections';
import { createNewCollection, saveTabRequest, useStore, type RequestTab } from '../state/store';

interface Props {
  open: boolean;
  onClose: () => void;
  tab: RequestTab;
}

const NEW = '__new__';

export function SaveRequestDialog({ open, onClose, tab }: Props) {
  const collections = useStore((s) => s.collections);
  const [name, setName] = useState(tab.title);
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? NEW);
  const [newName, setNewName] = useState('My collection');
  const [folderId, setFolderId] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName(tab.title === 'Untitled request' ? '' : tab.title);
      setCollectionId(collections[0]?.id ?? NEW);
      setFolderId('');
    }
  }
  const collection = collections.find((c) => c.id === collectionId);
  const folders = collection ? listFolders(collection) : [];
  const finalName = name.trim() || `${tab.request.method} ${tab.request.url || 'request'}`;

  const submit = () => {
    let targetId = collectionId;
    if (collectionId === NEW) {
      if (!newName.trim()) return;
      targetId = createNewCollection(newName.trim()).id;
    }
    saveTabRequest(tab.id, {
      location: { collectionId: targetId, folderId: folderId || null },
      name: finalName,
    });
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Save request"
      testId="save-dialog"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="save-request-form"
            className="btn btn--primary"
            data-testid="save-confirm"
          >
            Save
          </button>
        </>
      }
    >
      <form
        id="save-request-form"
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <label htmlFor="save-name">Name</label>
          <input
            id="save-name"
            className="input"
            value={name}
            placeholder={finalName}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            data-testid="save-name"
          />
        </div>
        <div className="field">
          <label htmlFor="save-collection">Collection</label>
          <select
            id="save-collection"
            className="select"
            value={collectionId}
            onChange={(e) => {
              setCollectionId(e.target.value);
              setFolderId('');
            }}
            data-testid="save-collection"
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value={NEW}>+ New collection…</option>
          </select>
        </div>
        {collectionId === NEW ? (
          <div className="field">
            <label htmlFor="save-new-collection">New collection name</label>
            <input
              id="save-new-collection"
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              data-testid="save-new-collection"
            />
          </div>
        ) : (
          folders.length > 0 && (
            <div className="field">
              <label htmlFor="save-folder">Folder</label>
              <select
                id="save-folder"
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
          )
        )}
        {(tab.request.auth.type === 'basic' || tab.request.auth.type === 'bearer') &&
          !tab.request.auth.saveCredentials && (
            <p className="field__hint">
              Credentials on the Auth tab are not saved (unless you tick "Save credentials" there).
              Variable references like {'{{token}}'} are kept.
            </p>
          )}
      </form>
    </Dialog>
  );
}
