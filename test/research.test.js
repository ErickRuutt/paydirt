import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { findingsFrom } from '../src/research.js';

after(() => pool.end());

test('each finding line keeps only the pages cited inside it', () => {
  const content = [
    { type: 'server_tool_use', name: 'web_search' },
    { type: 'text', text: '- [Listing] Listed for sale at ' },
    { type: 'text', text: '$1.2M in March 2026', citations: [{ url: 'https://a.example/listing', title: 'Listing A' }] },
    { type: 'text', text: '.\n- [Permits] A clearing permit was filed in 2025', citations: [{ url: 'https://b.example/permit', title: 'Permit B' }] },
    { type: 'text', text: '.\nSome stray text without a bullet' },
  ];
  const f = findingsFrom(content);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0], { category: 'Listing', text: 'Listed for sale at $1.2M in March 2026.', sources: [{ url: 'https://a.example/listing', title: 'Listing A' }] });
  assert.equal(f[1].category, 'Permits');
  assert.deepEqual(f[1].sources.map((s) => s.url), ['https://b.example/permit']);
});

test('an unknown category becomes Other', () => {
  const f = findingsFrom([{ type: 'text', text: '- [Gossip] Something' }]);
  assert.equal(f[0].category, 'Other');
});
