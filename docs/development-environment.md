# ToChat 本机环境

核实日期：2026-09-30。工程：`D:\Data\Codex\tochat`。

复用用户提供的 `C:\Users\lvzhiyuan\WorkBuddy\2026-09-06-18-01-12\gmmff-chat\docs\development-environment.md` 所列环境，只读取和调用工具链，未修改原工程。

| 组件 | 路径 |
|---|---|
| Node 22.22.2 | `C:\Users\lvzhiyuan\.workbuddy\binaries\node\versions\22.22.2-3\node.exe` |
| npm | 同目录 `npm.cmd` |
| JDK 17.0.20.1 | `C:\Users\lvzhiyuan\WorkBuddy\2026-09-06-18-01-12\gmmff-chat\toolchain\jdk-17.0.20.1+1` |
| Android SDK | `C:\Users\lvzhiyuan\WorkBuddy\2026-09-06-18-01-12\gmmff-chat\toolchain\sdk` |
| Android CMake | 上述 SDK 的 `cmake\3.22.1` |
| NDK | 上述 SDK 的 `ndk\27.1.12297006` |
| adb | 上述 SDK 的 `platform-tools\adb.exe` |
| Windows CMake | `C:\Program Files\CMake\bin\cmake.exe` |
| Ninja | `C:\Users\lvzhiyuan\AppData\Roaming\Python\Python311\Scripts\ninja.exe` |
| Windows Clang | `D:\Data\Codex\tochat\toolchain\llvm-mingw-20260922-ucrt-x86_64\bin` |
| Gradle | 8.10.2 wrapper，复用本机 `.gradle` 缓存 |
| AGP / Kotlin | 8.7.2 / 2.0.21 |

Android compile/target SDK 35，最低 SDK 26。Debug 包签名使用标准 Android debug keystore；正式发布要另配生产签名。

库固定：c-toxcore v0.2.23 = `d9ca3c577e5abd4303d180eb5270167b4133ea4c`；libsodium-cmake `9b2848dfc1b917a9410f0de9d81059b26cbfaa8d`；libsodium `93a7d0d41fe2e32409b5d00386946f491750b7de`（1.0.20）；nlohmann JSON 3.11.3，SHA256 `9BEA4C8066EF4A1C206B2BE5A36302F8926F7FDC6087AF5D20B417D0CF103EA6`。

不要把工具链或 `data/` 加入 Git。Windows 便携包自带 Node/native DLL；Android 包自带 native SO 和 UI。
