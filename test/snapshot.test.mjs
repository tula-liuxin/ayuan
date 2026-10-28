import test from 'node:test'
import assert from 'node:assert/strict'
import { createViewSnapshot, createSessionBrowser } from '../context.js'

test('snapshot heartbeat keeps revision; changes and expiry are observable without persistence', () => {
  let time = 1000000
  const store = createViewSnapshot({ now: () => time })
  assert.equal(store.get(), null)
  const first = store.update({ title: '主会话', route: 'conversation', selection: 'private', image: 'data:image/png;base64,abc', code: 'code', page: 'body' })
  assert.equal(first.revision, 1)
  for (const key of ['selection', 'image', 'code', 'page', 'at']) assert.equal(key in first.view, false)
  time += 30000
  const heartbeat = store.update({ title: '主会话', route: 'conversation' })
  assert.equal(heartbeat.revision, 1)
  assert.equal(heartbeat.changedAt, first.changedAt)
  assert.notEqual(heartbeat.observedAt, first.observedAt)
  const changed = store.update({ title: 'file.js', route: 'sidebar.right', secondary: '主会话' })
  assert.equal(changed.revision, 2)
  changed.view.title = 'mutated'
  assert.equal(store.get().view.title, 'file.js')
  time += 120001
  assert.equal(store.get().stale, true)
})

test('session read respects character budget and reports a clipped single message', async () => {
  const browser = createSessionBrowser({ getQuery: () => ({ listSessions: async () => [], readTitleSnapshot: async () => null,
    filterEvents: async () => [{ type: 'user/message', text: 'x'.repeat(1000), seq: 1, time: 0 }] }) })
  const result = await browser.read('session-test', { chars: 400 })
  assert.equal(result.messages[0].text.length, 400)
  assert.equal(result.truncated, true)
})
