# 每日热点信息推荐网页

第一版使用 Google News RSS、GDELT 和 Hacker News 聚合每日热点，提供中文摘要、热度分数和推荐理由。

## 运行

```bash
npm start
```

默认端口是 `3000`，也可以指定：

```bash
PORT=5173 npm start
```

打开 `http://localhost:3000`。

## API

- `GET /api/news`：读取缓存或抓取最新数据
- `GET /api/news?refresh=1`：强制刷新缓存
- `GET /api/push/status`：查看企业微信推送配置、定时任务和最近推送
- `GET /api/push/preview`：预览企业微信日报内容
- `POST /api/push/send`：立即触发一次企业微信推送
- `GET /api/health`：健康检查

缓存文件保存在 `data/news-cache.json`。默认每天自动换新，并在 `CACHE_TTL_MINUTES` 到期后刷新。

## 企业微信每日推送

先在企业微信群里添加「群机器人」，复制机器人 Webhook，然后创建 `.env`：

```bash
cp .env.example .env
```

编辑 `.env`：

```bash
WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=YOUR_ROBOT_KEY
PUSH_TIME=08:30
PUSH_TOP_PER_CATEGORY=3
```

手动预览推送内容，不会发送：

```bash
npm run push:dry-run
```

手动发送一次：

```bash
npm run push:once
```

在 macOS 上安装每日定时推送：

```bash
npm run push:install-macos
```

取消定时推送：

```bash
npm run push:uninstall-macos
```

推送日志保存在 `data/push-log.json`，同一天默认只推送一次；如需重复发送，可运行：

```bash
node scripts/push-wecom.js --refresh --force
```

网页首页会显示「企业微信推送」面板，可查看 Webhook 配置状态、定时任务状态、下次推送时间、最近推送记录，并可预览日报或手动触发推送。

## GitHub Actions 云端推送

如果希望电脑离线、关机或未登录时也能推送，可以使用 GitHub Actions。项目已包含云端定时任务：

```text
.github/workflows/daily-wecom-push.yml
```

这个 workflow 会每天 `08:30` 按 `Asia/Shanghai` 时区运行一次，也支持在 GitHub 的 Actions 页面手动运行。

在 GitHub 仓库中添加企业微信机器人地址：

1. 打开仓库 `Settings`
2. 进入 `Secrets and variables` -> `Actions`
3. 点击 `New repository secret`
4. 名称填写 `WECOM_WEBHOOK_URL`
5. 值填写企业微信群机器人的完整 Webhook URL

推送到 GitHub 后，进入仓库 `Actions` -> `Daily WeCom Push`，可以点 `Run workflow` 立即测试一次。定时任务会使用 GitHub 云端运行器执行：

```bash
npm run push:once
```

workflow 会用 GitHub Actions cache 保存当天的 `data/push-log.json`，避免同一天重复运行时再次推送。

如果只使用 GitHub 云端推送，可以取消本机 macOS 定时任务：

```bash
npm run push:uninstall-macos
```
