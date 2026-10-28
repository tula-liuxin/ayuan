import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createSessionBrowser, describeSourceContext, normalizeOrigin } from '../context.js'
import { topicTitle } from '../agent.js'

test('bundle rows cannot override core tools or unscoped shared rows', async () => {
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const ids = [...patch.matchAll(/\bid:\s*([\w-]+)/g)].map(m => m[1])
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.length >= 6)
  assert.ok(ids.every(id => id === 'ayuan' || id.startsWith('ayuan-')))
  assert.ok(!ids.includes('tools'))
})

test('same-workspace filtering occurs before limiting and excludes source/subagents', async () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ header: { id: 'other-' + i, cwd: '/other', createdAt: 100 + i } }))
  rows.push(...[
    { id: 'source', cwd: '/project', createdAt: 9 },
    { id: 'old', cwd: '/project', createdAt: 1 },
    { id: 'new', cwd: '/project', createdAt: 8 },
    { id: 'child', cwd: '/project', createdAt: 10, origin: 'subagent' },
  ].map(header => ({ header })))
  const browser = createSessionBrowser({ getQuery: () => ({
    listSessions: async () => rows,
    filterEvents: async () => [],
    readTitleSnapshots: async ids => ids.map(sessionId => ({ sessionId, status: 'fulfilled', value: { title: { title: sessionId } } })),
  }) })
  const list = await browser.list({ cwd: '/project', excludeId: 'source', limit: 1 })
  assert.deepEqual(list.map(x => x.id), ['new'])
  const source = { origin: normalizeOrigin({ sessionId: 'source', cwd: '/project', title: '来源标题' }), expiresAt: Date.now() + 10000 }
  const description = await describeSourceContext(source, { sessions: options => browser.list(options) })
  assert.match(description, /来源标题/)
  assert.match(description, /同目录其它会话/)
  assert.ok(!description.includes('other-'))
  assert.ok(description.length <= 900)
  assert.equal(await describeSourceContext({ ...source, expiresAt: 0 }, { sessions() { throw Error('must not query') } }), '')
})

test('topic names are bounded and avoid credential text', () => {
  assert.equal(topicTitle('  帮我\n整理项目计划 '), '阿源 · 帮我 整理项目计划')
  assert.equal([...topicTitle('🙂'.repeat(30)).split(' · ')[1]].length, 20)
})
