const COOKIE_DEFAULTS = {
  "selected_channels": [],
  "SORT": "1", "CSORT": "0", "TIMESPAN": "2", "EPGSTART": "0", "THEME": "0", "UUID": "None",
  "SUUID": "", "CLASHDET": "0", "TVH_URL": "", "REFR": "", "HOME": "now", "PREVIEW_PLAYER": "external",
  "VLC_HELPER": "1", "VLC_HELPER_PORT": "8765", "VLC_FULLSCREEN": "1", "VLC_STOP_ON_MENU": "0"
};

var WHATSON_TITLE_MAX_CHARS = 20;

function escape_html_text(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function whatson_epg_title_html(title) {
  if (!title) return '<div class="epg_title"></div>';
  var raw = String(title);
  var esc = escape_html_text(raw);
  if (raw.length <= WHATSON_TITLE_MAX_CHARS) {
    return '<div class="epg_title">' + esc + '</div>';
  }
  return '<div class="epg_title" title="' + esc + '">' + esc.slice(0, WHATSON_TITLE_MAX_CHARS) + '…</div>';
}

var VLC_PLUGIN_MIME = 'application/x-vlc-plugin';

function get_cookies() {
  const n = "TVHadmin";
  let ret;
  if (ret = localStorage.getItem(n)) {
    return Object.assign({}, COOKIE_DEFAULTS, JSON.parse(decodeURIComponent(ret)));
  }
  try {
    var b = document.cookie.match('(^|;)\\s*' + n + '\\s*=\\s*([^;]+)');
    var c = b ? b.pop() : '';
    localStorage.setItem(n, c);
    return Object.assign({}, COOKIE_DEFAULTS, JSON.parse(decodeURIComponent(c)));
  }
  catch {
    return Object.assign({}, COOKIE_DEFAULTS);
  }
}

function save_settings(formData) {
  const merged = Object.assign({}, COOKIE_DEFAULTS, cookies, formData);
  localStorage.setItem('TVHadmin', encodeURIComponent(JSON.stringify(merged)));
  Object.assign(cookies, merged);
}

var cookies = get_cookies();
var link = document.createElement('link');
link.rel = 'stylesheet';
link.type = 'text/css';
function show_body() {
  document.body.style.display = 'block';
}
link.onload = show_body;
link.onerror = show_body;
setTimeout(show_body, 100);
if (cookies.THEME == 1) link.href = 'style.dark.css';
else if (cookies.THEME == 2) link.href = 'style.blue.css';
else link.href = 'style.css';
document.head.appendChild(link);

function get_api_base() {
  if (location.protocol === 'file:') {
    if (cookies.TVH_URL) return cookies.TVH_URL.replace(/\/$/, '');
    return '';
  }
  if (location.pathname.includes('/static/')) return '';
  if (cookies.TVH_URL) return cookies.TVH_URL.replace(/\/$/, '');
  return '';
}

function is_tvh_embedded() {
  return location.pathname.includes('/static/');
}

function tvh_configured() {
  return is_tvh_embedded() || !!get_api_base();
}

function is_cross_origin_url(url) {
  try {
    const u = new URL(url, location.href);
    return u.origin !== location.origin;
  } catch (e) {
    return false;
  }
}

function set_video_stream_attrs(video, url) {
  if (!video) return;
  /* Same-origin /static/ + /stream/ must not use crossOrigin or Pale Moon/Firefox treat it as CORS and fail. */
  if (is_cross_origin_url(url)) {
    video.crossOrigin = 'use-credentials';
  } else {
    video.removeAttribute('crossorigin');
  }
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = false;
}

function is_tvh_stream_url(url) {
  const p = preview_base_url(url);
  return /\/stream\/(channel|service|channelid|channelnumber|channelname|file)\b/i.test(p) ||
    /\/play\/ticket\/(stream\/|dvrfile\/)/i.test(p);
}

function is_live_preview(url, type) {
  if (type === 'recording') return false;
  return is_tvh_stream_url(url);
}

function api_url(path) {
  return get_api_base() + path;
}

function tvh_url(path) {
  if (!path) return '';
  if (path[0] !== '/') path = '/' + path;
  return api_url(path);
}

function fetch_opts() {
  if (tvh_configured()) return {credentials: 'include'};
  return {};
}

function dvr_config_query() {
  if (cookies.UUID && cookies.UUID !== 'None') {
    return '&config_uuid=' + encodeURIComponent(cookies.UUID);
  }
  return '';
}

function browser_supports_h264_mp4() {
  var v = document.createElement('video');
  if (!v.canPlayType) return false;
  var mp4 = v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
  return mp4 === 'probably' || mp4 === 'maybe';
}

function browser_supports_h264_matroska() {
  var v = document.createElement('video');
  if (!v.canPlayType) return false;
  var mkv = v.canPlayType('video/x-matroska; codecs="avc1.42E01E, mp4a.40.2"');
  return mkv === 'probably' || mkv === 'maybe';
}

function show_codec_hint() {
  if (preview_player_mode() === 'external' || preview_player_mode() === 'vlc') return;
  if (browser_supports_h264_mp4()) return;
  if (document.getElementById('tvh-codec-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'tvh-codec-banner';
  banner.textContent = 'This browser cannot play H.264 MP4. On the Pi install ffmpeg/libavcodec for Pale Moon, or open streams in VLC. TVHeadend profile: webtv-h264-vorbis-mp4 or webtv-h264-aac-matroska.';
  document.body.appendChild(banner);
}

function current_preview_stream_url() {
  const video = document.getElementById('live-preview');
  if (video && video.src) return preview_base_url(video.src);
  const uuid = sessionStorage.getItem('preview_uuid');
  const type = sessionStorage.getItem('preview_type') || 'channel';
  if (!uuid) return null;
  return build_preview_url(uuid, type);
}

function dismiss_vlc_launch_hint() {
  const el = document.getElementById('tvh-vlc-hint');
  if (el) el.remove();
}

function vlc_helper_enabled() {
  return cookies.VLC_HELPER !== '0' && cookies.VLC_HELPER !== '';
}

function vlc_helper_base() {
  if (!vlc_helper_enabled()) return null;
  var port = parseInt(cookies.VLC_HELPER_PORT || '8765', 10);
  if (!port || port < 1 || port > 65535) port = 8765;
  return 'http://127.0.0.1:' + port;
}

function show_vlc_launch_hint(absUrl, mode) {
  dismiss_vlc_launch_hint();
  const safe = String(absUrl).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const hint = document.createElement('div');
  hint.id = 'tvh-vlc-hint';
  var body = '';
  if (mode === 'helper') {
    body =
      '<div class="tvh-vlc-hint-title">VLC started</div>' +
      '<div class="tvh-vlc-hint-text"><b>Backspace</b> switches TV menu ↔ VLC (video keeps playing). In the menu: <b>Enter</b> opens a page, <b>→</b> goes to the channel list. Start the <b>TVHadmin VLC</b> app on the Pi.</div>';
  } else if (mode === 'helper-missing') {
    body =
      '<div class="tvh-vlc-hint-title">VLC helper not running</div>' +
      '<div class="tvh-vlc-hint-text">On the Pi, start: <code>sh scripts/start-vlc-helper.sh</code> then press Play again.</div>' +
      '<div class="tvh-vlc-hint-text">Downloaded <b>tvhadmin-play.m3u</b> as fallback — open in VLC.</div>';
  } else {
    body =
      '<div class="tvh-vlc-hint-title">Play in VLC</div>' +
      '<div class="tvh-vlc-hint-text">Open <b>tvhadmin-play.m3u</b> with VLC, or Media → Open Network Stream:</div>';
  }
  hint.innerHTML = body +
    '<code class="tvh-vlc-hint-cmd">' + safe + '</code>' +
    '<div class="tvh-vlc-hint-text">Terminal: vlc --fullscreen --one-instance \'' + String(absUrl).replace(/'/g, "'\\''") + '\'</div>' +
    '<button type="button" class="tvh-vlc-hint-close">Dismiss</button>';
  document.body.appendChild(hint);
  hint.querySelector('.tvh-vlc-hint-close').addEventListener('click', dismiss_vlc_launch_hint);
  setTimeout(dismiss_vlc_launch_hint, mode === 'helper' ? 5000 : 14000);
}

function download_vlc_m3u_playlist(absUrl, label) {
  var title = String(label || 'TVHadmin').replace(/[\r\n#]/g, ' ').trim();
  var m3u = '#EXTM3U\n#EXTINF:-1,' + title + '\n' + absUrl + '\n';
  var blob = new Blob([m3u], { type: 'audio/x-mpegurl' });
  var blobUrl = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = blobUrl;
  a.download = 'tvhadmin-play.m3u';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function() { URL.revokeObjectURL(blobUrl); }, 2000);
}

async function launch_external_vlc(streamUrl, label) {
  if (!streamUrl) return;
  var abs = absolute_stream_url(streamUrl);
  if (/^https:/i.test(abs)) abs = abs.replace(/^https:/i, 'http:');
  log_preview_issue('external-vlc', label || 'Play in VLC', abs);

  var helper = vlc_helper_base();
  if (helper) {
    try {
      var q = helper + '/play?url=' + encodeURIComponent(abs);
      if (label) q += '&title=' + encodeURIComponent(String(label).slice(0, 200));
      if (cookies.VLC_FULLSCREEN === '0') q += '&fullscreen=0';
      const response = await fetch(q, { method: 'GET', mode: 'cors', cache: 'no-store' });
      if (response.ok) {
        show_vlc_launch_hint(abs, 'helper');
        return;
      }
      log_preview_issue('external-vlc', 'helper HTTP ' + response.status, abs);
    } catch (e) {
      log_preview_issue('external-vlc', 'helper: ' + (e.message || e), helper);
    }
  }

  try {
    download_vlc_m3u_playlist(abs, label);
  } catch (e) {
    log_preview_issue('external-vlc', 'm3u download: ' + (e.message || e), abs);
  }
  show_vlc_launch_hint(abs, helper ? 'helper-missing' : 'm3u');
}

function open_external_player() {
  const url = current_preview_stream_url();
  if (!url) return;
  launch_external_vlc(url, 'Open stream');
}

function sync_layout_for_preview_player() {
  var external = preview_player_mode() === 'external';
  if (external) document.body.classList.add('layout-no-preview');
  else document.body.classList.remove('layout-no-preview');
}

function show_tvh_error(message) {
  if (document.getElementById('tvh-error-banner')) {
    document.getElementById('tvh-error-banner').textContent = message;
    return;
  }
  const banner = document.createElement('div');
  banner.id = 'tvh-error-banner';
  banner.textContent = message;
  document.body.appendChild(banner);
}

async function check_tvh_connection() {
  if (!tvh_configured()) {
    show_tvh_error('TVHeadend not configured. Install this folder under TVHeadend static as TVHadmin-JS, or set the Server URL on Config.');
    return false;
  }
  try {
    const response = await fetch(api_url('/api/serverinfo'), fetch_opts());
    if (response.status === 401 || response.status === 403) {
      const base = get_api_base() || location.origin;
      show_tvh_error('Not logged in to TVHeadend. Open ' + base + ' in this browser, sign in, then reload TVHadmin.');
      return false;
    }
    if (!response.ok) {
      show_tvh_error('TVHeadend returned HTTP ' + response.status + '. Check you are using http://SERVER:9981/static/TVHadmin-JS/TVHadmin.html');
      return false;
    }
    return true;
  } catch (e) {
    show_tvh_error('Cannot reach TVHeadend. Check the server is running and the URL in Config is correct.');
    return false;
  }
}

window.addEventListener('load',function() {
  init_layout();
  init_navigation();
  check_tvh_connection();
},false);

function init_layout() {
  const layout = document.getElementById('layout');
  if (!layout) return;
  let main = layout.querySelector('#main-panel');
  if (!main) {
    main = document.createElement('div');
    main.id = 'main-panel';
    while (layout.firstChild) {
      main.appendChild(layout.firstChild);
    }
    layout.appendChild(main);
  }
  if (!layout.querySelector('#video-panel')) {
    const panel = document.createElement('div');
    panel.id = 'video-panel';
    panel.innerHTML = '<div class="video-placeholder">Select a channel to preview</div><div id="vlc-preview-host"></div><video id="live-preview" controls playsinline></video><div id="spectrum-analyzer"></div><div id="radio-now-playing"><div class="radio-info"><div class="radio-channel"></div><div class="radio-title"></div><div class="radio-subtitle"></div></div><div class="radio-time"></div></div><a href="#" id="open-external-player" class="open-external-player">Open stream in VLC / player</a>';
    layout.appendChild(panel);
    const video = document.getElementById('live-preview');
    if (video) video.style.display = 'none';
  }
  if (layout.dataset.layoutReady === '1') return;
  layout.dataset.layoutReady = '1';
  init_preview_persist();
  init_spectrum();
  init_menu_overlay();
  sync_layout_for_preview_player();
  init_vlc_hotkey_poll();
  show_codec_hint();
  const ext = document.getElementById('open-external-player');
  if (ext) {
    ext.addEventListener('click', function(e) {
      e.preventDefault();
      open_external_player();
    });
  }
  restore_stored_preview();
}

async function restore_stored_preview() {
  if (preview_player_mode() === 'external') return;
  if (sessionStorage.getItem('preview_active') !== '1') return;
  const uuid = sessionStorage.getItem('preview_uuid');
  const name = sessionStorage.getItem('preview_name') || '';
  const type = sessionStorage.getItem('preview_type') || 'channel';
  const live = sessionStorage.getItem('preview_live') === '1';
  const time = live ? 0 : parseFloat(sessionStorage.getItem('preview_time') || '0');
  let url = null;
  if (uuid) {
    await ensure_stream_profile();
    url = build_preview_url(uuid, type);
  }
  if (!url) url = sessionStorage.getItem('preview_url');
  const video = document.getElementById('live-preview');
  if (!video || !url) return;
  play_preview(video, name, url, time, uuid);
}

var PREVIEW_KEYS = ['preview_active', 'preview_url', 'preview_name', 'preview_uuid', 'preview_type', 'preview_time', 'preview_live'];

function preview_base_url(url) {
  return (url || '').split('#')[0];
}

function is_seekable_preview(url) {
  return /\.(mp3|m4a|ogg|wav|flac|mp4|mkv|webm)(\?|$)/i.test(preview_base_url(url));
}

function build_preview_src(url, time) {
  const base = preview_base_url(url);
  if (time > 0 && is_seekable_preview(base)) {
    return base + '#t=' + time.toFixed(3);
  }
  return base;
}

function store_preview_channel(uuid, name, url, time, type) {
  sessionStorage.setItem('preview_active', '1');
  sessionStorage.setItem('preview_uuid', uuid || '');
  sessionStorage.setItem('preview_name', name || '');
  sessionStorage.setItem('preview_url', url ? preview_base_url(url) : '');
  sessionStorage.setItem('preview_time', String(time || 0));
  sessionStorage.setItem('preview_type', type || 'channel');
  sessionStorage.setItem('preview_live', is_live_preview(url, type) ? '1' : '0');
}

function save_preview_position() {
  if (sessionStorage.getItem('preview_active') !== '1') return;
  const video = document.getElementById('live-preview');
  if (!video || !video.src) return;
  const url = preview_base_url(video.src);
  const live = sessionStorage.getItem('preview_live') === '1' || is_live_preview(url, sessionStorage.getItem('preview_type'));
  sessionStorage.setItem('preview_url', url);
  if (!live) sessionStorage.setItem('preview_time', String(video.currentTime || 0));
}

function clear_preview_state() {
  PREVIEW_KEYS.forEach(function(key) {
    sessionStorage.removeItem(key);
  });
}

function store_pending_record(info) {
  if (!info || !info.eventId) return;
  sessionStorage.setItem('pending_record', JSON.stringify({
    eventId: String(info.eventId),
    uuid: info.uuid || '',
    channel: info.channel || '',
    title: info.title || '',
    subtitle: info.subtitle || ''
  }));
}

function get_pending_record() {
  try {
    const raw = sessionStorage.getItem('pending_record');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clear_pending_record() {
  sessionStorage.removeItem('pending_record');
}

async function start_pending_recording() {
  const pending = get_pending_record();
  if (!pending || !pending.eventId) {
    alert('Play a show first, then use Start Recording here.');
    return false;
  }
  await ensure_recording_profile();
  try {
    const response = await fetch(
      api_url(`/api/dvr/entry/create_by_event?event_id=${pending.eventId}${dvr_config_query()}`),
      fetch_opts()
    );
    if (response.ok) {
      clear_pending_record();
      return true;
    }
  } catch (e) {}
  alert('Could not start recording.');
  return false;
}

function play_channel_with_pending(uuid, name, recordInfo) {
  if (recordInfo && recordInfo.eventId) store_pending_record(recordInfo);
  preview_channel(uuid, name);
}

function init_preview_persist() {
  if (window._preview_persist) return;
  window._preview_persist = true;
  window.addEventListener('pagehide', save_preview_position);
  window.addEventListener('beforeunload', save_preview_position);
}

var channel_info_cache = {};
var radio_tag_ids = [];

function cache_channels(list) {
  if (!list) return;
  list.forEach(function(ch) {
    channel_info_cache[ch.uuid] = ch;
  });
}

async function load_radio_tag_ids() {
  const tags = await fetch_json('/api/channeltag/list');
  if (!tags || !tags.entries) return;
  radio_tag_ids = tags.entries.filter(function(tag) {
    return /\bradio\b/i.test(tag.val || '');
  }).map(function(tag) {
    return tag.key;
  });
}

function channel_is_radio(ch) {
  if (!ch) return false;
  if (/\bradio\b|\bfm\b|\bdab\b/i.test(ch.name || '')) return true;
  if (ch.tags && radio_tag_ids.length) {
    for (let i = 0; i < ch.tags.length; i++) {
      if (radio_tag_ids.indexOf(ch.tags[i]) >= 0) return true;
    }
  }
  return false;
}

function is_radio_channel(name, uuid) {
  if (uuid && channel_info_cache[uuid]) return channel_is_radio(channel_info_cache[uuid]);
  return /\bradio\b|\bfm\b|\bdab\b|bbc sounds/i.test(name || '');
}

function should_use_radio_layout(forceRadio) {
  if (forceRadio === true) return true;
  if (forceRadio === false) return false;
  const uuid = sessionStorage.getItem('preview_uuid');
  const name = sessionStorage.getItem('preview_name') || '';
  return is_radio_channel(name, uuid);
}

var DEFAULT_STREAM_PROFILES = [
  { val: 'webtv-h264-aac-mp4', key: '' },
  { val: 'webtv-h264-aac-matroska', key: '' },
  { val: 'webtv-h264-vorbis-mp4', key: '' },
  { val: 'matroska', key: '' },
  { val: 'audio', key: '' },
  { val: 'pass', key: '' }
];

var cached_stream_profile_vals = null;

var BROWSER_STREAM_PROFILES = [
  'webtv-h264-aac-matroska',
  'webtv-h264-vorbis-matroska',
  'matroska',
  'webtv-h264-aac-mp4',
  'webtv-h264-vorbis-mp4',
  'audio'
];

var preview_generation = 0;

function is_heavy_or_unsafe_browser_profile(p) {
  if (!p) return false;
  var lower = String(p).toLowerCase();
  if (/vp8|webm/.test(lower)) return true;
  if (lower === 'pass' || /mpegts|^ts$/.test(lower)) return true;
  return false;
}

function browser_can_use_stream_profile(p) {
  if (!p || p === 'audio') return true;
  var lower = String(p).toLowerCase();
  if (lower.indexOf('matroska') !== -1 || lower === 'matroska') {
    return browser_supports_h264_matroska() || browser_supports_h264_mp4();
  }
  if (lower.indexOf('mp4') !== -1) return browser_supports_h264_mp4();
  return !is_heavy_or_unsafe_browser_profile(p);
}

function best_browser_stream_profile_hint() {
  const available = cached_stream_profile_vals || [];
  for (let i = 0; i < BROWSER_STREAM_PROFILES.length; i++) {
    var hint = BROWSER_STREAM_PROFILES[i];
    if (available.indexOf(hint) !== -1 && browser_can_use_stream_profile(hint)) return hint;
  }
  for (let j = 0; j < available.length; j++) {
    if (!is_heavy_or_unsafe_browser_profile(available[j])) return available[j];
  }
  return 'webtv-h264-vorbis-mp4';
}

function pick_stream_profile(name, uuid) {
  const available = cached_stream_profile_vals || [];
  function has(p) {
    return p && available.indexOf(p) !== -1;
  }
  if (cookies.SUUID && has(cookies.SUUID)) return cookies.SUUID;
  if (is_radio_channel(name, uuid) && has('audio')) return 'audio';
  for (let i = 0; i < BROWSER_STREAM_PROFILES.length; i++) {
    var cand = BROWSER_STREAM_PROFILES[i];
    if (has(cand) && browser_can_use_stream_profile(cand)) return cand;
  }
  for (let j = 0; j < available.length; j++) {
    if (!is_heavy_or_unsafe_browser_profile(available[j])) return available[j];
  }
  return '';
}

function pick_vlc_stream_profile(name, uuid) {
  const available = cached_stream_profile_vals || [];
  function has(p) {
    return p && available.indexOf(p) !== -1;
  }
  if (is_radio_channel(name, uuid) && has('audio')) return 'audio';
  if (has('pass')) return 'pass';
  if (has('matroska')) return 'matroska';
  if (cookies.SUUID && has(cookies.SUUID)) {
    var s = cookies.SUUID;
    if (s === 'audio' || s === 'pass' || s === 'matroska') return s;
  }
  if (has('webtv-h264-aac-matroska')) return 'webtv-h264-aac-matroska';
  if (has('webtv-h264-vorbis-matroska')) return 'webtv-h264-vorbis-matroska';
  for (let j = 0; j < available.length; j++) {
    if (!/^webtv-vp8|vp8|webm/i.test(available[j])) return available[j];
  }
  return '';
}

function vlc_plugin_detected() {
  try {
    if (navigator.mimeTypes && navigator.mimeTypes[VLC_PLUGIN_MIME] && navigator.mimeTypes[VLC_PLUGIN_MIME].enabledPlugin) {
      return true;
    }
    if (navigator.plugins) {
      for (let i = 0; i < navigator.plugins.length; i++) {
        const plug = navigator.plugins[i];
        if (!plug) continue;
        for (let j = 0; j < plug.length; j++) {
          if (plug[j].type === VLC_PLUGIN_MIME) return true;
        }
      }
    }
  } catch (e) {}
  return false;
}

function preview_player_mode() {
  const pref = cookies.PREVIEW_PLAYER || 'external';
  if (pref === 'html5') return 'html5';
  if (pref === 'vlc') return 'vlc';
  if (pref === 'auto') return vlc_plugin_detected() ? 'vlc' : 'html5';
  return 'external';
}

function escape_html_attr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function absolute_stream_url(streamUrl) {
  if (!streamUrl) return streamUrl;
  if (/^https?:\/\//i.test(streamUrl)) return streamUrl;
  try {
    return new URL(streamUrl, location.href).href;
  } catch (e) {
    return streamUrl;
  }
}

function ensure_vlc_preview_host() {
  let host = document.getElementById('vlc-preview-host');
  if (host) return host;
  const panel = document.getElementById('video-panel');
  if (!panel) return null;
  host = document.createElement('div');
  host.id = 'vlc-preview-host';
  const video = document.getElementById('live-preview');
  if (video && video.parentNode === panel) panel.insertBefore(host, video);
  else panel.appendChild(host);
  return host;
}

function vlc_get_embed() {
  return document.getElementById('vlc-preview-embed') || document.getElementById('vlc-preview-obj');
}

function stop_vlc_preview() {
  const host = document.getElementById('vlc-preview-host');
  if (!host) return;
  const vlc = vlc_get_embed();
  if (vlc) {
    try {
      if (vlc.playlist) {
        vlc.playlist.stop();
        vlc.playlist.clear();
      }
    } catch (e) {}
  }
  host.innerHTML = '';
  host.style.display = 'none';
}

function vlc_play_stream(vlc, streamUrl) {
  if (!vlc || !streamUrl) return false;
  const url = absolute_stream_url(streamUrl);
  try {
    if (vlc.playlist && vlc.playlist.add) {
      vlc.playlist.stop();
      if (vlc.playlist.clear) vlc.playlist.clear();
      vlc.playlist.add(url);
      vlc.playlist.play();
      return true;
    }
  } catch (e) {
    log_preview_issue('vlc', 'playlist API: ' + (e.message || e), url);
  }
  return false;
}

function vlc_input_state(vlc) {
  try {
    if (vlc && vlc.input && typeof vlc.input.state !== 'undefined') return vlc.input.state;
  } catch (e) {}
  return -1;
}

function play_preview_with_vlc(streamUrl, playId, placeholder, profileName, name, channelUuid, type) {
  const host = ensure_vlc_preview_host();
  const video = document.getElementById('live-preview');
  if (!host || !streamUrl) {
    show_preview_error_message('VLC preview container missing.', 'config');
    return;
  }
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.style.display = 'none';
  }
  stop_vlc_preview();
  host.style.display = 'block';
  if (placeholder) {
    placeholder.style.display = 'block';
    placeholder.textContent = 'Loading in VLC plugin… (' + (profileName || 'stream') + ')';
  }

  const fullUrl = absolute_stream_url(streamUrl);
  host.innerHTML =
    '<object type="' + VLC_PLUGIN_MIME + '" id="vlc-preview-obj" width="100%" height="100%">' +
    '<embed type="' + VLC_PLUGIN_MIME + '" id="vlc-preview-embed" name="vlc" width="100%" height="100%" ' +
    'pluginspage="https://www.videolan.org/" version="VideoLAN.VLCPlugin.2" ' +
    'target="' + escape_html_attr(fullUrl) + '" autoplay="yes" controls="yes" toolbar="yes" loop="no" /></object>';

  var loggedError = false;
  var stallTimer = setTimeout(function() {
    if (playId !== preview_generation) return;
    const vlc = vlc_get_embed();
    const st = vlc_input_state(vlc);
    if (st === 3 || st === 2) {
      if (placeholder) placeholder.style.display = 'none';
      return;
    }
    if (!loggedError) {
      loggedError = true;
      var msg = 'VLC plugin did not start playback.';
      if (!vlc_plugin_detected()) {
        msg += ' Pale Moon needs the old VLC NPAPI plugin (VLC 3.x — removed in VLC 4). Install vlc-plugin-base or use Preview player → HTML5 / Open stream in VLC.';
      } else {
        msg += ' Check stream profile (pass or matroska often work). Try buttons below or open in standalone VLC.';
      }
      log_preview_issue('vlc', msg, fullUrl);
      show_preview_error_message(msg, 'vlc', preview_alternate_stream_profiles(profileName));
      host.style.display = 'none';
    }
  }, 20000);

  function finishIfPlaying() {
    if (playId !== preview_generation) return;
    const vlc = vlc_get_embed();
    const st = vlc_input_state(vlc);
    if (st === 3) {
      clearTimeout(stallTimer);
      if (placeholder) placeholder.style.display = 'none';
    }
  }

  setTimeout(function() {
    if (playId !== preview_generation) return;
    const vlc = vlc_get_embed();
    if (!vlc_play_stream(vlc, streamUrl)) finishIfPlaying();
    else {
      setTimeout(finishIfPlaying, 1500);
      setTimeout(finishIfPlaying, 5000);
    }
  }, 300);

  if (is_radio_channel(name, channelUuid)) {
    show_radio_now_playing(name, null);
  } else {
    hide_radio_now_playing();
  }
}

function stop_preview_stream(video) {
  stop_vlc_preview();
  if (!video) return;
  video.pause();
  try {
    video.removeAttribute('src');
    video.load();
  } catch (e) {}
  video._amConnected = false;
}

async function get_stream_profiles() {
  const profiles = await fetch_json('/api/profile/list');
  if (profiles && profiles.entries && profiles.entries.length) {
    cached_stream_profile_vals = profiles.entries.map(function(p) { return p.val; });
    return profiles.entries;
  }
  cached_stream_profile_vals = DEFAULT_STREAM_PROFILES.map(function(p) { return p.val; });
  return DEFAULT_STREAM_PROFILES.slice();
}

async function ensure_recording_profile() {
  if (cookies.UUID && cookies.UUID !== 'None') return;
  const profiles = await fetch_json('/api/dvr/config/grid');
  if (!profiles || !profiles.entries || !profiles.entries.length) return;
  const enabled = profiles.entries.find(function(p) { return p.enabled !== false; });
  cookies.UUID = enabled ? enabled.uuid : profiles.entries[0].uuid;
}

async function sync_channel_tag_settings() {
  const tags = await fetch_json('/api/channeltag/list');
  if (!tags || !tags.entries) return;
  const updates = {};
  tags.entries.forEach(function(tag) {
    const key = 'Tag_' + tag.val;
    if (!(key in cookies)) updates[key] = tag.val;
  });
  if (Object.keys(updates).length) save_settings(updates);
}

async function ensure_stream_profile() {
  const profiles = await get_stream_profiles();
  if (!profiles.length) return;
  if (cookies.SUUID && cached_stream_profile_vals && cached_stream_profile_vals.indexOf(cookies.SUUID) === -1) {
    cookies.SUUID = '';
  }
  if (cookies.SUUID && is_heavy_or_unsafe_browser_profile(cookies.SUUID)) {
    cookies.SUUID = '';
    save_settings({ SUUID: '' });
  }
  if (cookies.SUUID) return;
  const picked = best_browser_stream_profile_hint();
  if (cached_stream_profile_vals.indexOf(picked) !== -1) {
    cookies.SUUID = picked;
    return;
  }
  const safe = cached_stream_profile_vals.find(function(p) {
    return !is_heavy_or_unsafe_browser_profile(p);
  });
  cookies.SUUID = safe || cached_stream_profile_vals[0] || '';
}

function log_preview_issue(kind, detail, streamUrl) {
  try {
    console.warn('[TVHadmin preview]', kind + ':', detail, streamUrl || '');
  } catch (e) {}
}

function describe_play_rejection(err) {
  if (!err) return 'Playback blocked (browser refused to play). Click the video controls or try again.';
  if (err.name === 'NotAllowedError') return 'Autoplay blocked — click Play on the video controls.';
  return 'Playback failed: ' + (err.message || err.name || 'unknown');
}

function describe_video_element_error(video, profileName) {
  if (!video || !video.error) {
    return 'Stream failed. TVHeadend libav/AVCodec errors mean the server transcoder failed — not JavaScript. Set Config → Stream Profile to ' + best_browser_stream_profile_hint() + ' and ensure ffmpeg with H.264 works on the Pi.';
  }
  const code = video.error.code;
  const prof = profileName ? (' Profile: ' + profileName + '.') : '';
  switch (code) {
    case 1:
      return 'Playback aborted.' + prof;
    case 2:
      return 'Network error — could not load stream.' + prof + ' Check TVHeadend is running and you are logged in at :9981.';
    case 3:
      return 'Decode error — codec problem.' + prof + ' Server transcode (libav) or browser decode failed.';
    case 4:
      if (!browser_supports_h264_mp4()) {
        return 'Browser codec — Pale Moon on this Pi cannot play H.264 MP4 (install ffmpeg/libavcodec).' + prof;
      }
      return 'Format not supported in browser.' + prof + ' Use webtv-h264-vorbis-mp4 only; avoid matroska/pass.';
    default:
      return (video.error.message || 'Playback error') + prof;
  }
}

function show_preview_error_message(message, kind, retryProfiles) {
  const placeholder = document.querySelector('#video-panel .video-placeholder');
  const video = document.getElementById('live-preview');
  if (placeholder) {
    placeholder.style.display = 'block';
    const label = kind ? String(kind).toUpperCase() : 'PLAYBACK';
    var html = '<div class="preview-error-kind">' + label + '</div><div class="preview-error-text">' + (message || '') + '</div>';
    if (kind === 'vlc' || preview_player_mode() === 'vlc') {
      html += '<div class="preview-error-actions"><button type="button" class="preview-retry-btn" id="preview-use-html5-btn">Try HTML5 player</button></div>';
    }
    if (retryProfiles && retryProfiles.length) {
      html += '<div class="preview-error-actions">';
      for (var ri = 0; ri < retryProfiles.length; ri++) {
        var rp = retryProfiles[ri];
        html += '<button type="button" class="preview-retry-btn" data-profile="' + String(rp).replace(/"/g, '&quot;') + '">Try ' + rp + '</button>';
      }
      html += '</div>';
    }
    placeholder.innerHTML = html;
    const html5Btn = placeholder.querySelector('#preview-use-html5-btn');
    if (html5Btn) html5Btn.addEventListener('click', preview_switch_to_html5);
    placeholder.querySelectorAll('.preview-retry-btn[data-profile]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        preview_retry_with_profile(btn.getAttribute('data-profile'));
      });
    });
  }
  if (video) video.style.display = 'none';
  const vlcHost = document.getElementById('vlc-preview-host');
  if (vlcHost) vlcHost.style.display = 'none';
}

function preview_switch_to_html5() {
  save_settings({ PREVIEW_PLAYER: 'html5' });
  cookies.PREVIEW_PLAYER = 'html5';
  const video = document.getElementById('live-preview');
  const uuid = sessionStorage.getItem('preview_uuid');
  const name = sessionStorage.getItem('preview_name') || '';
  if (video && uuid) play_preview(video, name, null, 0, uuid);
}

function preview_alternate_stream_profiles(currentProfile) {
  const available = cached_stream_profile_vals || [];
  const out = [];
  function add(p) {
    if (!p || p === currentProfile || out.indexOf(p) !== -1) return;
    if (available.length && available.indexOf(p) === -1) return;
    if (is_heavy_or_unsafe_browser_profile(p)) return;
    if (!browser_can_use_stream_profile(p)) return;
    out.push(p);
  }
  if (is_radio_channel(sessionStorage.getItem('preview_name') || '', sessionStorage.getItem('preview_uuid'))) add('audio');
  for (let i = 0; i < BROWSER_STREAM_PROFILES.length; i++) add(BROWSER_STREAM_PROFILES[i]);
  return out.slice(0, 3);
}

function preview_retry_with_profile(profile) {
  const uuid = sessionStorage.getItem('preview_uuid');
  const name = sessionStorage.getItem('preview_name') || '';
  const type = sessionStorage.getItem('preview_type') || 'channel';
  if (!uuid || !profile) return;
  cookies.SUUID = profile;
  save_settings({ SUUID: profile });
  if (preview_player_mode() === 'external') {
    void play_in_external_vlc(uuid, name, type, profile);
    return;
  }
  const video = document.getElementById('live-preview');
  if (!video) return;
  play_preview(video, name, null, 0, uuid, profile);
}

function build_preview_url(uuid, type, profile) {
  if (!uuid) return null;
  if (type === 'recording') {
    return api_url('/stream/file/' + uuid);
  }
  let streamUrl = api_url('/stream/channel/' + uuid);
  const useProfile = profile || cookies.SUUID;
  if (useProfile) streamUrl += '?profile=' + encodeURIComponent(useProfile);
  return streamUrl;
}

/** TVHeadend WebUI-style URL — works in VLC “Open network stream” without browser cookies. */
function build_ticket_play_url(uuid, type, profile, title) {
  if (!uuid) return null;
  type = type || 'channel';
  let path;
  if (type === 'recording') {
    path = '/play/ticket/dvrfile/' + uuid;
  } else {
    path = '/play/ticket/stream/channel/' + uuid;
  }
  const qs = [];
  if (title) qs.push('title=' + encodeURIComponent(title));
  const useProfile = profile || cookies.SUUID;
  if (useProfile) qs.push('profile=' + encodeURIComponent(useProfile));
  return api_url(path) + (qs.length ? '?' + qs.join('&') : '');
}

function parse_m3u_stream_url(body) {
  if (!body || body.indexOf('#EXTM3U') === -1) return null;
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && line.charAt(0) !== '#') return line;
  }
  return null;
}

async function resolve_play_ticket_url(uuid, type, profile, title) {
  const playUrl = build_ticket_play_url(uuid, type, profile, title);
  if (!playUrl || !tvh_configured()) return playUrl;
  const abs = absolute_stream_url(playUrl);
  try {
    const response = await fetch(abs, Object.assign({
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store'
    }, fetch_opts()));
    if (!response.ok) {
      log_preview_issue('ticket', 'HTTP ' + response.status, abs);
      return playUrl;
    }
    const ctype = (response.headers.get('content-type') || '').toLowerCase();
    if (ctype.indexOf('octet-stream') !== -1 || ctype.indexOf('mp2t') !== -1 ||
        (ctype.indexOf('video') !== -1 && ctype.indexOf('mpegurl') === -1)) {
      return playUrl;
    }
    if (ctype.indexOf('mpegurl') !== -1 || ctype.indexOf('m3u') !== -1 || ctype.indexOf('text') !== -1) {
      const text = await response.text();
      const fromM3u = parse_m3u_stream_url(text);
      if (fromM3u) return fromM3u;
    }
    if (response.url && response.url !== abs && /\/stream\//i.test(response.url)) {
      return response.url;
    }
  } catch (e) {
    log_preview_issue('ticket', 'resolve: ' + (e.message || e), abs);
  }
  return playUrl;
}

function play_preview(video, name, url, seekTime, uuid, forceProfile) {
  const placeholder = document.querySelector('#video-panel .video-placeholder');
  stop_spectrum();
  if (!video) return;
  preview_generation++;
  var playId = preview_generation;
  stop_preview_stream(video);

  const type = sessionStorage.getItem('preview_type') || 'channel';
  const channelUuid = uuid || sessionStorage.getItem('preview_uuid');
  if (!url && !channelUuid) return;

  const live = sessionStorage.getItem('preview_live') === '1' || is_live_preview(url, type);
  const time = live ? 0 : (Number(seekTime) || 0);
  const seekable = !live && url && is_seekable_preview(url);
  const playerMode = preview_player_mode();
  var profileName = (type !== 'recording' && channelUuid)
    ? (playerMode === 'vlc' ? pick_vlc_stream_profile(name, channelUuid) : pick_stream_profile(name, channelUuid))
    : (cookies.SUUID || '');
  if (forceProfile) profileName = forceProfile;
  let streamUrl = null;
  if (type !== 'recording' && channelUuid) {
    streamUrl = build_preview_url(channelUuid, type, profileName);
  } else if (url) {
    streamUrl = url;
  } else if (channelUuid) {
    streamUrl = build_preview_url(channelUuid, type, profileName);
  }
  if (!streamUrl) {
    show_preview_error_message('No stream URL or profile.', 'config');
    return;
  }

  if (playerMode === 'vlc') {
    play_preview_with_vlc(streamUrl, playId, placeholder, profileName, name, channelUuid, type);
    return;
  }

  if (is_heavy_or_unsafe_browser_profile(profileName) && type !== 'recording') {
    show_preview_error_message('Stream profile "' + profileName + '" often breaks the Pi transcoder. In Config choose webtv-h264-vorbis-mp4 or audio (radio).', 'transcode');
    return;
  }

  var started = false;
  var ready = false;
  var stallTimer = null;
  var loggedError = false;

  function clear_stall_timer() {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = null;
    }
  }

  function show_error(message, kind) {
    if (playId !== preview_generation) return;
    if (!loggedError) {
      loggedError = true;
      log_preview_issue(kind || 'playback', message, streamUrl);
    }
    var retries = (type !== 'recording' && channelUuid) ? preview_alternate_stream_profiles(profileName) : [];
    show_preview_error_message(message, kind, retries);
  }

  function playNow() {
    if (playId !== preview_generation || started) return;
    started = true;
    clear_stall_timer();
    video.play().then(function() {
      if (playId !== preview_generation) return;
      if (placeholder) placeholder.style.display = 'none';
      connect_spectrum(video, is_radio_channel(name, channelUuid));
    }).catch(function(err) {
      if (playId !== preview_generation) return;
      show_error(describe_play_rejection(err), 'browser');
      connect_spectrum(video, is_radio_channel(name, channelUuid));
    });
  }

  function seekAndPlay() {
    if (!seekable || time <= 0) {
      playNow();
      return;
    }
    function onSeeked() {
      video.removeEventListener('seeked', onSeeked);
      playNow();
    }
    video.addEventListener('seeked', onSeeked);
    try {
      if (Math.abs(video.currentTime - time) > 0.05) video.currentTime = time;
      else playNow();
    } catch (e) {
      playNow();
    }
    setTimeout(playNow, 400);
  }

  function onReady() {
    if (playId !== preview_generation || ready) return;
    ready = true;
    video.removeEventListener('loadedmetadata', onReady);
    seekAndPlay();
  }

  if (placeholder) {
    placeholder.style.display = 'block';
    placeholder.textContent = 'Loading… (' + (profileName || 'stream') + ')';
  }
  video.style.display = 'block';
  set_video_stream_attrs(video, streamUrl);
  video._amConnected = false;
  video.src = build_preview_src(streamUrl, seekable ? time : 0);

  stallTimer = setTimeout(function() {
    if (playId !== preview_generation || (started && video.readyState >= 2)) return;
    show_error(
      'No video/audio after 20s. If TVHeadend shows libav errors, the Pi transcoder failed — try a Matroska profile below (often remux only), or Open stream in VLC.',
      'transcode'
    );
  }, 20000);

  function onError() {
    if (playId !== preview_generation) return;
    video.removeEventListener('error', onError);
    clear_stall_timer();
    var msg = describe_video_element_error(video, profileName);
    show_error(msg, video.error && video.error.code === 4 ? 'codec' : 'transcode');
  }

  function onPlaying() {
    if (playId !== preview_generation) return;
    video.removeEventListener('playing', onPlaying);
    clear_stall_timer();
    if (placeholder) placeholder.style.display = 'none';
  }

  video.addEventListener('error', onError);
  video.addEventListener('playing', onPlaying);
  video.addEventListener('loadedmetadata', onReady);
  if (video.readyState >= 1) onReady();
}

var audio_motion = null;

var SPECTRUM_PRESET = {
  alphaBars: false,
  barSpace: 0.2,
  bgAlpha: 1,
  channelLayout: 'single',
  colorMode: 'bar-index',
  gradient: 'rainbow',
  ledBars: false,
  lumiBars: false,
  linearBoost: 1.6,
  mode: 6,
  outlineBars: false,
  radial: false,
  reflexRatio: 0.25,
  reflexAlpha: 0.2,
  roundBars: false,
  showPeaks: true,
  fadePeaks: false,
  showScaleX: true,
  showScaleY: false,
  noteLabels: true,
  splitGradient: false,
  start: false
};

function apply_spectrum_preset() {
  if (!audio_motion) return;
  audio_motion.setOptions(SPECTRUM_PRESET);
  audio_motion.setSensitivity(-85, -25);
}

function load_audiomotion() {
  if (document.getElementById('audiomotion-loader')) return;
  const s = document.createElement('script');
  s.type = 'module';
  s.id = 'audiomotion-loader';
  s.src = 'lib/audiomotion-loader.js';
  document.head.appendChild(s);
}

function ensure_audio_motion(cb) {
  function ready() {
    if (!window.AudioMotionAnalyzer) return;
    if (!audio_motion) {
      const el = document.getElementById('spectrum-analyzer');
      if (!el) return;
      el.innerHTML = '';
      audio_motion = new window.AudioMotionAnalyzer(el, SPECTRUM_PRESET);
      apply_spectrum_preset();
    }
    cb();
  }
  if (window.AudioMotionAnalyzer) ready();
  else window.addEventListener('audiomotion-ready', ready, { once: true });
}

function when_audiomotion(cb) {
  ensure_audio_motion(cb);
}

function init_spectrum() {
  load_audiomotion();
  ensure_audio_motion(function() {});
}

function stop_spectrum() {
  const el = document.getElementById('spectrum-analyzer');
  if (el) el.classList.remove('active', 'radio-mode', 'overlay-mode');
  const video = document.getElementById('live-preview');
  const panel = document.getElementById('video-panel');
  if (video) video.style.visibility = '';
  if (panel) panel.classList.remove('radio-playing');
  hide_radio_now_playing();
  if (audio_motion) audio_motion.stop();
}

function apply_spectrum_layout(radio) {
  const el = document.getElementById('spectrum-analyzer');
  const video = document.getElementById('live-preview');
  const panel = document.getElementById('video-panel');
  if (!el || !audio_motion) return;
  el.classList.toggle('radio-mode', radio);
  el.classList.toggle('overlay-mode', !radio);
  if (panel) panel.classList.toggle('radio-playing', radio);
  if (video) video.style.visibility = radio ? 'hidden' : '';
  if (radio) {
    show_radio_now_playing(sessionStorage.getItem('preview_name') || '', video);
  } else {
    hide_radio_now_playing();
  }
  audio_motion.setOptions({
    overlay: !radio,
    bgAlpha: radio ? 1 : 0,
    showBgColor: radio,
    showScaleX: true,
    noteLabels: true
  });
  requestAnimationFrame(function() {
    const h = el.clientHeight || 270;
    const w = el.clientWidth || 640;
    if (h > 0) audio_motion.height = h;
    if (w > 0) audio_motion.width = w;
  });
}

function attach_spectrum_audio(video) {
  if (!audio_motion || !video || !video.src) return false;
  const url = preview_base_url(video.src);
  if (is_cross_origin_url(url)) {
    video.crossOrigin = 'use-credentials';
  } else {
    video.removeAttribute('crossorigin');
  }
  if (!video._amConnected) {
    try {
      audio_motion.connectInput(video);
      audio_motion.connectOutput();
      video._amConnected = true;
    } catch (e) {
      video._amConnected = false;
      log_preview_issue('spectrum', 'Could not connect audio analyser: ' + (e.message || e), url);
      return false;
    }
  }
  if (audio_motion.audioCtx && audio_motion.audioCtx.state === 'suspended') {
    audio_motion.audioCtx.resume();
  }
  return video._amConnected;
}

function connect_spectrum(video, forceRadio) {
  when_audiomotion(function() {
    if (!audio_motion) return;
    const el = document.getElementById('spectrum-analyzer');
    if (!el) return;
    audio_motion.stop();
    el.classList.add('active');

    function refreshLayout() {
      apply_spectrum_layout(should_use_radio_layout(forceRadio));
    }

    if (video && video.src) {
      attach_spectrum_audio(video);
      video.addEventListener('loadedmetadata', refreshLayout);
      video.addEventListener('loadeddata', refreshLayout);
      refreshLayout();
    } else if (should_use_radio_layout(forceRadio)) {
      apply_spectrum_layout(true);
    } else {
      apply_spectrum_layout(false);
    }

    audio_motion.start();
  });
}

var radio_info_timer = null;

function format_play_time(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

function prettify_track_name(url) {
  const path = preview_base_url(url).split('/').pop() || '';
  const base = path.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  if (!base) return 'Unknown Track';
  return base.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}

function id3_syncsafe_size(bytes, off) {
  return ((bytes[off] & 0x7f) << 21) | ((bytes[off + 1] & 0x7f) << 14) | ((bytes[off + 2] & 0x7f) << 7) | (bytes[off + 3] & 0x7f);
}

function decode_id3_text(bytes, offset, size) {
  if (size < 2) return '';
  const enc = bytes[offset];
  const data = bytes.subarray(offset + 1, offset + size);
  let text = '';
  if (enc === 0) text = new TextDecoder('iso-8859-1').decode(data);
  else if (enc === 1) text = new TextDecoder('utf-16').decode(data);
  else if (enc === 2) text = new TextDecoder('utf-16be').decode(data);
  else text = new TextDecoder('utf-8').decode(data);
  return text.replace(/\0/g, '').trim();
}

async function read_mp3_tags(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, 262144));
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
    const ver = bytes[3];
    let offset = 10 + id3_syncsafe_size(bytes, 6);
    const tags = {};
    while (offset + 10 < bytes.length) {
      const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      let size = ver === 4 ? id3_syncsafe_size(bytes, offset + 4)
        : (bytes[offset + 4] << 24) | (bytes[offset + 5] << 16) | (bytes[offset + 6] << 8) | bytes[offset + 7];
      offset += 10;
      if (offset + size > bytes.length) break;
      if (id === 'TIT2' || id === 'TPE1' || id === 'TALB') tags[id] = decode_id3_text(bytes, offset, size);
      offset += size;
    }
    return { title: tags.TIT2 || '', artist: tags.TPE1 || '', album: tags.TALB || '' };
  } catch (e) {
    return null;
  }
}

