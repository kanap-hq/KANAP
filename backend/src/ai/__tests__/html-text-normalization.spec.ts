import * as assert from 'node:assert/strict';
import { normalizeKnowledgeText, stripWebText } from '../control-plane/agent-control/agent-control-knowledge.util';
import { normalizeKnowledgeReplyText } from '../control-plane/agent-control/agent-control-timeline-synthesis.util';
import { findImportedImageReferences } from '../../common/document-import-markdown';
import { buildMarkdownImage } from '../mutation/operations/import-glpi-ticket.ai-mutation-operation';

/** The Markdown image the GLPI import writes for the `<img>` tag of `html`. */
function importedImage(html: string, target: string): string {
  const [reference] = findImportedImageReferences(html);
  return buildMarkdownImage(reference, target);
}

function decodesWebTextOnce() {
  assert.equal(stripWebText('<b>R&amp;D</b> &quot;guide&quot; it&#39;s &lt;new&gt;'), 'R&D "guide" it\'s <new>');
  assert.equal(stripWebText('Escaped &amp;lt;tag&amp;gt; text'), 'Escaped &lt;tag&gt; text');
}

function decodesKnowledgeTextOnce() {
  assert.equal(normalizeKnowledgeText('<p>VPN&nbsp;&amp;&nbsp;proxy</p><p>&lt;setup&gt;</p>'), 'VPN & proxy <setup>');
  assert.equal(normalizeKnowledgeText('<p>Literal &amp;lt;b&amp;gt;</p>'), 'Literal &lt;b&gt;');
}

function decodesReplyTextOnce() {
  assert.equal(normalizeKnowledgeReplyText('<p>Press &lt;Enter&gt; then R&amp;D</p>'), 'Press [Enter] then R&D');
  assert.equal(normalizeKnowledgeReplyText('<p>Literal &amp;lt;x&amp;gt;</p>'), 'Literal &lt;x&gt;');
  // Content stored with numeric references keeps its two layers: markup, then text references.
  assert.equal(normalizeKnowledgeReplyText('&#60;p&#62;R&#38;amp;D &#38;lt;lab&#38;gt;&#60;/p&#62;'), 'R&D [lab]');
}

function escapesGlpiImageTitle() {
  assert.equal(
    importedImage('<img src="x" alt="Chart" title="Monthly view">', '/files/1'),
    '![Chart](/files/1 "Monthly view")',
  );
  assert.equal(
    importedImage('<img src="x" alt="Chart" title=\'Say \\"hi\\" \\\'>', '/files/1'),
    '![Chart](/files/1 "Say \\\\\\"hi\\\\\\" \\\\")',
  );
}

decodesWebTextOnce();
decodesKnowledgeTextOnce();
decodesReplyTextOnce();
escapesGlpiImageTitle();
