
package com.talkchat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.util.Base64;
import android.util.DisplayMetrics;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;

public class CallService extends Service {

    static final String CHANNEL = "call_ongoing";

    static final String ACTION_START_PROJECTION =
            "com.talkchat.app.START_SCREEN_CAPTURE";

    static final String ACTION_STOP_PROJECTION =
            "com.talkchat.app.STOP_SCREEN_CAPTURE";

    static final String ACTION_SHOW_OVERLAY =
            "com.talkchat.app.SHOW_CALL_OVERLAY";

    static final String ACTION_UPDATE_OVERLAY =
            "com.talkchat.app.UPDATE_CALL_OVERLAY";

    static final String ACTION_HIDE_OVERLAY =
            "com.talkchat.app.HIDE_CALL_OVERLAY";

    static final String EXTRA_RESULT_CODE = "projectionResultCode";
    static final String EXTRA_PROJECTION_DATA = "projectionData";

    static volatile boolean active = false;

    private boolean cameraActive = false;

    private CallOverlayManager overlayManager;

    private MediaProjection projection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;

    private HandlerThread captureThread;
    private Handler captureHandler;

    private long lastFrameAt = 0;

    private String title = "TalkChat";
    private String text = "Zəng davam edir";

    private final MediaProjection.Callback projectionCallback =
            new MediaProjection.Callback() {
        @Override
        public void onStop() {
            stopProjection(false, true);
        }
    };

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {

        createChannel();

        if (intent != null) {
            if (intent.getStringExtra("title") != null) {
                title = intent.getStringExtra("title");
            }

            if (intent.getStringExtra("text") != null) {
                text = intent.getStringExtra("text");
            }

            if (intent.hasExtra("camera")) {
                cameraActive = intent.getBooleanExtra("camera", false);
            }
        }

        String action = intent == null ? null : intent.getAction();

        if (ACTION_STOP_PROJECTION.equals(action)) {

            stopProjection(true, false);

        } else if (ACTION_START_PROJECTION.equals(action)) {

            startProjection(
                    intent.getIntExtra(EXTRA_RESULT_CODE, 0),
                    getProjectionData(intent)
            );

        } else if (ACTION_SHOW_OVERLAY.equals(action)) {

            updateForeground(false);
            showCallOverlay(intent);

        } else if (ACTION_UPDATE_OVERLAY.equals(action)) {

            updateCallOverlay(intent);

        } else if (ACTION_HIDE_OVERLAY.equals(action)) {

            hideCallOverlay();

        } else {

            updateForeground(false);
        }

        return START_STICKY;
    }

    // --------------------------------------------------
    // CALL OVERLAY
    // --------------------------------------------------

    private void showCallOverlay(Intent intent) {

        if (overlayManager == null) {

            overlayManager = new CallOverlayManager(
                    this,
                    action -> handleOverlayAction(action)
            );
        }

        overlayManager.show(buildOverlayState(intent));
    }

    private void updateCallOverlay(Intent intent) {

        if (overlayManager == null) {
            return;
        }

        overlayManager.update(buildOverlayState(intent));
    }

    private void hideCallOverlay() {

        if (overlayManager != null) {
            overlayManager.hide();
        }
    }

    private void handleOverlayAction(String action) {

        if (action == null) {
            return;
        }

        switch (action) {

            case "toggleMicrophone":
                CallServicePlugin.emitOverlayAction("mic");
                break;

            case "toggleCamera":
                CallServicePlugin.emitOverlayAction("camera");
                break;

            case "returnToCall":
                CallServicePlugin.emitOverlayAction("return");
                break;

            case "endCall":
                CallServicePlugin.emitOverlayAction("end");
                break;

            case "hide":
                CallServicePlugin.emitOverlayAction("hide");
                break;
        }
    }

