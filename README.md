# BetterShell

面向个人使用的 Windows SSH 服务器管理工具，基于 [Electerm](https://github.com/electerm/electerm) 5.5.76 做减法。

## 核心功能

- 保存 SSH 连接，支持密码与私钥认证、多标签和重连。
- 每个 SSH Shell 标签右侧的「+」查找并连接 GNU screen，右拉条展开或收起这台 Shell 已打开的同级 screen 标签；screen 和普通控制台都可直接拖离标签栏成为独立窗口、拖回顶部或点击合回，同一会话不重连。
- 终端与文件同屏：上方终端和 MySQL 工作区，下方目录树与文件列表。
- 普通 Shell 和 screen 均可用滚轮或常显滚动条回看历史，弹出和合回保留位置。
- MySQL / MariaDB 直连和 SSH 隧道；查看库表、字段和索引，执行 SQL，增删改记录，导出当前结果。
- 各 Shell 标签页的数据库会话、SQL、结果、尺寸和显隐独立；支持最小化窄栏和隐藏，恢复保留工作区。
- 关闭后自动保存整个工作区，下次启动恢复标签数量、顺序、目录和每页 MySQL 状态；已连接的数据库重新连接，SQL 草稿保留且不会自动执行。
- MySQL 库表列表支持自动宽度、拖动分隔线和长名称横向滚动；点击「自动」恢复自适应。
- SFTP 上传下载、配置文件编辑和基本文件操作。
- 本地和远程文件默认按名称排序，大小列按数值混排文件和文件夹；点击列表后按字母定位、Enter 打开。
- 近期目录缓存、空闲预读和鼠标停留预读，返回上级和再次进入更快；刷新和文件修改会更新缓存，本地目录属性一次批量读取。
- 内置官方 Notepad++ 便携程序和简体中文语言，独立窗口支持多文件编辑；远程文件保存后自动同步，并提供每个文件的同步状态。
- 左侧显示 CPU、内存、进程、网络、磁盘、负载和运行时间。
- 中文界面、简洁配色；保留 PowerShell / CMD 本机终端入口。
- 目录和上下分区可拖动并记住尺寸，深层目录支持横向滚动和右键操作。
- 顶部标签随标题自动宽度，长名称完整保留；多标签可用左右按钮或滚轮浏览，加号固定在右侧，切换时自动定位当前标签。
- 窄窗口工具栏自动收起文字；目录区保留，MySQL 短面板支持内部滚动，分页和 SQL 结果可继续操作。
- 标签栏加号可搜索并打开已有服务器；设置中支持整个界面的深浅主题切换。

个人版没有 AI、云同步、MCP、工具箱和远程桌面等扩展功能入口。

## 运行与编译

当前版本为 **0.6.8**。安装 Node.js 24 和 Yarn 1 后，在 PowerShell 中克隆并编译：

```powershell
git clone https://github.com/BlueNines/BetterShell.git
Set-Location BetterShell
.\build-personal.ps1 -InstallDependencies
```

构建完成后，运行 `dist/personal/win-unpacked/BetterShell.exe`。安装包和免安装 ZIP 位于 `dist/personal`；免安装包需要完整解压后运行。后续重新编译可直接运行 `./build-personal.ps1`。

仓库保存源码、构建脚本和测试；编译产物与本机连接配置不随源码提交。用户数据保存在 `%APPDATA%\BetterShell`。

详见 [screen 与独立控制台说明](PERSONAL_V6.md)、[Notepad++ 文件编辑说明](PERSONAL_V5.md)、[工作区恢复说明](PERSONAL_V4.md)、[数据库功能说明](PERSONAL_V3.md)、[编译说明](BUILD_WINDOWS.md)、[第二版说明](PERSONAL_V2.md) 和 [第一版说明](PERSONAL_V1.md)。

## 许可证

继承 Electerm 的 MIT 许可证，保留原作者版权声明，详见 [LICENSE](LICENSE)。

随附的独立 Notepad++ 程序遵循 GPL v3；产物的 `resources/notepad-plus-plus` 中包含其许可证、版本来源和对应源代码 ZIP。
