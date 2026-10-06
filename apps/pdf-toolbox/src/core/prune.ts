// Guarantees that exported files contain only the pages the user kept.
//
// pdf-lib's copyPages() deep-copies everything a page refers to. Annotations can refer to other
// pages — a link's destination, a widget's /P, a radio button's sibling widgets — so copying one
// page can silently drag a copy of another page (and its content stream) into the file as an
// orphan. pdf-lib writes every object on save, so deleted or redacted pages would leak.
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFRef,
  PDFStream,
  type PDFContext,
  type PDFDocument,
  type PDFObject,
} from 'pdf-lib';

const NAME = {
  Type: PDFName.of('Type'),
  Page: PDFName.of('Page'),
  Annots: PDFName.of('Annots'),
  Subtype: PDFName.of('Subtype'),
  Link: PDFName.of('Link'),
  Widget: PDFName.of('Widget'),
  Dest: PDFName.of('Dest'),
  A: PDFName.of('A'),
  D: PDFName.of('D'),
  P: PDFName.of('P'),
  Kids: PDFName.of('Kids'),
  Popup: PDFName.of('Popup'),
  IRT: PDFName.of('IRT'),
  Parent: PDFName.of('Parent'),
};

/** Deletes objects that cannot be reached from the document trailer (orphans, old revisions). */
export function removeUnreachableObjects(context: PDFContext): number {
  const reachable = new Set<string>();
  const stack: PDFObject[] = [];
  const { Root, Info, Encrypt } = context.trailerInfo;
  for (const entry of [Root, Info, Encrypt]) if (entry) stack.push(entry);
  while (stack.length) {
    const object = stack.pop()!;
    if (object instanceof PDFRef) {
      const key = object.toString();
      if (reachable.has(key)) continue;
      reachable.add(key);
      const target = context.lookup(object);
      if (target) stack.push(target);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) stack.push(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) stack.push(value);
    } else if (object instanceof PDFStream) {
      stack.push(object.dict);
    }
  }
  let removed = 0;
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reachable.has(ref.toString())) {
      context.delete(ref);
      removed++;
    }
  }
  return removed;
}

function destinationPage(context: PDFContext, annot: PDFDict): PDFRef | 'none' | 'other' {
  let dest: PDFObject | undefined = annot.get(NAME.Dest);
  if (!dest) {
    const action = context.lookup(annot.get(NAME.A));
    if (action instanceof PDFDict) dest = action.get(NAME.D);
  }
  if (!dest) return 'none';
  const resolved = context.lookup(dest);
  if (resolved instanceof PDFArray) {
    const first = resolved.get(0);
    return first instanceof PDFRef ? first : 'other';
  }
  return 'other'; // named destination or numeric page index: no object reference
}

/**
 * Removes every reference to pages that are not part of the document's page tree, then drops
 * all unreachable objects. Returns the number of foreign pages that were detached.
 */