function channel_name_only(name) {
  return (name || '').replace(/^\d+\s+/, '');
}

async function load_radio_metadata(channelName, url) {
  const live = sessionStorage.getItem('preview_live') === '1' || is_live_preview(url, sessionStorage.getItem('preview_type'));
  const meta = {
    channel: channelName || 'Radio',
    title: prettify_track_name(url),
    subtitle: live ? 'Live broadcast' : 'Live radio'
  };
  const uuid = sessionStorage.getItem('preview_uuid');
  const clean = channel_name_only(channelName);
  try {
    const events = await get_epg_now('');
    const ev = find_epg_now_event(events, { uuid: uuid, name: clean }, channelName);
    if (ev) {
      if (ev.title) meta.title = ev.title;
      if (ev.summary || ev.subtitle || ev.description) {
        meta.subtitle = ev.summary || ev.subtitle || ev.description;
      }
    }
  } catch (e) {}
  if (url && is_seekable_preview(url)) {
    const tags = await read_mp3_tags(url);
    if (tags) {
      if (tags.title) meta.title = tags.title;
      const parts = [];
      if (tags.artist) parts.push(tags.artist);
      if (tags.album) parts.push(tags.album);
      if (parts.length) meta.subtitle = parts.join(' · ');
    }
  }
  return meta;
}

