'use strict';

(function () {
  var orbWrap = document.getElementById('orbWrap');
  var stateEl = document.getElementById('state');
  var hintEl  = document.getElementById('hint');
  var feed    = document.getElementById('feed');
  var cmd     = document.getElementById('cmd');
  var mic     = document.getElementById('mic');
  var sendBtn = document.getElementById('send');
  var sheet   = document.getElementById('sheet');

  var settings = null;
  var history  = [];          // [{ role, content }] sent to the model
  var busy     = false;

  /* ── window controls ── */
  document.getElementById('tbMin').addEventListener('click', function () { window.jarvis.minimize(); });
  document.getElementById('tbClose').addEventListener('click', function () { window.jarvis.close(); });

  /* ── clock ── */
  function tick() {
    var n = new Date();
    document.getElementById('clock').textContent = n.toLocaleTimeString('en-GB', { hour12: false });
    document.getElementById('date').textContent =
      n.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  }
  tick();
  setInterval(tick, 1000);

  /* ── reticle tick ring ── */
  var ticks = document.getElementById('ticks');
  var NS = 'http://www.w3.org/2000/svg';
  for (var i = 0; i < 72; i++) {
    var major = i % 6 === 0;
    var a = (i / 72) * Math.PI * 2;
    var r1 = 196, r2 = 196 - (major ? 12 : 5);
    var l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', 200 + Math.cos(a) * r1);
    l.setAttribute('y1', 200 + Math.sin(a) * r1);
    l.setAttribute('x2', 200 + Math.cos(a) * r2);
    l.setAttribute('y2', 200 + Math.sin(a) * r2);
    l.setAttribute('stroke', major ? 'rgba(95,216,255,0.5)' : 'rgba(95,216,255,0.2)');
    l.setAttribute('stroke-width', '1');
    ticks.appendChild(l);
  }

  /* ── subsystem arc gauges ── */
  var subsystems = [
    { name: 'Net',   pct: 0.94, color: '#5fd8ff' },
    { name: 'Audio', pct: 0.68, color: '#5fd8ff' },
    { name: 'Core',  pct: 0.88, color: '#ffc46b' }
  ];
  var arcs = document.getElementById('arcs');
  subsystems.forEach(function (s) {
    var R = 22, C = 2 * Math.PI * R;
    var unit = document.createElement('div');
    unit.className = 'arc-unit';
    unit.innerHTML =
      '<svg width="56" height="56" viewBox="0 0 56 56">' +
        '<circle cx="28" cy="28" r="' + R + '" fill="none" stroke="rgba(95,216,255,0.12)" stroke-width="3"/>' +
        '<circle cx="28" cy="28" r="' + R + '" fill="none" stroke="' + s.color + '" stroke-width="3" stroke-linecap="round" ' +
          'stroke-dasharray="' + (C * s.pct).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 28 28)"/>' +
        '<text x="28" y="32" text-anchor="middle" fill="#cfeaf5" font-family="JetBrains Mono, monospace" font-size="11">' +
          Math.round(s.pct * 100) + '</text>' +
      '</svg><b>' + s.name + '</b>';
    arcs.appendChild(unit);
  });

  /* ── drifting telemetry (cosmetic) ── */
  var gauges = [
    { v: 'v-cpu', b: 'b-cpu', base: 34, range: 22, suffix: '%' },
    { v: 'v-mem', b: 'b-mem', base: 62, range: 9,  suffix: '%' },
    { v: 'v-pwr', b: 'b-pwr', base: 88, range: 6,  suffix: '%' }
  ];
  setInterval(function () {
    gauges.forEach(function (g) {
      var val = Math.round(g.base + (Math.random() - 0.5) * g.range);
      document.getElementById(g.v).textContent = val + g.suffix;
      document.getElementById(g.b).style.width = Math.min(100, val) + '%';
    });
  }, 2200);

  /* ── reactor state ── */
  var HINTS = {
    standby:    'Type a command below',
    listening:  'Listening — speak now',
    processing: 'Working on it',
    speaking:   'Responding',
    error:      'Something went wrong'
  };
  function setState(s) {
    orbWrap.className = 'orb-wrap ' + (s === 'standby' ? '' : s);
    stateEl.textContent = s;
    hintEl.textContent = HINTS[s];
  }

  /* ── transcript ── */
  function say(who, text) {
    var p = document.createElement('p');
    p.className = 'msg ' + who;
    var b = document.createElement('b');
    b.textContent = who === 'you' ? 'You' : (who === 'error' ? 'System' : 'Jarvis');
    p.appendChild(b);
    p.appendChild(document.createTextNode(text));
    feed.appendChild(p);
    feed.scrollTop = feed.scrollHeight;
  }

  /* ── send ── */
  function submit() {
    var text = cmd.value.trim();
    if (!text || busy) return;

    busy = true;
    sendBtn.disabled = true;
    cmd.value = '';
    say('you', text);
    history.push({ role: 'user', content: text });
    setState('processing');

    window.jarvis.send(history).then(function (res) {
      if (res.ok) {
        history.push({ role: 'assistant', content: res.text });
        setState('speaking');
        say('jarvis', res.text);
        setTimeout(function () { setState('standby'); }, 1400);
      } else {
        history.pop();                       // don't keep a turn the model never answered
        setState('error');
        say('error', res.error);
        setTimeout(function () { setState('standby'); }, 2600);
      }
    }).catch(function (err) {
      history.pop();
      setState('error');
      say('error', String(err));
      setTimeout(function () { setState('standby'); }, 2600);
    }).then(function () {
      busy = false;
      sendBtn.disabled = false;
      cmd.focus();
    });
  }

  sendBtn.addEventListener('click', submit);
  cmd.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

  /* ── dictation (browser speech API; see README for limits) ── */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var recog = null, listening = false;

  if (SR) {
    recog = new SR();
    recog.continuous = false;
    recog.interimResults = false;
    recog.lang = 'en-IN';

    recog.onresult = function (e) {
      cmd.value = e.results[0][0].transcript;
      stopListening();
      submit();
    };
    recog.onerror = function () { stopListening(); };
    recog.onend = function () { if (listening) stopListening(); };
  }

  function startListening() {
    if (!recog) {
      say('error', 'Speech recognition is not available in this build. Type instead.');
      return;
    }
    listening = true;
    mic.classList.add('on');
    mic.setAttribute('aria-pressed', 'true');
    setState('listening');
    try { recog.start(); } catch (err) { stopListening(); }
  }

  function stopListening() {
    listening = false;
    mic.classList.remove('on');
    mic.setAttribute('aria-pressed', 'false');
    if (recog) { try { recog.stop(); } catch (err) {} }
    if (!busy) setState('standby');
  }

  mic.addEventListener('click', function () {
    if (listening) stopListening(); else startListening();
  });

  /* ── settings sheet ── */
  var providerSel = document.getElementById('provider');
  var apiKeyIn    = document.getElementById('apiKey');
  var modelIn     = document.getElementById('model');
  var shortcutIn  = document.getElementById('shortcut');
  var sysIn       = document.getElementById('sysPrompt');

  function fillSheet() {
    providerSel.value = settings.provider;
    apiKeyIn.value    = settings.apiKeys[settings.provider] || '';
    modelIn.value     = settings.models[settings.provider] || '';
    shortcutIn.value  = settings.shortcut || '';
    sysIn.value       = settings.systemPrompt || '';
  }

  providerSel.addEventListener('change', function () {
    // keep whatever was typed for the provider we're leaving
    settings.apiKeys[settings.provider] = apiKeyIn.value.trim();
    settings.models[settings.provider]  = modelIn.value.trim();
    settings.provider = providerSel.value;
    apiKeyIn.value = settings.apiKeys[settings.provider] || '';
    modelIn.value  = settings.models[settings.provider] || '';
  });

  function openSheet()  { fillSheet(); sheet.classList.add('open'); apiKeyIn.focus(); }
  function closeSheet() { sheet.classList.remove('open'); cmd.focus(); }

  document.getElementById('cog').addEventListener('click', openSheet);
  document.getElementById('sheetCancel').addEventListener('click', function () {
    refreshSettings().then(closeSheet);
  });

  document.getElementById('sheetSave').addEventListener('click', function () {
    settings.provider = providerSel.value;
    settings.apiKeys[settings.provider] = apiKeyIn.value.trim();
    settings.models[settings.provider]  = modelIn.value.trim();
    settings.shortcut     = shortcutIn.value.trim();
    settings.systemPrompt = sysIn.value;

    window.jarvis.saveSettings(settings).then(function (saved) {
      settings = saved;
      updateLinkChip();
      closeSheet();
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && sheet.classList.contains('open')) {
      refreshSettings().then(closeSheet);
    }
  });

  /* ── link chip reflects whether a key is present ── */
  function updateLinkChip() {
    var chip = document.getElementById('linkChip');
    var text = document.getElementById('linkText');
    var hasKey = !!(settings.apiKeys[settings.provider] || '').trim();
    chip.classList.toggle('offline', !hasKey);
    text.textContent = hasKey ? (settings.provider + ' linked') : 'No API key';
  }

  function refreshSettings() {
    return window.jarvis.getSettings().then(function (s) { settings = s; return s; });
  }

  /* ── boot ── */
  refreshSettings().then(function () {
    updateLinkChip();
    setState('standby');
    var hasKey = !!(settings.apiKeys[settings.provider] || '').trim();
    if (hasKey) {
      say('jarvis', 'Good evening. Reactor is stable and all systems are nominal.');
    } else {
      say('jarvis', 'I am online, but no API key is set. Open settings (the cog, top right) and add one.');
      setTimeout(openSheet, 600);
    }
    cmd.focus();
  });
})();
