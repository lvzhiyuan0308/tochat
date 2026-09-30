# ToChat 0.1 架构

依据用户提供的 [设计方案](https://chatgpt.com/share/6abc623a-4dec-83ea-8fbc-010fa85de513)。范围取最终 ToChat 0.1 清单。独立工程，原 gmmff-chat 未作任何修改。

## 两端对等

Windows: 本地中文 Web UI → loopback HTTP API → JS Engine / SQLite → Koffi C ABI → Tox 原生工作线程。

Android: 同一份中文 UI → 仅私有 assets 可用的 JavascriptInterface → Kotlin Runtime / SQLite → JNI → 同一份 Tox 原生工作线程。

HTTP 只用于 Windows 本机显示界面，监听 127.0.0.1。设备间的身份、好友、消息和文件全部通过 c-toxcore；没有 broker、WebRTC、WebSocket、STUN 或 Cloudflare 通道。没有固定服务器角色。Android 选择 Kotlin + WebView，减少 React Native 层及跨语言构建依赖，同时原生服务可以在 UI 关闭后处理事件、落库、回复 ACK。

## 原生桥

`native/toxbridge` 只有 create / call / poll / destroy 四个生命周期接口。工作线程独占 Tox 实例；调用线程用命令队列与 future 取结果。工作线程按 `tox_iteration_interval` 调度；JS 不驱动 `tox_iterate`。JSON 返回值有独立释放函数，JNI 使用真正 UTF-8 转换，避免 modified UTF-8 损坏 emoji。

从上游 CMake 精确读取 `toxcore_SOURCES` 清单，静态链接 libsodium 和 toxencryptsave。禁用 AV 和独立 bootstrap 服务。Android 同时构建 arm64-v8a / x86_64；共享库按 16 KiB 页面对齐。

## 身份

每设备独立 Tox ID，添加好友需要 76 位地址及校验和。只允许显式接受好友请求。savedata 使用 toxencryptsave 加密后原子替换。Windows 加密口令由 CurrentUser DPAPI 保护；Android 用 Keystore AES-GCM 包装随机口令。解密失败停止启动，不覆盖身份。Android 禁止系统备份，避免只恢复文件而丢失 Keystore 密钥。0.1 暂无身份导出/导入 UI。

## 传输与持久化

自定义 lossless 包使用 `0xA0` 前缀，后跟 UTF-8 JSON envelope：

```json
{"v":1,"id":"UUID","t":"chat","ts":1790728335000,"body":{"text":"你好"}}
```

支持 chat / ack / hello / agent.request / stream.begin / stream.chunk / stream.end / stream.error。大于 1372 字节的 envelope 按 750 字节拆成 base64 fragment。组装按联系人与 UUID 隔离，最多 128 个未完成包、60 秒过期、单包 64 KiB 上限；聊天正文 16 KiB 上限。

发送事务同时写 message 和 outbox。发送成功只进入 sending；对方消息事务提交后返回 ACK，发送方才删除 outbox 并设 delivered。每 5 秒重试，上线立刻重试，received 主键去重。两端无云端离线邮箱，发送方必须重新上线才能送达待发消息。

流式每个 frame 也持久入 outbox、独立 ACK。接收方按 stream + peer + seq 落 chunks 后重建文字；end 只有所有序号完整时才能完成，支持 end 先于重试 chunk 到达。Unicode 码点完整分段，SSE 也处理跨 delta 的代理对。崩溃后未完成的 AI 作业发出明确 error，不会无限显示处理中。

## AI

Windows 通过本机配置的 OpenAI-compatible `/chat/completions` SSE 接口请求模型。启动时环境变量指定 endpoint/model/key；密钥不进入 UI 或 Tox。默认关闭，由联系人开关逐个授权，最多 2 个并发作业，每联系人最多 1 个，120 秒超时，256000 UTF-8 字节回答上限。手机只负责请求与接收。模型服务可为本地模型，也可为用户自行配置的代理；模型本身的网络访问取决于该服务。

## 文件

原生 Tox file API，不经聊天 envelope。接收方主动接受，内部随机 UUID 前缀隔离路径；先写 `.part`，长度完整且结束后才改名。支持拒绝、取消、进度和保存副本。上限 1 GiB。文件离线不会进入消息 outbox；断线/重启明确标记 interrupted，由用户重新发送；0.1 无断点续传。

## Android 生命周期

实时模式默认开启，前台 specialUse 服务维持原生节点，通知栏可返回应用。省电模式在界面离开时停止服务，回来重新加载身份与 outbox。监听默认网络变更重试 bootstrap。前台服务不能保证绕过厂商省电限制和 Doze，具体效果需要真机验收。

## 本地边界

Windows 随机会话 cookie、SameSite=Strict、Origin/Host 校验、CSP、本机监听；不提供远程 Shell 或本地任意文件读取 API。Android 只加载固定 https://tochat.local assets，请求拦截阻断外部内容、禁止 file/content 访问和跨站导航。聊天历史 SQLite 本身未加密，按设备系统账户/应用沙箱保护；加密 savedata 与历史数据库是不同边界。

群聊、音视频、MCP、Shell、Codex、多设备共享身份留给后续版本。
