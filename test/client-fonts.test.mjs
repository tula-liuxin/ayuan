import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = await readFile(path.join(here, '..', 'client.js'), 'utf8')
const cssStart = source.indexOf('const CSS = `')
const cssEnd = source.indexOf('`;', cssStart)
const css = source.slice(cssStart, cssEnd)

test('回复正文字号用稳定的 data-chat-flow，而不是构建期 hash 类名', () => {
  const rule = css.match(/\[data-chat-flow\][^}]*\}/)
  assert.ok(rule, '应有 [data-chat-flow] 字号规则')
  assert.ok(rule[0].includes('--dsh-content-font-size:var(--ay-reply-font)'))
  assert.ok(rule[0].includes('--dsh-content-font-delta:var(--ay-reply-delta)'))
  // 桌面版宿主 chat 根类名是构建期 hash（实测 xMeOpW_root，可读安装是 hWmORq_root），不能依赖
  assert.equal(/\.[A-Za-z0-9_-]+_root\{[^}]*--dsh-content-font-size/.test(css), false)
})

test('设置面板带即时字号预览，改 select 能立刻看到效果', () => {
  assert.ok(source.includes('ay-settings-preview'))
  assert.ok(source.includes("输入和界面文字 '+fontSizes.interface+'%"))
  assert.ok(source.includes("阿源回复正文 '+fontSizes.reply+'%"))
})
