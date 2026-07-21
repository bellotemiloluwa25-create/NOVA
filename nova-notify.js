/* ===========================================================
   NOVA desktop notifications
   -----------------------------------------------------------
   Shows a system notification when something arrives while the
   page is open, keeps a count in the browser tab title, and
   plays a short sound.

   Honest limit: this only works while a NOVA tab is open. Once
   the browser is closed, nothing can reach them without push
   infrastructure or an email. Email remains the reliable path
   for clients who visit occasionally.
   =========================================================== */

var NOVANotify = (function () {
  var unseen = 0;
  var baseTitle = document.title;
  var lastSound = 0;

  function supported() { return 'Notification' in window; }
  function permission() { return supported() ? Notification.permission : 'unsupported'; }

  /* a soft two note chime, generated rather than loaded, so there is no file to host */
  function chime() {
    if (Date.now() - lastSound < 2000) return;   /* never machine gun */
    lastSound = Date.now();
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      [880, 1174].forEach(function (freq, i) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.28);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.12);
        o.stop(ctx.currentTime + i * 0.12 + 0.3);
      });
      setTimeout(function () { ctx.close(); }, 900);
    } catch (e) {}
  }

  function paintTitle() {
    document.title = unseen ? '(' + unseen + ') ' + baseTitle : baseTitle;
  }

  function show(title, body, onClick) {
    /* the tab count and sound happen whether or not they granted permission */
    if (document.hidden) { unseen++; paintTitle(); }
    chime();

    if (permission() !== 'granted' || !document.hidden) return;
    try {
      var n = new Notification(title, {
        body: body,
        icon: 'favicon.svg',
        badge: 'favicon.svg',
        tag: 'nova-' + Date.now(),
        silent: true            /* we play our own, so no double sound */
      });
      n.onclick = function () {
        window.focus();
        n.close();
        if (onClick) onClick();
      };
      setTimeout(function () { n.close(); }, 12000);
    } catch (e) {}
  }

  function ask() {
    if (!supported()) return Promise.resolve('unsupported');
    return Notification.requestPermission();
  }

  /* clear the tab count when they come back to the page */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { unseen = 0; paintTitle(); }
  });
  window.addEventListener('focus', function () { unseen = 0; paintTitle(); });

  /* a small control that only appears if notifications are not yet on */
  function mountButton(container, label) {
    if (!supported() || permission() === 'granted') return;
    var b = document.createElement('button');
    b.className = 'notifybtn';
    b.type = 'button';
    b.innerHTML = '&#9788; ' + (label || 'Turn on alerts');
    b.title = 'Show a desktop notification when something new arrives';
    b.onclick = function () {
      ask().then(function (p) {
        if (p === 'granted') {
          b.remove();
          show('Alerts are on', 'You will be told when something new arrives.');
        } else {
          b.textContent = 'Alerts blocked in your browser';
          b.disabled = true;
        }
      });
    };
    container.appendChild(b);
  }

  return { show: show, ask: ask, permission: permission, supported: supported, mountButton: mountButton };
})();
