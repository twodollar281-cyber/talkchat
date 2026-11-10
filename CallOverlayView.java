package com.talkchat.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Premium, programmatic call overlay UI. It never owns or stops the WebRTC session. */
final class CallOverlayView extends LinearLayout {
    interface Listener { void onAction(String action); }

    private static final int WHITE = Color.WHITE;
    private static final int MUTED = Color.rgb(176, 171, 198);
    private static final ExecutorService IMAGE_WORKER = Executors.newFixedThreadPool(2);
    private static final Map<String, Bitmap> IMAGE_CACHE = new HashMap<>();

    private final SharedPreferences prefs;
    private final Listener listener;
    private final LinearLayout expanded;
    private final LinearLayout compact;
    private final LinearLayout settings;
    private final LinearLayout participants;
    private final View dragHandle;
    private final FrameLayout heroAvatar;
    private final ImageView heroImage;
    private final TextView heroInitial;
    private final TextView heroName;
    private final TextView heroState;
    private final TextView callTitle;
    private final TextView callKind;
    private final TextView callTimer;
    private final TextView compactName;
    private final TextView compactTimer;
    private final TextView micButton;
    private final TextView micLabel;
    private final TextView cameraButton;
    private final TextView cameraLabel;
    private final Map<String, FrameLayout> avatarViews = new HashMap<>();
    private final Map<String, TextView> participantNameViews = new HashMap<>();
    private String participantSignature = "";
    private JSONObject current = new JSONObject();
    private boolean expandedMode = true;
    private ValueAnimator pulseAnimator;

    CallOverlayView(Context context, SharedPreferences prefs, Listener listener) {
        super(context);
        this.prefs = prefs;
        this.listener = listener;
        setOrientation(VERTICAL);
        setPadding(dp(15), dp(12), dp(15), dp(13));
        setBackground(cardBackground());
        setElevation(dp(22));
        setClipToOutline(true);

        dragHandle = new View(context);
        dragHandle.setBackground(shape("#766A91", "#766A91", 0, 5));
        LayoutParams handleParams = new LayoutParams(dp(42), dp(4));
        handleParams.gravity = Gravity.CENTER_HORIZONTAL;
        handleParams.bottomMargin = dp(11);
        addView(dragHandle, handleParams);

        compact = new LinearLayout(context);
        compact.setOrientation(HORIZONTAL);
        compact.setGravity(Gravity.CENTER_VERTICAL);
        compact.setVisibility(GONE);
        CompactRefs compactRefs = buildCompact(compact);
        compactName = compactRefs.name;
        compactTimer = compactRefs.timer;
        addView(compact, new LayoutParams(LayoutParams.MATCH_PARENT, dp(48)));

        expanded = new LinearLayout(context);
        expanded.setOrientation(VERTICAL);
        HeroRefs refs = buildExpanded(expanded);
        callTitle = refs.title;
        callKind = refs.kind;
        callTimer = refs.timer;
        heroAvatar = refs.avatar;
        heroImage = refs.image;
        heroInitial = refs.initial;
        heroName = refs.name;
        heroState = refs.state;
        participants = refs.participants;
        micButton = refs.mic;
        micLabel = refs.micLabel;
        cameraButton = refs.camera;
        cameraLabel = refs.cameraLabel;
        addView(expanded, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        settings = buildSettings();
        settings.setVisibility(GONE);
        addView(settings, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));
        update(new JSONObject());
        setExpanded(true);
    }

    View getDragHandle() { return dragHandle; }

