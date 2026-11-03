package com.example.dshapp;

import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;

/**
 * 常驻通知的宿主。Android 规定「不可滑动清除的通知」必须挂在服务上，
 * 所以这里的唯一职责就是维持那条通知，并在内容变化时更新它。
 */
public class TaskForegroundService extends Service {
    static final String ACTION_UPDATE = "com.example.dshapp.UPDATE";
    static final String ACTION_STOP = "com.example.dshapp.STOP";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_TEXT = "text";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notifier.ensureChannels(this);

        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String text = intent != null ? intent.getStringExtra(EXTRA_TEXT) : null;
        if (title == null) title = ReminderStore.panelTitle(this);
        if (text == null) text = ReminderStore.panelText(this);

        ReminderStore.setPanel(this, title, text);
        startForeground(Notifier.ID_ONGOING, Notifier.ongoing(this, title, text));
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // 用户从最近任务划掉 App 时，提醒仍然要活着
        super.onTaskRemoved(rootIntent);
    }

    static void update(Context context, String title, String text) {
        Intent intent = new Intent(context, TaskForegroundService.class);
        intent.setAction(ACTION_UPDATE);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_TEXT, text);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    static void stop(Context context) {
        Intent intent = new Intent(context, TaskForegroundService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(Notifier.ID_ONGOING);
    }
}
