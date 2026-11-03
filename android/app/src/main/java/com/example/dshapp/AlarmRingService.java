package com.example.dshapp;

import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

/**
 * 强提醒的震动循环。
 *
 * 为什么需要服务：通知频道只能震动一次，想「一直震到你点停止」就必须有代码持有震动器。
 * 安全阀：最多震 5 分钟自动停，避免用户没看到手机时把电耗光。
 */
public class AlarmRingService extends Service {
    static final String ACTION_START = "com.example.dshapp.RING_START";
    static final String ACTION_STOP = "com.example.dshapp.RING_STOP";
    static final String EXTRA_ID = "id";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_BODY = "body";

    private static final long MAX_RING_MS = 5 * 60 * 1000L;
    private static final long[] PATTERN = new long[]{0, 700, 300, 700, 300, 1200};

    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable autoStop = new Runnable() {
        @Override
        public void run() {
            stopEverything();
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
            if (manager != null) vibrator = manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopEverything();
            return START_NOT_STICKY;
        }

        String id = intent != null ? intent.getStringExtra(EXTRA_ID) : null;
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String body = intent != null ? intent.getStringExtra(EXTRA_BODY) : null;
        if (id == null) id = "reminder";
        if (title == null) title = "任务提醒";
        if (body == null) body = "";

        Notifier.ensureChannels(this);
        startForeground(Notifier.ID_RING, Notifier.ringing(this, id, title, body));

        startVibration();
        handler.removeCallbacks(autoStop);
        handler.postDelayed(autoStop, MAX_RING_MS);
        return START_STICKY;
    }

    private void startVibration() {
        if (vibrator == null || !vibrator.hasVibrator()) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(PATTERN, 0));
            } else {
                vibrator.vibrate(PATTERN, 0);
            }
        } catch (Exception ignored) {
        }
    }

    private void stopEverything() {
        handler.removeCallbacks(autoStop);
        try {
            if (vibrator != null) vibrator.cancel();
        } catch (Exception ignored) {
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(autoStop);
        try {
            if (vibrator != null) vibrator.cancel();
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static void start(Context context, String id, String title, String body) {
        Intent intent = new Intent(context, AlarmRingService.class);
        intent.setAction(ACTION_START);
        intent.putExtra(EXTRA_ID, id);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_BODY, body);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    static void stop(Context context) {
        Intent intent = new Intent(context, AlarmRingService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
    }
}
