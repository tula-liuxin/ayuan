import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = await readFile(path.join(here, '..', 'client.js'), 'utf8')

/** 从真实 client.js 抽出宿主会话行 slot 的镜像注册逻辑，用桩验证「插件新增条目会自动跟随」。 */
function extractMirror() {
  const start = source.indexOf('    function installNativeHistory(ctx) {')
  const end = source.indexOf('    function YuanNativeTools(', start)
  assert.ok(start > 0 && end > start, 'client.js 中应存在 installNativeHistory')
  return source.slice(start, end)
}

const SOURCES = {
  'sidebar.workspaces.session.menu.item': [{ component: 'menu-pin', inject: { menuOpenState: {} }, locale: 'workspace' }],
  'sidebar.workspaces.session.row.action': [{ component: 'row-archive', inject: {}, locale: 'workspace' }],
  'sidebar.session.row.leading': [{ component: 'leading-dot', inject: {}, locale: undefined }],
  'sidebar.session.row.hover': [{ component: 'hover-extra', inject: {}, locale: undefined }],
}

function harness() {
  const entries = JSON.parse(JSON.stringify(SOURCES))
  const registered = [], factories = [], subscriptions = new Map(), disposers = []
  const slots = {
    inject(_key, callback) { return callback() },
    spec(key) { return key === 'sidebar.workspaces.session.menu.item' ? { inject: { hooks: { menuOpenState: {}, shortcuts: {} } } } : undefined },
    registerFactory(definition, component) { factories.push({ definition, component }); return () => {} },
    entriesOfSlot(key) { return entries[key] || [] },
    register(options, component) {
      const record = { options, component, disposed: false }
      registered.push(record)
      return () => { record.disposed = true; disposers.push(options.name + ':' + options.id) }
    },
    subscribe(key, callback) { subscriptions.set(key, callback); return () => subscriptions.delete(key) },
  }
  const code = extractMirror()
  const factory = new Function('ctx', 'YuanHistoryRow', code + '; return installNativeHistory;')
  const rowStub = function YuanHistoryRowStub() { return null }
  const install = () => factory({ slots }, rowStub)({ slots })
  return { install, entries, registered, factories, subscriptions, disposers }
}

test('历史行镜像宿主四个公开扩展点，并复制条目组件/注入/locale', () => {
  const h = harness()
  const dispose = h.install()
  assert.equal(h.factories.length, 1)
  assert.deepEqual(Object.keys(h.factories[0].definition.children).sort(), [
    'ayuan.history.actions', 'ayuan.history.hover', 'ayuan.history.leading', 'ayuan.history.menu',
  ])
  assert.deepEqual(h.factories[0].definition.children['ayuan.history.menu'].inject, { hooks: { menuOpenState: {}, shortcuts: {} } })
  for (const target of ['ayuan.history.menu', 'ayuan.history.actions', 'ayuan.history.leading', 'ayuan.history.hover']) {
    const rows = h.registered.filter((item) => item.options.name === target)
    assert.equal(rows.length, 1, target + ' 应镜像 1 条')
  }
  const menu = h.registered.find((item) => item.options.name === 'ayuan.history.menu')
  assert.equal(menu.component, 'menu-pin')
  assert.deepEqual(menu.options.inject, { menuOpenState: {} })
  assert.equal(menu.options.locale, 'workspace')
  assert.equal(h.registered.find((item) => item.options.name === 'ayuan.history.leading').component, 'leading-dot')
  assert.equal(h.registered.find((item) => item.options.name === 'ayuan.history.hover').component, 'hover-extra')
  dispose()
  assert.ok(h.disposers.length >= 4, '卸载时应释放镜像注册')
})

test('宿主或插件往原生 slot 新增条目时，镜像会重新同步', () => {
  const h = harness()
  h.install()
  const live = (name) => h.registered.filter((item) => item.options.name === name && !item.disposed)
  const before = live('ayuan.history.actions').length
  h.entries['sidebar.workspaces.session.row.action'].push({ component: 'row-pin', inject: {}, locale: 'workspace' })
  h.subscriptions.get('sidebar.workspaces.session.row.action')()
  const after = live('ayuan.history.actions')
  assert.equal(after.length, 2)
  assert.deepEqual(after.map((item) => item.component), ['row-archive', 'row-pin'])
  assert.ok(h.disposers.includes('ayuan.history.actions:host-0'), '同步前应释放旧注册')
  assert.ok(before === 1)
})
