package com.talkchat.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "TalkMedia")
public class TalkMediaPlugin extends Plugin implements TalkMediaService.PlaybackListener {

    private TalkMediaService mediaService;
    private boolean isBound = false;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            TalkMediaService.LocalBinder binder = (TalkMediaService.LocalBinder) service;
            mediaService = binder.getService();
            mediaService.setPlaybackListener(TalkMediaPlugin.this);
            isBound = true;
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            isBound = false;
            mediaService = null;
        }
    };

    @Override
    public void load() {
        Intent intent = new Intent(getContext(), TalkMediaService.class);
        getContext().startService(intent);
        getContext().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
    }

    @Override
    protected void handleOnDestroy() {
        if (isBound) {
            if (mediaService != null) {
                mediaService.setPlaybackListener(null);
            }
            getContext().unbindService(serviceConnection);
            isBound = false;
        }
        super.handleOnDestroy();
    }

    private File getStagedFile(String trackId) {
        String safeId = trackId.replaceAll("[^a-zA-Z0-9._-]", "_");
        File dir = new File(getContext().getCacheDir(), "talkmedia_tracks");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, safeId + ".audio");
    }

    @PluginMethod
    public void hasTrack(PluginCall call) {
        String trackId = call.getString("trackId");
        if (trackId == null) {
            call.reject("trackId is required");
            return;
        }
        File file = getStagedFile(trackId);
        JSObject ret = new JSObject();
        ret.put("exists", file.exists() && file.length() > 0);
        call.resolve(ret);
    }

    @PluginMethod
    public void stageChunk(PluginCall call) {
        String trackId = call.getString("trackId");
        String base64Data = call.getString("data");
        boolean append = call.getBoolean("append", true);

        if (trackId == null || base64Data == null) {
            call.reject("trackId and data are required");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64Data, Base64.DEFAULT);
            File file = getStagedFile(trackId);
            try (FileOutputStream fos = new FileOutputStream(file, append)) {
                fos.write(bytes);
            }
            JSObject ret = new JSObject();
            ret.put("staged", true);
            ret.put("size", file.length());
            call.resolve(ret);
        } catch (IOException | IllegalArgumentException e) {
            call.reject("Failed to stage chunk: " + e.getMessage());
        }
    }

    @PluginMethod
    public void trackReady(PluginCall call) {
        String trackId = call.getString("trackId");
        if (trackId == null) {
            call.reject("trackId is required");
            return;
        }
        File file = getStagedFile(trackId);
        JSObject ret = new JSObject();
        ret.put("ready", file.exists() && file.length() > 0);
        ret.put("path", file.getAbsolutePath());
        call.resolve(ret);
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray queueArray = call.getArray("queue");
        int startIndex = call.getInt("startIndex", 0);
        if (queueArray == null) {
            call.reject("queue array is required");
            return;
        }

        List<TalkMediaService.TrackItem> tracks = new ArrayList<>();
        try {
            for (int i = 0; i < queueArray.length(); i++) {
                JSONObject obj = queueArray.getJSONObject(i);
                String id = obj.optString("id", String.valueOf(i));
                String title = obj.optString("title", "Naməlum mahnı");
                String artist = obj.optString("artist", "Naməlum ifaçı");
                String url = obj.optString("url", "");
                String cover = obj.optString("cover", "");

                File staged = getStagedFile(id);
                String source = (staged.exists() && staged.length() > 0) ? staged.getAbsolutePath() : url;
                tracks.add(new TalkMediaService.TrackItem(id, title, artist, source, cover));
            }
        } catch (JSONException e) {
            call.reject("Invalid queue format: " + e.getMessage());
            return;
        }

        if (mediaService != null) {
            mediaService.setQueue(tracks, startIndex);
        }
        call.resolve();
    }

    @PluginMethod
    public void play(PluginCall call) {
        if (mediaService != null) {
            Integer index = call.getInt("index");
            if (index != null) {
                mediaService.playAtIndex(index);
            } else {
                mediaService.play();
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (mediaService != null) {
            mediaService.pause();
        }
        call.resolve();
    }

    @PluginMethod
    public void next(PluginCall call) {
        if (mediaService != null) {
            mediaService.next();
        }
        call.resolve();
    }

    @PluginMethod
    public void previous(PluginCall call) {
        if (mediaService != null) {
            mediaService.previous();
        }
        call.resolve();
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Double positionSec = call.getDouble("position");
        if (mediaService != null && positionSec != null) {
            mediaService.seekTo((long) (positionSec * 1000));
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (mediaService != null) {
            mediaService.stopPlayback();
        }
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Float volume = call.getFloat("volume", 1.0f);
        if (mediaService != null && volume != null) {
            mediaService.setVolume(Math.max(0.0f, Math.min(1.0f, volume)));
        }
        call.resolve();
    }

    @PluginMethod
    public void setShuffle(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled", false);
        if (mediaService != null && enabled != null) {
            mediaService.setShuffle(enabled);
        }
        call.resolve();
    }

    @PluginMethod
    public void setRepeat(PluginCall call) {
        String mode = call.getString("mode", "off");
        if (mediaService != null && mode != null) {
            mediaService.setRepeat(mode);
        }
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        if (mediaService != null) {
            call.resolve(mediaService.getPlaybackStateJS());
        } else {
            JSObject fallback = new JSObject();
            fallback.put("isPlaying", false);
            fallback.put("currentIndex", 0);
            fallback.put("position", 0);
            fallback.put("duration", 0);
            call.resolve(fallback);
        }
    }

    @Override
    public void onStateChanged(JSObject state) {
        notifyListeners("playbackStateChanged", state);
    }
}
