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

  var MAX_TURNS = 20;         // keep the context (and the bill) bounded

  /* If index.html is opened directly in a browser there is no preload bridge.
     Stub it so the HUD still renders and says what is wrong, instead of
     throwing on the first call and leaving a dead-looking window. */
  var bridge = window.jarvis || {
    send:         function () { return Promise.resolve({ ok: false, error: 'Not running inside Electron — start the app with "npm start".' }); },
    getSettings:  function () { return Promise.resolve({ provider: 'anthropic', apiKeys: {}, models: {}, shortcut: '', systemPrompt: '' }); },
    saveSettings: function (s) { return Promise.resolve(s); },
    minimize:     function () {},
    toggleMax:    function () {},
    close:        function () {},
    toggleFullscreen: function () {
      // outside Electron, fall back to the browser fullscreen API
      if (document.fullscreenElement) document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    },
    exitFullscreen: function () { if (document.fullscreenElement) document.exitFullscreen(); },
    isFullscreen:   function () { return Promise.resolve(!!document.fullscreenElement); },
    onFullscreen:   function () {},
    onMaximized:    function () {}
  };

  /* ── window controls ── */
  document.getElementById('tbMin').addEventListener('click', function () { bridge.minimize(); });
  document.getElementById('tbClose').addEventListener('click', function () { bridge.close(); });
  document.getElementById('tbMax').addEventListener('click', function () { bridge.toggleMax(); });
  document.getElementById('tbFull').addEventListener('click', function () { bridge.toggleFullscreen(); });
  document.getElementById('fsExit').addEventListener('click', function () { bridge.exitFullscreen(); });

  // double-clicking the bar maximises, the way a normal Windows titlebar does
  document.querySelector('.titlebar').addEventListener('dblclick', function (e) {
    if (e.target.closest('.tb-actions')) return;
    bridge.toggleMax();
  });

  /* Fullscreen: main sends the state, and we mirror it on <body> so the
     titlebar hides and the layout opens up. F11 is also handled in main so it
     fires even while typing; this listener covers the browser fallback. */
  function setFullscreen(on) {
    document.body.classList.toggle('fullscreen', !!on);
    var btn = document.getElementById('tbFull');
    if (btn) btn.title = on ? 'Exit fullscreen (F11)' : 'Fullscreen (F11)';
  }
  bridge.onFullscreen(setFullscreen);
  document.addEventListener('fullscreenchange', function () {
    if (!window.jarvis) setFullscreen(!!document.fullscreenElement);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F11') { e.preventDefault(); bridge.toggleFullscreen(); }
  });
  bridge.isFullscreen().then(setFullscreen);

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

  /* Send only the recent turns. Unbounded history meant every message
     re-sent the whole conversation, so cost and latency climbed all session. */
  function trimmed() {
    return history.slice(-MAX_TURNS);
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

    bridge.send(trimmed()).then(function (res) {
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

    bridge.saveSettings(settings).then(function (saved) {
      settings = saved;
      updateLinkChip();
      closeSheet();
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (sheet.classList.contains('open')) {
      refreshSettings().then(closeSheet);       // sheet takes priority
    } else if (document.body.classList.contains('fullscreen')) {
      bridge.exitFullscreen();
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
    return bridge.getSettings().then(function (s) { settings = s; return s; });
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
