# dsh-app — 三端应用骨架

同一个 `www/` 前端，产出三种东西：Windows 安装包（Electron）、安卓 APK（Capacitor）、PWA（浏览器直接装到主屏幕）。

## 目录

```
www/                  唯一的前端源（HTML/CSS/JS，无构建步骤）
electron/             桌面壳：main.js / preload.js / update.js
app.config.json       GitHub 仓库坐标（更新检查读它）
capacitor.config.json 安卓壳配置（appId 在这里改）
electron-builder.yml  Windows 打包配置
scripts/              一次性工具（图标生成等）
```

## 常用命令

| 目的 | 命令 |
|---|---|
| 桌面端开发运行 | `pnpm start` |
| 打 Windows 安装包 | `pnpm build:win` → `release/` |
| 生成安卓工程（只需一次） | `pnpm android:add` |
| 同步前端到安卓 | `pnpm android:sync` |
| 打 APK | `pnpm android:apk` → `android/app/build/outputs/apk/release/` |
| 本地起网页（PWA 调试） | `python -m http.server 8080 --directory www` |

## 环境（本机现状）

- Node 24 / pnpm 11：已就绪（pnpm 用 `node <runtime>/pnpm/bin/pnpm.cjs` 调用）
- JDK：`D:\dev\jdk17`（Temurin 17.0.20.1）与 `D:\dev\jdk21`（Temurin 21.0.12.1）。
  **安卓构建必须用 JDK 21**（Capacitor 8 的 Java 源级别是 21，用 17 会报“无效的源发行版：21”）
- Android SDK：`D:\dev\android-sdk`（cmdline-tools latest + platform-tools + build-tools;34.0.0 + platforms;android-34，licenses 已接受）
- Gradle 缓存：`GRADLE_USER_HOME=D:\dev\gradle-home`；wrapper 分发地址已改到腾讯镜像（services.gradle.org 在国内不稳）
- 构建前必须设：`JAVA_HOME=D:\dev\jdk21`、`ANDROID_HOME=D:\dev\android-sdk`、`GRADLE_USER_HOME=D:\dev\gradle-home`
- `android/local.properties` 里 `sdk.dir=D:/dev/android-sdk`
- Maven 走了阿里云镜像（`android/build.gradle` 里排在 google() 前面）
- 项目路径含中文，AGP 默认拒绝构建；`android/gradle.properties` 里开了 `android.overridePathCheck=true`。
  如果哪天 aapt2 阶段报乱码路径错误，就把工程整体挪到 `D:\dev\dsh-app` 再构建
- 安卓产物：`android/app/build/outputs/apk/debug/app-debug.apk`（当前 4.0 MB），
  复制到 `D:\DSH-App-dist\` 再传手机
- 版本号已打通：`android/app/build.gradle` 直接读根目录 `package.json` 的 `version`，
  `versionCode` 按 `major*10000+minor*100+patch` 推导（0.1.0 → 100）。改版本只改一处

## 血泪教训：产物不要放在工作区里运行

DSH 文件沙箱会给工作区文件打 **Low Mandatory Level** 完整性标签 + 沙箱 SID。在那种目录里双击 Electron 程序会出现：

- “仍要运行”提示，点完之后进程静默退出
- `debug.log` 里只有 `Invalid file descriptor to ICU data received`
- 主进程能启动但 GPU 子进程 `launch-failed`（systemErrorCode 5 = 拒绝访问）

**所以：源码在工作区，运行/分发产物必须在 D 盘。** 现在桌面快捷方式指向 `D:\DSH-App\`，构建后要复制过去再测。

## 发版流程（已跑通）

```bash
# 1. 改 package.json 的 version（三端同源：桌面 app.getVersion()、安卓 versionName/Code 都读它）
# 2. 桌面安装包（注意 TMP：NSIS 在沙箱默认临时目录里会报 "Unable to create temporary file"）
export TMP="C:\...\dsh-app\build\tmp"; export TEMP="$TMP"
export ELECTRON_BUILDER_CACHE="$PWD/.eb-cache"      # 已解压好的 nsis/winCodeSign
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
node node_modules/electron-builder/cli.js --win nsis --x64 --publish never
node scripts/make-latest-yml.mjs                     # 生成 release/latest.yml

# 3. 安卓
export JAVA_HOME="D:\dev\jdk21" ANDROID_HOME="D:\dev\android-sdk" GRADLE_USER_HOME="D:\dev\gradle-home"
cd android && cmd //c "gradlew.bat assembleDebug --no-daemon"

