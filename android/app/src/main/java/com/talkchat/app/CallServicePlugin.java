package com.talkchat.app;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.ActivityCallback;
import com.getcapacitor.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "CallService")
public class CallServicePlugin extends Plugin {
    private static volatile CallServicePlugin instance;
    @Override public void load() { super.load(); instance = this; }
    @Override protected void handleOnDestroy() { if (instance == this) instance = null; super.handleOnDestroy(); }

    static void emitScreenFrame(String frame, int width, int height) {
        CallServicePlugin plugin = instance;
        if (plugin == null || plugin.getActivity() == null) return;
        plugin.getActivity().runOnUiThread(() -> {
            if (instance != plugin) return;
            JSObject data = new JSObject(); data.put("frame", frame); data.put("width", width); data.put("height", height);
            plugin.notifyListeners("screenFrame", data);
        });
    }
    static void emitScreenCaptureStopped() {
        CallServicePlugin plugin = instance;
        if (plugin == null || plugin.getActivity() == null) return;
        plugin.getActivity().runOnUiThread(() -> { if (instance == plugin) plugin.notifyListeners("screenCaptureStopped", new JSObject()); });
    }

    @PluginMethod public void start(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), CallService.class);
            intent.putExtra("title", call.getString("title", "TalkChat"));
            intent.putExtra("text", call.getString("text", "Zəng davam edir"));
            intent.putExtra("camera", call.getBoolean("camera", false));
            ContextCompat.startForegroundService(getContext(), intent); call.resolve();
        } catch (Exception e) { call.reject("Could not start call service", e); }
    }

    @PluginMethod public void startScreenShare(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) { call.reject("Android screen sharing requires Android 5.0 or newer"); return; }
        try {
            MediaProjectionManager manager = (MediaProjectionManager) getContext().getSystemService(Activity.MEDIA_PROJECTION_SERVICE);
            if (manager == null) { call.reject("MediaProjection is unavailable"); return; }
            startActivityForResult(call, manager.createScreenCaptureIntent(), "screenCaptureResult");
        } catch (Exception e) { call.reject("Could not request screen capture permission", e); }
    }

    @ActivityCallback private void screenCaptureResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.reject("Screen capture permission was denied"); return; }
        try {
            Intent intent = new Intent(getContext(), CallService.class); intent.setAction(CallService.ACTION_START_PROJECTION);
            intent.putExtra(CallService.EXTRA_RESULT_CODE, result.getResultCode());
            intent.putExtra(CallService.EXTRA_PROJECTION_DATA, result.getData());
            ContextCompat.startForegroundService(getContext(), intent); call.resolve();
        } catch (Exception e) { call.reject("Could not start Android screen capture", e); }
    }

    @PluginMethod public void stopScreenShare(PluginCall call) {
        try { Intent intent = new Intent(getContext(), CallService.class); intent.setAction(CallService.ACTION_STOP_PROJECTION); getContext().startService(intent); }
        catch (Exception e) { call.reject("Could not stop screen capture", e); return; }
        call.resolve();
    }
    @PluginMethod public void stop(PluginCall call) {
        try { getContext().stopService(new Intent(getContext(), CallService.class)); }
        catch (Exception e) { call.reject("Could not stop call service", e); return; }
        call.resolve();
    }
}
