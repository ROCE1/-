package com.example.dshapp;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.widget.RemoteViews;

/**
 * 桌面小组件：显示今日完整清单（顺序和 App 内一致：紧急→支线→日常→主线）。
 *
 * 数据单独存一份（ReminderStore 的 widgetTitle / widgetBody）：
 * 常驻通知为了锁屏空间只显示一条，小组件要的是全部，两者不能共用同一份文本。
 * 前端每次 syncState 都会调 refresh()。
 */
public class TaskWidgetProvider extends AppWidgetProvider {

    /** 刷新所有已放置的组件实例（前端同步状态后调用）。 */
    static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        ComponentName provider = new ComponentName(context, TaskWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        for (int widgetId : ids) update(context, manager, widgetId);
    }

    static void update(Context context, AppWidgetManager manager, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_tasks);

        // 小组件用自己的一份数据（完整清单），不再是通知的那一行
        String title = ReminderStore.widgetTitle(context);
        int done = ReminderStore.progressDone(context);
        int total = ReminderStore.progressTotal(context);
        if (total > 0) title = "今日任务 " + done + "/" + total;

        String body = ReminderStore.widgetBody(context);
        views.setTextViewText(R.id.widget_title, title);
        views.setTextViewText(R.id.widget_body, body == null || body.isEmpty() ? "今天还没有任务" : body);

        // 背景色 + 不透明度由前端设置页决定（setBackgroundColor 会盖掉圆角 drawable）
        int background = withAlpha(ReminderStore.widgetColor(context), ReminderStore.widgetOpacity(context));
        views.setInt(R.id.widget_root, "setBackgroundColor", background);

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, open, flags));

        manager.updateAppWidget(widgetId, views);
    }

    /** #rrggbb + 不透明度 → ARGB；颜色写坏了就退回默认深色。 */
    private static int withAlpha(String color, float opacity) {
        int rgb;
        try {
            rgb = Color.parseColor(color == null ? "#171a21" : color);
        } catch (IllegalArgumentException error) {
            rgb = Color.parseColor("#171a21");
        }
        float clamped = Math.max(0f, Math.min(1f, opacity));
        int alpha = Math.round(clamped * 255f);
        return (alpha << 24) | (rgb & 0x00FFFFFF);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int widgetId : appWidgetIds) update(context, appWidgetManager, widgetId);
    }
}