    void update(JSONObject data) {
        if (data != null) current = data;
        String title = current.optString("title", "TalkChat zəngi");
        String media = current.optString("mediaType", "audio");
        boolean video = "video".equalsIgnoreCase(media);
        boolean muted = current.optBoolean("micMuted", false);
        boolean cameraOn = current.optBoolean("cameraOn", video);
        int seconds = Math.max(0, current.optInt("durationSeconds", 0));
        String duration = formatDuration(seconds);

        callTitle.setText(title);
        compactName.setText(title);
        callTimer.setText(duration);
        compactTimer.setText(duration);
        callKind.setText((video ? "VIDEO ZƏNG" : "SƏSLİ ZƏNG") + (current.optBoolean("isGroup", false) ? "  ·  QRUP" : "  ·  ŞƏXSİ"));
        micButton.setText(muted ? "×" : "⌁");
        micLabel.setText(muted ? "Mikrofon bağlı" : "Mikrofon açıq");
        cameraButton.setVisibility(video ? VISIBLE : GONE);
        cameraLabel.setVisibility(video ? VISIBLE : GONE);
        cameraButton.setText(cameraOn ? "▣" : "▧");
        cameraLabel.setText(cameraOn ? "Kamera açıq" : "Kamera bağlı");

        JSONArray people = current.optJSONArray("participants");
        JSONArray speakers = current.optJSONArray("speakers");
        Set<String> speaking = new HashSet<>();
        if (speakers != null) {
            for (int i = 0; i < speakers.length(); i++) {
                String username = speakers.optString(i, "");
                if (!username.isEmpty()) speaking.add(username);
            }
        }
        JSONObject active = chooseSpeaker(people, speaking);
        String activeName = active.optString("displayName", active.optString("username", title));
        heroName.setText(activeName);
        heroState.setText(speaking.isEmpty() ? "ZƏNG DAVAM EDİR" : "●  İNDİ DANIŞIR");
        setAvatar(heroAvatar, heroImage, heroInitial, active);
        renderParticipants(people, speaking);
        animateSpeaker(!speaking.isEmpty());
    }

    private static final class CompactRefs {
        TextView name;
        TextView timer;
    }

