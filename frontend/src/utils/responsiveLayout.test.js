import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appCssPath = path.resolve(__dirname, '..', 'App.css');
const indexCssPath = path.resolve(__dirname, '..', 'index.css');
const appCss = fs.readFileSync(appCssPath, 'utf8');
const indexCss = fs.readFileSync(indexCssPath, 'utf8');

test('index.css allows vertical document scrolling so landing, auth, and profile pages are never clipped', () => {
  const htmlBodyMatch = indexCss.match(/html,\s*body\s*\{[^}]*\}/s);
  assert.ok(htmlBodyMatch, 'Expected html, body rule in index.css');
  assert.match(htmlBodyMatch[0], /overflow-y:\s*auto/);
  assert.doesNotMatch(htmlBodyMatch[0], /(?<![-\w])overflow:\s*hidden/);
  assert.doesNotMatch(htmlBodyMatch[0], /(?<![-\w])height:\s*100(?:d?vh|%)/);
});

test('mobile 768px media query wraps topbar instead of clipping action buttons off-screen', () => {
  const mediaMatch = appCss.match(/@media\s*\(max-width:\s*768px\)\s*\{[\s\S]*?\n\}/);
  assert.ok(mediaMatch, 'Expected @media (max-width: 768px) block in App.css');
  const mobileBlock = mediaMatch[0];

  assert.match(mobileBlock, /\.chatgpt-topbar\s*\{[^}]*flex-wrap:\s*wrap/s);
  assert.match(mobileBlock, /\.chatgpt-topbar\s*\{[^}]*height:\s*auto/s);
  assert.match(mobileBlock, /\.topbar-right\s*\{[^}]*margin-left:\s*auto/s);
  assert.match(mobileBlock, /\.model-name\s*\{[^}]*white-space:\s*nowrap/s);
});

test('modal-card uses solid --bg-panel background so dark theme modals stay opaque', () => {
  const modalCardMatch = appCss.match(/\.modal-card\s*\{[^}]*\}/s);
  assert.ok(modalCardMatch, 'Expected .modal-card rule in App.css');
  assert.match(modalCardMatch[0], /background:\s*var\(--bg-panel\)/);
});