function update_radio_now_playing_time() {
  const panel = document.getElementById('radio-now-playing');
  const video = document.getElementById('live-preview');
  const timeEl = panel && panel.querySelector('.radio-time');
  if (!timeEl || !video || !video.src) return;
  if (sessionStorage.getItem('preview_live') === '1') {
    timeEl.textContent = 'Live';
    return;
  }
  const cur = format_play_time(video.currentTime);
  const dur = video.duration && isFinite(video.duration) ? format_play_time(video.duration) : '';
  timeEl.textContent = dur ? cur + ' / ' + dur : cur;
}

async function refresh_radio_now_playing() {
  const panel = document.getElementById('radio-now-playing');
  if (!panel || !panel.classList.contains('visible')) return;
  const channelName = panel._channel || sessionStorage.getItem('preview_name') || '';
  const video = panel._video || document.getElementById('live-preview');
  const url = video && video.src ? preview_base_url(video.src) : sessionStorage.getItem('preview_url') || '';
  const meta = await load_radio_metadata(channelName, url);
  const ch = panel.querySelector('.radio-channel');
  const title = panel.querySelector('.radio-title');
  const sub = panel.querySelector('.radio-subtitle');
  if (ch) ch.textContent = meta.channel;
  if (title) title.textContent = meta.title;
  if (sub) sub.textContent = meta.subtitle;
  update_radio_now_playing_time();
}

