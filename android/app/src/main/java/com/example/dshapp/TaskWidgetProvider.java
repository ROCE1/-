package com.example.dshapp;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

/**
 * 桌面小组件：显示今天最靠前的 3 条任务。
 *
 * 数据不另存一份 —— 直接读常驻通知用的同一份面板数据（ReminderStore 里的 title/text），
 * 这样锁屏通知和桌面小组件永远一致。前端每次 syncState 都会调 refresh()。
 */
public class TaskWidgetProvider extends AppWidgetProvider {
    private static final int[] LINE_IDS = { R.id.widget_line1, R.id.widget_line2, R.id.widget_line3 };

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

        String title = ReminderStore.panelTitle(context);
        String text = ReminderStore.panelText(context);
        int done = ReminderStore.progressDone(context);
        int total = ReminderStore.progressTotal(context);
        if (total > 0) title = title + " · " + done + "/" + total;

        views.setTextViewText(R.id.widget_title, title);

        // 背景色 + 不透明度由前端设置页决定（setBackgroundColor 会盖掉圆角 drawable）
        int background = withAlpha(ReminderStore.widgetColor(context), ReminderStore.widgetOpacity(context));
        views.setInt(R.id.widget_root, "setBackgroundColor", background);

        String[] lines = text == null || text.isEmpty() ? new String[] { "今天还没有任务" } : text.split("\n");
        for (int i = 0; i < LINE_IDS.length; i++) {
            if (i < lines.length) {
                views.setTextViewText(LINE_IDS[i], lines[i]);
                views.setViewVisibility(LINE_IDS[i], View.VISIBLE);
            } else {
                views.setViewVisibility(LINE_IDS[i], View.GONE);
            }
        }

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
