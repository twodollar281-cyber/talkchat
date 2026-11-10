
package com.talkchat.app;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

public class CallOverlayManager {
    public interface Listener {
        void onMicClick();
        void onCameraClick();
        void onReturnClick();
        void onEndClick();
    }

    private final Context context;
    private final WindowManager windowManager;
    private final Listener listener;
    private View overlay;
    private TextView status;
    private TextView duration;
    private TextView speaker;
    private WindowManager.LayoutParams params;
    private boolean compact = false;

    public CallOverlayManager(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
        this.windowManager =
            (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
    }

    private int dp(float value) {
        return (int) (value * context.getResources()
            .getDisplayMetrics().density + 0.5f);
    }

    private GradientDrawable shape(int color, int stroke) {
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(dp(24));
        if (stroke != 0) bg.setStroke(dp(1), stroke);
        return bg;
    }

    private TextView text(String value, int size, int color) {
        TextView t = new TextView(context);
        t.setText(value);
        t.setTextSize(size);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER);
        return t;
    }

    private TextView control(String label, int color) {
        TextView t = text(label, 14, Color.WHITE);
        t.setPadding(dp(13), dp(12), dp(13), dp(12));
        t.setBackground(shape(color, 0));
        return t;
    }

    private LinearLayout column() {
        LinearLayout l = new LinearLayout(context);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    private LinearLayout.LayoutParams lp(int w, int h) {
        return new LinearLayout.LayoutParams(w < 0 ? w : dp(w),
            h < 0 ? h : dp(h));
    }

    public boolean hasPermission() {
        return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context);
    }

    public void show(String title, String callDuration,
                     String activeSpeaker, String participants) {
        if (!hasPermission()) return;

        if (overlay != null) {
            update(title, callDuration, activeSpeaker, participants);
            return;
        }

        LinearLayout card = column();
        card.setPadding(dp(16), dp(14), dp(16), dp(14));
        card.setBackground(shape(Color.rgb(16, 19, 42),
            Color.rgb(91, 83, 190)));

        LinearLayout header = new LinearLayout(context);
        header.setGravity(Gravity.CENTER_VERTICAL);

        TextView live = text("● LIVE", 11, Color.rgb(120, 225, 255));
        live.setPadding(dp(9), dp(6), dp(9), dp(6));
        live.setBackground(shape(Color.rgb(32, 48, 75), 0));

        duration = text(callDuration, 12, Color.WHITE);
        duration.setPadding(dp(10), 0, 0, 0);

        header.addView(live);
        header.addView(duration);
        card.addView(header, lp(-1, 34));

        TextView heading = text(title, 17, Color.WHITE);
        heading.setGravity(Gravity.CENTER_VERTICAL);
        card.addView(heading, lp(-1, 36));

        speaker = text("Danışan: " + activeSpeaker, 13,
            Color.rgb(190, 205, 255));
        speaker.setGravity(Gravity.CENTER_VERTICAL);
        card.addView(speaker, lp(-1, 32));

        status = text(participants, 12, Color.LTGRAY);
        status.setGravity(Gravity.CENTER_VERTICAL);
        card.addView(status, lp(-1, 38));

        LinearLayout controls = new LinearLayout(context);
        controls.setGravity(Gravity.CENTER);
        controls.setPadding(0, dp(8), 0, 0);

        TextView mic = control("Mikrofon", Color.rgb(61, 72, 112));
        TextView camera = control("Kamera", Color.rgb(61, 72, 112));
        TextView back = control("Qayıt", Color.rgb(76, 76, 160));
        TextView end = control("Bitir", Color.rgb(190, 48, 76));

        mic.setOnClickListener(v -> {
            if (listener != null) listener.onMicClick();
        });
        camera.setOnClickListener(v -> {
            if (listener != null) listener.onCameraClick();
        });
        back.setOnClickListener(v -> {
            if (listener != null) listener.onReturnClick();
        });
        end.setOnClickListener(v -> {
            if (listener != null) listener.onEndClick();
        });

        controls.addView(mic, lp(-2, -2));
        controls.addView(camera, lp(-2, -2));
        controls.addView(back, lp(-2, -2));
        controls.addView(end, lp(-2, -2));
        card.addView(controls);

        card.setOnClickListener(v -> {
            if (compact) {
                compact = false;
                status.setVisibility(View.VISIBLE);
                speaker.setVisibility(View.VISIBLE);
                controls.setVisibility(View.VISIBLE);
            }
        });

        overlay = card;
        int type = Build.VERSION.SDK_INT >= 26
            ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
            : WindowManager.LayoutParams.TYPE_PHONE;

        params = new WindowManager.LayoutParams(
            dp(340), WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        );

        params.gravity = Gravity.TOP | Gravity.END;
        params.x = dp(12);
        params.y = dp(90);
        header.setOnTouchListener(new View.OnTouchListener() {
    private int startX, startY;
    private float touchX, touchY;

    @Override
    public boolean onTouch(View v, MotionEvent event) {
        if (params == null || overlay == null) return false;

        switch (event.getAction()) {
            case MotionEvent.ACTION_DOWN:
                startX = params.x;
                startY = params.y;
                touchX = event.getRawX();
                touchY = event.getRawY();
                return true;

            case MotionEvent.ACTION_MOVE:
                params.x = startX + (int)(touchX - event.getRawX());
                params.y = startY + (int)(event.getRawY() - touchY);
                try {
                    windowManager.updateViewLayout(overlay, params);
                } catch (Exception ignored) {}
                return true;
        }
        return true;
    }
});
        

        try {
            windowManager.addView(overlay, params);
        } catch (Exception e) {
            overlay = null;
            params = null;
        }
    }

    public void update(String title, String callDuration,
                       String activeSpeaker, String participants) {
        if (overlay == null) return;
        if (duration != null) duration.setText(callDuration);
        if (speaker != null) speaker.setText("Danışan: " + activeSpeaker);
        if (status != null) status.setText(participants);
    }

    public void hide() {
        if (overlay != null) {
            try {
                windowManager.removeView(overlay);
            } catch (Exception ignored) {}
            overlay = null;
            params = null;
            duration = null;
            speaker = null;
            status = null;
        }
    }

    public boolean isShowing() {
        return overlay != null;
    }
}