    private JSONObject buildOverlayState(Intent intent) {

        JSONObject state = new JSONObject();

        if (intent == null) {
            return state;
        }

        try {

            String rawState = intent.getStringExtra("overlayState");

            if (rawState != null && !rawState.isEmpty()) {
                state = new JSONObject(rawState);
            }

            String overlayTitle =
                    intent.getStringExtra("overlayTitle");

            if (overlayTitle != null) {
                state.put("title", overlayTitle);
            } else if (!state.has("title")) {
                state.put("title", title);
            }

            String mediaType =
                    intent.getStringExtra("overlayMediaType");

            if (mediaType != null) {
                state.put("mediaType", mediaType);
            } else if (!state.has("mediaType")) {
                state.put("mediaType", cameraActive ? "video" : "audio");
            }

            if (intent.hasExtra("overlayMicMuted")) {
                state.put(
                        "micMuted",
                        intent.getBooleanExtra("overlayMicMuted", false)
                );
            }

            if (intent.hasExtra("overlayCameraOn")) {
                state.put(
                        "cameraOn",
                        intent.getBooleanExtra("overlayCameraOn", cameraActive)
                );
            } else if (!state.has("cameraOn")) {
                state.put("cameraOn", cameraActive);
            }

            if (intent.hasExtra("overlayDurationSeconds")) {

                state.put(
                        "durationSeconds",
                        intent.getIntExtra("overlayDurationSeconds", 0)
                );

            } else if (intent.hasExtra("overlayDuration")) {

                state.put(
                        "durationSeconds",
                        parseDuration(intent.getStringExtra("overlayDuration"))
                );
            }

            if (intent.hasExtra("overlayIsGroup")) {
                state.put(
                        "isGroup",
                        intent.getBooleanExtra("overlayIsGroup", false)
                );
            }

            String participantsText =
                    intent.getStringExtra("overlayParticipants");

            if (participantsText != null && !participantsText.isEmpty()) {
                state.put(
                        "participants",
                        parseParticipants(participantsText)
                );
            } else if (!state.has("participants")) {
                state.put("participants", new JSONArray());
            }

            String speaker =
                    intent.getStringExtra("overlaySpeaker");

            if (speaker != null && !speaker.isEmpty()) {

                JSONArray speakers = new JSONArray();
                speakers.put(speaker);

                state.put("speakers", speakers);

            } else if (!state.has("speakers")) {

                state.put("speakers", new JSONArray());
            }

        } catch (JSONException ignored) {
        }

        return state;
    }

    private JSONArray parseParticipants(String value) {

        try {

            JSONArray parsed = new JSONArray(value);
            return parsed;

        } catch (JSONException ignored) {
        }

        JSONArray people = new JSONArray();

        String[] names = value.split("[,;|]");

        for (String name : names) {

            String clean = name.trim();

            if (clean.isEmpty()) {
                continue;
            }

            JSONObject person = new JSONObject();

            try {
                person.put("username", clean);
                person.put("displayName", clean);

                people.put(person);

            } catch (JSONException ignored) {
            }
        }

        return people;
    }

    private int parseDuration(String value) {

        if (value == null || value.isEmpty()) {
            return 0;
        }

        try {

            String[] parts = value.split(":");

            int seconds = 0;

            for (String part : parts) {
                seconds = seconds * 60 + Integer.parseInt(part.trim());
            }

            return Math.max(0, seconds);

        } catch (Exception ignored) {

            return 0;
        }
    }

    // --------------------------------------------------
    // SCREEN CAPTURE
    // --------------------------------------------------

    private Intent getProjectionData(Intent intent) {

        if (Build.VERSION.SDK_INT >= 33) {

            return intent.getParcelableExtra(
                    EXTRA_PROJECTION_DATA,
                    Intent.class
            );
        }

        //noinspection deprecation
        return intent.getParcelableExtra(EXTRA_PROJECTION_DATA);
    }

    private void startProjection(int resultCode, Intent data) {

        if (data == null || resultCode == 0) {

            CallServicePlugin.emitScreenCaptureStopped();
            return;
        }

        stopProjection(true, false);

        updateForeground(true);

        if (!active) {

            CallServicePlugin.emitScreenCaptureStopped();
            return;
        }

        try {

            MediaProjectionManager manager =
                    (MediaProjectionManager) getSystemService(
                            MEDIA_PROJECTION_SERVICE
                    );

            projection = manager.getMediaProjection(resultCode, data);

            if (projection == null) {
                throw new IllegalStateException(
                        "MediaProjection was not created"
                );
            }

            captureThread = new HandlerThread(
                    "TalkChatScreenCapture"
            );

            captureThread.start();

            captureHandler = new Handler(
                    captureThread.getLooper()
            );

            projection.registerCallback(
                    projectionCallback,
                    captureHandler
            );

            DisplayMetrics metrics =
                    getResources().getDisplayMetrics();

            int width = metrics.widthPixels;
            int height = metrics.heightPixels;

            imageReader = ImageReader.newInstance(
                    width,
                    height,
                    PixelFormat.RGBA_8888,
                    2
            );

            imageReader.setOnImageAvailableListener(
                    this::onImageAvailable,
                    captureHandler
            );

            virtualDisplay = projection.createVirtualDisplay(
                    "TalkChatScreen",
                    width,
                    height,
                    metrics.densityDpi,
                    DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    imageReader.getSurface(),
                    null,
                    captureHandler
            );

        } catch (Exception e) {

            stopProjection(true, false);
            CallServicePlugin.emitScreenCaptureStopped();
        }
    }

