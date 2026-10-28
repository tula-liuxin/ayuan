/**
 * ayuan · 数据目录与页面 token
 *
 * 数据目录优先级：config.dataDir > AYUAN_DATA > 平台默认（Windows C:\data\ayuan）。
 * 页面 token 持久化在 <dataDir>/page-token：热重载和重启后保持稳定，设备中心
 * 打开的远程页面不会因为插件重载拿到新 token 而 401。
 */
import os from 'node:os'
import path from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes, timingSafeEqual } from 'node:crypto'

/** 页面 token 的请求头与查询参数（设备中心转发会剥掉自定义 header）。 */
export const PAGE_TOKEN_HEADER = 'x-ayuan-token'
export const PAGE_TOKEN_QUERY = '_ayuan_token'

/** 解析本次运行的数据目录。 */
export function resolveDataDir(config = {}) {
  const row = config !== null && typeof config === 'object' ? config : {}
  const explicit = typeof row.dataDir === 'string' ? row.dataDir.trim() : ''
  if (explicit !== '') return path.resolve(explicit)
  const env = typeof process.env.AYUAN_DATA === 'string' ? process.env.AYUAN_DATA.trim() : ''
  if (env !== '') return path.resolve(env)
  if (process.platform === 'win32') return 'C:\\data\\ayuan'
  return path.join(os.homedir(), '.local', 'share', 'ayuan')
}

/** 读取或生成稳定的页面 token（同步，apply 一开始就确定，不给首屏留竞态）。 */
export function loadPageToken(dataDir, log = () => {}) {
  let token = randomBytes(24).toString('hex')
  const file = path.join(dataDir, 'page-token')
  try {
    const saved = readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{32,128}$/i.test(saved)) return saved
  } catch (error) {
    if (error?.code !== 'ENOENT') log('ayuan page token read failed:', error?.message ?? error)
  }
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(file, token, { mode: 0o600 })
  } catch (error) {
    log('ayuan page token write failed:', error?.message ?? error)
  }
  return token
}

/** 常数时间比较；长度不同直接 false。 */
export function tokenMatches(token, value) {
  if (typeof value !== 'string' || value === '' || typeof token !== 'string' || token === '') return false
  const expected = Buffer.from(token, 'utf8')
  const actual = Buffer.from(value, 'utf8')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** 请求头或查询参数里的 token。 */
export function requestTokenMatches(req, token) {
  if (req === null || typeof req !== 'object') return false
  const header = req.headers !== null && typeof req.headers === 'object' ? req.headers[PAGE_TOKEN_HEADER] : undefined
  if (tokenMatches(token, header)) return true
  try {
    const url = new URL(typeof req.url === 'string' && req.url !== '' ? req.url : '/', 'http://localhost')
    return tokenMatches(token, url.searchParams.get(PAGE_TOKEN_QUERY) ?? '')
  } catch {
    return false
  }
}
