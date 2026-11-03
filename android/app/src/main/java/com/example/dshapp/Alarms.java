package com.example.dshapp;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONObject;

/** 闹钟的注册与取消：插件、开机恢复两处共用，避免逻辑分叉。 */
final class Alarms {
    private static final String ACTION_ALARM = "com.example.dshapp.ALARM";

    private Alarms() {}

    static void schedule(Context context, String id, long at, String title, String body, boolean strong) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;

        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(ACTION_ALARM);
        intent.putExtra("id", id);
        intent.putExtra("title", title);
        intent.putExtra("body", body);
        intent.putExtra("strong", strong);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getBroadcast(context, id.hashCode(), intent, flags);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
                // 没有精确闹钟权限时退让：系统可能合并/延后，但至少不会丢
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            } else {
                manager.setExact(AlarmManager.RTC_WAKEUP, at, pending);
            }
        } catch (SecurityException error) {
            manager.set(AlarmManager.RTC_WAKEUP, at, pending);
        }

        JSONObject record = new JSONObject();
        try {
            record.put("id", id);
            record.put("at", at);
            record.put("title", title);
            record.put("body", body);
            record.put("strong", strong);
        } catch (Exception ignored) {
            return;
        }
        ReminderStore.putAlarm(context, record);
    }

    static void schedule(Context context, JSONObject record) {
        schedule(
                context,
                record.optString("id"),
                record.optLong("at"),
                record.optString("title"),
                record.optString("body"),
                record.optBoolean("strong"));
    }

    static void cancel(Context context, String id) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(ACTION_ALARM);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getBroadcast(context, id.hashCode(), intent, flags);
        if (manager != null) manager.cancel(pending);
        ReminderStore.removeAlarm(context, id);
    }
}
