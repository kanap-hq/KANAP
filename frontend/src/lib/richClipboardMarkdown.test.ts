import { render } from '@testing-library/react';
import { createElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { describe, expect, it, vi } from 'vitest';
import {
  convertRichClipboardToMarkdown,
  escapeTableCell,
  shouldHandleRichClipboardImport,
} from './richClipboardMarkdown';

describe('richClipboardMarkdown', () => {
  it('converts rich HTML formatting into markdown', async () => {
    const markdown = await convertRichClipboardToMarkdown({
      html: `
        <h2>Imported Title</h2>
        <p><strong>Bold</strong> <em>italic</em> <a href="https://example.com/docs">link</a></p>
        <ul><li>One</li><li>Two</li></ul>
      `,
    });

    expect(markdown).toContain('## Imported Title');
    expect(markdown).toContain('**Bold** *italic* [link](https://example.com/docs)');
    expect(markdown).toContain('- One');
    expect(markdown).toContain('- Two');
  });

  it('uploads data URI images before generating markdown', async () => {
    const uploadImage = vi.fn(async (file: File) => `/uploads/${file.name}`);

    const markdown = await convertRichClipboardToMarkdown({
      html: '<p>Body</p><img src="data:image/png;base64,AA==" alt="diagram" />',
      uploadImage,
    });

    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(uploadImage.mock.calls[0]?.[0]).toBeInstanceOf(File);
    expect(markdown).toBe('Body\n\n![diagram](/uploads/pasted-image.png)');
  });

  it('uses clipboard image files for cid based pasted images', async () => {
    const uploadImage = vi.fn(async (file: File) => `/uploads/${file.name}`);
    const clipboardImage = new File(['binary'], 'clipboard.png', { type: 'image/png' });

    const markdown = await convertRichClipboardToMarkdown({
      html: '<p>With image</p><img src="cid:image-1" alt="cid image" />',
      imageFiles: [clipboardImage],
      uploadImage,
    });

    expect(uploadImage).toHaveBeenCalledWith(clipboardImage);
    expect(markdown).toBe('With image\n\n![cid image](/uploads/clipboard.png)');
  });

  it('imports remote image URLs before generating markdown', async () => {
    const importRemoteImage = vi.fn(async (sourceUrl: string) => `/uploads?source=${encodeURIComponent(sourceUrl)}`);

    const markdown = await convertRichClipboardToMarkdown({
      html: '<p>Body</p><img src="https://example.com/image.png" alt="diagram" />',
      importRemoteImage,
    });

    expect(importRemoteImage).toHaveBeenCalledWith('https://example.com/image.png');
    expect(markdown).toBe('Body\n\n![diagram](/uploads?source=https%3A%2F%2Fexample.com%2Fimage.png)');
  });

  it('unwraps image-only links so pasted images are not clickable links', async () => {
    const importRemoteImage = vi.fn(async () => '/uploads/internal.png');

    const markdown = await convertRichClipboardToMarkdown({
      html: '<p><a href="https://remote.example/image.png"><img src="https://remote.example/image.png" alt="diagram" /></a></p>',
      importRemoteImage,
    });

    expect(markdown).toBe('![diagram](/uploads/internal.png)');
  });

  it('preserves separator spaces between adjacent inline text fragments', async () => {
    const markdown = await convertRichClipboardToMarkdown({
      html: '<ul><li><span>Processeur:</span><span>Processeur AMD Ryzen</span></li></ul>',
    });

    expect(markdown).toBe('- Processeur: Processeur AMD Ryzen');
  });

  it('preserves separator spaces before adjacent emphasis fragments', async () => {
    const markdown = await convertRichClipboardToMarkdown({
      html: "<ul><li><span>Sans Microsoft Office</span><em>mise à niveau sélectionnée</em></li></ul>",
    });

    expect(markdown).toBe('- Sans Microsoft Office *mise à niveau sélectionnée*');
  });

  it('converts malformed nested clipboard spec lists instead of falling back to plain text', async () => {
    const markdown = await convertRichClipboardToMarkdown({
      html: `
        <ul class="specsDetails">
          <div class="title">
            <i style="font-style: normal;">Spécifications du système:</i><span>&nbsp;</span><button>(Modifier )</button>
          </div>
          <ul class="specsDetails">
            <li>
              <div class="content">
                <span>Processeur</span><span>:&nbsp;</span><span class="value">Processeur AMD Ryzen</span>
              </div>
            </li>
            <li>
              <div class="content">
                <span>Système d'exploitation</span><span>:&nbsp;</span>
                <span class="value">Pas de système d'exploitation<span class="selectUpgrade" style="margin: 0 0 0 10px; font: italic 13px / 16px Lato;">mise à niveau sélectionnée</span></span>
              </div>
            </li>
          </ul>
        </ul>
      `,
      plainText: [
        'Spécifications du système: (Modifier )',
        "Processeur: Processeur AMD Ryzen",
        "Système d'exploitation: Pas de système d'exploitationmise à niveau sélectionnée",
      ].join('\n'),
    });

    expect(markdown).toBe([
      'Spécifications du système: (Modifier )',
      '',
      '- Processeur: Processeur AMD Ryzen',
      "- Système d'exploitation: Pas de système d'exploitation *mise à niveau sélectionnée*",
    ].join('\n'));
  });

  it('detects mixed text and image clipboard payloads even without html', () => {
    const clipboardImage = new File(['binary'], 'clipboard.png', { type: 'image/png' });

    expect(shouldHandleRichClipboardImport({
      plainText: 'Pasted text',
      imageFiles: [clipboardImage],
    })).toBe(true);

    expect(shouldHandleRichClipboardImport({
      plainText: 'plain text only',
    })).toBe(false);
  });

  it('normalizes Word list paragraphs into markdown lists', async () => {
    const markdown = await convertRichClipboardToMarkdown({
      html: `
        <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">
          <span style="mso-list:Ignore">1.<span>&nbsp;&nbsp;&nbsp;</span></span>
          First item
        </p>
        <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">
          <span style="mso-list:Ignore">2.<span>&nbsp;&nbsp;&nbsp;</span></span>
          Second item
        </p>
      `,
    });

    expect(markdown).toBe('1. First item\n2. Second item');
  });

  it('avoids raw html when flattening table cell line breaks', async () => {
    const markdown = await convertRichClipboardToMarkdown({
      html: `
        <table>
          <tr><th>Column</th></tr>
          <tr><td>Line 1<br />Line 2</td></tr>
        </table>
      `,
    });

    expect(markdown).toContain('| Column |');
    expect(markdown).toContain('| Line 1 Line 2 |');
    expect(markdown).not.toContain('<br>');
  });

  describe('special characters in pasted text', () => {
    function renderMarkdown(markdown: string) {
      return render(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, markdown)).container;
    }

    it('keeps a pipe and the backslash before it inside a table cell', async () => {
      const markdown = await convertRichClipboardToMarkdown({
        html: String.raw`<table><tr><th>Pattern</th><th>Path</th></tr><tr><td>a\|b</td><td>C:\temp</td></tr></table>`,
      });

      expect(markdown).toContain(String.raw`| a\\\|b | C:\temp |`);
      const cells = Array.from(renderMarkdown(markdown).querySelectorAll('td')).map((cell) => cell.textContent);
      expect(cells).toEqual([String.raw`a\|b`, String.raw`C:\temp`]);
    });

    it('escapes a long run of backslashes in a table cell in linear time', () => {
      const run = '\\'.repeat(200 * 1024);
      const startedAt = performance.now();
      expect(escapeTableCell(run)).toBe(run);
      expect(performance.now() - startedAt).toBeLessThan(50);
      expect(escapeTableCell(`${run}|`)).toBe(`${run}${run}\\|`);
    });

    it('keeps backslashes and backticks literal inside inline code', async () => {
      const markdown = await convertRichClipboardToMarkdown({
        html: String.raw`<p>Run <code>C:\temp\run.cmd</code> or <code>a ` + '`' + String.raw`b</code></p>`,
      });

      expect(markdown).toBe('Run `C:\\temp\\run.cmd` or ``a `b``');
      const codes = Array.from(renderMarkdown(markdown).querySelectorAll('code')).map((code) => code.textContent);
      expect(codes).toEqual([String.raw`C:\temp\run.cmd`, 'a `b']);
    });

    it('keeps backslashes and quotes in an image title', async () => {
      const markdown = await convertRichClipboardToMarkdown({
        html: '<p><img src="https://example.com/a.png" alt="Chart" title=\'Say \\"hi\\" \\\'></p>',
      });

      expect(markdown).toBe('![Chart](https://example.com/a.png "Say \\\\\\"hi\\\\\\" \\\\")');
      expect(renderMarkdown(markdown).querySelector('img')?.getAttribute('title')).toBe('Say \\"hi\\" \\');
    });
  });
});
