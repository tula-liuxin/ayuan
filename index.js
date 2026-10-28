/**
 * ayuan — Host 半边（bare 入口 `ayuan`）
 *
 * 职责：
 *   - 配置与数据目录（config.dataDir > AYUAN_DATA > 平台默认）
 *   - 页面 token（__AYUAN_PAGE_TOKEN__ / x-ayuan-token，持久化 <dataDir>/page-token）
 *   - 共享运行环境（ayuanRuntime 服务）：看板/建议/提醒读取、模型选择、旧版 yuan 服务
 *   - 本机 HTTP（/ayuan/api/*）与中心 HTTP（经 leoHub.registerRoute 挂载 /api/yuan/*）
 *   - 组合 agent.js（真实 Agent 会话运行时）
 *
 * 与 leo-status 的关系：只通过 Cordis 服务通信。leoBoard 缺失时 tasks 为空；
 * leoHub 缺失时按本机模式运行，不抛未捕获异常。
 */
import path from 'node:path'
import { mkdirSync } from 'node:fs'
import { resolveDataDir, loadPageToken, requestTokenMatches } from './page-token.js'
import { createYuanService } from './legacy.js'
import { apply as applyAgent } from './agent.js'

export const name = 'ayuan'
/** 不硬依赖任何服务：缺 webServer / leoHub / leoBoard 时逐级降级。 */
export const inject = []
export const PLUGIN_VERSION = '2.0.0'

const LOCAL_PREFIX = '/ayuan/api'
const CENTRAL_PREFIX = '/api/yuan/'
const READ_ROUTES = new Set(['state', 'signals', 'activity', 'sessions', 'snapshot'])
const LOCAL_ONLY = new Set(['open', 'sessions', 'chat', 'activity', 'stop', 'snapshot', 'snapshot/update'])
const methodOf = (route) => (READ_ROUTES.has(route) ? 'GET' : 'POST')

const LOCAL_ROUTES = [
  ['state', 'GET'], ['signals', 'GET'], ['activity', 'GET'], ['sessions', 'GET'],
  ['open', 'POST'], ['chat', 'POST'], ['stop', 'POST'], ['snapshot', 'GET'], ['snapshot/update', 'POST'],
  ['memory/query', 'POST'], ['memory/change', 'POST'], ['memory/remove', 'POST'],
  ['remember', 'POST'], ['reminder', 'POST'], ['reminder/done', 'POST'], ['seen', 'POST'],
]

const CENTRAL_ROUTES = new Set([
  'state', 'signals', 'activity', 'sessions',
  'open', 'chat', 'stop',
  'memory/query', 'memory/change', 'memory/note', 'memory/capture',
  'remember', 'memory/delete', 'memory/accept',
  'reminder', 'reminder/done', 'seen',
])

function nowIso() {
  return new Date().toISOString()
}

function describeError(error) {
  if (error === null || error === undefined) return 'unknown error'
  if (typeof error === 'string') return error
  return String(error?.message ?? error)
}

function plainText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

