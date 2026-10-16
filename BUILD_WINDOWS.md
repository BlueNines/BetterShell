# Windows 编译说明

当前工程是基于 Electerm 5.5.76 的 **BetterShell 个人版 0.6.8**，面向 Windows x64。

- 直接启动：`dist/personal/win-unpacked/BetterShell.exe`。
- 免安装包：`dist/personal/BetterShell-0.6.8-win-x64.zip`，完整解压后启动 EXE。
- 安装程序：`dist/personal/BetterShell-0.6.8-win-x64-installer.exe`。
- screen 控制台、独立窗口与拖动合回：见 [PERSONAL_V6.md](PERSONAL_V6.md)。
- 中文 Notepad++ 和多文件编辑：见 [PERSONAL_V5.md](PERSONAL_V5.md)。
- 关闭和重开的工作区恢复：见 [PERSONAL_V4.md](PERSONAL_V4.md)。
- 数据库工作区和第一版范围：见 [PERSONAL_V3.md](PERSONAL_V3.md)。
- 第二版交互：见 [PERSONAL_V2.md](PERSONAL_V2.md)，最初的功能裁剪范围见 [PERSONAL_V1.md](PERSONAL_V1.md)。

先安装 Git、Node.js 24 和 Yarn 1。已验证的工具版本为 Node.js 24.21.0、Yarn 1.22.22 和 Electron 42.8.1；Electron 由构建脚本下载，无需单独安装。Yarn 可通过 `npm install --global yarn@1.22.22` 安装。

首次从源码构建，在 PowerShell 中执行：

```powershell
git clone https://github.com/BlueNines/BetterShell.git
Set-Location BetterShell
.\build-personal.ps1 -InstallDependencies
```

后续重新编译执行 `./build-personal.ps1`；需要重新安装锁定依赖时，加上 `-InstallDependencies`。如系统限制本地脚本运行，可在项目目录执行 `powershell -NoProfile -ExecutionPolicy Bypass -File .\build-personal.ps1 -InstallDependencies`。

脚本使用系统 PATH 中的 Node.js 和 Yarn；若项目的 `temp/build-tools` 中已有指定版本的本地工具，则优先使用。Electron 和 Notepad++ 下载文件经过官方 SHA-256 校验。脚本使用 Windows 原生模块的预编译版本，不需要 Visual Studio C++。构建需要联网下载依赖和资源，打包后产物留在本机。

`temp` 保存下载缓存及本地验证资料；`work` 是打包暂存目录，`dist/personal` 是固定的最终产物位置，均不提交到 Git。自动化测试位于 `src/test`，安装依赖后可运行 `npm run lint` 和 `npm run test-unit-ci`。修改业务代码后重新执行编译脚本即可，编译前请正常退出正在使用的程序。

新版沿用 `%APPDATA%\BetterShell` 的连接和设置，数据库连接另行加密保存。更新时先打包到 `dist/personal-update` 并测试，正常退出旧版后再替换固定目录；旧版保留在 `dist/archive`。界面左上角显示版本号，方便确认正在使用的程序。

`npm run pb` 自动准备锁定的官方 Notepad++ 8.9.8.1 便携版并校验 SHA-256，资源在 `vendor/notepad-plus-plus`。安装包和免安装包都携带编辑器、官方简体中文语言文件、许可证及对应源代码 ZIP，无需用户另行安装。运行配置放在用户数据目录，安装目录无需写入权限。

仓库保留 Electerm 的历史和上游构建文件；个人版 Windows 构建以 `build-personal.ps1` 为准。
