import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorkAreaPath } from '@/lib/swWorkArea';

test('isWorkAreaPath is true for the three work-area routes', () => {
  assert.equal(isWorkAreaPath('/api/vault/file'), true);
  assert.equal(isWorkAreaPath('/api/vault/meta'), true);
  assert.equal(isWorkAreaPath('/api/vault/recent'), true);
});

test('isWorkAreaPath is false for other routes', () => {
  assert.equal(isWorkAreaPath('/api/vault/graph'), false);
  assert.equal(isWorkAreaPath('/api/chats'), false);
});
