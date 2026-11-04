package com.example.dshapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/**
 * 通知与闹钟的统一构造入口：频道、常驻面板、提醒通知都从这里出。
 */
final class Notifier {
    // 频道 id 带版本号：Android 不允许修改已创建频道的重要性，
    // 老用户升级后必须换新 id，否则锁屏可见性改了也白改。
    // v3：强提醒改由 AlarmRingService 自己播放声音（这样才支持自定义提醒音乐），
    //     频道本身静音；同时把历史频道删掉，避免系统通知设置里出现同名多份。
    static final String CHANNEL_ONGOING = "ongoing_v3";
    static final String CHANNEL_STRONG = "strong_v3";
    static final String CHANNEL_SOFT = "soft_v3";

    private static final String[] LEGACY_CHANNELS = {
            "ongoing", "strong", "soft",
            "ongoing_v2", "strong_v2", "soft_v2",
    };

    static final int ID_ONGOING = 1001;
    static final int ID_RING = 1002;
    static final int ID_ALARM_BASE = 2000;

    private Notifier() {}

    static void ensureChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        // 旧频道只删不建：0.3.0~0.7.x 用过，留着会在“通知类别”里显示成同名重复项
        for (String legacy : LEGACY_CHANNELS) {
            try {
                manager.deleteNotificationChannel(legacy);
            } catch (Exception ignored) {
            }
        }

        // 常驻面板：用 DEFAULT 而不是 LOW —— 低重要性会被多数国内 ROM 从锁屏隐藏
        NotificationChannel ongoing = new NotificationChannel(
                CHANNEL_ONGOING, "任务常驻", NotificationManager.IMPORTANCE_DEFAULT);
        ongoing.setDescription("锁屏与通知栏显示的今日任务");
        ongoing.setShowBadge(false);
        ongoing.setSound(null, null);
        ongoing.enableVibration(false);
        ongoing.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(ongoing);

        // 强提醒：声音和震动都由 AlarmRingService 自己来（否则没法自定义音乐）
        NotificationChannel strong = new NotificationChannel(
                CHANNEL_STRONG, "强提醒", NotificationManager.IMPORTANCE_HIGH);
        strong.setDescription("截止提醒：横幅 + 持续响铃震动");
        strong.setSound(null, null);
        strong.enableVibration(false);
        strong.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(strong);

        NotificationChannel soft = new NotificationChannel(
                CHANNEL_SOFT, "软提醒", NotificationManager.IMPORTANCE_LOW);
        soft.setDescription("静默提醒，繁忙时暂停");
        soft.setSound(null, null);
        soft.enableVibration(false);
        manager.createNotificationChannel(soft);
    }

    /** 常驻通知：锁屏可见、不可滑动清除；带完成进度条和「繁忙 / 空闲」按钮。 */
    static Notification ongoing(Context context, String title, String text, int done, int total, boolean busy) {
        PendingIntent content = openApp(context, 0);

        Notification.Builder builder = builder(context, CHANNEL_ONGOING)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(content)
                .setCategory(Notification.CATEGORY_SERVICE)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setPriority(Notification.PRIORITY_DEFAULT);

        if (total > 0) {
            builder.setProgress(total, Math.max(0, Math.min(done, total)), false);
        }

        // 不用打开 App 就能切状态；点完由 BusyToggleReceiver 立即刷新这条通知
        Intent toggle = new Intent(context, BusyToggleReceiver.class);
        toggle.setAction(BusyToggleReceiver.ACTION_TOGGLE_BUSY);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent toggleIntent = PendingIntent.getBroadcast(context, 1, toggle, flags);
        builder.addAction(new Notification.Action.Builder(null, busy ? "切到空闲" : "切到繁忙", toggleIntent).build());

        return builder.build();
    }

    /** 强提醒：持续震动，必须点「停止提醒」才结束（5 分钟后自动停）。 */
    static Notification ringing(Context context, String id, String title, String body) {
        Intent stop = new Intent(context, AlarmRingService.class);
        stop.setAction(AlarmRingService.ACTION_STOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent stopIntent = PendingIntent.getService(context, id.hashCode(), stop, flags);

        Notification.Builder builder = builder(context, CHANNEL_STRONG)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setContentIntent(openApp(context, id.hashCode()))
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_ALARM)
                .setPriority(Notification.PRIORITY_HIGH)
                .addAction(new Notification.Action.Builder(null, "停止提醒", stopIntent).build());

        return builder.build();
    }

    /** 软提醒：静默、可滑除。 */
    static Notification soft(Context context, String id, String title, String body) {
        return builder(context, CHANNEL_SOFT)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setAutoCancel(true)
                .setContentIntent(openApp(context, id.hashCode()))
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_STATUS)
                .setPriority(Notification.PRIORITY_LOW)
                .build();
    }

    private static PendingIntent openApp(Context context, int requestCode) {
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, requestCode, open, flags);
    }

    private static Notification.Builder builder(Context context, String channel) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return new Notification.Builder(context, channel);
        }
        return new Notification.Builder(context);
    }
}
