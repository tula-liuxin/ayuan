import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = await readFile(path.join(here, '..', 'client.js'), 'utf8')

/** 从真实 client.js 里抽出「空白会话打开」逻辑，用桩执行；防止再次把首条消息写回旧会话。 */
function extractDraftLogic() {
  const start = source.indexOf('let draftOpening = null')
  const end = source.indexOf('    async function openYuan(', start)
  assert.ok(start > 0 && end > start, 'client.js 中应存在 draft 打开逻辑')
  return source.slice(start, end)
}

function harness({ sessions = [], rows = {}, phase = 'ready', openYuan }) {
  const calls = []
  const snapshot = { phase, byId: rows }
  const yuan = { state: { sessions }, loading: false }
  const clientService = (name) => name === 'sessions'
    ? { list: { getSnapshot: () => snapshot } }
    : null
  const factory = new Function('yuan', 'clientService', 'openYuan', 'captureOrigin', 'setTimeout',
    extractDraftLogic() + '; return openDraftYuan;')
  const open = factory(yuan, clientService, async (options) => {
    calls.push(options)
    return openYuan(options)
  }, () => ({ title: '测试页面' }), setTimeout)
  return { open, calls, snapshot, yuan }
}

test('draft 打开优先复用真正的空白会话，并避开主界面正在显示的空白会话', async () => {
  const rows = {
    'shown-in-main': { blank: true, retainedBy: { mainView: 1 } },
    usable: { blank: true, retainedBy: {} },
    used: { blank: false, retainedBy: {} },
  }
  const h = harness({ sessions: [{ id: 'shown-in-main' }, { id: 'usable' }, { id: 'used' }], rows,
    openYuan: (options) => ({ sessionId: options.sessionId ?? 'fresh' }) })
  const result = await h.open()
  assert.deepEqual(h.calls, [{ sessionId: 'usable', origin: { title: '测试页面' } }])
  assert.equal(result.sessionId, 'usable')
})

test('draft 没有可用空白会话时创建新会话，而不是恢复旧会话', async () => {
  const h = harness({ sessions: [{ id: 'old' }], rows: { old: { blank: false, retainedBy: {} } },
    openYuan: (options) => ({ sessionId: options.newSession === true ? 'fresh' : 'old' }) })
  const result = await h.open()
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].newSession, true)
  assert.equal(h.calls[0].sessionId, undefined)
  assert.equal(result.sessionId, 'fresh')
})

test('draft 恢复空白会话失败时退回创建新会话', async (t) => {
  const warn = console.warn
  console.warn = () => {}
  t.after(() => { console.warn = warn })
  const h = harness({ sessions: [{ id: 'blank' }], rows: { blank: { blank: true, retainedBy: {} } },
    openYuan: (options) => {
      if (options.sessionId) throw new Error('resume failed')
      return { sessionId: 'fresh' }
    } })
  const result = await h.open()
  assert.deepEqual(h.calls.map((call) => call.sessionId ?? 'new'), ['blank', 'new'])
  assert.equal(result.sessionId, 'fresh')
})

test('draft 打开期间重复点击共享同一个请求，不重复创建空白会话', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const h = harness({ sessions: [], rows: {}, openYuan: async () => { await gate; return { sessionId: 'fresh' } } })
  const first = h.open()
  const second = h.open()
  assert.equal(h.calls.length, 0)
  release()
  assert.deepEqual(await Promise.all([first, second]), [{ sessionId: 'fresh' }, { sessionId: 'fresh' }])
  assert.equal(h.calls.length, 1)
})

test('会话列表还在 pending 时先等它就绪，再决定复用还是新建', async () => {
  const rows = { blank: { blank: true, retainedBy: {} } }
  const h = harness({ sessions: [{ id: 'blank' }], rows, openYuan: (options) => ({ sessionId: options.sessionId ?? 'fresh' }) })
  h.snapshot.phase = 'pending'
  setTimeout(() => { h.snapshot.phase = 'ready' }, 160)
  const started = Date.now()
  const result = await h.open()
  assert.ok(Date.now() - started >= 140, '应等待列表就绪')
  assert.equal(result.sessionId, 'blank')
  assert.deepEqual(h.calls, [{ sessionId: 'blank', origin: { title: '测试页面' } }])
})

test('空白会话返回了别的 id 时视为失败并新建，不绑定错会话', async (t) => {
  const warn = console.warn
  console.warn = () => {}
  t.after(() => { console.warn = warn })
  const h = harness({ sessions: [{ id: 'blank' }], rows: { blank: { blank: true, retainedBy: {} } },
    openYuan: (options) => ({ sessionId: options.sessionId ? 'other' : 'fresh' }) })
  const result = await h.open()
  assert.deepEqual(h.calls.map((call) => call.sessionId ?? 'new'), ['blank', 'new'])
  assert.equal(result.sessionId, 'fresh')
})