# 4. 复制到 D:\DSH-App-dist\ 再上传 GitHub Release
```

产物：`DSH App-<版本>-setup.exe`（118 MB）、`latest.yml`、`DSH-App-<版本>-debug.apk`（4 MB）。

## 推送代码（注意网络）

这台机器 **`github.com:443` 被阻断**，HTTPS 推送必然超时；但 **`ssh.github.com:443` 是通的**。所以仓库走 SSH：

```
origin  ssh://git@ssh.github.com:443/ROCE1/-.git
core.sshCommand  ssh -i D:/dev/.ssh/id_ed25519_dshapp -o IdentitiesOnly=yes -o UserKnownHostsFile=D:/dev/.ssh/known_hosts -o StrictHostKeyChecking=accept-new
```

- 密钥在 `D:\dev\.ssh\`，**不放 `~/.ssh`**：用户目录是中文（杜方舟），OpenSSH 处理该路径会编码错乱
- 公钥已加到 GitHub 账号（`dsh-app@windows`），推送无需密码
- 本仓库 git 身份是 `dsh-app <dsh-app@local>`（全局没设）

## 更新机制（重要）

- 读取：`https://github.com/<owner>/<repo>/releases/latest/download/latest.yml`
  客户端统一走**加速前缀**（`app.config.json` 的 `mirror`，默认 `https://gh-proxy.com/`），
  前缀失败才回落直连；不调用 api.github.com（本机阻断）。
- 发布：**推 tag 即发布**（见下节），不需要手工上传。

## CI 发布（已跑通）

```
改 package.json 的 version → git push + git tag vX.Y.Z + push tag
  → GitHub Actions（windows-latest）打包
  → gh release create 自动建 Release 并上传 exe / latest.yml / blockmap
  → 客户端「检查更新」看到新版本 → 「下载并安装」自动完成升级
```

排障要点（都踩过）：

- pnpm 11 的构建设置读 `pnpm-workspace.yaml` 的 `allowBuilds`，不读 package.json 的 `pnpm` 字段；
  未放行 electron 的安装脚本 → CI 上没有 `electron/dist` → 打包失败
- `artifactName` **不能带空格**：GitHub 会把空格换成点，清单里的文件名就对不上（0.1.2 的坑）
- `scripts/make-latest-yml.mjs` **不要硬编码安装包名**，按 `*-setup.exe` 去 `release/` 里找（0.1.3 的坑）
- 本机读不到 Actions 日志（api.github.com 阻断），所以失败时 job 会把 `install/electron/build/manifest/release.log`
  汇总成 `ci-failure.log` 推到 `ci-logs` 分支，用
  `https://gh-proxy.com/https://raw.githubusercontent.com/ROCE1/-/ci-logs/ci-failure.log` 读
- NSIS 默认 solid 压缩在 runner 上曾被杀，现用 `compression: store`（包 ~117 MB，稳定优先）

## 约定

- 版本号在 `package.json` 的 `version`，语义化：修 bug +1 末位，加功能 +1 中位。
- 每次发版：改版本 → 构建 → 更新 `CHANGELOG.md` → 传 Release。
- 前端不做复杂构建（没有 Vite/webpack）；真需要框架时再引入，并同步改 `webDir`。
- `app.config.json` 里的 owner/repo 为空时，更新检查会明确返回“未配置”，不会假装成功。

## 安卓签名与更新（已跑通）

- **keystore**：`D:\dev\keystore\dsh-app.jks`，密码在同目录 `keystore.properties`（`android/keystore.properties` 被 gitignore，绝不入库）。
  **这份文件+密码丢了就永远无法覆盖升级**，务必另存一份。
- **GitHub Secrets**（已配置）：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。
  没配这几个 secret 时 CI 只发桌面包，APK 步骤自动跳过（`HAS_KEYSTORE`）。
- **CI 里的坑**：`keystore.properties` 的 `storeFile` 必须是**正斜杠绝对路径**。
  写 `$PWD/android/release.jks`（反斜杠）会被 Gradle `file()` 按模块目录再拼一次，变成 `D:a--\android\release.jks` 然后报找不到。
- **客户端更新**：`www/app.js` 用 `CapacitorHttp`（原生请求，绕开 CORS）拉 `latest.yml`，拼出
  `.../releases/latest/download/DSH-App-<版本>-release.apk`，再 `window.open` 交给系统浏览器。
  Android 不允许应用静默安装 APK，用户要点一次“安装”，并授权“允许安装未知应用”。
- **版本显示**：安卓/网页端没有主进程，版本号由 `scripts/write-web-version.mjs` 写进 `www/app-version.json`；
  `build:win` / `android:sync` / `android:apk` 都会先跑它。
- 换仓库地址时，要同时改 `app.config.json`（桌面端读）和 `www/app.js` 顶部的 `SOURCE`（移动端读）。