function show_radio_now_playing(channelName, video) {
  const panel = document.getElementById('radio-now-playing');
  if (!panel) return;
  panel.classList.add('visible');
  panel._channel = channelName;
  panel._video = video;
  if (video && !video._radioTimeWatch) {
    video._radioTimeWatch = true;
    video.addEventListener('timeupdate', update_radio_now_playing_time);
    video.addEventListener('loadedmetadata', update_radio_now_playing_time);
  }
  refresh_radio_now_playing();
  if (radio_info_timer) clearInterval(radio_info_timer);
  radio_info_timer = setInterval(refresh_radio_now_playing, 30000);
}

function hide_radio_now_playing() {
  const panel = document.getElementById('radio-now-playing');
  if (panel) panel.classList.remove('visible');
  if (radio_info_timer) {
    clearInterval(radio_info_timer);
    radio_info_timer = null;
  }
}

function start_preview(video, name, url, uuid, type) {
  const placeholder = document.querySelector('#video-panel .video-placeholder');
  stop_spectrum();
  if (!video) return;
  if (placeholder) placeholder.style.display = 'none';

  if (url) {
    store_preview_channel(uuid, name, url, 0, type || 'channel');
    play_preview(video, name, url, 0, uuid);
    return;
  }

  video.style.display = 'none';
  video.removeAttribute('src');
  video._amConnected = false;
  if (is_radio_channel(name, uuid)) {
    sessionStorage.setItem('preview_active', '1');
    sessionStorage.setItem('preview_uuid', uuid || '');
    sessionStorage.setItem('preview_name', name || '');
    sessionStorage.setItem('preview_type', type || 'channel');
    sessionStorage.setItem('preview_live', '1');
    connect_spectrum(null, true);
  } else {
    clear_preview_state();
    if (placeholder) {
      placeholder.style.display = 'block';
      placeholder.textContent = 'Unable to play stream';
    }
  }
}

