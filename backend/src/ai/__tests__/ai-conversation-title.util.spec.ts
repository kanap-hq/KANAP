import * as assert from 'node:assert/strict';
import { conversationTitleFromMessage } from '../ai-conversation-title.util';

function keepsTheLabelOfALink() {
  assert.equal(
    conversationTitleFromMessage('Summarise [Formaggio Supremo SRL](/master-data/companies/5835dd12-0c1d-4b8e-9f00-1a2b3c4d5e6f)'),
    'Summarise Formaggio Supremo SRL',
  );
}

function keepsTheAltTextOfAnImage() {
  assert.equal(
    conversationTitleFromMessage('What is in ![logo test](https://example.com/files/logo.png "Logo") here?'),
    'What is in logo test here?',
  );
}

function convertsSeveralLinks() {
  assert.equal(
    conversationTitleFromMessage('Compare [SAP S/4HANA](/it/applications/APP-3) and [Salesforce](/it/applications/APP-7)\nfor **cost**'),
    'Compare SAP S/4HANA and Salesforce for cost',
  );
}

function keepsAMessageWithoutMarkdown() {
  assert.equal(conversationTitleFromMessage('How many incidents are open?'), 'How many incidents are open?');
  assert.equal(conversationTitleFromMessage('Budget lines for 2026_Q1 * 2'), 'Budget lines for 2026_Q1 * 2');
}

function cutsAfterTheConversion() {
  const label = 'Formaggio Supremo SRL';
  const prefix = 'x'.repeat(90);
  const title = conversationTitleFromMessage(`${prefix} [${label}](/master-data/companies/5835dd12-0c1d-4b8e-9f00-1a2b3c4d5e6f)`);
  assert.equal(title, `${prefix} ${label}`.slice(0, 100));
  assert.ok(!title.includes('/master-data'));
  assert.ok(!title.includes('['));
  assert.equal(conversationTitleFromMessage('a'.repeat(150)).length, 100);
}

function cleansATitleCutInsideALink() {
  assert.equal(
    conversationTitleFromMessage('[Formaggio Supremo SRL](/master-data/companies/5835dd12-'),
    'Formaggio Supremo SRL',
  );
  assert.equal(conversationTitleFromMessage('Look at ![logo test](https://example.com/fi'), 'Look at logo test');
  assert.equal(conversationTitleFromMessage('Summarise [Formaggio Sup'), 'Summarise Formaggio Sup');
}

keepsTheLabelOfALink();
keepsTheAltTextOfAnImage();
convertsSeveralLinks();
keepsAMessageWithoutMarkdown();
cutsAfterTheConversion();
cleansATitleCutInsideALink();
