/**
 * SAM — the Notifications row: a long title and body sit on one line until
 * tapped, a second tap folds them again, and the answer buttons are not part
 * of that tap.
 *
 * The suite has no DOM, so the row is a plain function of its props: the test
 * calls it, walks the element tree it returns, and fires the toggle's own
 * onClick, the same handler a tap runs. Static markup (react-dom/server)
 * proves what is on screen in each state.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { NotificationRow, toggleExpanded } from './NotificationRow.js';

const TITLE = 'Job question: ' + 'a very long job name that goes on '.repeat(5).trim();
const BODY = 'Do you want me to clear the stale lock file and relaunch the build? '.repeat(6).trim() + ' END-OF-BODY';

const entry = {
  id: 'n1',
  ts: Date.UTC(2026, 9, 10, 9, 30),
  title: TITLE,
  body: BODY,
  url: '/notifications?n=n1',
  tag: 't',
  chatId: null,
  jobId: 'job-1',
};

const ACCEPT = createElement('button', { 'data-role': 'accept' }, 'Accept');

function row(expanded: boolean, onToggle: () => void = () => {}): ReactElement {
  return createElement(NotificationRow, { entry, expanded, onToggle }, ACCEPT);
}

function find(node: ReactNode, pred: (el: ReactElement) => boolean): ReactElement | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, pred);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (pred(el)) return el;
  return find(el.props.children, pred);
}

/** Call the row as a function to get its element tree (it holds no hooks). */
function tree(expanded: boolean, onToggle: () => void): ReactElement {
  const el = row(expanded, onToggle) as ReactElement<Parameters<typeof NotificationRow>[0]>;
  return NotificationRow(el.props) as ReactElement;
}

test('collapsed: title and body are each cut to one line, full text is not in a wrapping element', () => {
  const html = renderToStaticMarkup(row(false));
  assert.match(html, /aria-expanded="false"/);
  const titleTag = html.match(/<span[^>]*data-role="title"[^>]*>/)?.[0] ?? '';
  const bodyTag = html.match(/<span[^>]*data-role="body"[^>]*>/)?.[0] ?? '';
  assert.match(titleTag, /\btruncate\b/);
  assert.match(bodyTag, /\btruncate\b/);
});

test('expanded: the whole title and body show with no truncation', () => {
  const html = renderToStaticMarkup(row(true));
  assert.match(html, /aria-expanded="true"/);
  const titleTag = html.match(/<span[^>]*data-role="title"[^>]*>/)?.[0] ?? '';
  const bodyTag = html.match(/<span[^>]*data-role="body"[^>]*>/)?.[0] ?? '';
  assert.doesNotMatch(titleTag, /truncate/);
  assert.doesNotMatch(bodyTag, /truncate/);
  assert.match(titleTag, /break-words/);
  assert.match(bodyTag, /break-words/);
  assert.ok(html.includes(BODY), 'the full body text is in the markup');
  assert.ok(html.includes(TITLE), 'the full title text is in the markup');
});

test('tapping the entry calls onToggle; tapping again folds it back', () => {
  let open = new Set<string>();
  const taps = () => {
    open = toggleExpanded(open, entry.id);
  };
  const press = (expanded: boolean) => {
    const toggle = find(tree(expanded, taps), (el) => (el.props as Record<string, unknown>)['data-role'] === 'toggle');
    assert.ok(toggle, 'the row has a toggle');
    (toggle.props as { onClick: () => void }).onClick();
  };
  assert.equal(open.has(entry.id), false);
  press(open.has(entry.id));
  assert.equal(open.has(entry.id), true, 'first tap expands');
  press(open.has(entry.id));
  assert.equal(open.has(entry.id), false, 'second tap collapses');
});

test('toggleExpanded leaves other rows alone and does not mutate its input', () => {
  const before = new Set(['a']);
  const after = toggleExpanded(before, 'b');
  assert.deepEqual([...before], ['a']);
  assert.deepEqual([...after].sort(), ['a', 'b']);
});

test('the Accept button sits outside the toggle, so pressing it cannot expand the row', () => {
  const root = tree(false, () => {
    throw new Error('toggle must not fire');
  });
  const toggle = find(root, (el) => (el.props as Record<string, unknown>)['data-role'] === 'toggle');
  assert.ok(toggle);
  assert.equal(find(toggle, (el) => (el.props as Record<string, unknown>)['data-role'] === 'accept'), null);
  assert.ok(find(root, (el) => (el.props as Record<string, unknown>)['data-role'] === 'accept'), 'the button is still rendered in the row');
  assert.match(renderToStaticMarkup(row(false)), /data-role="accept"/);
});

test('expanded row offers a link to open the ping target', () => {
  assert.doesNotMatch(renderToStaticMarkup(row(false)), /href=/);
  assert.match(renderToStaticMarkup(row(true)), /href="\/jobs\/job-1"/);
});
