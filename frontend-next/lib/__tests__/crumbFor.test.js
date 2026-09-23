import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crumbFor } from '../crumb.js';

test('crumbFor: root path', () => {
  assert.equal(crumbFor('/'), 'เมนูหลัก');
});

test('crumbFor: longer, more-specific match wins over a shorter prefix', () => {
  assert.equal(crumbFor('/customers/new'), 'ลูกค้าใหม่');
  assert.notEqual(crumbFor('/customers/new'), 'ลูกค้า');
});

test('crumbFor: unknown path falls back to TIMEOPTIC @ Be Well MEDICAL CENTER', () => {
  assert.equal(crumbFor('/no-such-route'), 'TIMEOPTIC @ Be Well MEDICAL CENTER');
});
