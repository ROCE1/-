# dsh-app

带锁屏提醒的个人任务 / 时间管理应用。一套 `www/` 前端，三种产物：Windows 安装包（Electron）、安卓 APK（Capacitor）、PWA。

## 功能

| 页面 | 内容 |
|---|---|
| 今日 | 紧急 / 主线 / 支线分区；截止倒计时（颜色随剩余时间变化）；强提醒标记；勾选完成；左滑删除；右上角「排序」用 ↑ ↓ 手动调顺序 |
| 健身 | 力量日 / 有氧日两个页签，按基准日自动交替；力量记「组 × 个」、有氧记「时长 / 距离」；整条勾选；当天可手动切换 |
| 日历 | 月视图，有任务的日期打点；点某天查看当天任务，可直接在那天新建 |
| 记录 | 每日总结（按日期倒序，可回看/补改）+ 记录卡（可写标题/正文/标签，支持关键词与标签检索） |
| 统计 | 今日 + 本周/本月工作占比环图（数据来自「繁忙」开关），工作与空闲时长明细，可清空时间记录 |
| 设置 | 背景图（透明度 / 模糊可调）、主题、晚间总结时间、截止提前量、倒计时图例、健身提醒与轮换基准、小组件配色、权限与保活引导、检查更新、导出 / 导入备份 |

提醒与桌面：安卓侧用前台服务 + 精确闹钟，强提醒是横幅 + 持续震动，软提醒静默且繁忙时跳过；
常驻通知显示最多 5 行任务和「3/7」完成进度（带进度条），并带一个「切到繁忙 / 切到空闲」按钮；
主屏可放 4×2 小组件，显示今日前 3 条任务，背景色和不透明度可在设置里调。

## 快速开始

```bash
pnpm start                # 桌面端开发运行（产物不能在工作区里跑，见 AGENTS.md）
pnpm build:win            # 打 Windows 安装包 → release/
pnpm android:sync         # 把 www/ 同步进安卓工程
pnpm android:apk          # 打 APK
```

本地看网页版（PWA 调试）：`python -m http.server 8080 --directory www`

## 测试

```bash
node scripts/test-model.mjs   # 纯逻辑回归测试（倒计时、重复规则、健身轮换、月历）
node scripts/smoke.mjs         # 无头浏览器冒烟测试（需要本机装 Edge/Chrome，且要有完整权限）
```

## 发布

```bash
# 1. 改 package.json 的 version（三端同源：桌面 app.getVersion()、安卓 versionName/versionCode 都读它）
# 2. 提交并打 tag，CI 自动打包并发布到 Releases
git push && git tag v0.5.0 && git push origin v0.5.0
```

客户端「检查更新」读 `releases/latest/download/latest.yml`（走 `app.config.json` 里的加速前缀）。
详细流程、环境变量与踩过的坑都记在 [AGENTS.md](./AGENTS.md)；版本历史见 [CHANGELOG.md](./CHANGELOG.md)。

## 目录

```
www/                  唯一的前端源（HTML/CSS/JS 模块，无构建步骤）
  index.html          六个页签 + 四个弹窗
  app.js              界面与交互（唯一的“控制器”）
  model.js            任务与倒计时的纯逻辑
  fitness.js          健身轮换与文案的纯逻辑
  calendar.js         月历网格的纯逻辑
  stats.js            统计（忙碌区间合并、占比）的纯逻辑
  store.js            IndexedDB（v2）读写
  native.js           安卓原生插件的封装（浏览器里全是空实现）
  themes.js           皮肤注册表（颜色全走 CSS 变量）
electron/             桌面壳：main.js / preload.js / update.js
android/              Capacitor 安卓工程（通知/闹钟前台服务 + 桌面小组件）
scripts/              一次性工具与测试（图标、清单、版本、测试）
docs/                 产品规格与施工计划
```
