package com.example.dshapp;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 闹钟到点时的落点。
 * - 强提醒：交给 AlarmRingService，持续震动直到用户点「停止提醒」
 * - 软提醒：繁忙状态下直接丢弃（需求里的“繁忙时暂停软提醒”）
 */
public class AlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent.getStringExtra("id");
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        boolean strong = intent.getBooleanExtra("strong", false);

        if (id == null) return;

        if (strong) {
            AlarmRingService.start(context, id, title, body);
            return;
        }

        if (ReminderStore.isBusy(context)) return;

        Notifier.ensureChannels(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        int notifyId = Notifier.ID_ALARM_BASE + Math.abs(id.hashCode() % 500);
        manager.notify(notifyId, Notifier.soft(context, id, title, body));
    }
}
