# Free New Desk 公开版

面向 Windows 11 x64 的点播、直播与音乐播放器，兼容 TVBox / FongMi 风格来源配置。**软件不内置第三方影视源**，影视内容由用户自行导入；本地音乐、NAS、SMB 和 WebDAV 可加入音乐库。

TVBox/FongMi-style desktop media player for Windows 11 x64. No third-party video sources are bundled; users import their own sources. Local music, NAS, SMB and WebDAV libraries are supported.

**当前版本：V1.5.0** ｜ [下载本版](https://github.com/cwe88108/free-new-desk-public/releases/tag/v1.5.0) ｜ [全部发行](https://github.com/cwe88108/free-new-desk-public/releases) ｜ [问题反馈](https://github.com/cwe88108/free-new-desk-public/issues)

## 下载与安装

| 文件 | 用途 |
|---|---|
| [Windows x64 安装版](https://github.com/cwe88108/free-new-desk-public/releases/download/v1.5.0/Free-New-Desk-Setup-1.5.0-x64.exe) | 安装并创建快捷方式 |
| [Windows x64 便携版](https://github.com/cwe88108/free-new-desk-public/releases/download/v1.5.0/Free-New-Desk-Portable-1.5.0-x64.exe) | 无安装运行；仍会保存应用数据 |
| [构建对应源码快照](https://github.com/cwe88108/free-new-desk-public/releases/download/v1.5.0/Free-New-Desk-Source-1.5.0-public.zip) | 本地安装包对应的脱敏源码，附源码文件清单 |
| [SHA256 校验值](https://github.com/cwe88108/free-new-desk-public/releases/download/v1.5.0/SHA256SUMS-PUBLIC.txt) | 核对安装版、便携版和源码快照 |

这两个 Windows 程序均**未进行发布者代码签名**，不声称具有可信发布者签名。升级前退出旧程序；保留本人数据备份。

## V1.5.0 改动

- 首页迷你播放器移至“我的收藏”下方，与主栏模块保持同宽、常规窗口下同高；进度、暂停与音量使用真实播放会话。
- 播放状态和点播历史／当前队列移至播放控制条下方，主栏宽度统一；修正已暂停状态标签。
- 来源导入、修改后主动刷新关联页面，避免切换页面后才看到已导入的来源。
- 修复直播播放列表跳转被误判为加载失败的问题，保留播放操作竞争与迟到请求隔离。
- 同步来源操作、收藏原子修改、音乐元数据和相关可靠性修复；保留安装包、程序与快捷方式图标资源。
- 更新仅匿名查询本公开仓库的 Release，无需 GitHub 账号或访问令牌；更新失败不会伪报“已是最新”。

## 功能与数据

- 点播：来源导入、分类、搜索、详情、剧集、收藏与历史。
- 直播：IPTV 播放列表、频道分组、多线路与 EPG。
- 音乐：本地／SMB／WebDAV 音乐库、封面、歌词、队列与 CUE 分段。
- 播放器：PlayerHost / libmpv、播放控制、画中画、全屏及媒体诊断。

公开版默认使用应用数据目录中的 `free-new-desk-public`，不会自动读取私有版的来源、历史、收藏、NAS 凭据或更新授权。可通过界面导入本人数据；不要向公开仓库上传私人来源、令牌或诊断包。测试可显式指定独立 `--user-data-dir`。

软件检查更新后打开发行页面，当前不提供静默下载安装。同版本号重新打包不会被识别为更高版本。

## 已知问题与验证范围

**已知问题：** 播放页向下滚动、视频区域部分离屏时，原生视频窗口可能越过页面顶部；V1.5.0 尚未修复此问题。

本地公开版完成 422 项单元／集成测试与 21 项原生播放器检查，均通过；构建、类型、脱敏、发行载荷、公开更新配置和图标资源检查通过。测试不代表所有外部来源、显卡和系统环境均已验收。完整跨窗口、硬解／多屏、安装升级及卸载矩阵仍需补齐。本次未重新进行完整公开版人工界面验收。

详见 [V1.5.0 验证范围](docs/PUBLIC-V150-VALIDATION.md) 和 Release 附件 `public-verification.json`。安装包沿用发布前的本地构建；源码快照对应其构建输入，主线额外包含 README 与历史截图更新。

## 构建

需要 Windows x64、Node >=24.18.1、JDK 17、CMake 与 Visual Studio C++ Build Tools。

```powershell
npm ci
npm run verify
npm run package:win
```

构建产物位于 `dist/releases`。`npm run check:public-sanitization` 检查源码私有引用及明显凭据。使用 Release 中的源码快照、`SOURCE-FILES.json`、`release-manifest.json` 和校验文件核对构建来源。

## 历史界面参考

以下为 **V1.4.17** 的公开版历史截图，不代表 V1.5.0 的新布局或本版验收证据。

<table>
<tr>
<td width="50%"><img alt="V1.4.17 直播历史界面" src="docs/screenshots/v1.4.17-live.webp"></td>
<td width="50%"><img alt="V1.4.17 点播历史界面" src="docs/screenshots/v1.4.17-vod.webp"></td>
</tr>
<tr>
<td width="50%"><img alt="V1.4.17 播放器历史界面" src="docs/screenshots/v1.4.17-player.webp"></td>
<td width="50%"><img alt="V1.4.17 音乐历史界面" src="docs/screenshots/v1.4.17-music.webp"></td>
</tr>
</table>

## 授权与安全

源码公开不等于采用宽松开源许可证，授权范围以 [LICENSE](LICENSE) 为准。第三方组件按其各自许可证使用，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。安全问题报告方式见 [SECURITY.md](SECURITY.md)，不要在公开 Issue 中披露凭据或可利用细节。

V1.4.7 的历史兼容协议记录见 [兼容状态文档](docs/compatibility-v2-status.md)，历史数字不作为本版证据。