function is_fullscreen() {
  return !!(document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement);
}

function request_panel_fullscreen(panel) {
  if (!panel) return;
  const fn = panel.requestFullscreen || panel.mozRequestFullScreen || panel.webkitRequestFullscreen;
  if (fn) fn.call(panel).catch(function() {});
}

function exit_panel_fullscreen() {
  if (!is_fullscreen()) return;
  const fn = document.exitFullscreen || document.mozCancelFullScreen || document.webkitExitFullscreen;
  if (fn) fn.call(document).catch(function() {});
}

async function vlc_helper_stop() {
  const helper = vlc_helper_base();
  if (!helper) return;
  try {
    await fetch(helper + '/stop', { method: 'GET', mode: 'cors', cache: 'no-store' });
  } catch (e) {}
}

async function vlc_helper_raise_ui() {
  const helper = vlc_helper_base();
  if (!helper) return;
  try {
    await fetch(helper + '/raise', { method: 'GET', mode: 'cors', cache: 'no-store' });
  } catch (e) {}
}

function external_tv_uses_sidebar_menu() {
  return preview_player_mode() === 'external';
}

function enter_external_tv_menu_mode() {
  close_menu_overlay();
  try { if (window.focus) window.focus(); } catch (e) {}
  focus_menu();
  sessionStorage.setItem('external_tv_mode', 'menu');
}

function enter_external_tv_video_mode() {
  close_menu_overlay();
  focus_content();
  sessionStorage.setItem('external_tv_mode', 'video');
}

function init_vlc_hotkey_poll() {
  if (window._tvh_hotkey_poll_init) return;
  if (preview_player_mode() !== 'external' || !vlc_helper_base()) return;
  window._tvh_hotkey_poll_init = true;
  setInterval(function() {
    fetch(vlc_helper_base() + '/hotkey-pending', { method: 'GET', mode: 'cors', cache: 'no-store' })
      .then(function(response) { return response.ok ? response.json() : null; })
      .then(function(data) {
        if (!data || !data.action) return;
        if (data.action === 'menu') enter_external_tv_menu_mode();
        else if (data.action === 'video') enter_external_tv_video_mode();
      })
      .catch(function() {});
  }, 350);
}

function is_menu_overlay_open() {
  return document.body.classList.contains('menu-overlay-open');
}

function is_menu_open_key(e) {
  if (!e || e.ctrlKey || e.altKey || e.metaKey) return false;
  if (e.key === 'Home' || e.keyCode === 36) return true;
  if (e.key === 'F2' || e.keyCode === 113) return true;
  return false;
}

function is_menu_close_key(e) {
  if (!e) return false;
  if (e.key === 'Escape' || e.keyCode === 27) return true;
  if (external_tv_uses_sidebar_menu()) return false;
  if (e.key === 'Backspace' || e.keyCode === 8) return true;
  return false;
}

