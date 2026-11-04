package com.example.dshapp;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 闹钟与状态的本地存储。
 * 用 SharedPreferences + JSON：条目少（几十个），不需要数据库；
 * 关键作用是**开机后能把闹钟重新注册回去**。
 */
final class ReminderStore {
    private static final String PREFS = "task_reminders";
    private static final String KEY_BUSY = "busy";
    private static final String KEY_ALARMS = "alarms";
    private static final String KEY_TITLE = "panel_title";
    private static final String KEY_TEXT = "panel_text";
    private static final String KEY_DONE = "panel_done";
    private static final String KEY_TOTAL = "panel_total";
    private static final String KEY_PENDING_BUSY = "pending_busy";
    private static final String KEY_PENDING_AT = "pending_busy_at";
    private static final String KEY_WIDGET_COLOR = "widget_color";
    private static final String KEY_WIDGET_OPACITY = "widget_opacity";

    private ReminderStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static void setBusy(Context context, boolean busy) {
        prefs(context).edit().putBoolean(KEY_BUSY, busy).apply();
    }

    static boolean isBusy(Context context) {
        return prefs(context).getBoolean(KEY_BUSY, false);
    }

    static void setPanel(Context context, String title, String text) {
        prefs(context).edit().putString(KEY_TITLE, title).putString(KEY_TEXT, text).apply();
    }

    static String panelTitle(Context context) {
        return prefs(context).getString(KEY_TITLE, "今日任务");
    }

    static String panelText(Context context) {
        return prefs(context).getString(KEY_TEXT, "还没有任务");
    }

    /** 今日任务完成进度（done/total），供常驻通知的进度条与桌面小组件使用。 */
    static void setProgress(Context context, int done, int total) {
        prefs(context).edit().putInt(KEY_DONE, done).putInt(KEY_TOTAL, total).apply();
    }

    static int progressDone(Context context) {
        return prefs(context).getInt(KEY_DONE, 0);
    }

    static int progressTotal(Context context) {
        return prefs(context).getInt(KEY_TOTAL, 0);
    }

    /**
     * 通知栏上的「繁忙 / 空闲」是原生先接的：这里按顺序记下每一次点击，
     * 等前端下次启动/回到前台时一次性取走，用它去写工作时段（sessions 只有前端能写）。
     *
     * 必须用队列而不是单值：用户可能“繁忙 → 空闲”连点两次都不打开 App，
     * 只留最后一次的话第一段工时就被吞了。
     */
    static synchronized void appendPendingBusy(Context context, boolean busy, long at) {
        JSONArray array = readPending(context);
        JSONObject item = new JSONObject();
        try {
            item.put("busy", busy);
            item.put("at", at);
            array.put(item);
        } catch (JSONException ignored) {
            return;
        }
        // 队列最多留 50 条，防止异常情况下无限增长
        if (array.length() > 50) {
            JSONArray trimmed = new JSONArray();
            for (int i = array.length() - 50; i < array.length(); i++) trimmed.put(array.opt(i));
            array = trimmed;
        }
        prefs(context).edit().putString(KEY_PENDING_BUSY, array.toString()).apply();
    }

    static synchronized boolean hasPendingBusy(Context context) {
        return readPending(context).length() > 0;
    }

    static synchronized List<JSONObject> pendingBusyList(Context context) {
        JSONArray array = readPending(context);
        List<JSONObject> list = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.optJSONObject(i);
            if (item != null) list.add(item);
        }
        return list;
    }

    static void clearPendingBusy(Context context) {
        prefs(context).edit().remove(KEY_PENDING_BUSY).remove(KEY_PENDING_AT).apply();
    }

    private static JSONArray readPending(Context context) {
        String raw = prefs(context).getString(KEY_PENDING_BUSY, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException error) {
            return new JSONArray();
        }
    }

    /** 桌面小组件外观：颜色 #rrggbb + 不透明度 0..1。 */
    static void setWidgetStyle(Context context, String color, float opacity) {
        prefs(context).edit().putString(KEY_WIDGET_COLOR, color).putFloat(KEY_WIDGET_OPACITY, opacity).apply();
    }

    static String widgetColor(Context context) {
        return prefs(context).getString(KEY_WIDGET_COLOR, "#171a21");
    }

    static float widgetOpacity(Context context) {
        return prefs(context).getFloat(KEY_WIDGET_OPACITY, 0.95f);
    }

    static synchronized void putAlarm(Context context, JSONObject alarm) {
        try {
            JSONArray array = readArray(context);
            JSONArray next = new JSONArray();
            String id = alarm.getString("id");
            for (int i = 0; i < array.length(); i++) {
                JSONObject item = array.optJSONObject(i);
                if (item != null && !id.equals(item.optString("id"))) next.put(item);
            }
            next.put(alarm);
            write(context, next);
        } catch (JSONException ignored) {
        }
    }

    static synchronized void removeAlarm(Context context, String id) {
        JSONArray array = readArray(context);
        JSONArray next = new JSONArray();
        for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.optJSONObject(i);
            if (item != null && !id.equals(item.optString("id"))) next.put(item);
        }
        write(context, next);
    }

    static synchronized void clearAlarms(Context context) {
        write(context, new JSONArray());
    }

    static synchronized List<JSONObject> alarms(Context context) {
        JSONArray array = readArray(context);
        List<JSONObject> list = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            JSONObject item = array.optJSONObject(i);
            if (item != null) list.add(item);
        }
        return list;
    }

    private static JSONArray readArray(Context context) {
        String raw = prefs(context).getString(KEY_ALARMS, "[]");
        try {
            return new JSONArray(raw);
        } catch (JSONException error) {
            return new JSONArray();
        }
    }

    private static void write(Context context, JSONArray array) {
        prefs(context).edit().putString(KEY_ALARMS, array.toString()).apply();
    }
}
