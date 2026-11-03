package com.example.dshapp;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/**
 * 开机后把闹钟重新注册回去。
 * Android 重启会清空 AlarmManager，不重注册的话所有提醒都会静默消失。
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())
                && !"android.intent.action.QUICKBOOT_POWERON".equals(intent.getAction())) {
            return;
        }

        long now = System.currentTimeMillis();
        for (JSONObject record : ReminderStore.alarms(context)) {
            if (record.optLong("at") <= now) continue;
            Alarms.schedule(context, record);
        }

        // 顺带把常驻通知挂回去（进度沿用上次存下来的）
        TaskForegroundService.update(
                context,
                ReminderStore.panelTitle(context),
                ReminderStore.panelText(context),
                ReminderStore.progressDone(context),
                ReminderStore.progressTotal(context));
    }
}
