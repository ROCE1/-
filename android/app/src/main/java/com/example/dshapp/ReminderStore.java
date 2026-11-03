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
