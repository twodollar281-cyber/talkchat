package com.talkchat.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.media.projection.MediaProjectionManager;
import android.os.Build;

import androidx.core.content.ContextCompat;
import androidx.activity.result.ActivityResult;

import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CallService")
public class CallServicePlugin extends Plugin {

    private static volatile CallServicePlugin instance;

    @Override
    public void load() {
        super.load();
        instance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instance == this) {
            instance = null;
        }
        super.handleOnDestroy();
    }

    // ------------------------------------------
    // OVERLAY PERMISSIONS
    // ------------------------------------------

    @PluginMethod
    public void checkOverlayPermission(PluginCall call) {

        boolean granted = Build.VERSION.SDK_INT < 23
                || Settings.canDrawOverlays(getContext());

        JSObject result = new JSObject();
        result.put("granted", granted);

        call.resolve(result);
    }

    @PluginMethod
    public void requestOverlayPermission(PluginCall call) {

        if (Build.VERSION.SDK_INT < 23
                || Settings.canDrawOverlays(getContext())) {

            JSObject result = new JSObject();
            result.put("granted", true);

            call.resolve(result);
            return;
        }

        try {

            Intent intent = new Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:" + getContext().getPackageName())
            );

            startActivityForResult(
                    call,
                    intent,
                    "overlayPermissionResult"
            );

        } catch (Exception e) {
            call.reject("Overlay permission request failed", e);
        }
    }

    @ActivityCallback
    private void overlayPermissionResult(
            PluginCall call,
            ActivityResult result
    ) {

        if (call == null) {
            return;
        }

        boolean granted = Build.VERSION.SDK_INT < 23
                || Settings.canDrawOverlays(getContext());

        JSObject response = new JSObject();
        response.put("granted", granted);

        call.resolve(response);
    }

    // ------------------------------------------
    // JAVASCRIPT EVENTS
    // ------------------------------------------

    static void emitScreenFrame(
            String frame,
            int width,
            int height
    ) {

        CallServicePlugin plugin = instance;

        if (plugin == null || plugin.getActivity() == null) {
            return;
        }

        plugin.getActivity().runOnUiThread(() -> {

            if (instance != plugin) {
                return;
            }

            JSObject data = new JSObject();

            data.put("frame", frame);
            data.put("width", width);
            data.put("height", height);

            plugin.notifyListeners("screenFrame", data);
        });
    }

    static void emitScreenCaptureStopped() {

        CallServicePlugin plugin = instance;

        if (plugin == null || plugin.getActivity() == null) {
            return;
        }

        plugin.getActivity().runOnUiThread(() -> {

            if (instance == plugin) {
                plugin.notifyListeners(
                        "screenCaptureStopped",
                        new JSObject()
                );
            }
        });
    }

    static void emitOverlayAction(String action) {

        CallServicePlugin plugin = instance;

        if (plugin == null || plugin.getActivity() == null) {
            return;
        }

        plugin.getActivity().runOnUiThread(() -> {

            if (instance != plugin) {
                return;
            }

            JSObject data = new JSObject();
            data.put("action", action);

            plugin.notifyListeners("overlayAction", data);
        });
    }

    // ------------------------------------------
    // CALL SERVICE
    // ------------------------------------------

    @PluginMethod
    public void start(PluginCall call) {

        try {

            Intent intent = new Intent(
                    getContext(),
                    CallService.class
            );

            intent.putExtra(
                    "title",
                    call.getString("title", "TalkChat")
            );

            intent.putExtra(
                    "text",
                    call.getString("text", "Zəng davam edir")
            );

            intent.putExtra(
                    "camera",
                    call.getBoolean("camera", false)
            );

            ContextCompat.startForegroundService(
                    getContext(),
                    intent
            );

            call.resolve();

        } catch (Exception e) {
            call.reject("Could not start call service", e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {

        try {

            getContext().stopService(
                    new Intent(getContext(), CallService.class)
            );

            call.resolve();

        } catch (Exception e) {
            call.reject("Could not stop call service", e);
        }
    }

    // ------------------------------------------
    // SCREEN SHARING
    // ------------------------------------------

    @PluginMethod
    public void startScreenShare(PluginCall call) {

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) {
            call.reject("Screen sharing requires Android 5.0 or newer");
            return;
        }

        try {

            MediaProjectionManager manager =
                    (MediaProjectionManager) getContext()
                            .getSystemService(
                                    Activity.MEDIA_PROJECTION_SERVICE
                            );

            if (manager == null) {
                call.reject("MediaProjection is unavailable");
                return;
            }

            startActivityForResult(
                    call,
                    manager.createScreenCaptureIntent(),
                    "screenCaptureResult"
            );

        } catch (Exception e) {
            call.reject("Could not request screen capture permission", e);
        }
    }

    @ActivityCallback
    private void screenCaptureResult(
            PluginCall call,
            ActivityResult result
    ) {

        if (call == null) {
            return;
        }

        if (result == null
                || result.getResultCode() != Activity.RESULT_OK
                || result.getData() == null) {

            call.reject("Screen capture permission was denied");
            return;
        }

        try {

            Intent intent = new Intent(
                    getContext(),
                    CallService.class
            );

            intent.setAction(CallService.ACTION_START_PROJECTION);

            intent.putExtra(
                    CallService.EXTRA_RESULT_CODE,
                    result.getResultCode()
            );

            intent.putExtra(
                    CallService.EXTRA_PROJECTION_DATA,
                    result.getData()
            );

            ContextCompat.startForegroundService(
                    getContext(),
                    intent
            );

            call.resolve();

        } catch (Exception e) {
            call.reject("Could not start screen capture", e);
        }
    }

    @PluginMethod
    public void stopScreenShare(PluginCall call) {

        try {

            Intent intent = new Intent(
                    getContext(),
                    CallService.class
            );

            intent.setAction(CallService.ACTION_STOP_PROJECTION);

            getContext().startService(intent);

            call.resolve();

        } catch (Exception e) {
            call.reject("Could not stop screen capture", e);
        }
    }

    // ------------------------------------------
    // OVERLAY STATE
    // ------------------------------------------

    private void addOverlayData(
            Intent intent,
            PluginCall call
    ) {

        intent.putExtra(
                "overlayTitle",
                call.getString("title", "TalkChat")
        );

        intent.putExtra(
                "overlayDuration",
                call.getString("duration", "00:00")
        );

        intent.putExtra(
                "overlaySpeaker",
                call.getString("speaker", "")
        );

        intent.putExtra(
                "overlayParticipants",
                call.getString("participants", "")
        );

        intent.putExtra(
                "overlayMediaType",
                call.getString("mediaType", "audio")
        );

        intent.putExtra(
                "overlayMicMuted",
                call.getBoolean("micMuted", false)
        );

        intent.putExtra(
                "overlayCameraOn",
                call.getBoolean("cameraOn", false)
        );

        intent.putExtra(
                "overlayIsGroup",
                call.getBoolean("isGroup", false)
        );

        Object state = call.getData().opt("state");

        if (state != null) {
            intent.putExtra("overlayState", state.toString());
        }
    }

    @PluginMethod
    public void showOverlay(PluginCall call) {

        try {

            if (Build.VERSION.SDK_INT >= 23
                    && !Settings.canDrawOverlays(getContext())) {

                call.reject("Overlay permission not granted");
                return;
            }

            Intent intent = new Intent(
                    getContext(),
                    CallService.class
            );

            intent.setAction(CallService.ACTION_SHOW_OVERLAY);

            addOverlayData(intent, call);

            getContext().startService(intent);

            call.resolve();

        } catch (Exception e) {
            call.reject("Could not show call overlay", e);
        }
    }

    @PluginMethod
    public void updateOverlay(PluginCall call) {

        try {

            Intent intent = new Intent(
                    getContext(),
                    CallService.class
            );

            intent.setAction(CallService.ACTION_UPDATE_OVERLAY);

            addOverlayData(intent, call);

            getContext().startService(intent);

            call.resolve();

        } catch (Exception e) {
            call.reject("Could not update call overlay", e);
        }
    }

    @PluginMethod
    public void hideOverlay(PluginCall call) {

        try {

            Intent intent = new Intent(
                    getContext(),
                    CallService.class
            );

            intent.setAction(CallService.ACTION_HIDE_OVERLAY);

            getContext().startService(intent);

            call.resolve();

        } catch (Exception e) {
            call.reject("Could not hide call overlay", e);
        }
    }
                }
