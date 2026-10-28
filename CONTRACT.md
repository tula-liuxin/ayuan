# ayuan 2.0.0 契约与回滚

- 包内包含 memory/status/context/tools 子插件；所有行 ID 使用 ayuan 前缀，只有 bare 入口承载 client。
- 不 import leo-status；只消费可选 leoBoard / leoHub。缺看板时 tasks 为空，修改工具明确提示未安装；缺中心时使用本机记忆。
- leoBoard.list/stats/propose/action 负责看板数据与操作；propose 产生待确认建议，不代替用户确认。
- 中心 HTTP /api/yuan/* 通过 leoHub.registerRoute 挂载；注册返回卸载函数并绑定到注入作用域，避免重启插件后使用已释放服务。本机接口独立位于 /ayuan/api/*，使用本包页面 token。
- 数据默认 C:\data\ayuan；不迁移或删除 C:\data\leo-status 旧数据。
- 全局气泡与浮框可拖动、保存位置；新会话先显示欢迎/建议/单输入，首发后使用宿主会话视图。历史名为 阿源 · <首条消息话题>。
- L1 页面、L2 来源会话标题/目录/执行状态及最近消息、L3 同目录其他主会话标题。浮框打开时跟随主页面变化；摘要有预算与十分钟有效期；详情通过 ayuan_sessions 显式读取。
- 不采集 DSH 之外的屏幕/网页，不接管普通会话身份。

## 回滚

使用 DSH 插件管理器停用 ayuan，再将 leo-status 选择回 0.9.0（市场保留旧版本/提交）。先等插件变更完成，勿从正在安装自身的阿源会话执行。保留两个数据目录，回滚不执行数据迁移。开发源码可以 Git 历史恢复，但不要手改运行 profile 的依赖或 patch。卸载包前先导出需要保留的阿源会话。

## 验证边界

本机真实 Cordis 独立模式、宿主组合、UI 首发/历史/拖动/页面切换、HTTP 读接口已检查。第二台真实设备的完整共享记忆写入流程尚未实测；不以代码或单元测试代替该项验收。
