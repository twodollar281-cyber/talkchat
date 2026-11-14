package com.talkchat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media.session.MediaButtonReceiver;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class TalkMediaService extends Service implements AudioManager.OnAudioFocusChangeListener {

    public static final String CHANNEL_ID = "talkchat_media_channel";
    public static final int NOTIFICATION_ID = 4301;

    public static final String ACTION_PLAY_PAUSE = "com.talkchat.app.ACTION_PLAY_PAUSE";
    public static final String ACTION_NEXT = "com.talkchat.app.ACTION_NEXT";
    public static final String ACTION_PREV = "com.talkchat.app.ACTION_PREV";
    public static final String ACTION_STOP = "com.talkchat.app.ACTION_STOP";

    public static class TrackItem {
        public final String id;
        public final String title;
        public final String artist;
        public final String source;
        public final String cover;

        public TrackItem(String id, String title, String artist, String source, String cover) {
            this.id = id;
            this.title = title;
            this.artist = artist;
            this.source = source;
            this.cover = cover;
        }
    }

    public interface PlaybackListener {
        void onStateChanged(JSObject state);
    }

    public class LocalBinder extends Binder {
        public TalkMediaService getService() {
            return TalkMediaService.this;
        }
    }

    private final IBinder binder = new LocalBinder();
    private MediaPlayer mediaPlayer;
    private MediaSessionCompat mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private PlaybackListener listener;

    private final List<TrackItem> originalQueue = new ArrayList<>();
    private final List<TrackItem> activeQueue = new ArrayList<>();
    private int currentIndex = 0;
    private boolean isShuffle = false;
    private String repeatMode = "off"; // "off", "all", "one"
    private float volume = 1.0f;
    private boolean isPrepared = false;
    private boolean resumeOnFocusGain = false;

    private final Handler progressHandler = new Handler(Looper.getMainLooper());
    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            if (mediaPlayer != null && isPrepared && mediaPlayer.isPlaying()) {
                emitState();
                progressHandler.postDelayed(this, 1000);
            }
        }
    };

    @Override
    public void onCreate() {
        super.onCreate();
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        createNotificationChannel();
        initMediaSession();
    }

    private void initMediaSession() {
        mediaSession = new MediaSessionCompat(this, "TalkChatMediaSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                play();
            }

            @Override
            public void onPause() {
                pause();
            }

            @Override
            public void onSkipToNext() {
                next();
            }

            @Override
            public void onSkipToPrevious() {
                previous();
            }

            @Override
            public void onStop() {
                stopPlayback();
            }

            @Override
            public void onSeekTo(long pos) {
                seekTo(pos);
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            switch (intent.getAction()) {
                case ACTION_PLAY_PAUSE:
                    if (isPlaying()) pause(); else play();
                    break;
                case ACTION_NEXT:
                    next();
                    break;
                case ACTION_PREV:
                    previous();
                    break;
                case ACTION_STOP:
                    stopPlayback();
                    break;
                default:
                    MediaButtonReceiver.handleIntent(mediaSession, intent);
                    break;
            }
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    public void setPlaybackListener(PlaybackListener listener) {
        this.listener = listener;
    }

    public void setQueue(List<TrackItem> tracks, int startIndex) {
        originalQueue.clear();
        originalQueue.addAll(tracks);
        rebuildActiveQueue(startIndex);
        if (!activeQueue.isEmpty()) {
            prepareAndPlay(currentIndex, false);
        }
    }

    private void rebuildActiveQueue(int targetOriginalIndex) {
        TrackItem targetTrack = (targetOriginalIndex >= 0 && targetOriginalIndex < originalQueue.size())
                ? originalQueue.get(targetOriginalIndex) : null;
        activeQueue.clear();
        activeQueue.addAll(originalQueue);
        if (isShuffle && activeQueue.size() > 1) {
            Collections.shuffle(activeQueue);
            if (targetTrack != null) {
                activeQueue.remove(targetTrack);
                activeQueue.add(0, targetTrack);
            }
            currentIndex = 0;
        } else {
            currentIndex = Math.max(0, Math.min(targetOriginalIndex, activeQueue.size() - 1));
        }
    }

    private void prepareAndPlay(int index, boolean autoPlay) {
        if (activeQueue.isEmpty() || index < 0 || index >= activeQueue.size()) return;
        currentIndex = index;
        TrackItem track = activeQueue.get(currentIndex);

        releasePlayer();
        isPrepared = false;

        mediaPlayer = new MediaPlayer();
        mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build());
        mediaPlayer.setVolume(volume, volume);

        mediaPlayer.setOnPreparedListener(mp -> {
            isPrepared = true;
            updateMetadata(track, mp.getDuration());
            if (autoPlay) {
                play();
            } else {
                emitState();
            }
        });

        mediaPlayer.setOnCompletionListener(mp -> {
            if ("one".equals(repeatMode)) {
                mp.seekTo(0);
                mp.start();
                emitState();
            } else if (currentIndex + 1 < activeQueue.size()) {
                prepareAndPlay(currentIndex + 1, true);
            } else if ("all".equals(repeatMode)) {
                prepareAndPlay(0, true);
            } else {
                updatePlaybackState(PlaybackStateCompat.STATE_PAUSED);
                updateNotification();
                emitState();
            }
        });

        mediaPlayer.setOnErrorListener((mp, what, extra) -> {
            isPrepared = false;
            emitState();
            return true;
        });

        try {
            mediaPlayer.setDataSource(track.source);
            mediaPlayer.prepareAsync();
        } catch (IOException e) {
            isPrepared = false;
            emitState();
        }
    }

    public void playAtIndex(int index) {
        prepareAndPlay(index, true);
    }

    public void play() {
        if (activeQueue.isEmpty()) return;
        if (!requestAudioFocus()) return;

        if (mediaPlayer == null) {
            prepareAndPlay(currentIndex, true);
            return;
        }

        if (isPrepared && !mediaPlayer.isPlaying()) {
            mediaPlayer.start();
            updatePlaybackState(PlaybackStateCompat.STATE_PLAYING);
            startForeground(NOTIFICATION_ID, buildNotification());
            progressHandler.removeCallbacks(progressRunnable);
            progressHandler.post(progressRunnable);
            emitState();
        }
    }

    public void pause() {
        if (mediaPlayer != null && isPrepared && mediaPlayer.isPlaying()) {
            mediaPlayer.pause();
            progressHandler.removeCallbacks(progressRunnable);
            updatePlaybackState(PlaybackStateCompat.STATE_PAUSED);
            updateNotification();
            stopForeground(false);
            emitState();
        }
    }

    public void next() {
        if (activeQueue.isEmpty()) return;
        int nextIdx = currentIndex + 1;
        if (nextIdx >= activeQueue.size()) {
            nextIdx = "all".equals(repeatMode) ? 0 : activeQueue.size() - 1;
        }
        prepareAndPlay(nextIdx, true);
    }

    public void previous() {
        if (activeQueue.isEmpty()) return;
        if (mediaPlayer != null && isPrepared && mediaPlayer.getCurrentPosition() > 4000) {
            seekTo(0);
            return;
        }
        int prevIdx = currentIndex - 1;
        if (prevIdx < 0) {
            prevIdx = "all".equals(repeatMode) ? activeQueue.size() - 1 : 0;
        }
        prepareAndPlay(prevIdx, true);
    }

    public void seekTo(long positionMs) {
        if (mediaPlayer != null && isPrepared) {
            mediaPlayer.seekTo((int) positionMs);
            updatePlaybackState(isPlaying() ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED);
            emitState();
        }
    }

    public void stopPlayback() {
        progressHandler.removeCallbacks(progressRunnable);
        abandonAudioFocus();
        releasePlayer();
        isPrepared = false;
        updatePlaybackState(PlaybackStateCompat.STATE_STOPPED);
        stopForeground(true);
        emitState();
    }

    public void setVolume(float vol) {
        this.volume = vol;
        if (mediaPlayer != null) {
            mediaPlayer.setVolume(vol, vol);
        }
        emitState();
    }

    public void setShuffle(boolean enabled) {
        if (this.isShuffle == enabled) return;
        TrackItem current = (!activeQueue.isEmpty() && currentIndex < activeQueue.size())
                ? activeQueue.get(currentIndex) : null;
        this.isShuffle = enabled;
        int origIdx = current != null ? originalQueue.indexOf(current) : 0;
        rebuildActiveQueue(Math.max(0, origIdx));
        emitState();
    }

    public void setRepeat(String mode) {
        this.repeatMode = mode;
        emitState();
    }

    public boolean isPlaying() {
        return mediaPlayer != null && isPrepared && mediaPlayer.isPlaying();
    }

    private boolean requestAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                            .build())
                    .setAcceptsDelayedFocusGain(true)
                    .setOnAudioFocusChangeListener(this)
                    .build();
            return audioManager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } else {
            return audioManager.requestAudioFocus(this, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
                    == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
    }

    private void abandonAudioFocus() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
            audioManager.abandonAudioFocusRequest(focusRequest);
        } else {
            audioManager.abandonAudioFocus(this);
        }
    }

    @Override
    public void onAudioFocusChange(int focusChange) {
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
                resumeOnFocusGain = false;
                pause();
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                if (isPlaying()) {
                    resumeOnFocusGain = true;
                    pause();
                }
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                if (mediaPlayer != null) {
                    mediaPlayer.setVolume(volume * 0.25f, volume * 0.25f);
                }
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                if (mediaPlayer != null) {
                    mediaPlayer.setVolume(volume, volume);
                }
                if (resumeOnFocusGain) {
                    resumeOnFocusGain = false;
                    play();
                }
                break;
        }
    }

    private void updateMetadata(TrackItem track, long durationMs) {
        MediaMetadataCompat metadata = new MediaMetadataCompat.Builder()
                .putString(MediaMetadataCompat.METADATA_KEY_TITLE, track.title)
                .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, track.artist)
                .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
                .build();
        mediaSession.setMetadata(metadata);
    }

    private void updatePlaybackState(int state) {
        long position = (mediaPlayer != null && isPrepared) ? mediaPlayer.getCurrentPosition() : 0;
        long actions = PlaybackStateCompat.ACTION_PLAY
                | PlaybackStateCompat.ACTION_PAUSE
                | PlaybackStateCompat.ACTION_PLAY_PAUSE
                | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                | PlaybackStateCompat.ACTION_SEEK_TO
                | PlaybackStateCompat.ACTION_STOP;

        PlaybackStateCompat playbackState = new PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(state, position, 1.0f)
                .build();
        mediaSession.setPlaybackState(playbackState);
    }

    private Notification buildNotification() {
        TrackItem current = (!activeQueue.isEmpty() && currentIndex < activeQueue.size())
                ? activeQueue.get(currentIndex)
                : new TrackItem("0", "TalkPlayer", "TalkChat", "", "");

        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this, 0, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        PendingIntent prevIntent = PendingIntent.getService(
                this, 1, new Intent(this, TalkMediaService.class).setAction(ACTION_PREV),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent playPauseIntent = PendingIntent.getService(
                this, 2, new Intent(this, TalkMediaService.class).setAction(ACTION_PLAY_PAUSE),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent nextIntent = PendingIntent.getService(
                this, 3, new Intent(this, TalkMediaService.class).setAction(ACTION_NEXT),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        int playPauseIcon = isPlaying() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String playPauseLabel = isPlaying() ? "Fasilə" : "Oxut";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(current.title)
                .setContentText(current.artist)
                .setContentIntent(contentIntent)
                .setOngoing(isPlaying())
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(android.R.drawable.ic_media_previous, "Əvvəlki", prevIntent)
                .addAction(playPauseIcon, playPauseLabel, playPauseIntent)
                .addAction(android.R.drawable.ic_media_next, "Növbəti", nextIntent)
                .setStyle(new MediaStyle()
                        .setMediaSession(mediaSession.getSessionToken())
                        .setShowActionsInCompactView(0, 1, 2))
                .build();
    }

    private void updateNotification() {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "TalkPlayer Musiqi Oxuducu", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Arxa fonda musiqi oxutma idarəetməsi");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    public JSObject getPlaybackStateJS() {
        JSObject state = new JSObject();
        state.put("isPlaying", isPlaying());
        state.put("currentIndex", currentIndex);
        state.put("shuffle", isShuffle);
        state.put("repeat", repeatMode);
        state.put("volume", volume);
        if (mediaPlayer != null && isPrepared) {
            state.put("position", mediaPlayer.getCurrentPosition() / 1000.0);
            state.put("duration", mediaPlayer.getDuration() / 1000.0);
        } else {
            state.put("position", 0);
            state.put("duration", 0);
        }
        if (!activeQueue.isEmpty() && currentIndex < activeQueue.size()) {
            state.put("trackId", activeQueue.get(currentIndex).id);
        }
        return state;
    }

    private void emitState() {
        if (listener != null) {
            listener.onStateChanged(getPlaybackStateJS());
        }
    }

    private void releasePlayer() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.reset();
                mediaPlayer.release();
            } catch (Exception ignored) {
            }
            mediaPlayer = null;
        }
    }

    @Override
    public void onDestroy() {
        progressHandler.removeCallbacks(progressRunnable);
        abandonAudioFocus();
        releasePlayer();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        super.onDestroy();
    }
}
