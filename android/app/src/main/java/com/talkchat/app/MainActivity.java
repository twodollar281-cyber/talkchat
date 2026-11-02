package com.talkchat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallServicePlugin.class);
        super.onCreate(savedInstanceState);
        createChannels();
    }

    @Override
    public void onPause() {
        super.onPause();
        if (CallService.active) {
            try {
                getBridge().getWebView().onResume();
                getBridge().getWebView().resumeTimers();
            } catch (Exception ignored) {}
        }
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = getSystemService(NotificationManager.class);

        NotificationChannel msg = new NotificationChannel("messages", "Mesajlar", NotificationManager.IMPORTANCE_HIGH);
        nm.createNotificationChannel(msg);

        NotificationChannel calls = new NotificationChannel("calls", "Zənglər", NotificationManager.IMPORTANCE_HIGH);
        Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        AudioAttributes aa = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIC)
                .build();
        calls.setSound(ring, aa);
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 500});
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(calls);
    }
}