function open_menu_overlay() {
  if (is_menu_overlay_open()) return;
  if (cookies.VLC_STOP_ON_MENU === '1') void vlc_helper_stop();
  else if (preview_player_mode() === 'external') void vlc_helper_raise_ui();
  try { if (window.focus) window.focus(); } catch (e) {}
  document.body.classList.add('menu-overlay-open');
  var head = document.getElementById('tv-menu-head');
  if (head) head.style.display = 'flex';
  focus_menu();
}

function close_menu_overlay() {
  if (!is_menu_overlay_open()) return;
  document.body.classList.remove('menu-overlay-open');
  var head = document.getElementById('tv-menu-head');
  if (head) head.style.display = 'none';
  focus_content();
}

function toggle_menu_overlay() {
  if (is_menu_overlay_open()) close_menu_overlay();
  else open_menu_overlay();
}

function handle_menu_overlay_keydown(e) {
  if (!is_menu_overlay_open()) return false;
  if (e.target.matches('input, textarea, select')) return false;

  if (is_menu_close_key(e)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    close_menu_overlay();
    return true;
  }

  if (!menu_focus) focus_menu();

  if (e.key === 'ArrowUp' || e.keyCode === 38) {
    e.preventDefault();
    e.stopImmediatePropagation();
    navigate_menu_item(menu_index - 1);
    return true;
  }
  if (e.key === 'ArrowDown' || e.keyCode === 40) {
    e.preventDefault();
    e.stopImmediatePropagation();
    navigate_menu_item(menu_index + 1);
    return true;
  }
  if (e.key === 'Enter' || e.keyCode === 13) {
    e.preventDefault();
    e.stopImmediatePropagation();
    navigate_menu_item(menu_index);
    return true;
  }
  if (e.key === 'ArrowRight' || e.keyCode === 39) {
    e.preventDefault();
    e.stopImmediatePropagation();
    close_menu_overlay();
    return true;
  }
  return true;
}

function on_menu_overlay_global_key(e) {
  if (e.target && e.target.matches && e.target.matches('input, textarea, select')) {
    if (!is_menu_overlay_open()) return;
  }
  if (e.repeat) return;

  if (is_menu_open_key(e)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (external_tv_uses_sidebar_menu()) enter_external_tv_menu_mode();
    else toggle_menu_overlay();
    return;
  }

  if (is_menu_overlay_open() && is_menu_close_key(e)) {
    if (e.target && e.target.matches && e.target.matches('input, textarea, select')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close_menu_overlay();
  }
}

function init_menu_overlay() {
  if (window._tvh_menu_overlay_init) return;
  window._tvh_menu_overlay_init = true;

  var head = document.createElement('div');
  head.id = 'tv-menu-head';
  head.style.display = 'none';
  head.innerHTML =
    '<span class="tv-menu-head-title">TVHadmin menu</span>' +
    '<span class="tv-menu-head-hint">↑↓ move · Enter open page · Esc close</span>' +
    '<button type="button" id="tv-menu-head-close">Close</button>';
  document.body.appendChild(head);
  head.querySelector('#tv-menu-head-close').addEventListener('click', function(ev) {
    ev.preventDefault();
    close_menu_overlay();
  });

  document.addEventListener('keydown', on_menu_overlay_global_key, true);
}

async function play_in_external_vlc(uuid, name, type, forceProfile) {
  await ensure_stream_profile();
  type = type || 'channel';
  var profileName = type !== 'recording' ? pick_vlc_stream_profile(name, uuid) : '';
  if (forceProfile) profileName = forceProfile;
  const title = name || '';
  const url = await resolve_play_ticket_url(uuid, type, profileName, title);
  if (!url) return;
  store_preview_channel(uuid, name, url, 0, type);
  close_menu_overlay();
  await launch_external_vlc(url, name);
  enter_external_tv_video_mode();
}

async function preview_channel(uuid, name) {
  if (preview_player_mode() === 'external') {
    await play_in_external_vlc(uuid, name, 'channel');
    return;
  }
  const video = document.getElementById('live-preview');
  if (!video) return;
  await ensure_stream_profile();
  const url = build_preview_url(uuid, 'channel');
  store_preview_channel(uuid, name, url, 0, 'channel');
  if (!url) {
    start_preview(video, name, null, uuid, 'channel');
    return;
  }
  play_preview(video, name, url, 0, uuid);
}

function play_recording(uuid, title) {
  if (preview_player_mode() === 'external') {
    void play_in_external_vlc(uuid, title, 'recording');
    return;
  }
  const video = document.getElementById('live-preview');
  if (!video) return;
  const url = build_preview_url(uuid, 'recording');
  store_preview_channel(uuid, title, url, 0, 'recording');
  if (!url) {
    start_preview(video, title, null, uuid, 'recording');
    return;
  }
  play_preview(video, title, url, 0);
}

function init_navigation() {
  var mytop = document.getElementById('mobmenu');
  if (mytop) {
    mytop.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (external_tv_uses_sidebar_menu()) enter_external_tv_menu_mode();
      else open_menu_overlay();
    });
  }
  const items = [
    { title: "Whats On Now", link: "now.html", icon: "" },
    { title: "TimeLine", link: "timeline.html", icon: "<span class='nav-icon'><span class='tl-bar b1'></span><span class='tl-bar b2'></span><span class='tl-bar b3'></span><span class='tl-bar b4'></span></span>" },
    { title: "Record", link: "recordings.html", icon: "<span class='nav-icon' title='Recordings'>&#128249;</span>" },
    { title: "Config", link: "config.html", icon: "<span class='nav-icon' title='Configuration'>&#9881;</span>" }
  ];
  const page = location.pathname.split('/').pop() || 'TVHadmin.html';
  let menu = document.getElementsByClassName("nav_bar");
  if (!menu[0]) return;
  for (let i = 0; i < items.length; i++) {
    let div = document.createElement("div");
    div.className = "navi";
    if (page === items[i].link) div.className += " active";
    div.innerHTML = `<a href="${items[i].link}"><span>${items[i].title}</span>${items[i].icon}</a>`;
    menu[0].appendChild(div);
  }
  const nav = document.getElementById('navigation');
  if (nav && !nav.querySelector('.nav_keybinds')) {
    const keybinds = [
      ['↑ ↓', 'Navigate'],
      ['←', 'Sidebar'],
      ['→', 'Channel list'],
      ['Enter', 'Play']
    ];
    const kbEl = document.createElement('div');
    kbEl.className = 'nav_keybinds';
    kbEl.innerHTML = '<div class="nav_keybinds-title">Keys</div>' +
      keybinds.map(function(row) {
        return '<div class="nav_keybind"><span class="nav_key">' + row[0] +
          '</span><span class="nav_keybind-label">' + row[1] + '</span></div>';
      }).join('');
    nav.appendChild(kbEl);
  }
  if (nav) {
    nav.addEventListener('click', function(e) {
      const link = e.target.closest('a');
      if (link && link.getAttribute('href') && link.getAttribute('href') !== '#') {
        if (is_menu_overlay_open()) close_menu_overlay();
        save_preview_position();
      }
    });
  }
  init_menu_keyboard();
}

var nav_items = [];
var menu_focus = false;
var menu_index = 0;
var on_content_focus = null;
var content_nav = null;

function begin_field_edit(field) {
  if (!field) return;
  field_edit_gen++;
  field.classList.add('kb-field-edit');
  if (content_nav) content_nav.fieldEdit = field;
  if (field.tagName === 'SELECT') {
    field.tabIndex = 0;
    field.dataset.kbSize = String(field.size || 0);
    const n = field.options.length;
    field.size = n < 2 ? 2 : Math.min(n, 8);
  }
  field.focus();
}

function end_field_edit(field) {
  if (!field) field = content_nav && content_nav.fieldEdit;
  if (!field) return;
  const doneGen = field_edit_gen;
  field.classList.remove('kb-field-edit');
  if (content_nav && content_nav.fieldEdit === field) content_nav.fieldEdit = null;
  if (field.tagName === 'SELECT') {
    field.size = parseInt(field.dataset.kbSize, 10) || 0;
    delete field.dataset.kbSize;
    field.tabIndex = -1;
    if (field.blur) field.blur();
  }
  release_field_focus(field);
  apply_content_row_style();
  setTimeout(function() {
    if (doneGen !== field_edit_gen) return;
    if (field && document.activeElement === field) release_field_focus(field);
    apply_content_row_style();
  }, 0);
}

function is_field_editing(field) {
  return !!(field && field.classList && field.classList.contains('kb-field-edit'));
}

function field_blocks_navigation(target) {
  if (!target || !target.matches) return false;
  if (target.id === 'kb-focus-sink') return false;
  if (target.matches('input, textarea, button')) return true;
  if (target.matches('select') && is_field_editing(target)) return true;
  return false;
}

function focus_content_row(row) {
  if (!row) return;
  if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1');
  row.focus({ preventScroll: true });
}

var kb_focus_sink = null;
var field_edit_gen = 0;

function get_kb_focus_sink() {
  if (!kb_focus_sink) {
    kb_focus_sink = document.createElement('div');
    kb_focus_sink.id = 'kb-focus-sink';
    kb_focus_sink.setAttribute('tabindex', '-1');
    kb_focus_sink.setAttribute('aria-hidden', 'true');
    kb_focus_sink.style.cssText = 'position:fixed;width:0;height:0;opacity:0;pointer-events:none;overflow:hidden;';
    document.body.appendChild(kb_focus_sink);
  }
  return kb_focus_sink;
}

function release_field_focus(field) {
  if (field && field.blur) field.blur();
  get_kb_focus_sink().focus({ preventScroll: true });
}

function content_has_top_focus() {
  if (!content_nav || !content_nav.hasTopBar()) return false;
  return !!(content_nav.topBarFocus || content_nav.topBar);
}

function init_content_keyboard(cfg) {
  content_nav = {
    getItems: cfg.getItems,
    topBar: cfg.topBar || null,
    topBarFocus: cfg.topBarFocus || null,
    hasTopBar: cfg.hasTopBar || function() { return !!cfg.topBar; },
    onActivate: cfg.onActivate || null,
    onDelete: cfg.onDelete || null,
    onTopBarLeft: cfg.onTopBarLeft || null,
    onTopBarRight: cfg.onTopBarRight || null,
    onFocusChange: cfg.onFocusChange || null,
    autoSubFocus: cfg.autoSubFocus || null,
    subFocus: false,
    index: cfg.start || 0
  };

  on_content_focus = function() {
    set_content_focus(content_nav.index);
  };

  if (sessionStorage.getItem('menu_focus') !== '1') {
    set_content_focus(content_nav.index);
  }
}

function clear_top_bar_focus() {
  if (!content_nav) return;
  if (content_nav.topBar) content_nav.topBar.classList.remove('content-selected');
  if (content_nav.topBarFocus) content_nav.topBarFocus.classList.remove('content-selected');
}

function set_top_bar_focus(active) {
  clear_top_bar_focus();
  if (!active || !content_nav) return;
  const el = content_nav.topBarFocus || content_nav.topBar;
  if (el) el.classList.add('content-selected');
}

