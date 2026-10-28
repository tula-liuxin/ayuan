# ayuan

DSH 的「阿源」助手插件，从 leo-status 拆出的独立包（2.0.0，针对 DSH 0.2.1-rc.3）。

- 本机运行：真实 DSH Agent 会话（默认 preset 的全部工具 + 与用户相同的最高权限），可开新会话、恢复历史、停止执行。
- 跨设备共享：记忆、情绪/兴趣、提醒、已读只有中心一份；会话、模型、工具、文件留在各自设备。
- 本机上下文：只读浏览这台设备上的主会话，轻量携带当前页面文字、选中内容、可见代码和一张缩略图。
- 依赖 leo-status 时：通过 `leoBoard` 读取待办/建议、把阿源提议写成待确认建议；未安装时 tasks 为空、工具明确报「看板未安装」。
- 独立浮框与全局可拖气泡由 `client.js` 提供，支持新会话、历史和来源位置更新。
- 来源上下文分三层：打开浮框或切换 DSH 页面时的页面快照、来源会话标识与目录、同目录其它主会话标题。浮框展开时跟随主页面/会话切换及运行状态变化更新；来源快照十分钟后过期；不会把阿源自己的专用目录当成来源，也不会自动读取同目录全部会话正文。
- 首条用户消息将会话命名为 `阿源 · <话题>`（最多 20 个字符），后续消息不重复改名。

## 包结构（host 侧）

| 入口 | 职责 |
|---|---|
| `index.js` | bare 入口 `ayuan`：config / dataDir / 页面 token / 本机 HTTP `/ayuan/api/*` / 中心路由 `/api/yuan/*` / 共享运行环境 `ayuanRuntime` |
| `memory.js` | `ayuan/memory`：memory-core 与中心远端适配器，服务 `ayuanMemory`，`leo_memory` 工具实现 |
| `status.js` | `ayuan/status`：设备/情绪/兴趣/记忆/任务/本机会话状态，服务 `ayuanStatus`，`ayuan_status` / `ayuan_note` 工具实现 |
| `context.js` | `ayuan/context`：本机会话浏览，服务 `ayuanContext`，`ayuan_sessions` 工具实现；页面来源快照 |
| `tools.js` | `ayuan/tools`：工具注册壳（唯一注册点）+ 看板桥 `createBoardBridge`（未来待办类工具用） |
| `agent.js` | 真实 Agent 会话运行时，服务 `ayuanAgent` |
| `legacy.js` | 旧版 yuan 的提醒/已读/旧数据兼容层 |

## 服务

提供：`ayuanMemory`、`ayuanStatus`、`ayuanContext`、`ayuanAgent`。
消费（均可选，缺失自动降级）：`leoBoard`、`leoHub`、`llm`、`agentDefaultModel`、`sessionQuery`、`webServer`、`connection`。

## 数据与配置

- 数据目录：`config.dataDir` > 环境变量 `AYUAN_DATA` > 默认 `C:\data\ayuan`（其他平台 `~/.local/share/ayuan`）。
- 页面 token：`<dataDir>/page-token`，注入 `window.__AYUAN_PAGE_TOKEN__`，请求头 `x-ayuan-token`（查询参数 `_ayuan_token` 兜底中心转发剥 header 的情况）。
- 不迁移 leo-status 旧数据；旧目录原样保留用于回滚。

## 开发校验

```sh
node --check index.js
node --check client.js
node --test "test/*.test.mjs"
```

插件行 ID 均使用 `ayuan-` 前缀（分组为 `ayuan`），不得改回 `tools`、`memory` 等全局通用 ID：它们可能覆盖宿主核心行。启用前先确认普通会话空闲，一次只应用一个插件变更并验证核心服务仍然正常。不要从正在安装本插件的 Agent 内反复触发热加载。
