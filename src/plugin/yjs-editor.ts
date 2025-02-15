import { Descendant, Editor, Operation } from 'slate';
import invariant from 'tiny-invariant';
import * as Y from 'yjs';
import { applyYjsEvents } from '../apply-to-slate';
import applySlateOps from '../apply-to-yjs';
import { SharedType } from '../model';
import { toSlateDoc } from '../utils/convert';

const IS_REMOTE: WeakSet<Editor> = new WeakSet();
const IS_LOCAL: WeakSet<Editor> = new WeakSet();
const IS_UNDO: WeakSet<Editor> = new WeakSet();
const SHARED_TYPES: WeakMap<Editor, SharedType> = new WeakMap();

export interface YjsEditor extends Editor {
  sharedType: SharedType;
  isInitialized: boolean;
}

export const YjsEditor = {
  /**
   * Set the editor value to the content of the to the editor bound shared type.
   */
  synchronizeValue: (e: YjsEditor): void => {
    Editor.withoutNormalizing(e, () => {
      e.children = toSlateDoc(e.sharedType);
      e.isInitialized = true;
      e.onChange();
    });
  },

  /**
   * Returns whether the editor currently is applying remote changes.
   */
  sharedType: (editor: YjsEditor): SharedType => {
    const sharedType = SHARED_TYPES.get(editor);
    invariant(sharedType, 'YjsEditor without attached shared type');
    return sharedType;
  },

  /**
   * Applies a slate operations to the bound shared type.
   */
  applySlateOperations: (editor: YjsEditor, operations: Operation[]): void => {
    YjsEditor.asLocal(editor, () => {
      try {
        applySlateOps(YjsEditor.sharedType(editor), operations, editor);
      } catch (error) {
        const e: YjsEditor & {
          onError: (errorData: { code?: number; name?: string; nativeError?: any; data?: Descendant[] }) => void;
        } = editor as any;
        if (e.onError) {
          e.onError({ code: 10000, name: 'apply local operations', nativeError: error });
        }
      }
    });
  },

  /**
   * Returns whether the editor currently is applying remote changes.
   */
  isRemote: (editor: YjsEditor): boolean => {
    return IS_REMOTE.has(editor);
  },

  /**
   * Performs an action as a remote operation.
   */
  asRemote: (editor: YjsEditor, fn: () => void): void => {
    const wasRemote = YjsEditor.isRemote(editor);
    IS_REMOTE.add(editor);

    fn();

    if (!wasRemote) {
      Promise.resolve().then(() => IS_REMOTE.delete(editor));
    }
  },

  /**
   * Returns whether the editor currently is applying remote changes.
   */
  isUndo: (editor: YjsEditor): boolean => {
    return IS_UNDO.has(editor);
  },

  /**
   * Performs an action as a remote operation.
   */
  asUndo: (editor: YjsEditor, fn: () => void): void => {
    const wasUndo = YjsEditor.isUndo(editor);
    IS_UNDO.add(editor);

    fn();

    if (!wasUndo) {
      Promise.resolve().then(() => IS_UNDO.delete(editor));
    }
  },

  /**
   * Apply Yjs events to slate
   */
  applyYjsEvents: (editor: YjsEditor, events: Y.YEvent[]): void => {
    if (YjsEditor.isUndo(editor)) {
      try {
        applyYjsEvents(editor, events);
      } catch (error) {
        const e: YjsEditor & {
          onError: (errorData: { code?: number; name?: string; nativeError?: any; data?: Descendant[] }) => void;
        } = editor as any;
        if (e.onError) {
          e.onError({ code: 10001, name: 'apply yjs undo events', nativeError: error });
        }
      }
    } else {
      YjsEditor.asRemote(editor, () => {
        try {
          applyYjsEvents(editor, events);
        } catch (error) {
          const e: YjsEditor & {
            onError: (errorData: { code?: number; name?: string; nativeError?: any; data?: Descendant[] }) => void;
          } = editor as any;
          if (e.onError) {
            e.onError({ code: 10002, name: 'apply yjs remote events', nativeError: error });
          }
        }
      });
    }
  },

  /**
   * Performs an action as a local operation.
   */
  asLocal: (editor: YjsEditor, fn: () => void): void => {
    const wasLocal = YjsEditor.isLocal(editor);
    IS_LOCAL.add(editor);

    fn();

    if (!wasLocal) {
      IS_LOCAL.delete(editor);
    }
  },

  /**
   * Returns whether the editor currently is applying a remote change to the yjs doc.
   */
  isLocal: (editor: YjsEditor): boolean => {
    return IS_LOCAL.has(editor);
  }
};

export function withYjs<T extends Editor>(
  editor: T,
  sharedType: SharedType,
  { isSynchronizeValue = true }: WithYjsOptions = {}
): T & YjsEditor {
  const e = editor as T & YjsEditor;
  e.isInitialized = false;

  e.sharedType = sharedType;
  SHARED_TYPES.set(editor, sharedType);

  if (isSynchronizeValue) {
    setTimeout(() => {
      YjsEditor.synchronizeValue(e);
    });
  }

  sharedType.observeDeep((events) => {
    if (!YjsEditor.isLocal(e)) {
      const isNormalizing = Editor.isNormalizing(editor);
      Editor.setNormalizing(e, false);
      if (!e.isInitialized) {
        e.children = e.sharedType.toJSON();
        e.isInitialized = true;
        setTimeout(() => {
          e.onChange();
        });
      } else {
        YjsEditor.applyYjsEvents(e, events);
      }
      Editor.setNormalizing(e, isNormalizing);
    }
  });

  const { onChange } = editor;

  e.onChange = () => {
    if (!YjsEditor.isRemote(e) && !YjsEditor.isUndo(e) && e.isInitialized) {
      YjsEditor.applySlateOperations(e, e.operations);
    }
    onChange();
  };

  return e;
}

export type WithYjsOptions = {
  isSynchronizeValue?: boolean;
};