    private CompactRefs buildCompact(LinearLayout row) {
        CompactRefs refs = new CompactRefs();
        TextView logo = label("TC", 13, WHITE, true);
        logo.setGravity(Gravity.CENTER);
        logo.setBackground(shape("#7658D8", "#B9A5FF", 1, 14));
        row.addView(logo, new LayoutParams(dp(38), dp(38)));
        LinearLayout copy = column();
        copy.setPadding(dp(10), 0, dp(8), 0);
        TextView name = label("TalkChat", 12, WHITE, true);
        TextView timer = label("00:00", 10, MUTED, false);
        refs.name = name;
        refs.timer = timer;
        copy.addView(name);
        copy.addView(timer);
        row.addView(copy, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        TextView expandButton = iconButton("⌃", "#302747");
        expandButton.setOnClickListener(v -> setExpanded(true));
        row.addView(expandButton, new LayoutParams(dp(38), dp(38)));
        TextView hideButton = iconButton("×", "#47283F");
        hideButton.setOnClickListener(v -> listener.onAction("hide"));
        LayoutParams hideParams = new LayoutParams(dp(38), dp(38));
        hideParams.leftMargin = dp(7);
        row.addView(hideButton, hideParams);
        return refs;
    }

    private static final class HeroRefs {
        TextView title, kind, timer, name, state, mic, micLabel, camera, cameraLabel;
        FrameLayout avatar;
        ImageView image;
        TextView initial;
        LinearLayout participants;
    }

    private HeroRefs buildExpanded(LinearLayout panel) {
        HeroRefs r = new HeroRefs();
        LinearLayout header = horizontal();
        TextView logo = label("TC", 13, WHITE, true);
        logo.setGravity(Gravity.CENTER);
        logo.setBackground(shape("#7658D8", "#B9A5FF", 1, 13));
        header.addView(logo, new LayoutParams(dp(34), dp(34)));
        LinearLayout brand = column();
        brand.setPadding(dp(9), 0, 0, 0);
        brand.addView(label("TALKCHAT", 11, WHITE, true));
        brand.addView(label("LIVE CALL EXPERIENCE", 8, MUTED, true));
        header.addView(brand, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        LinearLayout live = horizontal();
        View dot = new View(getContext());
        dot.setBackground(shape("#78E7C2", "#78E7C2", 0, 8));
        live.addView(dot, new LayoutParams(dp(7), dp(7)));
        TextView liveText = label("LIVE", 8, Color.rgb(143, 238, 207), true);
        LayoutParams liveTextParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        liveTextParams.leftMargin = dp(5);
        live.addView(liveText, liveTextParams);
        live.setPadding(dp(10), dp(7), dp(10), dp(7));
        live.setBackground(shape("#1D3540", "#315F69", 1, 18));
        header.addView(live);
        panel.addView(header);

        LinearLayout titleLine = horizontal();
        r.title = label("TalkChat zəngi", 17, WHITE, true);
        r.title.setMaxLines(1);
        r.title.setEllipsize(TextUtils.TruncateAt.END);
        titleLine.addView(r.title, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        r.timer = label("00:00", 13, Color.rgb(207, 190, 255), true);
        r.timer.setPadding(dp(10), dp(7), dp(10), dp(7));
        r.timer.setBackground(shape("#292143", "#66528F", 1, 15));
        titleLine.addView(r.timer);
        LayoutParams titleParams = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        titleParams.topMargin = dp(14);
        panel.addView(titleLine, titleParams);
        r.kind = label("SƏSLİ ZƏNG · ŞƏXSİ", 8, MUTED, true);
        LayoutParams kindParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        kindParams.topMargin = dp(4);
        panel.addView(r.kind, kindParams);

        LinearLayout hero = horizontal();
        hero.setGravity(Gravity.CENTER_VERTICAL);
        hero.setPadding(dp(12), dp(12), dp(12), dp(12));
        hero.setBackground(shape("#24203D", "#594B7C", 1, 21));
        r.avatar = avatarFrame(76);
        r.image = (ImageView) r.avatar.getChildAt(0);
        r.initial = (TextView) r.avatar.getChildAt(1);
        hero.addView(r.avatar, new LayoutParams(dp(76), dp(76)));
        LinearLayout heroCopy = column();
        heroCopy.setPadding(dp(12), 0, 0, 0);
        r.name = label("İştirakçı", 15, WHITE, true);
        r.state = label("ZƏNG DAVAM EDİR", 8, Color.rgb(195, 173, 255), true);
        LayoutParams stateParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        stateParams.topMargin = dp(5);
        heroCopy.addView(r.name);
        heroCopy.addView(r.state, stateParams);
        hero.addView(heroCopy, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        hero.addView(equalizer(), new LayoutParams(dp(42), dp(32)));
        LayoutParams heroParams = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        heroParams.topMargin = dp(13);
        panel.addView(hero, heroParams);

        TextView participantTitle = label("İŞTİRAKÇILAR", 8, MUTED, true);
        LayoutParams peopleTitleParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        peopleTitleParams.topMargin = dp(14);
        peopleTitleParams.bottomMargin = dp(7);
        panel.addView(participantTitle, peopleTitleParams);
        HorizontalScrollView horizontalScroll = new HorizontalScrollView(getContext());
        horizontalScroll.setHorizontalScrollBarEnabled(false);
        r.participants = horizontal();
        horizontalScroll.addView(r.participants, new HorizontalScrollView.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT));
        panel.addView(horizontalScroll, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT));

        LinearLayout controls = horizontal();
        controls.setGravity(Gravity.CENTER);
        r.mic = label("⌁", 20, Color.rgb(213, 196, 255), true);
        r.micLabel = label("Mikrofon açıq", 8, MUTED, false);
        controls.addView(controlGroup(r.mic, r.micLabel, "#30264D", "toggleMicrophone"), new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        r.camera = label("▣", 20, Color.rgb(145, 208, 255), true);
        r.cameraLabel = label("Kamera açıq", 8, MUTED, false);
        controls.addView(controlGroup(r.camera, r.cameraLabel, "#26344B", "toggleCamera"), new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        TextView back = label("↗", 20, Color.rgb(139, 235, 215), true);
        controls.addView(controlGroup(back, label("TalkChat", 8, MUTED, false), "#203D48", "returnToCall"), new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        TextView end = label("●", 18, Color.rgb(255, 160, 179), true);
        controls.addView(controlGroup(end, label("Zəngi bitir", 8, MUTED, false), "#51293B", "endCall"), new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        LayoutParams controlsParams = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        controlsParams.topMargin = dp(15);
        panel.addView(controls, controlsParams);

        LinearLayout footer = horizontal();
        TextView settingsButton = iconButton("⚙", "#302747");
        settingsButton.setOnClickListener(v -> showSettings());
        TextView compactButton = iconButton("⌄", "#302747");
        compactButton.setOnClickListener(v -> setExpanded(false));
        TextView hideButton = iconButton("×", "#47283F");
        hideButton.setOnClickListener(v -> listener.onAction("hide"));
        footer.addView(settingsButton, new LayoutParams(dp(36), dp(32)));
        LayoutParams compactParams = new LayoutParams(dp(36), dp(32));
        compactParams.leftMargin = dp(6);
        footer.addView(compactButton, compactParams);
        LayoutParams hideParams = new LayoutParams(dp(36), dp(32));
        hideParams.leftMargin = dp(6);
        footer.addView(hideButton, hideParams);
        TextView dragText = label("SÜRÜŞDÜRÜLƏ BİLƏN PƏNCƏRƏ", 7, Color.rgb(125, 118, 151), true);
        LayoutParams dragTextParams = new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1);
        dragTextParams.leftMargin = dp(8);
        dragText.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        footer.addView(dragText, dragTextParams);
        LayoutParams footerParams = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        footerParams.topMargin = dp(12);
        panel.addView(footer, footerParams);
        return r;
    }

    private LinearLayout buildSettings() {
        LinearLayout panel = column();
        LinearLayout header = horizontal();
        TextView title = label("OVERLAY DİZAYNI", 13, WHITE, true);
        header.addView(title, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        TextView done = iconButton("✓", "#23463F");
        done.setOnClickListener(v -> closeSettings());
        header.addView(done, new LayoutParams(dp(36), dp(32)));
        panel.addView(header);
        TextView description = label("Zəng pəncərəsinin görünüşünü özünə uyğunlaşdır.", 9, MUTED, false);
        LayoutParams descParams = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        descParams.topMargin = dp(7);
        descParams.bottomMargin = dp(10);
        panel.addView(description, descParams);
        addSetting(panel, "Avatarlar", "İştirakçı şəkillərini göstər", "avatars", true);
        addSetting(panel, "Adlar", "İştirakçı adlarını göstər", "names", true);
        addSetting(panel, "Danışan effekti", "Aktiv danışanın bənövşəyi halqası", "glow", true);
        addSetting(panel, "Yumşaq animasiya", "Yüngül, diqqət yayındırmayan hərəkət", "motion", true);
        LinearLayout side = horizontal();
        TextView left = smallAction("SOLDA", "positionLeft");
        TextView right = smallAction("SAĞDA", "positionRight");
        side.addView(left, new LayoutParams(0, dp(34), 1));
        LayoutParams rightParams = new LayoutParams(0, dp(34), 1);
        rightParams.leftMargin = dp(8);
        side.addView(right, rightParams);
        LayoutParams sideParams = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        sideParams.topMargin = dp(10);
        panel.addView(side, sideParams);
        TextView hint = label("Dəqiq yerini dəyişmək üçün yuxarıdakı tutacaqdan sürüşdür.", 8, MUTED, false);
        LayoutParams hintParams = new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        hintParams.topMargin = dp(8);
        panel.addView(hint, hintParams);
        return panel;
    }

    private void addSetting(LinearLayout panel, String title, String detail, String key, boolean defaultValue) {
        LinearLayout line = horizontal();
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(0, dp(8), 0, dp(8));
        LinearLayout copy = column();
        copy.addView(label(title, 11, WHITE, true));
        TextView sub = label(detail, 8, MUTED, false);
        LayoutParams subParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        subParams.topMargin = dp(3);
        copy.addView(sub, subParams);
        line.addView(copy, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1));
        Switch toggle = new Switch(getContext());
        toggle.setChecked(prefs.getBoolean(key, defaultValue));
        toggle.setOnCheckedChangeListener((button, checked) -> {
            prefs.edit().putBoolean(key, checked).apply();
            update(current);
        });
        line.addView(toggle);
        panel.addView(line);
        View divider = new View(getContext());
        divider.setBackgroundColor(Color.argb(35, 255, 255, 255));
        panel.addView(divider, new LayoutParams(LayoutParams.MATCH_PARENT, dp(1)));
    }

    private TextView smallAction(String title, String action) {
        TextView button = label(title, 9, WHITE, true);
        button.setGravity(Gravity.CENTER);
        button.setBackground(shape("#302747", "#625282", 1, 11));
        button.setOnClickListener(v -> listener.onAction(action));
        return button;
    }

    private void renderParticipants(JSONArray people, Set<String> speaking) {
        StringBuilder signature = new StringBuilder();
        if (people != null) for (int i = 0; i < people.length(); i++) {
            JSONObject person = people.optJSONObject(i);
            if (person == null) continue;
            signature.append(person.optString("username")).append('|')
                    .append(person.optString("displayName")).append('|')
                    .append(person.optString("avatar")).append('|')
                    .append(person.optBoolean("muted")).append('|')
                    .append(person.optBoolean("moderatorMuted")).append(';');
        }
        if (!signature.toString().equals(participantSignature)) {
            participantSignature = signature.toString();
            participants.removeAllViews();
            avatarViews.clear();
            participantNameViews.clear();
            if (people != null) for (int i = 0; i < people.length(); i++) {
                JSONObject person = people.optJSONObject(i);
                if (person == null) continue;
                String username = person.optString("username", "");
                if (username.isEmpty()) continue;
                LinearLayout tile = column();
                tile.setGravity(Gravity.CENTER);
                FrameLayout avatar = avatarFrame(42);
                setAvatar(avatar, (ImageView) avatar.getChildAt(0), (TextView) avatar.getChildAt(1), person);
                tile.addView(avatar, new LayoutParams(dp(42), dp(42)));
                TextView name = label(person.optString("displayName", username), 8, WHITE, true);
                name.setGravity(Gravity.CENTER);
                name.setMaxWidth(dp(74));
                name.setSingleLine(true);
                name.setEllipsize(TextUtils.TruncateAt.END);
                name.setVisibility(prefs.getBoolean("names", true) ? VISIBLE : GONE);
                LayoutParams nameParams = new LayoutParams(dp(74), LayoutParams.WRAP_CONTENT);
                nameParams.topMargin = dp(4);
                tile.addView(name, nameParams);
                boolean muted = person.optBoolean("muted") || person.optBoolean("moderatorMuted");
                TextView mic = label(muted ? "MIC OFF" : "MIC ON", 7,
                        muted ? Color.rgb(255, 151, 172) : Color.rgb(128, 218, 190), true);
                LayoutParams micParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
                micParams.topMargin = dp(3);
                tile.addView(mic, micParams);
                LayoutParams tileParams = new LayoutParams(dp(78), LayoutParams.WRAP_CONTENT);
                tileParams.rightMargin = dp(4);
                participants.addView(tile, tileParams);
                avatarViews.put(username, avatar);
                participantNameViews.put(username, name);
            }
        }
        for (Map.Entry<String, FrameLayout> entry : avatarViews.entrySet()) {
            boolean active = speaking.contains(entry.getKey()) && prefs.getBoolean("glow", true);
            setGlow(entry.getValue(), active);
            entry.getValue().setVisibility(prefs.getBoolean("avatars", true) ? VISIBLE : GONE);
            TextView name = participantNameViews.get(entry.getKey());
            if (name != null) name.setVisibility(prefs.getBoolean("names", true) ? VISIBLE : GONE);
        }
    }

    private JSONObject chooseSpeaker(JSONArray people, Set<String> speaking) {
        if (people == null) return new JSONObject();
        for (int i = 0; i < people.length(); i++) {
            JSONObject person = people.optJSONObject(i);
            if (person != null && speaking.contains(person.optString("username"))) return person;
        }
        JSONObject first = people.optJSONObject(0);
        return first == null ? new JSONObject() : first;
    }

    private void setAvatar(FrameLayout frame, ImageView image, TextView initial, JSONObject person) {
        String displayName = person.optString("displayName", person.optString("username", "?"));
        String url = person.optString("avatar", "");
        initial.setText(displayName.isEmpty() ? "?" : displayName.substring(0, 1).toUpperCase(Locale.ROOT));
        if (!prefs.getBoolean("avatars", true) || !url.startsWith("https://")) {
            image.setImageDrawable(null);
            image.setVisibility(GONE);
            initial.setVisibility(VISIBLE);
            return;
        }
        Object previousTag = image.getTag();
        if (url.equals(previousTag) && image.getDrawable() != null) return;
        if (("loading:" + url).equals(previousTag) || ("failed:" + url).equals(previousTag)) return;
        Bitmap cached;
        synchronized (IMAGE_CACHE) { cached = IMAGE_CACHE.get(url); }
        image.setTag("loading:" + url);
        if (cached != null) {
            image.setTag(url);
            image.setImageBitmap(cached);
            image.setVisibility(VISIBLE);
            initial.setVisibility(GONE);
            return;
        }
        image.setImageDrawable(null);
        image.setVisibility(VISIBLE);
        initial.setVisibility(VISIBLE);
        IMAGE_WORKER.execute(() -> {
            Bitmap bitmap = null;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(3000);
                connection.setReadTimeout(3000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("Accept", "image/*");
                try (InputStream input = connection.getInputStream()) { bitmap = BitmapFactory.decodeStream(input); }
                if (bitmap != null) synchronized (IMAGE_CACHE) {
                    if (IMAGE_CACHE.size() > 24) IMAGE_CACHE.clear();
                    IMAGE_CACHE.put(url, bitmap);
                }
            } catch (Exception ignored) {
            } finally { if (connection != null) connection.disconnect(); }
            if (bitmap != null) {
                Bitmap result = bitmap;
                frame.post(() -> {
                    if (("loading:" + url).equals(image.getTag())) {
                        image.setTag(url);
                        image.setImageBitmap(result);
                        image.setVisibility(VISIBLE);
                        initial.setVisibility(GONE);
                    }
                });
            } else {
                frame.post(() -> { if (("loading:" + url).equals(image.getTag())) image.setTag("failed:" + url); });
            }
        });
    }

    private LinearLayout controlGroup(TextView glyph, TextView caption, String fill, String action) {
        LinearLayout group = column();
        group.setGravity(Gravity.CENTER);
        glyph.setGravity(Gravity.CENTER);
        glyph.setBackground(shape(fill, "#5D507C", 1, 15));
        group.addView(glyph, new LayoutParams(dp(46), dp(46)));
        LayoutParams captionParams = new LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT);
        captionParams.topMargin = dp(5);
        group.addView(caption, captionParams);
        group.setOnClickListener(v -> listener.onAction(action));
        return group;
    }

    private LinearLayout equalizer() {
        LinearLayout bars = horizontal();
        bars.setGravity(Gravity.CENTER);
        int[] heights = {12, 23, 16, 29, 13};
        for (int height : heights) {
            View bar = new View(getContext());
            bar.setBackground(shape("#B49AFF", "#B49AFF", 0, 4));
            LayoutParams params = new LayoutParams(dp(4), dp(height));
            params.leftMargin = dp(2);
            params.rightMargin = dp(2);
            bars.addView(bar, params);
        }
        return bars;
    }

    private FrameLayout avatarFrame(int size) {
        FrameLayout frame = new FrameLayout(getContext());
        frame.setBackground(shape("#382B59", "#8C72C5", 1, 50));
        frame.setClipToOutline(true);
        ImageView image = new ImageView(getContext());
        image.setScaleType(ImageView.ScaleType.CENTER_CROP);
        FrameLayout.LayoutParams imageParams = new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT);
        imageParams.setMargins(dp(4), dp(4), dp(4), dp(4));
        frame.addView(image, imageParams);
        TextView initial = label("T", size > 50 ? 24 : 15, WHITE, true);
        initial.setGravity(Gravity.CENTER);
        initial.setBackground(shape("#59418B", "#59418B", 0, 50));
        FrameLayout.LayoutParams initialParams = new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT);
        initialParams.setMargins(dp(4), dp(4), dp(4), dp(4));
        frame.addView(initial, initialParams);
        return frame;
    }

    private void setGlow(FrameLayout avatar, boolean active) {
        String stroke = active ? "#D6C2FF" : "#786A98";
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(Color.rgb(42, 32, 68));
        bg.setStroke(dp(active ? 3 : 1), Color.parseColor(stroke));
        avatar.setBackground(bg);
        avatar.setElevation(dp(active ? 10 : 2));
    }

    private void animateSpeaker(boolean speaking) {
        if (!speaking || !prefs.getBoolean("motion", true)) {
            if (pulseAnimator != null) { pulseAnimator.cancel(); pulseAnimator = null; }
            heroAvatar.setScaleX(1f);
            heroAvatar.setScaleY(1f);
            setGlow(heroAvatar, false);
            return;
        }
        if (pulseAnimator == null || !pulseAnimator.isStarted()) {
            pulseAnimator = ValueAnimator.ofFloat(1f, 1.045f);
            pulseAnimator.setDuration(720);
            pulseAnimator.setRepeatMode(ValueAnimator.REVERSE);
            pulseAnimator.setRepeatCount(ValueAnimator.INFINITE);
            pulseAnimator.addUpdateListener(animation -> {
                float scale = (float) animation.getAnimatedValue();
                heroAvatar.setScaleX(scale);
                heroAvatar.setScaleY(scale);
            });
            pulseAnimator.start();
        }
        setGlow(heroAvatar, true);
    }

    private void showSettings() {
        expanded.setVisibility(GONE);
        compact.setVisibility(GONE);
        settings.setVisibility(VISIBLE);
    }

    private void closeSettings() {
        settings.setVisibility(GONE);
        setExpanded(expandedMode);
    }

    private void setExpanded(boolean value) {
        expandedMode = value;
        settings.setVisibility(GONE);
        expanded.setVisibility(value ? VISIBLE : GONE);
        compact.setVisibility(value ? GONE : VISIBLE);
    }

    private TextView iconButton(String glyph, String fill) {
        TextView button = label(glyph, 19, WHITE, true);
        button.setGravity(Gravity.CENTER);
        button.setBackground(shape(fill, "#625282", 1, 13));
        return button;
    }

    private LinearLayout horizontal() {
        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        return row;
    }

    private LinearLayout column() {
        LinearLayout col = new LinearLayout(getContext());
        col.setOrientation(VERTICAL);
        return col;
    }

    private TextView label(String text, int size, int color, boolean bold) {
        TextView view = new TextView(getContext());
        view.setText(text);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
        view.setIncludeFontPadding(false);
        return view;
    }

    private GradientDrawable shape(String fill, String stroke, int strokeDp, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(Color.parseColor(fill));
        drawable.setCornerRadius(dp(radiusDp));
        if (strokeDp > 0) drawable.setStroke(dp(strokeDp), Color.parseColor(stroke));
        return drawable;
    }

    private GradientDrawable cardBackground() {
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[]{Color.rgb(18, 15, 34), Color.rgb(35, 26, 57), Color.rgb(18, 29, 46)});
        bg.setCornerRadius(dp(25));
        bg.setStroke(dp(1), Color.rgb(104, 83, 151));
        return bg;
    }

    private int dp(float value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private String formatDuration(int seconds) {
        int hours = seconds / 3600;
        int minutes = (seconds / 60) % 60;
        int secs = seconds % 60;
        return hours > 0
                ? String.format(Locale.US, "%d:%02d:%02d", hours, minutes, secs)
                : String.format(Locale.US, "%02d:%02d", minutes, secs);
    }
}
