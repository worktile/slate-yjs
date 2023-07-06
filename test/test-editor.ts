import { Editor, Location, Node, Operation, Path, Point, Transforms, createEditor } from 'slate';
import invariant from 'tiny-invariant';
import * as Y from 'yjs';
import { CustomNode, SyncElement, ThemeType } from '../src/model';
import { YjsEditor, withYjs } from '../src/plugin/yjs-editor';
import { YjsUndoEditor } from '../src/plugin/undo-manage';
import { toSharedContent } from '../src';
import { applyTheme } from '../src/apply-to-slate/apply-theme';
import { ThemeOperation } from '../src/apply-to-yjs/theme/set-theme';

export interface TestEditor extends YjsUndoEditor {
  shouldCaptureYjsUpdates: boolean;
  capturedYjsUpdates: Uint8Array[];
}

export type TransformFunc = (e: YjsEditor) => void;

export const TestEditor = {
  /**
   * Capture Yjs updates generated by this editor.
   */
  captureYjsUpdate: (e: TestEditor, update: Uint8Array): void => {
    if (!e.shouldCaptureYjsUpdates) return;
    e.capturedYjsUpdates.push(update);
  },

  /**
   * Return captured Yjs updates.
   */
  getCapturedYjsUpdates: (e: TestEditor): Uint8Array[] => {
    const result = e.capturedYjsUpdates;
    e.capturedYjsUpdates = [];
    return result;
  },

  /**
   * Apply one Yjs update to Yjs.
   */
  applyYjsUpdateToYjs: (e: TestEditor, update: Uint8Array): void => {
    e.shouldCaptureYjsUpdates = false;
    invariant(e.sharedDoc.doc, 'Shared type should be bound to a document');
    Y.applyUpdate(e.sharedDoc.doc!, update);
    e.shouldCaptureYjsUpdates = true;
  },

  /**
   * Apply multiple Yjs updates to Yjs.
   */
  applyYjsUpdatesToYjs: (e: TestEditor, updates: Uint8Array[]): void => {
    updates.forEach((update) => {
      TestEditor.applyYjsUpdateToYjs(e, update);
    });
  },

  /**
   * Apply one TransformFunc to slate.
   */
  applyTransform: (e: TestEditor, transform: TransformFunc): void => {
    transform(e);
  },

  /**
   * Apply multiple TransformFuncs to slate.
   */
  applyTransforms: (e: TestEditor, transforms: TransformFunc[]): void => {
    transforms.forEach((transform) => {
      TestEditor.applyTransform(e, transform);
    });
  },

  makeInsertText: (text: string, at: Location): TransformFunc => {
    return (e: Editor) => {
      Transforms.insertText(e, text, { at });
    };
  },

  makeRemoveCharacters: (count: number, at: Location): TransformFunc => {
    return (e: Editor) => {
      Transforms.delete(e, { distance: count, at });
    };
  },

  makeInsertNodes: (nodes: (Node | CustomNode) | (Node | CustomNode)[], at: Location): TransformFunc => {
    return (e: Editor) => {
      Transforms.insertNodes(e, nodes as Node, { at });
    };
  },

  makeMergeNodes: (at: Path): TransformFunc => {
    return (e: Editor) => {
      Transforms.mergeNodes(e, { at });
    };
  },

  makeMoveNodes: (from: Path, to: Path): TransformFunc => {
    return (e: Editor) => {
      Transforms.moveNodes(e, { at: from, to });
    };
  },

  makeRemoveNodes: (at: Path): TransformFunc => {
    return (e: Editor) => {
      Transforms.removeNodes(e, { at });
    };
  },

  makeSetNodes: (at: Location, props: Partial<CustomNode>): TransformFunc => {
    return (e: Editor) => {
      Transforms.setNodes(e, props, { at });
    };
  },

  makeSplitNodes: (at: Location): TransformFunc => {
    return (e: Editor) => {
      Transforms.splitNodes(e, { at });
    };
  },

  makeSetSelection: (anchor: Point, focus: Point): TransformFunc => {
    return (e: Editor) => {
      Transforms.setSelection(e, { anchor, focus });
    };
  },

  makeSetTheme: (theme: ThemeType): TransformFunc => {
    return (e: YjsEditor) => {
      const operation: ThemeOperation = { type: 'set_theme', properties: e.theme!, newProperties: theme };
      applyTheme(e, operation);
      e.apply(operation as unknown as Operation);
    };
  }
};

export function withTest<T extends YjsEditor>(editor: T): T & TestEditor {
  const e = editor as T & TestEditor;

  invariant(e.sharedDoc.doc, 'Shared type should be bound to a document');

  e.sharedDoc.doc.on('update', (updateMessage: Uint8Array) => {
    TestEditor.captureYjsUpdate(e, updateMessage);
  });

  e.shouldCaptureYjsUpdates = true;
  e.capturedYjsUpdates = [];

  return e;
}

export function createTestEditor(theme?: ThemeType): TestEditor {
  const doc = new Y.Doc();
  const syncType = doc.getArray<SyncElement>('content');
  const editor = createEditor();
  toSharedContent(syncType, editor.children);
  if (!theme) {
    return withTest(withYjs(editor, syncType));
  }

  const syncTheme = doc.getMap('theme');
  (editor as YjsEditor).theme = theme;
  return withTest(withYjs(editor, syncType, syncTheme));
}
