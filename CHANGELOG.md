# 更新记录

## 0.1.3 — 2026-10-30

- 桌面端支持**下载并安装更新**：清单取 Release 里的 latest.yml，安装包走加速前缀下载，sha512 校验后静默安装
- 安装包文件名去掉空格（`DSH-App-<版本>-setup.exe`）：GitHub 会把空格替换成点，导致清单里的文件名与实际资产对不上
- 更新清单只认 Release 资产（CI 生成，sha512 与安装包严格对应），不再读仓库里的手写清单

## 0.1.1 — 2026-10-30

- 更新检查支持**加速前缀**（`app.config.json` 的 `mirror`，默认 `https://gh-proxy.com/`）：
  本机网络对 `github.com` 与 `raw.githubusercontent.com` 均阻断，只有前缀可达
- 更新清单改从**仓库根目录** `latest.yml` 读取，不再依赖 Release 附件：
  发版只需改一个文件并 push，不必重复上传 118 MB 安装包
- 逐个候选地址回退（前缀 raw → 前缀 release → 直连 raw → 直连 release），任一成功即用

## 0.1.0 — 2026-10-30

首个可运行骨架，验证三端产物与更新链路：

- 一套 `www/` 前端，产出 Windows 安装包（Electron）、安卓 APK（Capacitor）、PWA
- 桌面端：主进程带崩溃/加载日志（`%APPDATA%\dsh-app\startup.log`），关 GPU 加速，窗口就绪后才显示
- 更新检查：读 `https://github.com/<owner>/<repo>/releases/latest/download/latest.yml`，不依赖 GitHub API
- 版本号单一来源：`package.json` 的 `version`，安卓 `versionName/versionCode` 由 Gradle 读取推导
- 发版脚本：`scripts/make-icons.py`（图标）、`scripts/make-latest-yml.mjs`（更新清单）
