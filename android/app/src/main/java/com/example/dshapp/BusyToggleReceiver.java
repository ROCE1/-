package com.example.dshapp;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 常驻通知上的「繁忙 / 空闲」按钮。
 *
 * 原生侧先把状态翻过来、立刻刷新通知和小组件（用户点了马上有反馈），
 * 同时记一笔 pending，等前端下次启动/回前台时取走，用它补写工作时段。
 */
public class BusyToggleReceiver extends BroadcastReceiver {
    static final String ACTION_TOGGLE_BUSY = "com.example.dshapp.TOGGLE_BUSY";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION_TOGGLE_BUSY.equals(intent.getAction())) return;

        boolean busy = !ReminderStore.isBusy(context);
        long at = System.currentTimeMillis();
        ReminderStore.setBusy(context, busy);
        ReminderStore.setPendingBusy(context, busy, at);

        int done = ReminderStore.progressDone(context);
        int total = ReminderStore.progressTotal(context);
        String title = retitle(ReminderStore.panelTitle(context), busy);
        String text = ReminderStore.panelText(context);
        ReminderStore.setPanel(context, title, text);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(Notifier.ID_ONGOING, Notifier.ongoing(context, title, text, done, total, busy));
        }
        TaskWidgetProvider.refresh(context);
    }

    /** 只换「空闲 / 繁忙中」前缀，后面的任务数保持原样。 */
    private static String retitle(String title, boolean busy) {
        String rest = title == null ? "今日任务" : title.replaceFirst("^(空闲|繁忙中)\\s*·\\s*", "");
        return (busy ? "繁忙中 · " : "空闲 · ") + rest;
    }
}
