# ayuan

DSH 的「阿源」助手插件，从 leo-status 拆出的独立包（2.0.8，针对 DSH 0.2.1-rc.3）。

- 本机运行：真实 DSH Agent 会话（默认 preset 的全部工具 + 与用户相同的最高权限），可开新会话、恢复历史、停止执行。
- 跨设备共享：记忆、情绪/兴趣、提醒、已读只有中心一份；会话、模型、工具、文件留在各自设备。
- 本机上下文：只读浏览这台设备上的主会话，轻量携带当前页面文字、选中内容、可见代码和一张缩略图。
- 依赖 leo-status 时：通过 `leoBoard` 读取待办/建议、把阿源提议写成待确认建议；未安装时 tasks 为空、工具明确报「看板未安装」。
- 独立浮框与全局可拖气泡由 `client.js` 提供，支持新会话、历史和来源位置更新。
- ayuan-status：收起时也跟踪最后操作的主面板，180ms 防抖、30 秒心跳；只更新内存中的位置元数据，不因导航调用模型。正文、选择和图片按需捕获。工具栏快照按钮可查看来源、时间和版本。运行中的阿源在下一模型步骤读取变化；空闲时不唤醒。
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

## 2.0.1

- 修复同一会话在主界面和浮框抢占原生编辑器；收起时卸载浮框正文。同会话双开时，浮框提供简洁输入，正文在主界面显示。
- 新空白页首条发送被接受后才显示会话；历史隐藏空白，只列阿源会话。历史操作调用宿主公开接口（重命名、归档、fork、置顶、打开），宿主未开放整个列表组件，因此列表外观由插件提供。已有空白会话不自动删除。
- 浮框正文字号调整为原先约 85%。
- ayuan_sessions 可按需只读查询本机不同目录的主会话；返回的是限量文本，截断会明确标记。

## 2.0.5

- 新会话改用宿主原生输入区：打开浮框或点「新会话」时复用一个空白阿源会话，欢迎内容下方直接是宿主 Composer。权限、模型选择、语音输入等输入区插件自动跟随宿主，不需要在阿源里另做一套。
- 修复在欢迎页输入首条消息却写进上一个旧会话：欢迎页不再自绘输入框，也不再走「恢复上次会话」的打开逻辑；首条消息只发到新的空白会话。
- 语音输入等宿主 Composer 插件在阿源浮框内自动可用；阿源设置不需要复制一份，识别器/语言等仍以宿主语音输入设置为准。

## 2.0.6：历史列表对齐宿主会话行

- 阿源「历史」列表的行改为仿照宿主左侧会话行：菜单用宿主同款 Menu + 省略号，行内悬停卡片复用宿主 HoverCard 原语，列表顺序按最近更新排列。
- 复用宿主的四个公开扩展点并实时同步：`sidebar.workspaces.session.menu.item`（菜单项）、`sidebar.workspaces.session.row.action`（悬停按钮）、`sidebar.session.row.leading`（前导装饰）、`sidebar.session.row.hover`（悬停卡片内容）。以后 DSH 升级或第三方插件往这些 slot 里新增条目，阿源历史列表会自动跟随，不需要改插件。
- 说明：会话行的「骨架」本身是宿主内部组件，没有公开 slot；这里按当前版本的度量和主题变量仿制。DSH 若改动行骨架，需要同步微调本插件的 CSS；扩展点部分不受影响。

## 2.0.7：可读性 + 已读圆点

- 历史弹层可读性：弹层 420px、行高 36px、标题 15px、时间 11px 次级色，悬停操作图标 18px 并带悬停底色；悬停卡片改用宿主原生深色卡片的配色（标题 #fff、时间 #cfd3d6、状态 #adb2b8），不再出现「深底 + 主题深色字」看不清的问题。
- 在阿源浮框里查看某个会话时，会同时清掉宿主左侧会话行的小圆点（宿主用 completionUnread 标记「后台完成、还没在主界面看过」）。宿主没有公开的已读 API，这里按当前客户端实现做特性检测并静默降级：未来实现变化最多是圆点继续显示，不会崩。

## 2.0.8：修好字号设置

- 修复「阿源回复正文」调了没反应：桌面版 DSH 的对话根类名是构建期 hash（实测 xMeOpW_root；可读 npm 安装是 hWmORq_root），旧选择器永远匹配不到。现在改用宿主稳定的结构属性 `[data-chat-flow]` 设置字号，DSH 升级/重新构建也不会依赖 hash。
- 百分比改为以宿主当前正文基准字号（body 上的 `--dsh-content-font-size`，当前 16px）为 100%：100% 与主界面正文字号一致，不再固定按 14px 折算。
- 设置面板新增两行**实时预览**（按当前百分比直接渲染），改下拉框立刻能看到效果，不必等对话内容刷新。
- 说明：「输入和界面文字」影响浮框里的宿主原生输入区；「阿源回复正文」影响浮框内对话正文（含用户消息、阿源回复和工具卡片）。
