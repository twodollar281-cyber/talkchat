package com.talkchat.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Extends Capacitor's own push service so existing push behaviour (token + JS events) is unchanged,
 * and additionally shows a full-screen incoming-call notification for data-only "call"/"group-call"
 * messages while the app is in the background or closed. In the foreground the socket already rings,
 * so nothing extra is shown. Server side: set FCM_CALL_DATA_ONLY=true after installing this APK.
 */
public class CallMessagingService extends MessagingService {

    private static final String CHANNEL_ID = "calls";
    private static final int NOTIFICATION_ID = 2001;
    private static final long TIMEOUT_MS = 30_000L;

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        try {
            showCallNotification(remoteMessage);
        } catch (Exception ignored) {
            // never block Capacitor's own handling
        }
        super.onMessageReceived(remoteMessage);
    }

    private void showCallNotification(RemoteMessage message) {
        Map<String, String> data = message.getData();
        String kind = data.get("kind");
        if (!"call".equals(kind) && !"group-call".equals(kind)) return;
        if (message.getNotification() != null) return; // system tray already shows notification payloads
        if (MainActivity.inForeground) return;         // socket.io is ringing in the open app

        Context ctx = getApplicationContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        ensureChannel(nm);

        String title = data.get("title") != null ? data.get("title") : "TalkChat";
        String body = data.get("body") != null ? data.get("body") : data.get("sender");

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(ctx, NOTIFICATION_ID, open, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(ctx.getApplicationInfo().icon)
                .setContentTitle(title)
                .setContentText(body)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setOngoing(false)
                .setTimeoutAfter(TIMEOUT_MS)
                .setContentIntent(pi)
                .setFullScreenIntent(pi, true);
        if (Build.VERSION.SDK_INT < 26) {
            b.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE));
            b.setVibrate(new long[]{0, 500, 300, 500, 300, 500});
        }
        nm.notify(NOTIFICATION_ID, b.build());
    }

    private void ensureChannel(NotificationManager nm) {
        if (Build.VERSION.SDK_INT < 26 || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Zənglər", NotificationManager.IMPORTANCE_HIGH);
        Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        ch.setSound(ring, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 500});
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }
}