export function pruneForeignPages(doc: PDFDocument): number {
  const context = doc.context;
  const kept = new Set(doc.getPages().map((p) => p.ref.toString()));
  const foreignPages = new Set<string>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFDict &&
      object.get(NAME.Type) === NAME.Page &&
      !kept.has(ref.toString())
    ) {
      foreignPages.add(ref.toString());
    }
  }

  // 0. copyPages() clones the page itself separately from the copies made while following
  //    references, so a link to (or widget on) a *kept* page may point at a second, orphan
  //    copy of it. Both copies share the same copied content streams; use that to re-point
  //    such references at the kept page.
  const pageKey = (dict: PDFDict) => {
    const contents = dict.get(PDFName.of('Contents'));
    return contents ? `${contents.toString()}|${String(dict.get(PDFName.of('Resources')))}` : null;
  };
  const keptByKey = new Map<string, PDFRef>();
  for (const page of doc.getPages()) {
    const key = pageKey(page.node);
    if (key && !keptByKey.has(key)) keptByKey.set(key, page.ref);
  }
  const alias = new Map<string, PDFRef>();
  for (const key of foreignPages) {
    const [num, gen] = key.split(' ').map(Number);
    const dict = context.lookup(PDFRef.of(num, gen));
    const match = dict instanceof PDFDict ? keptByKey.get(pageKey(dict) ?? '') : undefined;
    if (match) alias.set(key, match);
  }
  if (alias.size) {
    const replace = (value: PDFObject): PDFObject | null =>
      value instanceof PDFRef && alias.has(value.toString()) ? alias.get(value.toString())! : null;
    for (const [, object] of context.enumerateIndirectObjects()) {
      const dicts: PDFDict[] = [];
      const arrays: PDFArray[] = [];
      const visit = (o: PDFObject | undefined) => {
        if (o instanceof PDFDict) dicts.push(o);
        else if (o instanceof PDFArray) arrays.push(o);
        else if (o instanceof PDFStream) dicts.push(o.dict);
      };
      visit(object);
      while (dicts.length || arrays.length) {
        const dict = dicts.pop();
        if (dict) {
          for (const [k, v] of dict.entries()) {
            const r = replace(v);
            if (r) dict.set(k, r);
            else visit(v);
          }
        }
        const array = arrays.pop();
        if (array) {
          for (let i = 0; i < array.size(); i++) {
            const r = replace(array.get(i));
            if (r) array.set(i, r);
            else visit(array.get(i));
          }
        }
      }
    }
    for (const key of alias.keys()) {
      foreignPages.delete(key);
      const [num, gen] = key.split(' ').map(Number);
      context.delete(PDFRef.of(num, gen));
    }
  }
  if (!foreignPages.size) {
    removeUnreachableObjects(context);
    return 0;
  }
  const isForeign = (value: PDFObject | undefined) =>
    value instanceof PDFRef && foreignPages.has(value.toString());

  // 1. Links on kept pages that jump to a page that is not kept are removed.
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(NAME.Annots, PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = context.lookup(annots.get(i));
      if (!(annot instanceof PDFDict) || annot.get(NAME.Subtype) !== NAME.Link) continue;
      const target = destinationPage(context, annot);
      if (target instanceof PDFRef && !kept.has(target.toString())) annots.remove(i);
    }
  }

  // 2. Annotations listed on a kept page get /P pointed at that page (copyPages points it at a
  //    separate orphan copy of the same page). Annotations that belong to foreign pages (e.g.
  //    sibling widgets of a radio group) are detached from their parents, and back-references
  //    (/P, /Popup, /IRT) to them are cleared.
  const onKeptPage = new Set<string>();
  for (const page of doc.getPages()) {
    const annots = page.node.lookupMaybe(NAME.Annots, PDFArray);
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i);
      const annot = context.lookup(ref);
      if (!(ref instanceof PDFRef) || !(annot instanceof PDFDict)) continue;
      onKeptPage.add(ref.toString());
      if (annot.has(NAME.P)) annot.set(NAME.P, page.ref);
    }
  }
  const foreignAnnots = new Set<string>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFDict &&
      object.get(NAME.Subtype) &&
      isForeign(object.get(NAME.P)) &&
      !onKeptPage.has(ref.toString())
    ) {
      foreignAnnots.add(ref.toString());
    }
  }
  const isForeignAnnot = (value: PDFObject | undefined) =>
    value instanceof PDFRef && foreignAnnots.has(value.toString());
  for (const [, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict)) continue;
    if (isForeign(object.get(NAME.P))) object.delete(NAME.P);
    if (isForeignAnnot(object.get(NAME.Popup))) object.delete(NAME.Popup);
    if (isForeignAnnot(object.get(NAME.IRT))) object.delete(NAME.IRT);
    const kids = object.lookupMaybe(NAME.Kids, PDFArray);
    if (kids && object.get(NAME.Type) !== PDFName.of('Pages')) {
      for (let i = kids.size() - 1; i >= 0; i--)
        if (isForeignAnnot(kids.get(i)) || isForeign(kids.get(i))) kids.remove(i);
    }
  }

  // 3. Whatever still points at a foreign page now resolves to null (PDF semantics for a
  //    reference to a missing object): delete the page objects themselves, then collect garbage.
  for (const key of foreignPages) {
    const [num, gen] = key.split(' ').map(Number);
    context.delete(PDFRef.of(num, gen));
  }
  removeUnreachableObjects(context);
  return foreignPages.size;
}