function apply_content_row_style() {
  if (!content_nav) return;
  const items = content_nav.getItems();
  const menu_active = menu_focus || sessionStorage.getItem('menu_focus') === '1';
  items.forEach(function(i) {
    i.classList.remove('content-selected', 'content-delete-focus');
  });
  clear_top_bar_focus();
  if (menu_active) return;
  if (content_nav.index < 0 && content_has_top_focus()) {
    set_top_bar_focus(true);
    return;
  }
  if (content_nav.index < 0 || !items[content_nav.index]) return;
  const row = items[content_nav.index];
  if (content_nav.autoSubFocus && content_nav.autoSubFocus(row)) content_nav.subFocus = true;
  if (content_nav.subFocus) row.classList.add('content-delete-focus');
  else row.classList.add('content-selected');
}

function set_content_focus(idx) {
  if (!content_nav) return;
  const editing = content_nav.fieldEdit;
  if (editing) end_field_edit(editing);
  else {
    const active = document.activeElement;
    if (active && active.matches && active.matches('select, input, textarea')) release_field_focus(active);
  }
  const items = content_nav.getItems();
  const menu_active = menu_focus || sessionStorage.getItem('menu_focus') === '1';
  const prev = content_nav.index;
  items.forEach(function(i) {
    i.classList.remove('content-selected', 'content-delete-focus');
  });
  clear_top_bar_focus();

  if (!menu_active) {
    nav_items.forEach(function(n) { n.classList.remove('kb-selected'); });
    const nav = document.getElementById('navigation');
    if (nav) nav.classList.remove('menu-focus');
  }

  if (idx < 0 && content_has_top_focus()) {
    content_nav.index = -1;
    content_nav.subFocus = false;
    if (!menu_active) set_top_bar_focus(true);
    if (content_nav.onFocusChange) content_nav.onFocusChange(-1);
    return;
  }
  if (!items.length) return;
  if (idx < 0) idx = 0;
  if (idx >= items.length) idx = items.length - 1;
  if (idx !== prev) content_nav.subFocus = false;
  content_nav.index = idx;
  if (items[idx] && content_nav.autoSubFocus && content_nav.autoSubFocus(items[idx])) {
    content_nav.subFocus = true;
  }
  if (menu_active) return;
  apply_content_row_style();
  if (content_nav.onFocusChange) content_nav.onFocusChange(content_nav.index);
  items[idx].scrollIntoView({ block: 'nearest' });
}

function handle_content_keydown(e) {
  if (!content_nav || menu_focus) return;
  if (content_nav.fieldEdit) return;
  if (field_blocks_navigation(e.target)) return;
  if (is_menu_overlay_open()) return;

  if (e.key === 'Escape') {
    return;
  }

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (content_nav.index < 0) set_content_focus(0);
    else set_content_focus(content_nav.index + 1);
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (content_nav.index <= 0 && content_has_top_focus()) set_content_focus(-1);
    else set_content_focus(content_nav.index - 1);
  }
  else if (e.key === 'Enter') {
    const items = content_nav.getItems();
    if (content_nav.index < 0 && content_has_top_focus()) {
      e.preventDefault();
      if (content_nav.onActivate) content_nav.onActivate(null, -1);
    }
    else if (content_nav.index >= 0 && items[content_nav.index]) {
      e.preventDefault();
      if (content_nav.subFocus && content_nav.onDelete) {
        content_nav.onDelete(items[content_nav.index], content_nav.index);
      }
      else if (content_nav.onActivate) {
        content_nav.onActivate(items[content_nav.index], content_nav.index);
      }
    }
  }
  else if (e.key === 'ArrowRight') {
    if (content_nav.index < 0 && content_nav.onTopBarRight) {
      e.preventDefault();
      content_nav.onTopBarRight();
      return;
    }
    const items = content_nav.getItems();
    if (content_nav.index >= 0 && items[content_nav.index] && content_nav.onDelete && !content_nav.subFocus) {
      e.preventDefault();
      content_nav.subFocus = true;
      apply_content_row_style();
    }
  }
  else if (e.key === 'Delete' && content_nav.onDelete) {
    const items = content_nav.getItems();
    if (content_nav.index >= 0 && items[content_nav.index]) {
      e.preventDefault();
      content_nav.onDelete(items[content_nav.index], content_nav.index);
    }
  }
}

function is_menu_focus() {
  return menu_focus;
}

function clear_content_selection() {
  if (!content_nav) return;
  content_nav.subFocus = false;
  content_nav.getItems().forEach(function(i) {
    i.classList.remove('content-selected', 'content-delete-focus');
  });
  clear_top_bar_focus();
}

function focus_menu() {
  const nav = document.getElementById('navigation');
  if (!nav || !nav_items.length) return;
  menu_focus = true;
  nav.classList.add('menu-focus');
  set_menu_selection(menu_index);
  clear_content_selection();
}

function focus_content() {
  const nav = document.getElementById('navigation');
  menu_focus = false;
  sessionStorage.removeItem('menu_focus');
  sessionStorage.removeItem('menu_index');
  nav_items.forEach(function(n) { n.classList.remove('kb-selected'); });
  if (nav) nav.classList.remove('menu-focus');
  if (content_nav && content_nav.fieldEdit) end_field_edit(content_nav.fieldEdit);
  else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (typeof on_content_focus === 'function') on_content_focus();
}

function set_menu_selection(idx) {
  if (!nav_items.length) return;
  if (idx < 0) idx = 0;
  if (idx >= nav_items.length) idx = nav_items.length - 1;
  menu_index = idx;
  nav_items.forEach(function(n) { n.classList.remove('kb-selected'); });
  nav_items[idx].classList.add('kb-selected');
  const nav = document.getElementById('navigation');
  const item = nav_items[idx];
  if (nav && item) {
    const navRect = nav.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (itemRect.top < navRect.top) {
      nav.scrollTop -= navRect.top - itemRect.top;
    } else if (itemRect.bottom > navRect.bottom) {
      nav.scrollTop += itemRect.bottom - navRect.bottom;
    }
  }
}

function navigate_menu_item(idx) {
  if (!nav_items.length) return;
  if (idx < 0) idx = 0;
  if (idx >= nav_items.length) idx = nav_items.length - 1;
  const item = nav_items[idx];
  if (item.classList.contains('active')) {
    set_menu_selection(idx);
    return;
  }
  const link = item.querySelector('a');
  if (link) {
    save_preview_position();
    sessionStorage.setItem('menu_focus', '1');
    sessionStorage.setItem('menu_index', String(idx));
    window.location.href = link.href;
  }
}

function init_menu_keyboard() {
  if (window._tvh_menu_kb_init) return;
  window._tvh_menu_kb_init = true;
  nav_items = Array.from(document.querySelectorAll('#navigation .navi'));
  const active = nav_items.findIndex(function(n) { return n.classList.contains('active'); });
  menu_index = active >= 0 ? active : 0;
  if (sessionStorage.getItem('menu_focus') === '1') {
    const saved = sessionStorage.getItem('menu_index');
    if (saved !== null && saved !== '') menu_index = parseInt(saved, 10);
    if (isNaN(menu_index)) menu_index = active >= 0 ? active : 0;
    focus_menu();
  }

  document.addEventListener('keydown', function(e) {
    if (handle_menu_overlay_keydown(e)) return;

    if (external_tv_uses_sidebar_menu() && (e.key === 'Backspace' || e.keyCode === 8)) {
      if (!e.target.matches('input, textarea, select')) {
        e.preventDefault();
        return;
      }
    }

    const editing = content_nav && content_nav.fieldEdit;

    if (editing) {
      if (e.key === 'Escape') {
        e.preventDefault();
        end_field_edit(editing);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        end_field_edit(editing);
        return;
      }
      if (editing.tagName === 'SELECT' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        return;
      }
      return;
    }

    if (e.key === 'Escape' && e.target.matches('input, textarea')) {
      e.preventDefault();
      if (e.target.blur) e.target.blur();
      apply_content_row_style();
      return;
    }

    if (e.target.matches('select')) {
      if (e.key === 'Enter') {
        e.preventDefault();
        begin_field_edit(e.target);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        release_field_focus(e.target);
      } else {
        return;
      }
    }
    else if (field_blocks_navigation(e.target)) {
      return;
    }

    if (menu_focus) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigate_menu_item(menu_index - 1);
      }
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigate_menu_item(menu_index + 1);
      }
      else if (e.key === 'ArrowRight') {
        e.preventDefault();
        focus_content();
      }
      else if (e.key === 'Enter') {
        e.preventDefault();
        navigate_menu_item(menu_index);
      }
      return;
    }

    if (e.key === 'ArrowLeft') {
      if (content_nav && content_nav.subFocus) {
        const items = content_nav.getItems();
        const row = content_nav.index >= 0 ? items[content_nav.index] : null;
        if (content_nav.autoSubFocus && row && content_nav.autoSubFocus(row)) {
          e.preventDefault();
          focus_menu();
          return;
        }
        e.preventDefault();
        content_nav.subFocus = false;
        apply_content_row_style();
        return;
      }
      if (content_nav && content_nav.index < 0 && content_nav.onTopBarLeft) {
        e.preventDefault();
        content_nav.onTopBarLeft();
        return;
      }
      e.preventDefault();
      if (external_tv_uses_sidebar_menu()) {
        enter_external_tv_menu_mode();
      } else {
        focus_menu();
      }
      return;
    }

    handle_content_keydown(e);
  }, true);
}

function checkForm() {
  var x = document.forms["search"]["find"].value;
  if (x == "") return false;
  return true;
}

function create_by_event(event, event_id, element) {
  event.preventDefault();
  fetch(api_url(`/api/dvr/entry/create_by_event?event_id=${event_id}${dvr_config_query()}`), fetch_opts()).then(function(response) {
    if (response.ok) {
      const outer = element.parentNode;
      outer.removeChild(outer.childNodes[0]);
      const a = document.createElement("a");
      a.title = "Remove scheduled recording";
      a.href = "channels.html"
      a.onclick = event => {delete_new_event(event, event_id, outer)};
      const img = document.createElement("img");
      img.src = "images/rec.png";
      a.appendChild(img);
      outer.appendChild(a);
    }
  });
}

function create_by_series(event, event_id, element) {
  event.preventDefault();
  fetch(api_url(`/api/dvr/autorec/create_by_series?event_id=${event_id}${dvr_config_query()}`), fetch_opts()).then(function(response) {
    if (response.ok) {
      const outer = element.parentNode;
      outer.removeChild(outer.childNodes[0]);
      outer.previousSibling.removeChild(outer.previousSibling.childNodes[0]);
      const a = document.createElement("a");
      a.title = "Remove series link";
      a.href = "channels.html"
      a.onclick = event => {delete_new_series(event, event_id, outer)};
      const img = document.createElement("img");
      img.src = "images/rec.png";
      a.appendChild(img);
      outer.appendChild(a);
    }
  });
}

function delete_by_event(event, title, uuid, element) {
  event.preventDefault();
  if (confirm(`Delete timer "${title}"?`)) {
    fetch(api_url(`/api/dvr/entry/cancel?uuid=${uuid}`), fetch_opts()).then(function(response) {
      if (response.ok) {
        let outer = element.parentNode;
        outer.removeChild(outer.childNodes[0]);
        let a = document.createElement("a");
        a.title = "Record";
        a.href = "channels.html"
        let img = document.createElement("img");
        img.src = "images/rec_button1.png";
        a.appendChild(img);
        outer.appendChild(a);
      }
    });
  }
}

