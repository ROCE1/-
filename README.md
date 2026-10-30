# dsh-app

一套前端，三种产物：Windows 安装包、安卓 APK、PWA。

现在是最小骨架：界面上只有一个版本号和“检查更新”按钮，用来验证整条链路（打包 → 发布 → 检查更新）能跑通。功能定了之后往 `www/` 里填。

## 快速开始

```bash
pnpm start        # 桌面端开发运行
pnpm build:win    # 产出 release/DSH App-0.1.0-setup.exe
```

## 发布

1. `package.json` 里改 `version`
2. `pnpm build:win`
3. GitHub 上 Create release，tag 用 `v0.1.0`，上传 `release/` 下的 exe 和 `latest.yml`
4. 把 `app.config.json` 的 owner/repo 填成你的仓库 —— 之后客户端的“检查更新”就能读到

详见 [AGENTS.md](./AGENTS.md)。
