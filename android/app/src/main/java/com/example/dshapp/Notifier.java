package com.example.dshapp;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * 通知与闹钟的统一构造入口：频道、前台服务通知、提醒通知都从这里出，
 * 免得插件、Service、Receiver 三处各写一套样式。
 */
final class Notifier {
    static final String CHANNEL_ONGOING = "ongoing";
    static final String CHANNEL_STRONG = "strong";
    static final String CHANNEL_SOFT = "soft";

    static final int ID_ONGOING = 1001;
    static final int ID_ALARM_BASE = 2000;

    private Notifier() {}

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel ongoing = new NotificationChannel(
                CHANNEL_ONGOING, "任务常驻", NotificationManager.IMPORTANCE_LOW);
        ongoing.setDescription("锁屏与通知栏显示的今日任务");
        ongoing.setShowBadge(false);
        manager.createNotificationChannel(ongoing);

        NotificationChannel strong = new NotificationChannel(
                CHANNEL_STRONG, "强提醒", NotificationManager.IMPORTANCE_HIGH);
        strong.setDescription("截止提醒：横幅 + 震动");
        strong.enableVibration(true);
        strong.setVibrationPattern(new long[]{0, 250, 150, 250});
        strong.setBypassDnd(false);
        manager.createNotificationChannel(strong);

        NotificationChannel soft = new NotificationChannel(
                CHANNEL_SOFT, "软提醒", NotificationManager.IMPORTANCE_LOW);
        soft.setDescription("静默提醒，繁忙时暂停");
        soft.setSound(null, null);
        soft.enableVibration(false);
        manager.createNotificationChannel(soft);
    }

    /** 常驻通知：锁屏可见、不可滑动清除。 */
    static Notification ongoing(Context context, String title, String text) {
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent content = PendingIntent.getActivity(
                context, 0, open, pendingFlags());

        Notification.Builder builder = builder(context, CHANNEL_ONGOING)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(content)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setVisibility(Notification.VISIBILITY_PUBLIC);

        return builder.build();
    }

    /** 截止/健身提醒：strong 走横幅+震动，否则静默。 */
    static Notification reminder(Context context, String id, String title, String body, boolean strong) {
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent content = PendingIntent.getActivity(
                context, id.hashCode(), open, pendingFlags());

        Notification.Builder builder = builder(context, strong ? CHANNEL_STRONG : CHANNEL_SOFT)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setAutoCancel(true)
                .setContentIntent(content)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(strong ? Notification.CATEGORY_REMINDER : Notification.CATEGORY_STATUS);

        if (!strong) {
            // 平台 Notification.Builder 没有 setSilent；静音由低重要性频道保证
            builder.setPriority(Notification.PRIORITY_LOW);
        } else {
            builder.setPriority(Notification.PRIORITY_HIGH);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                builder.setDefaults(Notification.DEFAULT_VIBRATE);
            }
        }
        return builder.build();
    }

    private static Notification.Builder builder(Context context, String channel) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(context, channel);
        }
        return new Notification.Builder(context);
    }

    private static int pendingFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.FLAG_UPDATE_CURRENT;
    }
}
