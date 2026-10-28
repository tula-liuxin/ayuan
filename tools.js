/**
 * ayuan/tools · 工具注册壳 + 看板桥
 *
 * 所有阿源专属工具只在这里注册：leo_memory（memory.js）、ayuan_status /
 * ayuan_note（status.js）、ayuan_sessions（context.js）。未来新工具也加在这里，
 * 模块只负责提供实现，注册壳保持唯一。
 *
 * 看板桥（createBoardBridge）把 leo-status 提供的 leoBoard 服务包成稳定的
 * read/propose/action 接口，供未来的待办类工具使用；没有 leo-status 时所有方法
 * 返回明确的「看板未安装」而不是抛未捕获异常。
 */
import { memoryToolDefinition } from './memory.js'
import { statusToolDefinitions } from './status.js'
import { sessionsToolDefinition } from './context.js'

/** 读取宿主服务；缺失时返回 null。 */
function service(ctx, name) {
  try {
    const value = ctx.get(name)
    return value === undefined ? null : value
  } catch {
    return null
  }
}

/** 看板桥：未来待办类工具的统一入口。 */
export function createBoardBridge(ctx) {
  const board = () => service(ctx, 'leoBoard')
  const missing = () => { throw new Error('Leo 看板未安装或不可用（leoBoard 服务缺失）') }
  return {
    async list(options = {}) { const target = board(); if (!target) missing(); return target.list({ force: options?.force === true }) },
    async propose(text) { const target = board(); if (!target) missing(); return target.propose(text) },
    async action(body) { const target = board(); if (!target) missing(); return target.action(body) },
  }
}

/** ayuan/tools 入口：注册壳。 */
export function apply(ctx, config) {
  ctx.inject(['tools'], ({ tools }) => {
    const get = (name) => service(ctx, name)
    const definitions = [
      memoryToolDefinition(get),
      ...statusToolDefinitions(get),
      sessionsToolDefinition(get),
    ]
    for (const definition of definitions) {
      ctx.effect(() => tools.register(definition), `ayuan: ${definition.name} tool`)
    }
    console.log('[ayuan] tools ready ·', definitions.map((item) => item.name).join(', '))
  })
}
