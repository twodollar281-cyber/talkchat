// TalkPlayer - Native Capacitor TalkMedia + Browser Audio Fallback
(function () {
  const TalkMedia = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TalkMedia;
  const isNative = Boolean(TalkMedia);

  class TalkPlayerController {
    constructor() {
      this.audio = new Audio();
      this.queue = [];
      this.currentIndex = 0;
      this.isPlaying = false;
      this.shuffle = false;
      this.repeat = 'off'; // 'off' | 'all' | 'one'
      this.volume = 1.0;
      this.serverTracks = [];
      this.localTracks = [];
      this.activeTab = 'local'; // 'local' | 'server'
      this.listeners = new Set();

      this._bindAudioEvents();
      if (isNative && TalkMedia.addListener) {
        TalkMedia.addListener('playbackStateChanged', (state) => {
          this.isPlaying = Boolean(state.isPlaying);
          this.currentIndex = state.currentIndex || 0;
          this.shuffle = Boolean(state.shuffle);
          this.repeat = state.repeat || 'off';
          this._notify({
            ...state,
            track: this.queue[this.currentIndex] || null
          });
        });
      }
    }

    _bindAudioEvents() {
      this.audio.addEventListener('timeupdate', () => {
        if (!isNative) this._emitWebState();
      });
      this.audio.addEventListener('ended', () => {
        if (isNative) return;
        if (this.repeat === 'one') {
          this.audio.currentTime = 0;
          this.audio.play();
        } else if (this.currentIndex + 1 < this.queue.length) {
          this.playAt(this.currentIndex + 1);
        } else if (this.repeat === 'all' && this.queue.length > 0) {
          this.playAt(0);
        } else {
          this.isPlaying = false;
          this._emitWebState();
        }
      });
    }

    _emitWebState() {
      this._notify({
        isPlaying: this.isPlaying,
        currentIndex: this.currentIndex,
        position: this.audio.currentTime || 0,
        duration: this.audio.duration || 0,
        shuffle: this.shuffle,
        repeat: this.repeat,
        volume: this.volume,
        track: this.queue[this.currentIndex] || null
      });
    }

    onStateChange(cb) {
      this.listeners.add(cb);
      return () => this.listeners.delete(cb);
    }

    _notify(state) {
      this.listeners.forEach((cb) => {
        try { cb(state); } catch (e) { console.error(e); }
      });
    }

    async setQueue(tracks, startIndex = 0) {
      this.queue = Array.isArray(tracks) ? [...tracks] : [];
      this.currentIndex = startIndex;

      if (isNative) {
        await TalkMedia.setQueue({
          queue: this.queue.map((t) => ({
            id: String(t.id),
            title: t.title || 'Naməlum mahnı',
            artist: t.artist || 'Naməlum ifaçı',
            url: t.audioUrl || t.url || '',
            cover: t.coverUrl || t.cover || ''
          })),
          startIndex
        });
      } else if (this.queue[startIndex]) {
        this.audio.src = this.queue[startIndex].audioUrl || this.queue[startIndex].url;
      }
    }

    async playAt(index) {
      if (!this.queue[index]) return;
      this.currentIndex = index;
      if (isNative) {
        await TalkMedia.play({ index });
      } else {
        const track = this.queue[index];
        this.audio.src = track.audioUrl || track.url;
        await this.audio.play();
        this.isPlaying = true;
        this._emitWebState();
      }
    }

    async togglePlay() {
      if (isNative) {
        const state = await TalkMedia.getState();
        if (state.isPlaying) {
          await TalkMedia.pause();
        } else {
          await TalkMedia.play({});
        }
      } else {
        if (this.isPlaying) {
          this.audio.pause();
          this.isPlaying = false;
        } else {
          if (!this.audio.src && this.queue[this.currentIndex]) {
            this.audio.src = this.queue[this.currentIndex].audioUrl || this.queue[this.currentIndex].url;
          }
          await this.audio.play();
          this.isPlaying = true;
        }
        this._emitWebState();
      }
    }

    async next() {
      if (isNative) {
        await TalkMedia.next();
      } else if (this.queue.length > 0) {
        const nextIdx = (this.currentIndex + 1) % this.queue.length;
        await this.playAt(nextIdx);
      }
    }

    async previous() {
      if (isNative) {
        await TalkMedia.previous();
      } else if (this.queue.length > 0) {
        const prevIdx = (this.currentIndex - 1 + this.queue.length) % this.queue.length;
        await this.playAt(prevIdx);
      }
    }

    async setVolume(val) {
      this.volume = Math.max(0, Math.min(1, Number(val)));
      if (isNative) {
        await TalkMedia.setVolume({ volume: this.volume });
      } else {
        this.audio.volume = this.volume;
      }
    }

    async setShuffle(enabled) {
      this.shuffle = Boolean(enabled);
      if (isNative) {
        await TalkMedia.setShuffle({ enabled: this.shuffle });
      }
    }

    async setRepeat(mode) {
      this.repeat = mode;
      if (isNative) {
        await TalkMedia.setRepeat({ mode });
      }
    }

    async stop() {
      if (isNative) {
        await TalkMedia.stop();
      } else {
        this.audio.pause();
        this.audio.currentTime = 0;
        this.isPlaying = false;
        this._emitWebState();
      }
    }

        async fetchServerTracks(search = '') {
      const url = `/api/songs${search ? `?q=${encodeURIComponent(search)}` : ''}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Server mahnıları yüklənə bilmədi');
      const data = await res.json();
      this.serverTracks = data.songs || [];
      return this.serverTracks;
    }

    async uploadSong(fileInput, metadata = {}) {
      const formData = new FormData();
      formData.append('audio', fileInput);
      formData.append('title', metadata.title || fileInput.name);
      formData.append('artist', metadata.artist || 'Naməlum');

      const res = await fetch('/api/songs/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });

      if (!res.ok) throw new Error('Mahnı yüklənə bilmədi');
      
      const data = await res.json();
      // Yükləndikdən sonra server mahnı siyahısını avtomatik yeniləyək:
      await this.fetchServerTracks();
      return data;
    }
  }

  window.TalkPlayer = new TalkPlayerController();
})();