async function readJsonBody(req, limit = 1_048_576) {
  let text = ''
  for await (const chunk of req) {
    text += chunk
    if (Buffer.byteLength(text) > limit) throw new Error('请求体过大')
  }
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/** 读取宿主服务；缺失时返回 null（降级，不抛异常）。 */
function lookup(ctx, serviceName) {
  try {
    const value = ctx.get(serviceName)
    return value === undefined ? null : value
  } catch {
    return null
  }
}

/**
 * 共享运行环境：memory/status/context/tools 通过 `ctx.inject(['ayuanRuntime'])` 取这一份。
 * 只做数据读取与桥接，不直接写别人的状态。
 */
function createRuntime({ ctx, dataDir, log = () => {}, config = {} }) {
  const row = config !== null && typeof config === 'object' ? config : {}
  let llm = null
  let agentDefaultModel = null
  let legacy = null
  let legacyPromise = null

  const llmBridge = {
    get stream() {
      return llm !== null && llm !== undefined && typeof llm.stream === 'function' ? llm.stream.bind(llm) : undefined
    },
    listProviders() {
      return llm !== null && llm !== undefined && typeof llm.listProviders === 'function' ? llm.listProviders() : []
    },
  }

  function getModel() {
    if (row.model !== null && typeof row.model === 'object' && typeof row.model.provider === 'string') return row.model
    try {
      if (agentDefaultModel !== null && agentDefaultModel !== undefined && typeof agentDefaultModel.currentSelection === 'function') {
        const selection = agentDefaultModel.currentSelection()
        if (selection !== null && typeof selection === 'object' && typeof selection.provider === 'string' && typeof selection.model === 'string') return selection
      }
    } catch (error) {
      log('ayuan: default model unavailable:', describeError(error))
    }
    return null
  }

  const hub = () => lookup(ctx, 'leoHub')
  const mode = () => {
    try { return hub()?.mode?.() ?? 'local' } catch { return 'local' }
  }
  const isDevice = () => {
    try { return hub()?.isDevice?.() === true } catch { return false }
  }

  /** 看板数据；没有 leo-status（缺 leoBoard）时返回 null。 */
  async function board(force = false) {
    const service = lookup(ctx, 'leoBoard')
    if (!service || typeof service.list !== 'function') return null
    try {
      return await service.list({ force: force === true })
    } catch (error) {
      log('ayuan board:', describeError(error))
      return null
    }
  }

  async function suggestions() {
    const current = await board(false)
    return Array.isArray(current?.suggestions) ? current.suggestions : []
  }

  async function reminders() {
    try {
      const service = await ensureLegacy()
      return (await service.store?.loadReminders?.()) ?? []
    } catch (error) {
      log('ayuan reminders:', describeError(error))
      return []
    }
  }

  async function ensureLegacy() {
    if (legacy !== null) return legacy
    if (legacyPromise !== null) return legacyPromise
    legacyPromise = (async () => {
      mkdirSync(path.join(dataDir, 'yuan'), { recursive: true })
      const service = createYuanService({
        dataDir,
        log,
        llm: llmBridge,
        getModel,
        // 阿源的真实 Agent 会话（ayuanAgent 由 agent.js 同一行提供）。
        agentChat: (text, options) => {
          const agent = lookup(ctx, 'ayuanAgent')
          if (!agent || typeof agent.chat !== 'function') return undefined
          return agent.chat(text, options)
        },
        config: { yuan: { model: row.model ?? null, name: typeof row.name === 'string' && row.name !== '' ? row.name : '阿源' } },
      })
      await service.ensureLoaded()
      legacy = service
      return service
    })()
    try {
      return await legacyPromise
    } finally {
      if (legacy === null) legacyPromise = null
    }
  }

  return {
    ctx,
    dataDir,
    log,
    config: row,
    llm: () => llm,
    llmBridge,
    setLlm(value) { llm = value },
    setAgentDefaultModel(value) { agentDefaultModel = value },
    getModel,
    hub,
    mode,
    isDevice,
    board,
    suggestions,
    reminders,
    ensureLegacy,
    lookup: (serviceName) => lookup(ctx, serviceName),
    query: () => lookup(ctx, 'sessionQuery'),
    dataPath: (...parts) => path.join(dataDir, ...parts),
    ensureDataDir() { mkdirSync(dataDir, { recursive: true }) },
  }
}

export function apply(ctx, config) {
  const rowConfig = config !== null && typeof config === 'object' ? config : {}
  const dataDir = resolveDataDir(rowConfig)
  const log = (...args) => console.log('[ayuan]', ...args)
  const pageToken = loadPageToken(dataDir, log)
  const runtime = createRuntime({ ctx, dataDir, log, config: rowConfig })
  ctx.provide('ayuanRuntime', runtime)

  ctx.inject(['llm'], ({ llm }) => { runtime.setLlm(llm); log('llm ready') })
  ctx.inject(['agentDefaultModel'], ({ agentDefaultModel }) => runtime.setAgentDefaultModel(agentDefaultModel))

  const startupPromise = (async () => {
    runtime.ensureDataDir()
    await runtime.ensureLegacy()
    log(`dataDir=${dataDir}`, `mode=${runtime.mode()}`)
  })().catch((error) => { log('startup failed:', describeError(error)) })

  // 同一行提供 ayuanAgent（open/chat/activity/stop）。
  applyAgent(ctx, rowConfig)

  /* ------------------------------ 操作实现 ------------------------------ */

  const service = (serviceName) => runtime.lookup(serviceName)

  async function yuanState() {
    const board = await runtime.board(false)
    const suggestions = Array.isArray(board?.suggestions) ? board.suggestions : []
    const legacy = await runtime.ensureLegacy().catch(() => null)
    const shared = legacy ? await legacy.statePayload({ board, suggestions, chatLimit: 30 }) : null
    const agent = service('ayuanAgent')
    let agentStatus = { enabled: agent !== null, ready: false, sessionId: null, error: null }
    if (agent !== null) {
      try {
        await agent.ensure()
        agentStatus = { enabled: true, ready: true, sessionId: agent.sessionId, error: null }
      } catch (error) {
        agentStatus = { enabled: true, ready: false, sessionId: null, error: describeError(error) }
      }
    }
    const memory = service('ayuanMemory')
    let memoryStatus = null
    try { memoryStatus = memory?.status?.() ?? null } catch { memoryStatus = null }
    return {
      ok: true,
      name: shared?.name ?? '阿源',
      signals: shared?.signals ?? [],
      badge: shared?.badge ?? { total: 0, urgent: 0, kinds: {}, hasUnread: false },
      unread: shared?.unread ?? false,
      suggestions,
      chat: shared?.chat ?? [],
      memory: shared?.memory ?? [],
      reminders: shared?.reminders ?? [],
      model: shared?.model ?? { provider: null, model: null, available: false },
      agent: agentStatus,
      mode: runtime.mode(),
      sessions: agent !== null ? await agent.sessions().catch(() => []) : [],
      context: agent !== null ? agent.context() : null,
      memoryStatus,
    }
  }

  async function yuanSignals() {
    const board = await runtime.board(false)
    const suggestions = Array.isArray(board?.suggestions) ? board.suggestions : []
    const legacy = await runtime.ensureLegacy().catch(() => null)
    if (legacy === null) {
      return { ok: true, signals: [], badge: { total: 0, urgent: 0, kinds: {}, hasUnread: false }, unread: false, pending: suggestions.length }
    }
    const payload = await legacy.statePayload({ board, suggestions, chatLimit: 0 })
    const agent = service('ayuanAgent')
    return { ok: true, signals: payload.signals, badge: payload.badge, unread: payload.unread, pending: suggestions.length,
      agent: { enabled: agent !== null, sessionId: agent?.sessionId ?? null } }
  }

  async function yuanChat(body = {}) {
    const legacy = await runtime.ensureLegacy()
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (message === '') throw new Error('消息不能为空')
    const board = await runtime.board(false)
    const suggestions = Array.isArray(board?.suggestions) ? board.suggestions : []
    const result = await legacy.chat(message, { board, suggestions })
    const created = []
    const leoBoard = service('leoBoard')
    if (Array.isArray(result.proposals) && result.proposals.length > 0) {
      for (const proposal of result.proposals) {
        const text = plainText(proposal?.text)
        if (text === '') continue
        if (!leoBoard || typeof leoBoard.propose !== 'function') {
          log('ayuan proposal dropped: leoBoard unavailable')
          continue
        }
        try {
          const item = await leoBoard.propose(text)
          if (item?.id) created.push(item.id)
        } catch (error) {
          log('ayuan proposal merge failed:', describeError(error))
        }
      }
    }
    const fresh = await runtime.board(true)
    return {
      ok: true,
      reply: result.reply,
      chat: result.chat,
      proposals: result.proposals,
      tools: Array.isArray(result.tools) ? result.tools : [],
      usedAgent: result.usedAgent === true,
      suggestions: Array.isArray(fresh?.suggestions) ? fresh.suggestions : suggestions,
      signals: fresh?.yuan?.signals ?? [],
      badge: fresh?.yuan?.badge ?? { total: 0, urgent: 0, kinds: {}, hasUnread: false },
      created,
    }
  }

  async function memoryList() {
    const legacy = await runtime.ensureLegacy().catch(() => null)
    return legacy ? legacy.memory.slice(-200) : []
  }

  async function memoryQuery(body = {}) {
    const memory = service('ayuanMemory')
    if (!memory) return { ok: true, items: [], status: null }
    let status = null
    try { status = memory.status?.() ?? null } catch { status = null }
    if (body?.id) return { ok: true, items: [await memory.detail(body.id)].filter(Boolean), status }
    if (body?.query) return { ok: true, items: await memory.search(body.query, { limit: 30, budget: 10000 }), status }
    return { ok: true, items: await memory.list({ limit: 100 }), status }
  }

  async function memoryChange(body = {}) {
    const memory = service('ayuanMemory')
    if (!memory) throw new Error('记忆服务未就绪')
    return { ok: true, item: await memory.change(body?.id, body?.action, body?.text) }
  }

  async function memoryNote(body = {}) {
    const memory = service('ayuanMemory')
    if (!memory) throw new Error('记忆服务未就绪')
    return { ok: true, item: await memory.note(body) }
  }

  async function memoryCapture(body = {}) {
    const memory = service('ayuanMemory')
    if (!memory) throw new Error('记忆服务未就绪')
    return { ok: true, item: await memory.capture(body) }
  }

  async function rememberLegacy(body = {}) {
    const legacy = await runtime.ensureLegacy()
    const text = plainText(body?.text)
    if (text === '') throw new Error('记忆内容不能为空')
    const memory = await legacy.remember(text)
    return { ok: true, memory, memories: await memoryList() }
  }

  async function forgetLegacy(body = {}) {
    const legacy = await runtime.ensureLegacy()
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (id === '') throw new Error('缺少记忆 id')
    const ok = await legacy.forget(id)
    return { ok, memories: await memoryList() }
  }

  async function acceptMemoryLegacy(body = {}) {
    const legacy = await runtime.ensureLegacy()
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (id === '') throw new Error('缺少记忆 id')
    const memory = await legacy.acceptMemory(id)
    return { ok: memory !== null, memory, memories: await memoryList() }
  }

  async function reminderPayload() {
    const legacy = await runtime.ensureLegacy()
    const board = await runtime.board(false)
    const suggestions = Array.isArray(board?.suggestions) ? board.suggestions : []
    return legacy.statePayload({ board, suggestions, chatLimit: 0 })
  }

  async function addReminder(body = {}) {
    const legacy = await runtime.ensureLegacy()
    const text = plainText(body?.text)
    const at = typeof body?.at === 'string' ? body.at : ''
    if (text === '') throw new Error('提醒内容不能为空')
    const reminder = await legacy.addReminder(text, at)
    const payload = await reminderPayload()
    return { ok: true, reminder, reminders: payload.reminders, signals: payload.signals, badge: payload.badge }
  }

  async function finishReminder(body = {}) {
    const legacy = await runtime.ensureLegacy()
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (id === '') throw new Error('缺少提醒 id')
    const reminder = await legacy.doneReminder(id)
    if (reminder === null) throw new Error('提醒不存在')
    const payload = await reminderPayload()
    return { ok: true, reminder, reminders: payload.reminders, signals: payload.signals, badge: payload.badge }
  }

  async function markSeen() {
    const legacy = await runtime.ensureLegacy().catch(() => null)
    const lastSeenAt = legacy !== null ? await legacy.markSeen() : Date.now()
    return { ok: true, lastSeenAt }
  }

  async function agentActivity() {
    const agent = service('ayuanAgent')
    if (!agent) return { running: false, text: '', tools: [] }
    return agent.activity()
  }

  async function agentSessions() {
    const agent = service('ayuanAgent')
    if (!agent) return []
    return agent.sessions()
  }

  async function openAgent(body = {}) {
    const agent = service('ayuanAgent')
    if (!agent) throw new Error('原生阿源尚不可用')
    return agent.open(body)
  }

  async function stopAgent() {
    const agent = service('ayuanAgent')
    if (agent) return agent.stop()
    return { ok: true }
  }

  const operations = {
    snapshot: () => ({ ok: true, snapshot: service('ayuanContext')?.snapshot?.() || null }),
    'snapshot/update': body => ({ ok: true, snapshot: service('ayuanContext')?.updateSnapshot?.(body || {}) || null }),
    state: () => yuanState(),
    signals: () => yuanSignals(),
    activity: async () => ({ ok: true, activity: await agentActivity() }),
    sessions: async () => ({ ok: true, sessions: await agentSessions() }),
    open: (body) => openAgent(body || {}),
    chat: (body) => yuanChat(body || {}),
    stop: () => stopAgent(),
    'memory/query': (body) => memoryQuery(body || {}),
    'memory/change': (body) => memoryChange(body || {}),
    'memory/remove': (body) => forgetLegacy(body || {}),
    'memory/delete': (body) => forgetLegacy(body || {}),
    'memory/accept': (body) => acceptMemoryLegacy(body || {}),
    'memory/note': (body) => memoryNote(body || {}),
    'memory/capture': (body) => memoryCapture(body || {}),
    remember: (body) => rememberLegacy(body || {}),
    reminder: (body) => addReminder(body || {}),
    'reminder/done': (body) => finishReminder(body || {}),
    seen: () => markSeen(),
  }

  async function runOperation(route, body) {
    await startupPromise
    const operation = operations[route]
    if (typeof operation !== 'function') throw new Error('未知阿源操作')
    return operation(body)
  }

  /**
   * 本机路由：设备模式下，只有会话/模型/工具在本机执行，记忆与提醒仍以中心为准。
   * open/sessions/chat/activity/stop 本机执行；其余转发 leoHub.remoteCall。
   */
  async function localOperation(route, body) {
    const hub = runtime.hub()
    const device = hub?.isDevice?.() === true
    if (device && route === 'state') {
      const local = await runOperation('state', body)
      try {
        const remote = await hub.remoteCall('state', undefined)
        const merged = { ...local }
        for (const key of ['suggestions', 'reminders', 'memory', 'signals', 'badge', 'unread', 'memoryStatus', 'lastSeenAt']) {
          if (remote !== null && remote !== undefined && remote[key] !== undefined) merged[key] = remote[key]
        }
        return { ...merged, mode: runtime.mode() }
      } catch (error) {
        log('ayuan hub state unavailable:', describeError(error))
        return local
      }
    }
    if (device && !LOCAL_ONLY.has(route)) {
      const target = route === 'memory/remove' ? 'memory/delete' : route
      try {
        const data = await hub.remoteCall(target, body)
        return { ...(data ?? {}), mode: runtime.mode() }
      } catch (error) {
        const wrapped = new Error(`中心阿源暂不可用：${describeError(error)}`)
        wrapped.remote = true
        throw wrapped
      }
    }
    try {
      const data = await runOperation(route, body)
      return device ? { ...(data ?? {}), mode: runtime.mode() } : data
    } catch (error) {
      if (device && LOCAL_ONLY.has(route)) {
        const wrapped = new Error(`本机阿源暂不可用：${describeError(error)}`)
        wrapped.localDevice = true
        throw wrapped
      }
      throw error
    }
  }

  /* ------------------------------- 本机 HTTP ------------------------------- */

  ctx.inject(['webServer', 'connection'], (http) => {
    const connection = http.connection

    const authorized = (req, res) => {
      const site = req.headers !== null && typeof req.headers === 'object' ? req.headers['sec-fetch-site'] : undefined
      if (typeof site === 'string' && site.toLowerCase() === 'cross-site') {
        try { sendJson(res, 403, { ok: false, error: 'cross-site request rejected' }) } catch {}
        return false
      }
      if (requestTokenMatches(req, pageToken)) return true
      if (typeof connection?.authorizeIndex === 'function') {
        const ok = connection.authorizeIndex(req, res)
        if (ok) return true
        const alreadySent = res !== null && typeof res === 'object' && (res.headersSent === true || res.writableEnded === true)
        if (!alreadySent) {
          try { sendJson(res, 401, { ok: false, error: 'unauthorized' }) } catch {}
        }
        return false
      }
      return true
    }

    try {
      ctx.effect(() => http.webServer.tapIndex((html) => {
        if (typeof html !== 'string' || html.includes('__AYUAN_PAGE_TOKEN__')) return html
        const script = `<script>window.__AYUAN_PAGE_TOKEN__=${JSON.stringify(pageToken)}</script>`
        return html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : `${html}${script}`
      }), 'ayuan: page token')
    } catch (error) {
      log('page token injection unavailable:', describeError(error))
    }


    const handler = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const suffix = url.pathname.slice((LOCAL_PREFIX + '/').length)
      const route = suffix
      try {
        if (!authorized(req, res)) return
        if (!Object.prototype.hasOwnProperty.call(operations, route) || !LOCAL_ROUTES.some(([name]) => name === route)) {
          sendJson(res, 404, { ok: false, error: 'not found' })
          return
        }
        const method = typeof req.method === 'string' ? req.method.toUpperCase() : ''
        if (method !== methodOf(route)) {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const body = method === 'GET' ? {} : await readJsonBody(req)
        sendJson(res, 200, await localOperation(route, body))
      } catch (error) {
        const status = error?.remote === true || error?.localDevice === true ? 503 : 400
        try { sendJson(res, status, { ok: false, error: describeError(error) }) } catch {}
      }
    }

    for (const [route] of LOCAL_ROUTES) {
      const routePath = `${LOCAL_PREFIX}/${route}`
      ctx.effect(() => http.webServer.register({ kind: 'exact', path: routePath, handler }), `ayuan: ${routePath}`)
    }
    log('routes ready ·', LOCAL_ROUTES.map(([route]) => route).join(', '))
  })

  /* ------------------------------- 中心 HTTP ------------------------------- */

  ctx.inject(['leoHub'], (scope) => {
    const { leoHub } = scope
    if (!leoHub || typeof leoHub.registerRoute !== 'function') return
    const centralHandler = async (req, res, pathname, method) => {
      if (typeof pathname !== 'string' || !pathname.startsWith(CENTRAL_PREFIX)) return false
      const route = pathname.slice(CENTRAL_PREFIX.length)
      if (!CENTRAL_ROUTES.has(route)) return false
      const verb = typeof method === 'string' && method !== '' ? method.toUpperCase() : String(req.method || '').toUpperCase()
      if (verb !== methodOf(route)) {
        sendJson(res, 405, { ok: false, error: 'method not allowed' })
        return true
      }
      try {
        const body = verb === 'GET' ? {} : await readJsonBody(req)
        sendJson(res, 200, await runOperation(route, body))
      } catch (error) {
        sendJson(res, 400, { ok: false, error: describeError(error) })
      }
      return true
    }
    scope.effect(() => leoHub.registerRoute(CENTRAL_PREFIX, centralHandler), 'ayuan: central routes')
    log('central routes registered ·', CENTRAL_PREFIX)
  })

  ctx.effect(() => () => {
    try {
      const agent = service('ayuanAgent')
      void agent?.dispose?.()
      const memory = service('ayuanMemory')
      void Promise.resolve(memory?.close?.()).catch(() => {})
    } catch {}
  }, 'ayuan: dispose')
}
