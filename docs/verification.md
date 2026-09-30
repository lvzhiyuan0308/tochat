# ToChat 0.1 验收

## 1.1.0 增量验收（2026-09-30）

- 26 项测试通过：新增上下文按联系人/会话隔离、完整问答筛选、48 KB 预算及持久化摘要摘录、v1→v2 数据迁移、取消排队、远程取消的联系人归属、取消先于请求、安全 Markdown、图片签名与 8 MB 上限、移除记录及恢复。
- 真实原生 Tox UDP 双节点通过：124000 字节中文/emoji SSE 回答全文一致；后续“刚才介绍的是哪个城市？”读到北京历史；新会话无旧上下文；远程停止中断正在生成的回答；1 MiB + 19 字节文件 hash 一致；身份恢复。
- 浏览器 390×844：无横向溢出，默认输入区约 139 px 高；附件进入时间线，有缩略图和可展开操作；移除/撤销、新会话、离线问题排队及取消均通过。翻看历史时新增消息，scrollTop 前后均为 933.33，未强制跳到底部。
- Markdown 注入用例：HTML 标签、脚本、javascript 链接只显示为文本，消息区域 activeContent 节点数为 0。
- Windows 便携包以自带 Node/DLL 独立启动，v2 数据库创建成功，Markdown 文件可加载；未认证预览返回 401，已完成附件预览按真实字节返回图片 MIME，响应 hash 与原件一致。514 个 ZIP 条目不含身份、历史、模型配置或工具链。
- Android assembleDebug、assembleRelease、lintVitalRelease 成功；版本 1.1.0 / versionCode 2。仍未运行 Android 真机或模拟器验收，浏览器预览不能代替键盘、系统选择器、后台省电与跨设备网络测试。
- 预览截图：[新版手机聊天](qa-chat-mobile.png)。`tests/ui-layout.js` 使用独立 `build/ui-layout` 数据，不使用真实联系人或模型服务；下述 0.1 验收记录保留作历史证据。

1.1.0 的较早会话记忆使用有损摘要摘录：不额外调用模型生成摘要，成本有界，但可能省略历史细节；普通聊天、失败回答和其他联系人记录不会进入上下文。

日期：2026-09-30。构建与验证均在用户提供的 Windows 环境完成。没有连接手机或安装 Android 模拟器，因此 Android 实际运行和跨设备网络验收没有标记为通过。

## 已验证

| 项目 | 结果 / 证据 |
|---|---|
| Windows Tox DLL | Clang / c-toxcore v0.2.23 / libsodium 静态链接，构建成功，Node 22 可加载 |
| 协议与应用测试 | 9/9：分片乱序/重复/跨联系人隔离、过期/越界包、Tox ID 校验、离线 outbox 重启、peer-scoped ACK、消息去重、乱序 AI 流、默认 AI 拒绝、SSE UTF-8/代理对 |
| 真正的 UDP 双节点 | 原生 Tox 两个独立身份连接；无 mock transport |
| 真正的公共 TCP relay | 两端 `udp=false`，公共 Tox bootstrap/relay，好友连接类型 1，聊天成功 |
| 长中文消息 | 500 次“离线消息🙂”，超过单包长度；全文落库一致，只有应用 ACK 后 delivered |
| AI 端到端 | 本地 HTTP SSE 测试模型 → 授权节点 → 原生 Tox → SQLite；70000 UTF-8 字节，全文 SHA-256 相同，UDP 与 TCP 分别通过 |
| 文件 | 原生 Tox file API，1 MiB + 19 字节随机文件，接受/完成、源与目标 SHA-256 一致，UDP 与 TCP 分别通过 |
| 身份恢复 | savedata 具有 toxEsave 加密标记；重启地址相同，错误密码拒绝启动、不覆盖身份 |
| Android Debug / Release | Gradle assembleDebug + assembleRelease + lintVitalRelease 成功；arm64-v8a / x86_64 |
| APK 签名 | apksigner verify：Debug APK v2 签名有效；Release 是未签名产物 |
| 桌面 UI | 浏览器真实加载，身份二维码出现，错误 ID 提示可读；测试数据独立 |
| 移动尺寸 UI | 390×844 验收联系人与聊天布局；真实 Tox 收发消息最终显示“已送达” |
| Windows 公共网络 | 默认 Windows 节点接入公共 Tox 网络，self connection 显示 UDP |
| Windows 便携启动 | 包内 Node 22.22.2 / Koffi / DLL 独立启动；ZIP 检查不含身份、历史或工具链 |

截图：[桌面](qa-desktop.png)、[移动尺寸](qa-mobile.png)。移动尺寸截图是浏览器响应式验收，不能替代 Android 真机测试。AI SSE 服务是确定性测试服务，验证协议与全链路；未代替用户实际 LiteLLM/本地模型服务的验收。

## 真机验收清单（尚未执行）

| 场景 | 操作与通过标准 |
|---|---|
| Windows ↔ Android / Android ↔ Android | 安装 APK、互扫二维码图片/粘贴 ID、接受好友、双向中文及 emoji；最终 delivered |
| Wi-Fi ↔ 5G | 两手机分属不同网络；好友类型 UDP 或 TCP；消息和文件正确 |
| 切换网络 | 发消息时切 Wi-Fi/5G，UI 明确离线/连接状态，恢复后 outbox 清空，无重复消息 |
| IPv4 / IPv6 | 分别使用仅 IPv4、双栈及 IPv6 网络；网络抓包核对实际路径，不用 Tox status 推断 IP 版本 |
| UDP 被阻断 | Windows `TOCHAT_TCP_ONLY=1` 或网络禁 UDP；显示 TCP 中继且消息可达 |
| Android 重启 | 杀进程重新启动，Tox ID 和历史不变，待发消息重试 |
| 省电 / 实时模式 | 实时模式前台通知；省电模式界面关闭后离线；返回恢复；厂商省电策略分别测试 |
| Doze / 锁屏 | 锁屏和系统 Doze 下检查实际通知与在线状态；前台服务不预先宣称能绕过系统休眠 |
| 文件选择与保存 | Android 选择本地文件，对方明确接收；完成后系统保存位置导出，比较 hash |
| 大文件与断线 | 100 MiB 文件完整 hash；中途断网标记 interrupted，重新发送可完成；不要求断点续传 |
| 实际模型 | 配置用户模型 endpoint/key/model，授权联系人后完整问答；未授权明确拒绝 |

## 可重复命令

```powershell
$env:PATH = 'C:\Users\lvzhiyuan\.workbuddy\binaries\node\versions\22.22.2-3;' + $env:PATH
npm test
$env:TOCHAT_E2E_TCP='0'; npm run test:tox
$env:TOCHAT_E2E_TCP='1'; npm run test:tox
```

公共 relay 测试依赖外部节点和本地网络策略，超时是错误结果，不会回退到 fake/mock 后标记通过。测试目录在系统临时文件夹，结束清理。`tests/ui-session.js` 使用 `build/ui-qa`，专用于浏览器交互验收。
