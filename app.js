(function () {
  var $ = function (s) { return document.querySelector(s); };
  var STARTERS = [
    'Kita mulai bagian 1 seri Pamali setelah maghrib. Kasih pendapat tiap tim.',
    'Cari 3 urban legend Indonesia yang cocok jadi seri, lalu tim lain tanggapi.',
    'Cek apakah alur dan warna waktu kejadian sudah konsisten sebelum produksi.'
  ];
  function load(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var cfg = load('kr_cfg', { key: '', model: 'claude-haiku-5-5', web: true });
  var msgs = load('kr_msgs', []);
  var sel = {}, typing = {}, busy = false, confirmClr = false, auto = true;
  TEAMS.forEach(function (t) { sel[t.id] = 1; });
  var list = $('#list'), strip = $('#strip'), tgt = $('#tgt'), ta = $('#ta'), sendB = $('#send'), note = $('#note');

  function team(id) { return TEAMS.filter(function (t) { return t.id === id; })[0]; }
  function hhmm(ts) { var d = new Date(ts); return ('0' + d.getHours()).slice(-2) + '.' + ('0' + d.getMinutes()).slice(-2); }
  function say(t) { note.textContent = t; note.style.display = t ? 'block' : 'none'; }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }

  function drawStrip() {
    strip.textContent = '';
    TEAMS.forEach(function (t) {
      var b = el('button', 'tm' + (typing[t.id] ? ' on' : ''));
      var i = el('i'); i.style.background = t.c;
      b.appendChild(i); b.appendChild(el('b', null, t.n)); b.appendChild(el('span', null, typing[t.id] ? 'mengetik' : 'siap'));
      b.onclick = function () {
        $('#tName').textContent = t.n;
        var u = $('#tTugas'); u.textContent = '';
        t.tugas.forEach(function (x) { u.appendChild(el('li', null, x)); });
        $('#tAturan').textContent = t.aturan;
        $('#dlgTeam').showModal();
      };
      strip.appendChild(b);
    });
  }
  function drawTargets() {
    tgt.textContent = '';
    tgt.appendChild(el('small', null, 'Yang menjawab'));
    var o = el('button', 'chip' + (auto ? ' on' : ''), 'Otomatis');
    o.onclick = function () { auto = true; drawTargets(); };
    tgt.appendChild(o);
    var all = !auto && TEAMS.every(function (t) { return sel[t.id]; });
    var al = el('button', 'chip' + (all ? ' on' : ''), 'Semua');
    al.onclick = function () { auto = false; TEAMS.forEach(function (t) { sel[t.id] = 1; }); drawTargets(); };
    tgt.appendChild(al);
    TEAMS.forEach(function (t) {
      var b = el('button', 'chip' + (!auto && sel[t.id] ? ' on' : ''), t.n); b.style.setProperty('--c', t.c);
      b.onclick = function () {
        if (auto) { auto = false; sel = {}; }
        if (sel[t.id]) delete sel[t.id]; else sel[t.id] = 1;
        drawTargets();
      };
      tgt.appendChild(b);
    });
  }
  function drawList() {
    var atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    list.textContent = '';
    if (!msgs.length) {
      var e = el('div', 'empty');
      e.appendChild(el('h2', null, 'Belum ada instruksi'));
      e.appendChild(el('p', null, 'Tulis arahan di bawah, atau mulai dari salah satu ini.'));
      STARTERS.forEach(function (s) { var b = el('button', 'st', s); b.onclick = function () { ta.value = s; ta.focus(); }; e.appendChild(b); });
      list.appendChild(e); return;
    }
    msgs.forEach(function (m) {
      var me = m.who === 'bos', t = team(m.who);
      var d = el('div', 'm' + (me ? ' me' : ''));
      if (!me && t) { d.style.setProperty('--c', t.c); d.appendChild(el('b', null, t.n)); }
      d.appendChild(el('p', null, m.text));
      d.appendChild(el('time', null, hhmm(m.ts)));
      list.appendChild(d);
    });
    if (atEnd) list.scrollTop = list.scrollHeight;
  }
  function add(m) { msgs.push(m); msgs = msgs.slice(-200); store('kr_msgs', msgs); drawList(); }

  function mentioned(text) {
    var f = text.match(/@(riset|penulis|visual|editor)/gi);
    if (!f) return null;
    var ids = f.map(function (x) { return x.slice(1).toLowerCase(); });
    return TEAMS.filter(function (t) { return ids.indexOf(t.id) > -1; });
  }
  function transcript(ctx) {
    return ctx.map(function (m) { return (m.who === 'bos' ? 'Bos' : team(m.who).n) + ': ' + m.text; }).join('\n');
  }
  function promptFor(t, ctx, text) {
    return 'Percakapan ruang koordinasi:\n' + transcript(ctx) + '\n\nPesan terbaru dari Bos: ' + text + '\n\nBalas sebagai ' + t.n + ' seperti ngobrol di grup chat kerja: singkat dan natural, sesuai peran dan aturanmu.';
  }
  async function route(text, ctx) {
    var body = { model: 'claude-haiku-5-5', max_tokens: 60,
      system: 'Kamu moderator grup kerja tim konten TikTok. Tim: riset (ide, fakta, sumber), penulis (naskah dan cerita), visual (visual, warna, karakter), editor (video, subtitle, suara, caption, tinjauan sebelum produksi). Pilih tim yang paling relevan menjawab pesan terbaru bos. Biasanya 1 tim, maksimal 2, urut sesuai alur riset, penulis, visual, editor. Kalau pesannya sapaan atau umum, pilih 1 tim saja. Jawab HANYA array JSON berisi id tim, contoh: ["penulis"]',
      messages: [{ role: 'user', content: 'Percakapan terakhir:\n' + transcript(ctx.slice(-6)) + '\n\nPesan terbaru bos: ' + text }] };
    try {
      var res = await post(body);
      if (!res.ok) return [team('riset')];
      var d = await res.json();
      var m = d.content[0].text.match(/\[[^\]]*\]/);
      var ids = m ? JSON.parse(m[0]) : [];
      var out = TEAMS.filter(function (t) { return ids.indexOf(t.id) > -1; }).slice(0, 2);
      return out.length ? out : [team('riset')];
    } catch (e) { return [team('riset')]; }
  }
  function post(body) {
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify(body)
    });
  }
  async function ask(t, ctx, text, long) {
    var body = { model: cfg.model, max_tokens: long ? 1500 : 500, system: SHARED + '\n\n' + t.aturan, messages: [{ role: 'user', content: promptFor(t, ctx, text) }] };
    if (t.id === 'riset' && cfg.web) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }];
    var res = await post(body);
    if (!res.ok && body.tools && res.status !== 401 && res.status !== 429) { delete body.tools; res = await post(body); }
    if (!res.ok) { var e = await res.json().catch(function () { return {}; }); throw { status: res.status, msg: e.error && e.error.message }; }
    var d = await res.json();
    return d.content.filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('').trim();
  }
  async function go() {
    var text = ta.value.trim();
    if (!text || busy) return;
    if (!cfg.key) { say('Isi API key dulu di Pengaturan.'); $('#dlgSet').showModal(); return; }
    var ts = mentioned(text);
    if (!ts && !auto) {
      ts = TEAMS.filter(function (t) { return sel[t.id]; });
      if (!ts.length) { say('Pilih minimal satu tim.'); return; }
    }
    say(''); busy = true; sendB.disabled = true; ta.value = ''; ta.style.height = '';
    var ctx = msgs.slice(-14).concat([{ who: 'bos', text: text }]);
    add({ who: 'bos', text: text, ts: Date.now() });
    var long = /naskah|rencana|ringkas|lengkap|detail|serah|final|susun|storyboard/i.test(text);
    if (!ts) { say('Menentukan siapa yang menjawab...'); ts = await route(text, ctx); say(''); }
    for (var i = 0; i < ts.length; i++) {
      var t = ts[i]; typing[t.id] = 1; drawStrip();
      try {
        var out = await ask(t, ctx, text, long);
        if (out && !/^\[DIAM\]/.test(out)) {
          ctx.push({ who: t.id, text: out });
          add({ who: t.id, text: out, ts: Date.now() });
        }
      } catch (e) {
        say(e.status === 401 ? 'API key tidak valid.' : e.status === 429 ? 'Terlalu cepat atau kuota habis. Coba lagi nanti.' : 'Gagal membuat balasan' + (e.msg ? ': ' + e.msg : '. Cek koneksi lalu coba lagi.'));
        delete typing[t.id]; drawStrip(); break;
      }
      delete typing[t.id]; drawStrip();
    }
    busy = false; sendB.disabled = false;
  }

  sendB.onclick = go;
  ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); go(); } });
  ta.addEventListener('input', function () { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; });
  $('#btnSet').onclick = function () { $('#fKey').value = cfg.key; $('#fModel').value = cfg.model; $('#fWeb').checked = !!cfg.web; $('#dlgSet').showModal(); };
  $('#btnSave').onclick = function () { cfg = { key: $('#fKey').value.trim(), model: $('#fModel').value, web: $('#fWeb').checked }; store('kr_cfg', cfg); say(''); };
  $('#btnClr').onclick = function () {
    var b = $('#btnClr');
    if (!confirmClr) { confirmClr = true; b.textContent = 'Yakin? Ketuk lagi'; setTimeout(function () { confirmClr = false; b.textContent = 'Hapus riwayat'; }, 3000); return; }
    confirmClr = false; b.textContent = 'Hapus riwayat'; msgs = []; store('kr_msgs', msgs); drawList();
  };
  drawStrip(); drawTargets(); drawList();
  if (!cfg.key) say('Buka Pengaturan dan isi API key Anthropic supaya tim bisa membalas.');
})();
