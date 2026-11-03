# 任务系统方案（已确认）

## 定位

带锁屏提醒的个人任务/时间管理系统。**先做纯手机产品**（安卓 / 荣耀 MagicOS），单机本地存储，跨设备同步不在本期。

## 已确认的决策

| 项 | 决定 |
|---|---|
| 倒计时语义 | 只有**任务截止倒计时**；颜色随剩余时间变化（48h 绿 / 12h 黄 / 4h 橙 / 1h 红） |
| 专注计时 | 不做（不是番茄钟） |
| 后台计时 | 通过「繁忙 / 空闲」按钮累计每日工作学习时长，喂给环形图 |
| 繁忙/空闲 | **全局开关，只影响本 App 的提醒**，不影响系统其他通知 |
| 强提醒 | 横幅通知 + **显示倒计时** + 震动；繁忙时照常触发 |
| 软提醒 | 静默通知，无声音；繁忙时暂停 |
| 晚间总结 | 默认 22:00，**可在设置里改**，时间存本地 |
| 日历 | **仅 App 内视图**，不读写系统日历 |
| 健身任务 | 按**整块**提醒（不按单个任务）；最多 **3 个提醒时间**，每个可设「每天 / 一次性」 |
| 数据 | 本地（IndexedDB），提供导出/导入 JSON |

## 任务模型

| 类型 | 行为 |
|---|---|
| 主线 main | 长期目标下的任务，可设截止时间 |
| 支线 side | 随时可加，与主线分区显示 |
| 紧急 urgent | 临时插入，置顶、默认强提醒 |
| 健身 fitness | 每天自动出现，不计时、无截止，按整块时间提醒 |

**常挂任务**是调度属性（`repeat`），不是类型：不生成副本，每天“投影”出当天的 occurrence。

```ts
type TaskType = 'main' | 'side' | 'urgent' | 'fitness'
type Repeat =
  | { kind: 'once'; date: string }        // YYYY-MM-DD
  | { kind: 'daily' }
  | { kind: 'weekly'; days: number[] }    // 0=周日 … 6=周六
  | { kind: 'everyN'; n: number; anchor: string }

interface Task {
  id: string
  title: string
  type: TaskType
  repeat: Repeat
  deadline?: string | null      // ISO 时间；null = 无倒计时
  strong?: boolean              // 默认 false（软提醒）
  notes?: string
  createdAt: string
  archivedAt?: string | null
}

interface Occurrence {          // 某天的完成状态
  key: string                   // `${taskId}@${date}`
  taskId: string
  date: string                  // YYYY-MM-DD
  done: boolean
  doneAt?: string | null
}

interface WorkSession {         // 环形图数据源
  id: string
  kind: 'busy' | 'idle' | (string & {})   // 预留扩展
  start: string
  end?: string | null
}

interface JournalEntry { date: string; summary: string; planTaskIds: string[]; planFree: string }
interface RecordCard { id: string; createdAt: string; title?: string; body: string; tags: string[] }
interface ReminderPhrase { id: string; text: string; enabled: boolean; order: number }

interface Settings {
  summaryTime: string           // '22:00'
  countdownThresholds: { green: number; yellow: number; orange: number; red: number } // 小时
  fitnessReminders: { time: string; repeat: 'daily' | 'once'; date?: string }[]        // 最多 3 条
  lockScreenEnabled: boolean
}
```

## 页面

| 页面 | 内容 |
|---|---|
| 今日 | 紧急 / 主线 / 支线 / 健身 四个分区；每条含标题、倒计时彩色胶囊、强软标记、勾选完成 |
| 任务编辑 | 标题、类型、重复规则、截止时间、强提醒开关、备注 |
| 日历 | 月视图，有任务的日期打点，点开看当天 |
| 记录 | 每日日志（按日期）+ 记录卡（卡片流） |
| 统计 | 环形图（工作/空闲占比），数据来自 WorkSession |
| 设置 | 晚间总结时间、倒计时阈值、健身提醒时间（≤3）、锁屏开关、提醒语、导出备份 |

## 锁屏 / 通知

```
┌────────────────────────────┐
│ 忙碌中 · 已 1h24m           │
│ ● 主线 写完方案  ⏱ 2h15m   │
│ ○ 支线 整理素材             │
│ 🏋 健身 俯卧撑 30 个        │
└────────────────────────────┘
```

- 常驻通知（前台服务）承载今日任务与倒计时
- 空闲时末行显示当日轮换提醒语
- 强提醒：横幅 + 倒计时 + 震动（不依赖全屏意图）

## 荣耀 MagicOS 注意事项

1. 权限按需申请：通知 → 精确闹钟 → 忽略电池优化
2. App 内提供「保活引导」页：应用启动管理允许自启动、电池优化设为不限制、最近任务里锁定
3. 代码兜底：开机重注册闹钟、定时自检、触发延迟超 2 分钟在通知里标注

## 分期与验收

| 阶段 | 交付 | 验收 |
|---|---|---|
| P0 | 数据层、今日视图、任务增删改、重复规则、倒计时与颜色、完成打卡 | 能建任务；常挂任务每天自动出现；倒计时颜色随时间变化 |
| P1 | 前台服务 + 常驻通知、精确闹钟、强/软提醒、繁忙/空闲、保活引导 | 锁屏可见任务；繁忙时软提醒静音、强提醒照常；杀进程后闹钟仍响 |
| P2 | 晚间总结弹窗、每日日志、记录卡、次日排程、提醒语轮换 | 每晚按时弹出；能写总结与计划 |
| P3 | 环形图、月历视图、事件流扩展、主题令牌 | 环形图基于真实繁忙/空闲时长 |
