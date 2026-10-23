# Free New Desk 公开版

面向 Windows 11 x64 的点播、直播及本地／NAS 音乐播放器。软件不内置第三方影视源，来源需用户自行导入。

当前源码版本：**V1.5.0**。此目录为公开发行准备版本；本地生成安装包不代表已上传 GitHub。

- [公开仓库](https://github.com/cwe88108/free-new-desk-public)
- [下载与更新](https://github.com/cwe88108/free-new-desk-public/releases)
- [问题反馈](https://github.com/cwe88108/free-new-desk-public/issues)

## 本版改动

- 首页迷你播放器移至我的收藏下方，统一主栏宽度和模块高度。
- 播放状态与点播历史移至控制条下方；暂停状态准确显示。
- 同步来源导入即时刷新、直播播放列表跳转修复。

- 修复来源编辑／删除确认框，完善级联删除、批量状态反馈、筛选和上下排序。
- 完善点播／直播／音乐的播放所有权、迟到请求隔离和原生视频窗口状态。
- 收藏采用共享数据校验与原子修改；CUE采用分段时长，专辑按碟序／曲序稳定排序。
- 更新 music-metadata、Vite 等已核验补丁；第三方组件见 THIRD_PARTY_NOTICES.md。
- 更新仅匿名查询本公开仓库的 GitHub Release，不需要填写 GitHub 令牌；检查失败不会显示“已是最新”。
- 未签名构建保留EXE图标和版本资源写入；图标文件、安装包和快捷方式采用项目图标。

## 安装和数据

安装包：`Free-New-Desk-Setup-1.5.0-x64.exe`；便携包：`Free-New-Desk-Portable-1.5.0-x64.exe`。均未进行发布者代码签名，Windows可能提示未知发布者。

公开版默认使用应用数据目录中的 `free-new-desk-public`，不会自动读取其他版本的来源、历史、收藏、NAS凭据或更新授权。现有公开版用户如需迁移，请先备份并通过界面导入本人数据；不要直接复制凭据或向公开仓库上传诊断包。测试可显式指定独立 `--user-data-dir`。

公开仓库的 Release 版本号用于更新比较；将来发布新版本需同步更新版本号、标签、安装包、校验值和发行清单。同版本号重新打包不会被识别为更高版本。当前软件检查并打开发行页面，不承诺静默下载／安装更新。

## 构建与验证

需要 Windows x64、Node >=24.18.1、JDK 17、CMake、Visual Studio C++ Build Tools。

```powershell
npm ci
npm run verify
npm run package:win
```

产物位于 `dist/releases`。`npm run check:public-sanitization` 检查发布源码中的私有引用及明显凭据；不要把用户数据、构建缓存、日志或环境文件加入Git。

通过匹配包内 `release-manifest.json`、`SHA256SUMS.txt` 和源码树摘要核对来源。源码公开不等于采用宽松开源许可证，授权范围以 LICENSE 为准；第三方组件仍按各自许可证使用。

## 验收边界

公开版的验证结果见 [V1.5.0验证范围](docs/PUBLIC-V150-VALIDATION.md)。拖拽、完整跨窗口／硬解／多屏矩阵、部分恢复与安装流程仍需补齐，不能把单元测试通过等同所有设备与所有外部来源可用。

## 历史协议文档

V1.4.7 的 **V2 影视仓兼容状态**记录见 [docs/compatibility-v2-status.md](docs/compatibility-v2-status.md)。历史截图和验证数字仅代表其标注版本，不作为本版通过证据。
