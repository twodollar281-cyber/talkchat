// Owner Server Musiqi Yükləmə və İdarəetmə Modulu (Aqil Kərimov / DevQrxyz)
(function () {
  async function uploadServerSong(formData) {
    const res = await fetch('/api/admin/songs', {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Yükləmə xətası');
    return data.song;
  }

  async function updateServerSong(songId, payload) {
    const res = await fetch(`/api/admin/songs/${encodeURIComponent(songId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Yeniləmə xətası');
    return data.song;
  }

  async function deleteServerSong(songId) {
    const res = await fetch(`/api/admin/songs/${encodeURIComponent(songId)}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Silmə xətası');
    return true;
  }

  window.TalkServerSongs = {
    uploadServerSong,
    updateServerSong,
    deleteServerSong
  };
})();