function delete_by_series(event, title, uuid, element) {
  event.preventDefault();
  if (confirm(`Delete series link "${title}"?`)) {
    fetch(api_url(`/api/idnode/delete?uuid=${uuid}`), fetch_opts()).then(function(response) {
      if (response.ok) {
        var outer = element.parentNode;
        outer.removeChild(outer.childNodes[0]);
        var img = document.createElement("img");
        img.src = "images/rec_buttonS.png";
        outer.appendChild(img);
      }
    });
  }
}

async function delete_new_event(event, event_id, outer) {
  event.preventDefault();
  let entry = await get_timer_by_id(event_id);
  let uuid = entry.uuid;
  let title = htmlspecialchars(entry.disp_title);
  if (confirm(`Delete timer "${title}"?`)) {
    await fetch(api_url(`/api/dvr/entry/cancel?uuid=${uuid}`), fetch_opts()).then(function(response) {
      if (response.ok) {
        outer.removeChild(outer.childNodes[0]);
        const a = document.createElement("a");
        a.title = "Record";
        a.href = "channels.html"
        const img = document.createElement("img");
        img.src = "images/rec_button1.png";
        a.appendChild(img);
        outer.appendChild(a);
      }
    });
  }
}

async function delete_new_series(event, event_id, outer) {
  event.preventDefault();
  let entry = await get_timer_by_id(event_id);
  let autorec = entry.autorec;
  let title = htmlspecialchars(entry.autorec_caption);
  if (confirm(`Delete series link "${title}"?`)) {
    fetch(api_url(`/api/idnode/delete?uuid=${autorec}`), fetch_opts()).then(function(response) {
      if (response.ok) {
        outer.removeChild(outer.childNodes[0]);
        let a = document.createElement("a");
        a.title = "Record series";
        a.href = "channels.html"
        let img = document.createElement("img");
        img.src = "images/rec_buttonS.png";
        a.appendChild(img);
        outer.appendChild(a);
        a = document.createElement("a");
        a.title = "Record";
        img = document.createElement("img");
        img.src = "images/rec_button1.png";
        a.appendChild(img);
        outer.previousSibling.appendChild(a);
      }
    });
  }
}

async function fetch_json(path) {
  if (!tvh_configured()) return null;
  try {
    const response = await fetch(api_url(path), fetch_opts());
    if (!response.ok) return null;
    return await response.json();
  }
  catch {
    return null;
  }
}

async function get_timer_by_id(id) {
  let url = "/api/dvr/entry/grid_upcoming?limit=1";
  const filter = `[{"field":"broadcast","type":"numeric","value":"${id}","comparison":"eq"}]`;
  url += `&filter=${filter}`;
  const timers = await fetch_json(url);
  if (!timers || !timers.entries || !timers.entries.length) return null;
  return timers.entries[0];
}

async function get_epg(channel, start, to) {
  var url = "/api/epg/events/grid?limit=9999";
  if (to > 0) {
    const filter = `[{"field":"stop","type":"numeric","value":"${start}","comparison":"gt"},{"field":"start","type":"numeric","value":"${to}","comparison":"lt"}]`;
    url += `&filter=${filter}`;
  }
  if (channel) {
    const prog = encodeURIComponent(channel);
    url += `&channel=${prog}`;
  }
  const epg = await fetch_json(url);
  if (!epg || !epg.entries) return [];
  return epg.entries;
}

async function get_epg_now(channel) {
  var channelParam = '';
  if (channel) channelParam = '&channel=' + encodeURIComponent(channel);

  var epg = await fetch_json('/api/epg/events/grid?mode=now&limit=9999' + channelParam);
  if (epg && epg.entries && epg.entries.length) return epg.entries;

  var now = Math.floor(Date.now() / 1000);
  var filter = '[{"field":"stop","type":"numeric","value":"' + now + '","comparison":"gt"},{"field":"start","type":"numeric","value":"' + now + '","comparison":"lte"}]';
  epg = await fetch_json('/api/epg/events/grid?limit=9999&filter=' + filter + channelParam);
  if (epg && epg.entries && epg.entries.length) return epg.entries;

  var windowStart = now - 7200;
  var windowEnd = now + 7200;
  filter = '[{"field":"stop","type":"numeric","value":"' + windowStart + '","comparison":"gt"},{"field":"start","type":"numeric","value":"' + windowEnd + '","comparison":"lt"}]';
  epg = await fetch_json('/api/epg/events/grid?limit=9999&filter=' + filter + channelParam);
  if (!epg || !epg.entries) return [];
  return epg.entries.filter(function(e) {
    return e.start <= now && e.stop > now;
  });
}

function find_epg_now_event(events, channel, displayName) {
  if (!events || !events.length || !channel) return null;
  var now = Date.now() / 1000;
  var clean = channel_name_only(displayName || channel.name || '');
  var best = null;
  events.forEach(function(e) {
    var matches = (channel.uuid && e.channelUuid === channel.uuid) ||
      (channel.name && e.channelName === channel.name) ||
      (clean && e.channelName === clean) ||
      (displayName && e.channelName === displayName);
    if (!matches) return;
    if (e.start > now || e.stop <= now) return;
    if (!best || e.start > best.start) best = e;
  });
  return best;
}

async function search_epg(channel, needle) {
  const reg = encodeURIComponent(escapeRegExp(needle));
  let url = `/api/epg/events/grid?limit=9999&title=${reg}`;
  if (channel != "") {
    url += `&channel=${encodeURIComponent(channel)}`;
  }
  const epg = await fetch_json(url);
  if (!epg || !epg.entries) return [];
  return epg.entries;
}

async function get_timers() {
  const timers = await fetch_json("/api/dvr/entry/grid_upcoming?sort=start");
  if (!timers || !timers.entries) return [];
  return timers.entries;
}

async function get_profiles() {
  const profiles = await fetch_json("/api/dvr/config/grid");
  if (!profiles || !profiles.entries) return [];
  return profiles.entries;
}

async function get_channeltags() {
  const tags = await fetch_json("/api/channeltag/list");
  let ret = {};
  if (!tags || !tags.entries) return ret;
  tags.entries.forEach(function(tag) {
    ret[tag.val] = tag.key;
  });
  return ret;
}

async function get_links() {
  const json = await fetch_json("/api/dvr/autorec/grid");
  if (!json || !json.entries) return [];
  const links = json.entries;
  links.sort(function(a, b) {
    return sort_title(a.title, b.title);
  });
  return links;
}

async function get_recordings(sort) {
  const json = await fetch_json("/api/dvr/entry/grid?limit=9999");
  let recordings = [];
  if (json && json.entries) recordings = json.entries;
  switch(sort) {
    case "0":
      recordings.sort(function(a, b) {
	return (a.start - b.start);
      });
      break;
    case "1":
      recordings.sort(function(a, b) {
	return (b.start - a.start);
      });
      break;
    case "2":
      recordings.sort(function(a, b) {
	var ret = sort_title(a.disp_title, b.disp_title);
	if (ret == 0) return (a.start - b.start);
	return ret;
      });
  }
  return recordings;
}

async function get_channels(sort) {
  const json = await fetch_json("/api/channel/grid?limit=9999");
  let channels = [];
  if (json && json.entries) {
    channels = json.entries;
    cache_channels(channels);
    await sync_channel_tag_settings();
    await load_radio_tag_ids();
    await ensure_stream_profile();
    await ensure_recording_profile();
  }
  if (sort == 0) {
    channels.sort(strcasecmp);
  }
  else {
    channels.sort(function(a,b) {
      let ret = a.number - b.number;
      if (ret == 0) return strcasecmp(a,b); 
      else return ret;
    });
  }
  return channels;
}

function sort_title(x, y) {
  if (!x || !y) return 0;
  if (x.startsWith('New:')) {
    if (x[4] == ' ') x = x.substring(5);
    else x = x.substring(4);
  }
  if (y.startsWith('New:')) {
    if (y[4] == ' ') y = y.substring(5); 
    else y = y.substring(4); 
  }
  if (x.endsWith('...')) {
    x = x.substring(0, x.length - 3);
  }
  if (y.endsWith('...')) {
    y = y.substring(0, y.length - 3);
  }
  let n = Math.min(x.length, y.length);
  return strncmp(x, y, n);
}

function strcasecmp(a, b) {
  let s1 = (a.name + '').toLowerCase();
  let s2 = (b.name + '').toLowerCase();
  if (s1 > s2) return 1;
  else if (s1 === s2) return 0;
  return -1;
}

function strncmp(str1, str2, n) {
  str1 = str1.substring(0, n);
  str2 = str2.substring(0, n);
  return ( ( str1 == str2 ) ? 0 : (( str1 > str2 ) ? 1 : -1 ));
}

function click_tag(prefix, tagID) {
  var chk = document.getElementById(tagID).checked ? 1 : -1;
  sessionStorage.setItem(prefix + tagID, chk);
  location.reload();
}

function build_media_filter(pagePrefix, tags) {
  const media = { All: 1 };
  for (var key in cookies) {
    if (!key.startsWith('Tag_')) continue;
    var tag = decodeURIComponent(key.substring(4));
    if (tag === 'All') continue;
    var pageKey = pagePrefix + key.substring(4);
    var sessionVal = sessionStorage.getItem(pagePrefix + tag);
    if (sessionVal == 1 || (sessionVal === null && cookies[pageKey])) {
      media[tags[tag]] = 1;
    }
  }
  return media;
}

function build_tag_checkboxes(pagePrefix) {
  var s = "<span class='wideonly'>";
  for (var key in cookies) {
    if (!key.startsWith('Tag_')) continue;
    var tag = decodeURIComponent(key.substring(4));
    if (tag === 'All') continue;
    var pageKey = pagePrefix + key.substring(4);
    s += "<div class='media'>" +
      `<label for='${tag}'>${tag}:</label>` +
      `<input type='checkbox' name='${tag}' id='${tag}' onchange='click_tag("${pagePrefix}", "${tag}")'`;
    var sessionVal = sessionStorage.getItem(pagePrefix + tag);
    if (sessionVal == 1) s += " checked";
    else if (sessionVal === null && cookies[pageKey]) s += " checked";
    s += "></div>";
  }
  s += "</span>";
  return s;
}

function intersect(tags, media) {
  if (!tags || !tags.length) return 1;
  if (media.All) return 1;
  for (var t in tags) {
    if (media[tags[t]]) return 1;
  }
  return 0;
}

function channel_visible(c, media) {
  if (!media || media.All) return true;
  if (!Object.keys(media).length) return true;
  return intersect(c.tags, media) > 0;
}

// From https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions
function escapeRegExp(string) {
  return string.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

// https://stackoverflow.com/questions/1787322/what-is-the-htmlspecialchars-equivalent-in-javascript
function htmlspecialchars(string) {
  if (string === undefined) return "";
  return string.replace(/([&<>"']|\n)/g, function(m) { return specialchars[m]; });
};

// A collection of special characters and their entities.
var specialchars = {
  '&': '&amp;' ,
  '<': '&lt;' ,
  '>': '&gt;' ,
  '"': '&quot;' ,
  "'": '&apos;' ,
 '\n': ' '
};
