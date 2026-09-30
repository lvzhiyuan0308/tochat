# Third-party notices

ToChat is distributed under GPL-3.0-or-later, matching its c-toxcore linkage.

| Component | Pinned version / revision | License | Source |
|---|---|---|---|
| c-toxcore | v0.2.23 / d9ca3c577e5abd4303d180eb5270167b4133ea4c | GPL-3.0-or-later | https://github.com/TokTok/c-toxcore |
| cmp | 52bfcfa17d2eb4322da2037ad625f5575129cece | MIT | c-toxcore recursive submodule |
| libsodium-cmake | 9b2848dfc1b917a9410f0de9d81059b26cbfaa8d | MIT | https://github.com/robinlinden/libsodium-cmake |
| libsodium | 1.0.20 / 93a7d0d41fe2e32409b5d00386946f491750b7de | ISC | https://github.com/jedisct1/libsodium |
| nlohmann/json | 3.11.3 | MIT | https://github.com/nlohmann/json |
| Koffi | 2.14.1 | MIT | https://github.com/Koromix/koffi |
| qrcode-generator | 1.4.4 | MIT | https://github.com/kazuhikoarase/qrcode-generator |
| jsQR | 1.4.0 | Apache-2.0 | https://github.com/cozmo/jsQR |
| Node.js portable runtime | 22.22.2 | Node.js license with bundled notices | https://nodejs.org/ |
| LLVM-MinGW build tooling | 20260922 | LLVM / MinGW component licenses | https://github.com/mstorsjo/llvm-mingw |

The source checkout keeps upstream license files in vendor submodules. UI QR libraries retain upstream headers; their npm license texts are included in the portable distribution's node_modules. The JSON header includes its MIT notice. Build tooling is not bundled into the application. Android packages statically link the C++ runtime from the Android NDK, covered by the LLVM license.
