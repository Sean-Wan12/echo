import test from 'node:test';
import assert from 'node:assert/strict';
import { sidebarTheme } from '../extension/sidebar-theme.js';

test('native sidebar follows rapid theme changes and restores the existing browser theme', async () => {
  const original = { colors: { frame: '#123456', toolbar: '#abcdef', sidebar: '#eeeeee' }, properties: { color_scheme: 'light' } };
  const current = new Map([[1, structuredClone(original)], [2, { colors: { sidebar: '#777777' } }]]);
  const manager = sidebarTheme({
    getCurrent: async id => structuredClone(current.get(id)),
    update: async (id, theme) => current.set(id, structuredClone(theme)),
    reset: async id => current.set(id, {})
  });
  await manager.apply(1, true);
  assert.equal(current.get(1).colors.sidebar, '#1b1b20');
  assert.equal(current.get(1).colors.sidebar_text, '#efedf1');
  assert.equal(current.get(1).colors.frame, original.colors.frame);
  assert.deepEqual(current.get(1).properties, original.properties);
  await Promise.all([manager.apply(1, false), manager.apply(1, true), manager.restore(1)]);
  assert.deepEqual(current.get(1), original);
  assert.deepEqual(current.get(2), { colors: { sidebar: '#777777' } });
  await manager.apply(1, false);
  assert.equal(current.get(1).colors.sidebar, '#f8f8fa');
  const replacement = { colors: { sidebar: '#111111', frame: '#ff0000' } };
  current.set(1, replacement);
  await manager.restore(1);
  assert.deepEqual(current.get(1), replacement);
});
