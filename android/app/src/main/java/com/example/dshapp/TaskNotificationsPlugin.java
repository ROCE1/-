package com.example.dshapp;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

/**
 * 前端与原生通知/闹钟之间的桥。
 *
 * 前端调用方式（无需额外 npm 包）：
 *   const plugin = window.Capacitor.Plugins.TaskNotifications
 *   plugin.syncState({ title, text, busy })
 *   plugin.schedule({ id, at, title, body, strong })
 */
@CapacitorPlugin(
        name = "TaskNotifications",
        permissions = {
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        })
public class TaskNotificationsPlugin extends Plugin {

    @PluginMethod
    public void syncState(PluginCall call) {
        String title = call.getString("title", "今日任务");
        String text = call.getString("text", "还没有任务");
        Boolean busy = call.getBoolean("busy", false);
        Integer done = call.getInt("progressDone", 0);
        Integer total = call.getInt("progressTotal", 0);
        int doneCount = done == null ? 0 : done;
        int totalCount = total == null ? 0 : total;

        ReminderStore.setBusy(getContext(), Boolean.TRUE.equals(busy));
        ReminderStore.setPanel(getContext(), title, text);
        ReminderStore.setProgress(getContext(), doneCount, totalCount);

        // 小组件外观（可空）：只在前端传了值的时候覆盖，避免把用户设置冲掉
        String widgetColor = call.getString("widgetColor");
        Double widgetOpacity = call.getDouble("widgetOpacity");
        if (widgetColor != null && widgetOpacity != null) {
            ReminderStore.setWidgetStyle(getContext(), widgetColor, widgetOpacity.floatValue());
        }

        TaskForegroundService.update(getContext(), title, text, doneCount, totalCount);
        // 桌面小组件跟常驻通知同源，一起刷新
        TaskWidgetProvider.refresh(getContext());

        call.resolve();
    }

    /** 前端取走通知栏上那几次「繁忙 / 空闲」点击（按顺序返回，取一次就清空）。 */
    @PluginMethod
    public void consumeBusyToggle(PluginCall call) {
        java.util.List<JSONObject> pending = ReminderStore.pendingBusyList(getContext());
        if (pending.isEmpty()) {
            call.resolve();
            return;
        }
        JSArray items = new JSArray();
        for (JSONObject record : pending) {
            JSObject entry = new JSObject();
            entry.put("busy", record.optBoolean("busy", false));
            entry.put("at", record.optLong("at", 0L));
            items.put(entry);
        }
        ReminderStore.clearPendingBusy(getContext());
        JSObject result = new JSObject();
        result.put("items", items);
        call.resolve(result);
    }

    @PluginMethod
    public void stopPanel(PluginCall call) {
        TaskForegroundService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        String id = call.getString("id");
        Long at = call.getLong("at");
        if (id == null || at == null) {
            call.reject("schedule 需要 id 与 at");
            return;
        }
        Alarms.schedule(
                getContext(),
                id,
                at,
                call.getString("title", "任务提醒"),
                call.getString("body", ""),
                Boolean.TRUE.equals(call.getBoolean("strong", false)));
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        if (id != null) Alarms.cancel(getContext(), id);
        call.resolve();
    }

    @PluginMethod
    public void cancelAll(PluginCall call) {
        for (JSONObject record : ReminderStore.alarms(getContext())) {
            Alarms.cancel(getContext(), record.optString("id"));
        }
        ReminderStore.clearAlarms(getContext());
        call.resolve();
    }

    /** 权限现状，供设置页显示与引导。 */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("notifications", hasNotificationPermission());
        result.put("exactAlarm", canScheduleExactAlarms());
        result.put("batteryOptimized", isBatteryOptimized());
        call.resolve(result);
    }

    /** 按需申请：通知权限（运行时）→ 精确闹钟设置页 → 电池优化白名单。 */
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !hasNotificationPermission()) {
            requestPermissionForAlias("notifications", call, "notificationsCallback");
            return;
        }
        openExactAlarmSettingsIfNeeded();
        call.resolve();
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        openExactAlarmSettingsIfNeeded();
        call.resolve();
    }

    private boolean hasNotificationPermission() {        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean canScheduleExactAlarms() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        android.app.AlarmManager manager =
                (android.app.AlarmManager) getContext().getSystemService(android.content.Context.ALARM_SERVICE);
        return manager != null && manager.canScheduleExactAlarms();
    }

    private boolean isBatteryOptimized() {
        PowerManager manager = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        if (manager == null) return false;
        return !manager.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    private void openExactAlarmSettingsIfNeeded() {
        if (canScheduleExactAlarms()) return;
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {
        }
    }
}
