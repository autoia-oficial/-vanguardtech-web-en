/* ===========================================================================
   VANGUARD TECH — movimiento
   Un solo bucle de animación para todo lo que depende del scroll.
   Sin dependencias. Si el usuario prefiere menos movimiento, no se anima nada.
   =========================================================================== */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = window.matchMedia('(pointer: coarse)').matches;

  var yearEl = $('#year');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ------------------------------------------------------------ revelado --
     Cada elemento .rv aparece una sola vez al entrar en pantalla.
     Los titulares .split se revelan línea a línea desde abajo. */
  function setupReveal() {
    var targets = $$('.rv, .split');
    if (reduced || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    targets.forEach(function (el) { io.observe(el); });

    // Los titulares del hero se revelan al cargar, no al hacer scroll.
    requestAnimationFrame(function () {
      $$('.hero .split, .hero .rv').forEach(function (el) { el.classList.add('in'); });
    });
  }

  /* ------------------------------------------------------- barra superior --
     Se vuelve sólida al bajar y cambia a claro u oscuro según la sección
     que tenga detrás, para que el logo siempre se lea. */
  var nav = $('#nav');
  var darkSections = $$('.hero, .section--dark, .speed, footer');

  function updateNav() {
    if (!nav) return;
    var scrolled = window.scrollY > 20;
    nav.classList.toggle('is-stuck', scrolled);

    var probe = nav.offsetHeight * 0.6;
    var overDark = darkSections.some(function (el) {
      var r = el.getBoundingClientRect();
      return r.top <= probe && r.bottom >= probe;
    });
    nav.classList.toggle('is-dark', overDark);
  }

  /* --------------------------------------------------- maqueta 3D del hero --
     Rota con el ratón y se endereza al bajar. Las capas flotantes tienen
     profundidad real en Z, así que el paralaje sale solo. */
  var device = $('#device');
  var targetRx = 7;
  var targetRy = -13;
  var curRx = 7;
  var curRy = -13;

  function setupDeviceTilt() {
    if (!device || reduced || coarse) return;
    var stage = device.parentElement;
    stage.addEventListener('mousemove', function (e) {
      var r = stage.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      targetRy = -13 + px * 18;
      targetRx = 7 - py * 14;
      device.classList.add('is-live');
    }, { passive: true });
    stage.addEventListener('mouseleave', function () {
      targetRy = -13;
      targetRx = 7;
      device.classList.remove('is-live');
    });
  }

  var spin = 0;

  function animateDevice() {
    if (!device || reduced) return;
    // Giro propio y continuo: el objeto está vivo aunque nadie lo toque.
    spin += 0.18;
    var idle = Math.sin(spin * Math.PI / 180) * 9;

    // Al bajar, el sólido se endereza: sensación de "ponerse de frente".
    var progress = clamp(window.scrollY / (window.innerHeight * 0.9), 0, 1);
    var rx = lerp(targetRx, 0, progress);
    var ry = lerp(targetRy + idle, 0, progress);
    curRx = lerp(curRx, rx, 0.09);
    curRy = lerp(curRy, ry, 0.09);
    device.style.setProperty('--rx', curRx.toFixed(2) + 'deg');
    device.style.setProperty('--ry', curRy.toFixed(2) + 'deg');
  }

  /* -------------------------------------------- transformación con scroll --
     El contenedor mide 340vh. Mientras lo recorremos, --p va de 0 a 1 y el
     CSS hace el resto: el barrido, la rotación y la barra de progreso. */
  var morphTrack = $('#morphTrack');
  var morphCard = $('#morphCard');
  var morphSteps = $$('#morphSteps .morph__step');
  var morphFill = $('.morph__fill');

  function updateMorph() {
    if (!morphTrack || reduced) return;
    var r = morphTrack.getBoundingClientRect();
    var total = r.height - window.innerHeight;
    if (total <= 0) return;
    var p = clamp(-r.top / total, 0, 1);
    // Se deja margen al principio y al final para que el usuario "llegue".
    var eased = clamp((p - 0.12) / 0.72, 0, 1);

    morphTrack.style.setProperty('--p', eased.toFixed(4));
    if (morphCard) morphCard.style.setProperty('--p', eased.toFixed(4));
    if (morphFill) morphFill.parentElement.style.setProperty('--p', eased.toFixed(4));

    var active = Math.min(morphSteps.length - 1, Math.floor(eased * morphSteps.length));
    morphSteps.forEach(function (el, i) { el.classList.toggle('on', i === active); });
  }

  /* ------------------------------------------------ progreso de la línea --
     La línea vertical del proceso se va rellenando conforme se lee. */
  var steps = $('#steps');
  var stepsProg = $('#stepsProg');

  function updateSteps() {
    if (!steps || !stepsProg || reduced) return;
    var r = steps.getBoundingClientRect();
    var start = window.innerHeight * 0.75;
    var p = clamp((start - r.top) / (r.height * 0.85), 0, 1);
    steps.style.setProperty('--p', p.toFixed(4));
  }

  /* ----------------------------------------------------------- contador --
     Sube hasta el valor real de generación. No se inventa: son 3 ms. */
  function setupCounter() {
    var el = $('#counter');
    if (!el) return;
    var to = Number(el.getAttribute('data-to')) || 0;
    if (reduced || !('IntersectionObserver' in window)) { el.textContent = String(to); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        var start = null;
        var duration = 1400;
        function tick(ts) {
          if (start === null) start = ts;
          var t = clamp((ts - start) / duration, 0, 1);
          var eased = 1 - Math.pow(1 - t, 4);          // frena al final
          el.textContent = String(Math.round(eased * to));
          if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.5 });
    io.observe(el);
  }

  /* ------------------------------------------------- tarjetas con relieve --
     Inclinación sutil y brillo que sigue al cursor. Solo con ratón. */
  function setupCardTilt() {
    if (reduced || coarse) return;
    $$('.tilt').forEach(function (card) {
      card.addEventListener('mousemove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        card.style.transform = 'perspective(900px) rotateY(' + ((px - 0.5) * 11).toFixed(2)
          + 'deg) rotateX(' + ((0.5 - py) * 11).toFixed(2) + 'deg) translate3d(0,-6px,0)';
      }, { passive: true });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }

  /* ------------------------------------------------ paralaje de las capas --
     Las tarjetas flotantes del hero se mueven a distinta velocidad. */
  var floats = $$('.float');

  function updateFloats() {
    if (reduced || !floats.length) return;
    var y = window.scrollY;
    floats.forEach(function (el, i) {
      if (el.offsetParent === null) return;              // oculta: no se toca
      var depth = [90, 70][i] || 80;
      var shift = y * (0.05 + i * 0.035);
      el.style.transform = 'translate3d(0,' + (-shift).toFixed(1) + 'px,' + depth + 'px)';
    });
  }


  /* ------------------------------------------------ campo de puntos en 3D --
     Proyección en perspectiva escrita a mano: cada punto vive en un volumen
     con coordenadas x, y, z; se rota alrededor del eje Y y se proyecta sobre
     el plano de la pantalla dividiendo por la profundidad. Sin librerías. */
  function setupField() {
    var canvas = $('#field');
    if (!canvas || reduced) return;

    var ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    var DEPTH = 1400;          // profundidad del volumen
    var FOCAL = 620;           // distancia focal de la cámara
    var points = [];
    var w = 0;
    var h = 0;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    function build() {
      var rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Menos puntos en pantallas pequeñas: el coste es de pintado, no de cálculo.
      var count = w < 700 ? 90 : 190;
      points = [];
      for (var i = 0; i < count; i += 1) {
        points.push({
          x: (Math.random() - 0.5) * w * 2.4,
          y: (Math.random() - 0.5) * h * 1.8,
          z: Math.random() * DEPTH,
          s: 0.6 + Math.random() * 1.5,
        });
      }
    }

    var angle = 0;
    var pointerX = 0;
    var pointerY = 0;

    function frame() {
      angle += 0.0016;
      ctx.clearRect(0, 0, w, h);

      var cos = Math.cos(angle);
      var sin = Math.sin(angle);
      var cx = w / 2 + pointerX * 30;
      var cy = h / 2 + pointerY * 20;

      for (var i = 0; i < points.length; i += 1) {
        var p = points[i];

        // Rotación alrededor del eje Y
        var rx = p.x * cos - (p.z - DEPTH / 2) * sin;
        var rz = p.x * sin + (p.z - DEPTH / 2) * cos + DEPTH / 2;

        // Deriva hacia la cámara: al salir por detrás, vuelve al fondo
        p.z -= 0.55;
        if (p.z < 1) p.z = DEPTH;

        var depth = rz + 120;
        if (depth <= 1) continue;

        var scale = FOCAL / depth;
        var sx = cx + rx * scale;
        var sy = cy + p.y * scale;
        if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;

        // Lo cercano se ve más grande y más claro: es lo que da la sensación
        // de profundidad sin necesidad de sombras.
        var size = p.s * scale * 1.5;
        var alpha = Math.min(0.5, scale * 0.5);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.4, size), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      fieldRaf = requestAnimationFrame(frame);
    }

    if (!coarse) {
      window.addEventListener('mousemove', function (e) {
        pointerX = (e.clientX / window.innerWidth) - 0.5;
        pointerY = (e.clientY / window.innerHeight) - 0.5;
      }, { passive: true });
    }

    // Se detiene cuando el hero sale de pantalla: no tiene sentido pintar
    // 190 puntos que nadie ve.
    var running = false;
    function start() { if (!running) { running = true; frame(); } }
    function stop() { if (running) { running = false; cancelAnimationFrame(fieldRaf); } }

    build();
    window.addEventListener('resize', build, { passive: true });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) { if (entry.isIntersecting) start(); else stop(); });
      }, { threshold: 0.01 }).observe(canvas);
    } else start();
  }
  var fieldRaf = 0;

  /* --------------------------------------------------- anillo de sectores --
     Una vuelta completa mientras se recorre el contenedor. */
  var ringTrack = $('#ringTrack');
  var ring = $('#ring');

  /* Giro añadido a mano, en grados. El scroll manda, pero pulsar una flecha o
     una tarjeta de lado suma sobre lo que el scroll ya ha girado. Se anima
     hacia `giroDestino` en el mismo bucle que todo lo demás. */
  var giroManual = 0;
  var giroDestino = 0;
  var PASO = 60;                       // seis tarjetas: 360 / 6

  function girar(grados) {
    giroDestino += grados;
    ring.classList.add('is-turning');
    /* El bucle general solo corre cuando hay scroll o resize. Un giro a mano
       no genera ninguno de los dos, asi que sin esto la animacion se quedaria
       congelada en el sitio y la clase `is-turning` no se quitaria nunca. */
    if (!girando) { girando = true; requestAnimationFrame(animarGiro); }
  }

  var girando = false;

  function animarGiro() {
    updateRing();
    if (Math.abs(giroDestino - giroManual) > 0.05) {
      requestAnimationFrame(animarGiro);
      return;
    }
    // Cerrar aqui, no dentro de updateRing: ese solo vuelve a correr si hay
    // scroll, y sin scroll la clase se quedaba puesta dejando las tarjetas
    // sordas al puntero para siempre.
    giroManual = giroDestino;
    ring.classList.remove('is-turning');
    updateRing();
    girando = false;
  }

  function updateRing() {
    if (!ringTrack || !ring || reduced) return;
    var r = ringTrack.getBoundingClientRect();
    var total = r.height - window.innerHeight;
    if (total <= 0) return;
    var p = clamp(-r.top / total, 0, 1);
    // Margen al principio y al final para que la primera y la última tarjeta
    // se queden quietas de frente un momento.
    var eased = clamp((p - 0.1) / 0.8, 0, 1);

    // Acercarse al giro pedido a mano. Un 12% por fotograma frena solo al
    // llegar, sin necesidad de contar el tiempo ni de una curva aparte.
    if (Math.abs(giroDestino - giroManual) > 0.05) {
      giroManual += (giroDestino - giroManual) * 0.12;
    }

    var turn = eased * 360 + giroManual;
    ring.style.setProperty('--deg', turn.toFixed(2) + 'deg');

    // Cuánto mira cada tarjeta a la cámara: 1 de frente, 0 de espaldas.
    var cards = ring.children;
    for (var i = 0; i < cards.length; i += 1) {
      var delta = ((i * PASO - turn) % 360 + 360) % 360;
      if (delta > 180) delta = 360 - delta;
      var facing = Math.max(0, 1 - delta / 70);
      cards[i].style.setProperty('--f', facing.toFixed(3));
      /* Solo la tarjeta que mira de frente abre su demo. Una girada de canto
         mide unos pocos píxeles en pantalla: imposible de pulsar a propósito y
         facilísima de pulsar por error. Las demás sí se pueden pulsar, pero
         para traerlas al frente, no para abrir nada. */
      cards[i].classList.toggle('is-front', facing > 0.85);
    }
  }

  /* Pulsar una tarjeta que no está de frente la trae al frente en vez de
     abrirla. Es lo que la gente intenta hacer nada más ver el anillo. */
  function setupRingClicks() {
    if (!ring || reduced) return;
    var cards = Array.prototype.slice.call(ring.children);

    cards.forEach(function (card, i) {
      card.addEventListener('click', function (e) {
        if (card.classList.contains('is-front')) return;   // deja abrir la demo
        e.preventDefault();
        // Girar por el camino más corto hasta poner esta tarjeta de frente.
        var turn = parseFloat(ring.style.getPropertyValue('--deg')) || 0;
        var actual = ((turn % 360) + 360) % 360;
        var objetivo = i * PASO;
        var d = ((objetivo - actual) % 360 + 360) % 360;
        if (d > 180) d -= 360;
        girar(d);
      });
    });

    $$('[data-ring]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        girar(btn.getAttribute('data-ring') === 'prev' ? -PASO : PASO);
      });
    });

    // Flechas del teclado cuando el anillo tiene el foco.
    ring.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { girar(-PASO); e.preventDefault(); }
      if (e.key === 'ArrowRight') { girar(PASO); e.preventDefault(); }
    });
  }

  /* ------------------------------------------------------- bucle único --
     Todo lo que depende del scroll se calcula en un solo frame. */
  var ticking = false;

  function onFrame() {
    updateNav();
    updateMorph();
    updateSteps();
    updateRing();
    updateFloats();
    animateDevice();
    ticking = false;
  }

  function requestFrame() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onFrame);
  }

  // La maqueta necesita frames continuos para suavizar la inercia del ratón.
  function loop() {
    animateDevice();
    requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------- formulario --
     Todavía no hay backend. Se dice, en vez de fingir que se ha enviado. */
  function setupForm() {
    var form = $('form.form');
    if (!form) return;
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      var button = form.querySelector('button[type=submit]');
      var note = form.querySelector('p.full');
      button.disabled = true;
      button.textContent = 'Formulario no conectado';
      if (note) {
        note.innerHTML = '<strong style="color:#fff">Este formulario todavía no envía nada.</strong> '
          + 'Falta conectar el buzón de la empresa. Escríbenos directamente mientras tanto.';
      }
    });
  }

  /* ------------------------------------------------------------- arranque -- */
  setupReveal();
  setupRingClicks();
  setupField();
  setupDeviceTilt();
  setupCardTilt();
  setupCounter();
  setupForm();

  window.addEventListener('scroll', requestFrame, { passive: true });
  window.addEventListener('resize', requestFrame, { passive: true });
  requestFrame();
  if (!reduced && !coarse) loop();
}());