    private void onImageAvailable(ImageReader reader) {

        Image image = null;

        Bitmap padded = null;
        Bitmap cropped = null;
        Bitmap scaled = null;

        try {

            long now = System.currentTimeMillis();

            if (now - lastFrameAt < 120) {
                return;
            }

            image = reader.acquireLatestImage();

            if (image == null) {
                return;
            }

            lastFrameAt = now;

            Image.Plane[] planes = image.getPlanes();

            if (planes.length == 0) {
                return;
            }

            Image.Plane plane = planes[0];

            int width = image.getWidth();
            int height = image.getHeight();

            int pixelStride = plane.getPixelStride();
            int rowStride = plane.getRowStride();

            int paddedWidth =
                    rowStride / Math.max(1, pixelStride);

            padded = Bitmap.createBitmap(
                    paddedWidth,
                    height,
                    Bitmap.Config.ARGB_8888
            );

            padded.copyPixelsFromBuffer(
                    plane.getBuffer()
            );

            cropped = Bitmap.createBitmap(
                    padded,
                    0,
                    0,
                    width,
                    height
            );

            float scale = Math.min(
                    1f,
                    720f / Math.max(1, Math.max(width, height))
            );

            int outWidth = Math.max(
                    2,
                    ((int) (width * scale)) & ~1
            );

            int outHeight = Math.max(
                    2,
                    ((int) (height * scale)) & ~1
            );

            scaled = Bitmap.createScaledBitmap(
                    cropped,
                    outWidth,
                    outHeight,
                    false
            );

            ByteArrayOutputStream output =
                    new ByteArrayOutputStream(48 * 1024);

            scaled.compress(
                    Bitmap.CompressFormat.JPEG,
                    55,
                    output
            );

            CallServicePlugin.emitScreenFrame(
                    Base64.encodeToString(
                            output.toByteArray(),
                            Base64.NO_WRAP
                    ),
                    outWidth,
                    outHeight
            );

            output.close();

        } catch (Exception ignored) {

        } finally {

            if (scaled != null && scaled != cropped && scaled != padded) {
                scaled.recycle();
            }

            if (cropped != null && cropped != padded) {
                cropped.recycle();
            }

            if (padded != null) {
                padded.recycle();
            }

            if (image != null) {
                image.close();
            }
        }
    }

    private void stopProjection(boolean stopPlatform, boolean notify) {

        MediaProjection old = projection;
        projection = null;

        if (old != null) {

            try {
                old.unregisterCallback(projectionCallback);
            } catch (Exception ignored) {
            }

            if (stopPlatform) {

                try {
                    old.stop();
                } catch (Exception ignored) {
                }
            }
        }

        if (virtualDisplay != null) {

            try {
                virtualDisplay.release();
            } catch (Exception ignored) {
            }

            virtualDisplay = null;
        }

        if (imageReader != null) {

            try {
                imageReader.setOnImageAvailableListener(null, null);
                imageReader.close();
            } catch (Exception ignored) {
            }

            imageReader = null;
        }

        if (captureThread != null) {

            captureThread.quitSafely();

            captureThread = null;
            captureHandler = null;
        }

        if (active) {
            updateForeground(false);
        }

        if (notify) {
            CallServicePlugin.emitScreenCaptureStopped();
        }
    }

    // --------------------------------------------------
    // FOREGROUND NOTIFICATION
    // --------------------------------------------------

    private Notification buildNotification() {

        Intent open = new Intent(this, MainActivity.class);

        open.addFlags(
                Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
        );

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;

        if (Build.VERSION.SDK_INT >= 23) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent pendingIntent =
                PendingIntent.getActivity(
                        this,
                        0,
                        open,
                        flags
                );

        return new NotificationCompat.Builder(this, CHANNEL)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(android.R.drawable.stat_sys_phone_call)
                .setOngoing(true)
                .setContentIntent(pendingIntent)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .build();
    }

    private void updateForeground(boolean includeProjection) {

        try {

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {

                int types =
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;

                if (cameraActive) {
                    types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA;
                }

                if (includeProjection) {
                    types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
                }

                startForeground(
                        1001,
                        buildNotification(),
                        types
                );

            } else {

                startForeground(
                        1001,
                        buildNotification()
                );
            }

            active = true;

        } catch (Exception e) {

            active = false;
            stopSelf();
        }
    }

    private void createChannel() {

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager =
                getSystemService(NotificationManager.class);

        if (manager != null) {

            manager.createNotificationChannel(
                    new NotificationChannel(
                            CHANNEL,
                            "Davam edən zəng",
                            NotificationManager.IMPORTANCE_LOW
                    )
            );
        }
    }

    // --------------------------------------------------
    // SERVICE LIFECYCLE
    // --------------------------------------------------

    @Override
    public void onDestroy() {

        active = false;

        if (overlayManager != null) {

            overlayManager.destroy();
            overlayManager = null;
        }

        stopProjection(true, false);

        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
