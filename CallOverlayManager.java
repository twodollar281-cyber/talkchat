package com.talkchat.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.PixelFormat;
import android.os.Build;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.provider.Settings;

import org.json.JSONObject;

/** Owns only the system overlay window; the active call remains owned by CallService/WebRTC. */
final class CallOverlayManager {
    interface Listener { void onAction(String action); }

    private static final String PREFS = "talkchat_call_overlay";
    private final Context context;
    private final WindowManager windowManager;
    private final SharedPreferences preferences;
    private final Listener listener;
    private CallOverlayView view;
    private WindowManager.LayoutParams params;
    private float downRawX, downRawY;
    private int downX, downY;

    CallOverlayManager(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        this.preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    boolean hasPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(context);
    }

    void show(JSONObject state) {
        if (!hasPermission() || windowManager == null) return;
        if (view == null) {
            view = new CallOverlayView(context, preferences, this::handleAction);
            params = createParams();
            attachDrag(view.getDragHandle());
        }
        view.update(state);
        if (!view.isAttachedToWindow()) {
            try { windowManager.addView(view, params); }
            catch (RuntimeException error) { view = null; params = null; }
        } else {
            try { windowManager.updateViewLayout(view, params); } catch (Exception ignored) {}
        }
    }

    void update(JSONObject state) {
        if (view == null || !view.isAttachedToWindow()) return;
        view.update(state);
        try { windowManager.updateViewLayout(view, params); } catch (Exception ignored) {}
    }

    void hide() {
        if (view != null && view.isAttachedToWindow()) {
            try { windowManager.removeView(view); } catch (Exception ignored) {}
        }
        if (view != null) view.animate().cancel();
        view = null;
        params = null;
    }

    void destroy() { hide(); }

    private WindowManager.LayoutParams createParams() {
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                : WindowManager.LayoutParams.TYPE_PHONE;
        int width = Math.min(dp(344), Math.max(dp(280), screenWidth() - dp(24)));
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(
                width,
                WindowManager.LayoutParams.WRAP_CONTENT,
                type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
                PixelFormat.TRANSLUCENT);
        p.gravity = Gravity.TOP | (preferences.getBoolean("left", false) ? Gravity.LEFT : Gravity.RIGHT);
        p.x = preferences.getInt("x", dp(12));
        p.y = preferences.getInt("y", dp(105));
        p.windowAnimations = android.R.style.Animation_Dialog;
        return p;
    }

    private int screenWidth() {
        android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        return metrics.widthPixels;
    }

    private void attachDrag(View handle) {
        handle.setOnTouchListener((v, event) -> {
            switch (event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downRawX = event.getRawX();
                    downRawY = event.getRawY();
                    downX = params.x;
                    downY = params.y;
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = event.getRawX() - downRawX;
                    float dy = event.getRawY() - downRawY;
                    boolean leftSide = preferences.getBoolean("left", false);
                    int horizontalDelta = (int) (leftSide ? dx : -dx);
                    int maxX = Math.max(dp(8), screenWidth() - params.width - dp(8));
                    params.x = Math.max(dp(8), Math.min(maxX, downX + horizontalDelta));
                    int screenHeight = context.getResources().getDisplayMetrics().heightPixels;
                    int maxY = Math.max(dp(8), screenHeight - (view == null ? dp(280) : view.getHeight()) - dp(12));
                    params.y = Math.max(dp(8), Math.min(maxY, downY + (int) dy));
                    try { windowManager.updateViewLayout(view, params); } catch (Exception ignored) {}
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    preferences.edit().putInt("x", params.x).putInt("y", params.y).apply();
                    return true;
                default: return false;
            }
        });
    }

    private void handleAction(String action) {
        if ("hide".equals(action)) {
            hide();
            listener.onAction("hide");
            return;
        }
        if ("positionLeft".equals(action) || "positionRight".equals(action)) {
            boolean left = "positionLeft".equals(action);
            preferences.edit().putBoolean("left", left).apply();
            if (params != null && view != null && view.isAttachedToWindow()) {
                params.gravity = Gravity.TOP | (left ? Gravity.LEFT : Gravity.RIGHT);
                params.x = dp(12);
                preferences.edit().putInt("x", params.x).apply();
                try { windowManager.updateViewLayout(view, params); } catch (Exception ignored) {}
            }
            return;
        }
        if ("returnToCall".equals(action)) {
            try {
                Intent launch = new Intent(context, MainActivity.class);
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                context.startActivity(launch);
            } catch (Exception ignored) {}
        }
        listener.onAction(action);
    }

    private int dp(float value) {
        return (int) (value * context.getResources().getDisplayMetrics().density + 0.5f);
    }
}
