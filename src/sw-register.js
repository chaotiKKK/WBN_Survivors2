/* Service-Worker-Registrierung mit Update-Erkennung.
   Der Build stempelt einen Content-Hash in sw.js (CACHE-Name). Aendert sich das
   Spiel, sieht der Browser ein neues sw.js, installiert es als wartenden Worker
   und wir zeigen einen "Update verfuegbar"-Toast. Erst der Klick aktiviert den
   neuen Worker (skipWaiting) und laedt die Seite neu - so bleibt niemand auf
   einem alten Cache haengen, ohne mitten im Spiel unterbrochen zu werden. */
if ('serviceWorker' in navigator) {
  addEventListener('load', function () {
    var updating = false;

    function toast(reg) {
      if (document.getElementById('sw-toast')) return;
      var el = document.createElement('div');
      el.id = 'sw-toast';
      el.className = 'sw-toast';
      el.setAttribute('role', 'status');
      el.innerHTML = '<span>Update verfügbar</span><button type="button">Neu laden</button>';
      el.querySelector('button').addEventListener('click', function () {
        updating = true;
        var w = reg.waiting || reg.installing;
        if (w) w.postMessage({ type: 'SKIP_WAITING' });
        el.querySelector('button').textContent = '…';
      });
      document.body.appendChild(el);
      requestAnimationFrame(function () { el.classList.add('show'); });
    }

    navigator.serviceWorker.register('sw.js').then(function (reg) {
      /* Update lag schon vor dem Laden bereit. */
      if (reg.waiting && navigator.serviceWorker.controller) toast(reg);
      /* Neuer Worker installiert sich -> erst bei 'installed' + bestehendem
         Controller ist es ein echtes Update (nicht die Erstinstallation). */
      reg.addEventListener('updatefound', function () {
        var neu = reg.installing;
        if (!neu) return;
        neu.addEventListener('statechange', function () {
          if (neu.state === 'installed' && navigator.serviceWorker.controller) toast(reg);
        });
      });
      /* Regelmaessig nach Updates fragen: beim Sichtbarwerden und stuendlich. */
      var pruefe = function () { reg.update().catch(function () {}); };
      document.addEventListener('visibilitychange', function () { if (!document.hidden) pruefe(); });
      setInterval(pruefe, 60 * 60 * 1000);
    }).catch(function () {});

    /* Nur neu laden, wenn der Wechsel vom Spieler ausgeloest wurde - die
       Erstinstallation (clients.claim) darf die Seite nicht neu laden. */
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (updating) location.reload();
    });
  });
}
