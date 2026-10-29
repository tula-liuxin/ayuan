import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = await readFile(path.join(here, '..', 'client.js'), 'utf8')

/** 从真实 client.js 抽出「浮框读过即清宿主左侧未读点」的实现，用桩验证与降级。 */
function extractMarkRead() {
  const start = source.indexOf('    function markFloatSessionRead(')
  const end = source.indexOf('    const floating = {', start)
  assert.ok(start > 0 && end > start, 'client.js 中应存在 markFloatSessionRead')
  return source.slice(start, end)
}

function harness(mock) {
  const factory = new Function('clientService', extractMarkRead() + '; return markFloatSessionRead;')
  return factory(() => mock)
}

test('浮框显示会话时清除宿主的 completionUnread 并通知状态源', () => {
  const unread = new Set(['session-a', 'session-b'])
  let published = 0
  const mark = harness({ completionUnread: unread, publishStatus: () => { published++ } })
  mark('session-a')
  assert.equal(unread.has('session-a'), false)
  assert.equal(unread.has('session-b'), true)
  assert.equal(published, 1)
})

test('会话本来就不在未读集合里时不打扰宿主', () => {
  const unread = new Set()
  let published = 0
  const mark = harness({ completionUnread: unread, publishStatus: () => { published++ } })
  mark('session-a')
  assert.equal(published, 0)
})

test('宿主实现变化/状态源不可用时不抛错，只是不清点', () => {
  const markMissing = harness({})
  assert.doesNotThrow(() => markMissing('session-a'))
  const markBroken = harness({ completionUnread: new Set(['session-a']), publishStatus: () => { throw new Error('host changed') } })
  assert.doesNotThrow(() => markBroken('session-a'))
  const markNull = harness(null)
  assert.doesNotThrow(() => markNull('session-a'))
})

test('非法 sessionId 直接忽略', () => {
  const unread = new Set([''])
  let published = 0
  const mark = harness({ completionUnread: unread, publishStatus: () => { published++ } })
  mark('')
  mark(undefined)
  mark(42)
  assert.equal(published, 0)
  assert.equal(unread.has(''), true)
})
