# ToChat 0.1

**P2P chat for people, devices and personal AI.**

按 [分享方案](https://chatgpt.com/share/6abc623a-4dec-83ea-8fbc-010fa85de513) 实现的独立 Tox 原生 Windows / Android 应用。当前为可运行的 0.1 原型；Windows 本地和公共 TCP 中继已自动验收，Android APK 已构建，跨端真机网络矩阵待验收。

## 直接运行

### Windows

双击根目录 `Start-ToChat.cmd`。使用已有 Node 22；便携包则自带 Node。会打开本机聊天界面。终端持续运行即节点在线，关闭终端则离线。

已打包 `dist/ToChat-0.1-windows.zip`，解压后双击其中的 `Start-ToChat.cmd`。无需安装 JDK、Android SDK 或 C/C++ 编译器。

### Android

安装 `dist/android/ToChat-0.1-debug.apk`（签名 Debug 包，可直接安装，Android 8.0+，ARM64/x86_64）。`release-unsigned.apk` 是未签名发布产物，不能直接安装。

1. 两端点击“我的身份”，分享二维码或 Tox ID。
2. 另一端点击“添加联系人”，粘贴 ID，或选择二维码图片读取。
3. 收到好友请求后主动接受。
4. 联系人在线后显示 UDP 连接或 TCP 中继；可以聊天和发送文件。
5. 对方离线时消息显示“待发送”，双方重新在线后自动送达；文件需对方在线。
6. 收到文件主动接收，完成后点“保存副本”。Windows 弹出原生“另存为”窗口，Android 用系统保存位置选择器导出；原附件保留在应用历史中。

Android 设置提供实时/省电模式。实时模式会显示常驻通知。二维码目前支持从图片识别和 tox: 链接，尚未做 App 内实时摄像头扫描。

## Windows 本地 AI

点击左上角齿轮 → **模型配置**，填写兼容 OpenAI 接口的服务地址、模型名称和 API 密钥，勾选启用后保存。保存立即生效，重启后保留。密钥由 Windows 当前账户 DPAPI 加密保存，表单不回显原密钥；留空保留原密钥，也可勾选清除。此配置优先于启动环境变量。正在进行的回答继续使用原配置。

先启动你的 OpenAI-compatible 模型服务。复用原环境的 LiteLLM 时：

```powershell
$env:LLM_API_KEY = '<你的模型服务密钥>'
.\tools\start-windows.ps1 -AI -BaseURL 'http://127.0.0.1:4000/v1' -Model 'deepseek-v4-flash'
```

Windows “联系人设置”中打开“允许此联系人使用我的本地 AI”。手机看到该设备的 AI 能力后，勾选“向此设备的 AI 提问”发送。默认不授权任何联系人。外部模型服务的费用和网络行为由你的模型服务决定。

也可直接设置 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 后运行 `npm start`。未配置模型时只提供聊天/文件。

## 数据与配置

Windows 默认 `data/windows/`：identity.tox（加密身份）、identity.key（DPAPI）、history.sqlite、downloads、uploads。`TOCHAT_DATA` 可指定独立数据目录。Android 使用应用私有 files/database 和 Keystore。重启身份不变，卸载或删除数据会丢失身份与历史。当前无跨设备历史同步、身份备份 UI 或断点续传。

`TOCHAT_NAME` 设初始设备名；名称随后可在 UI 修改。`TOCHAT_PORT` 设本机 UI 端口，默认 8788。`TOCHAT_TCP_ONLY=1` 用于禁用 UDP 的中继验收。不要同时启动同一个数据目录的两个节点。

## 开发环境与构建

本机复用了 gmmff-chat 的 Node 22.22.2、JDK 17 和 SDK/NDK，原工程未修改。Windows 编译器放在本工程 `toolchain/`。

```powershell
.\tools\setup.ps1        # npm ci + 固定子模块 + 固定 Windows 编译器 + 原生库
npm run build:native
npm run build:android
npm test
npm run test:tox         # 真正的 Tox UDP 双节点、消息、AI、文件、身份恢复
$env:TOCHAT_E2E_TCP='1'
npm run test:tox         # 真正的公共 TCP relay，依赖公网 bootstrap 可用
```

Android 构建脚本默认工具链路径取用户提供的环境说明。换机可用 `tools/build-android.ps1 -BaseToolchain '完整工具链目录'`。Java/NDK 需要上述版本。脚本设置真实临时目录，修复该机 JDK 17 在 8.3 TEMP 路径下无法创建 loopback AF_UNIX 的问题。详细路径见 [开发环境](docs/development-environment.md)。

## 工程

```text
protocol/            协议、分片与校验
native/toxbridge/    跨端 C++ Tox 工作线程、C ABI、JNI
desktop/src/        Windows 节点、AI、loopback UI API
desktop/ui/         两端共用界面
mobile/android/     Kotlin Runtime、SQLite、前台服务、Keystore
shared/             Windows SQLite 与固定 bootstrap 节点
vendor/             固定上游子模块、JSON header
tests/              单元与真实 Tox 端到端验收
tools/              构建、启动、打包
```

完整 [架构说明](docs/architecture.md)、[验收记录与真机矩阵](docs/verification.md)。GPL-3.0-or-later，第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
