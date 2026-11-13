import { AutoLinkPlugin } from '@lexical/react/LexicalAutoLinkPlugin';
import {
  addComposerChild$,
  addNestedEditorChild$,
  addTableCellEditorChild$,
  realmPlugin,
} from '@mdxeditor/editor';
import { AUTO_LINK_MATCHERS } from '../lib/richTextAutoLink';

const BoundedAutoLinkPlugin = () => <AutoLinkPlugin matchers={AUTO_LINK_MATCHERS} />;

/**
 * Turns a web address or an e-mail address typed or pasted in the text into a link, as the
 * editor's own module does, with detectors that answer in bounded time (`richTextAutoLink`).
 * Goes with `linkPlugin({ disableAutoLink: true })`, which registers the link nodes.
 */
export const boundedAutoLinkPlugin = realmPlugin({
  init(realm) {
    realm.pubIn({
      [addNestedEditorChild$]: BoundedAutoLinkPlugin,
      [addTableCellEditorChild$]: BoundedAutoLinkPlugin,
      [addComposerChild$]: BoundedAutoLinkPlugin,
    });
  },
});
