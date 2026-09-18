/* ===========================================================================
   VANGUARD TECH — movimiento
   ---------------------------------------------------------------------------
   Dos sistemas, un solo bucle:

     · SCROLL manda en la historia. Cada seccion con relato (el hero, las
       cuatro etapas, el proceso, el anillo de sectores y el escaparate)
       calcula su propio progreso 0..1 a partir de la posicion de su
       contenedor y escribe variables CSS. La animacion no "se dispara": es
       una funcion directa de donde esta el scroll, asi que se puede parar a
       media vuelta y volver atras.

     · EL RATON manda en la luz y en el relieve, y siempre SUMA sobre lo que
       el scroll ya decidio. Nunca compiten por la misma propiedad.

   El bucle solo corre cuando hay algo que mover: un scroll, un cambio de
   tamaño, o un puntero que se ha movido hace menos de unos fotogramas. En
   reposo no se pide ni un frame.

   Sin dependencias. Si el usuario prefiere menos movimiento, no se anima nada.
   =========================================================================== */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  /* Rampa suave entre dos puntos del scroll: 0 antes de `a`, 1 despues de `b`,
     y una curva sin esquinas en medio. Es la pieza con la que se monta todo
     el relato, para que nada empiece ni termine de golpe. */
  var ramp = function (v, a, b) {
    var t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

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

  /* ------------------------------------------------- visible o no visible --
     Nada de lo que esta fuera de pantalla se recalcula. Un observador por
     seccion con relato pone su bandera; el bucle consulta la bandera antes de
     medir. Sin esto, cada fotograma media siete contenedores aunque solo se
     vea uno. */
  var seen = {};
  /* Cuando una seccion ENTRA en pantalla hay que recalcularla aunque el scroll
     no se haya movido desde el ultimo fotograma. Pasa siempre que se llega de
     un salto — pulsar "Pricing" en el menu, abrir la pagina con un ancla, o un
     arrastre rapido en el que el observador avisa despues del ultimo evento de
     scroll. Sin esta bandera, el bucle veia "misma posicion que antes", se
     saltaba la pasada y la seccion se quedaba sin pintar hasta que el usuario
     moviese la rueda un pixel. */
  var needPass = false;

  function watch(el, key) {
    if (!el) return;
    seen[key] = true;                                  // por si no hay soporte
    if (!('IntersectionObserver' in window)) return;
    seen[key] = false;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (seen[key] === e.isIntersecting) return;
        seen[key] = e.isIntersecting;
        if (e.isIntersecting) needPass = true;
      });
      schedule();
    }, { rootMargin: '10% 0px' }).observe(el);
  }

  /* ------------------------------------------------------- barra superior --
     Se vuelve sólida al bajar y cambia a claro u oscuro según la sección
     que tenga detrás, para que el logo siempre se lea. */
  var nav = $('#nav');
  var darkSections = $$('.hero, .section--dark, .speed, .burst, footer');
  /* Las secciones con tinte (#f5f6f8) son las unicas claras donde una luz
     blanca hace algo: las levanta hacia el blanco puro. Sobre blanco puro no
     ilumina nada, asi que ahi la luz se apaga en vez de ensuciar el texto. */
  var tintSections = $$('.section--tint, .morph');

  function inBand(list, y) {
    return list.some(function (el) {
      var r = el.getBoundingClientRect();
      return r.top <= y && r.bottom >= y;
    });
  }

  function overDark(y) { return inBand(darkSections, y); }
  function overTint(y) { return inBand(tintSections, y); }

  function updateNav() {
    if (!nav) return;
    nav.classList.toggle('is-stuck', window.scrollY > 20);
    nav.classList.toggle('is-dark', overDark(nav.offsetHeight * 0.6));
  }

  /* ===========================================================================
     LUZ DEL CURSOR
     La capa `.spot` es un circulo de tamaño fijo que se mueve con `transform`:
     el navegador solo la recompone, no la repinta. La posicion va con inercia
     (12% por fotograma) porque una luz que se pega al puntero parece un
     puntero, y una que llega con un retardo minimo parece luz.

     Se enciende SOLO sobre las secciones oscuras. Una luz blanca en modo
     `screen` sobre fondo blanco no ilumina: lava el texto.
     =========================================================================== */
  var spot = $('#spot');
  var pointerX = -999;
  var pointerY = -999;
  var lightX = -999;
  var lightY = -999;
  var hasPointer = false;

  function updateSpot() {
    if (!spot || reduced || coarse) return false;
    if (!hasPointer) return false;
    lightX = lerp(lightX, pointerX, 0.12);
    lightY = lerp(lightY, pointerY, 0.12);
    spot.style.setProperty('--sx', lightX.toFixed(1) + 'px');
    spot.style.setProperty('--sy', lightY.toFixed(1) + 'px');
    /* Dos intensidades, nunca las dos a la vez: sobre negro la luz se ve como
       luz, sobre tinte como un realce muy corto, y sobre blanco puro no se
       enciende. Asi la pagina entera responde al puntero sin brillar siempre. */
    var dark = overDark(pointerY);
    spot.classList.toggle('is-on', dark);
    spot.classList.toggle('is-on-light', !dark && overTint(pointerY));
    // El metal del titular del hero se mueve con la luz.
    if (hero) hero.style.setProperty('--lx', (20 + (pointerX / window.innerWidth) * 60).toFixed(1) + '%');
    return Math.abs(pointerX - lightX) > 0.4 || Math.abs(pointerY - lightY) > 0.4;
  }

  /* ===========================================================================
     HERO — la maqueta cuenta el relato
     El contenedor mide 240vh en pantallas anchas y altas; dentro, un panel
     pegajoso. Mientras se recorre: el texto se va, el solido gira y se acerca,
     se abre en sus tres capas (estructura, contenido, publicado) y se vuelve a
     cerrar de frente.

     La condicion del modo pegajoso esta DUPLICADA en styles.css. En una
     pantalla baja el texto del hero no cabe en 100svh y un panel pegajoso mas
     alto que la ventana esconderia su mitad de abajo para siempre; ahi el hero
     se queda normal y la maqueta se transforma con el scroll de salida.
     =========================================================================== */
  var hero = $('.hero');
  var heroTrack = $('#heroTrack');
  var heroCopy = $('#heroCopy');
  var heroCaps = $$('#heroCaps .hero__cap');
  var device = $('#device');
  var stage = device ? device.parentElement : null;
  /* El relato completo del hero (texto que se va, capas que se abren, objeto
     que se centra) solo cabe si el panel se queda pegado, y eso solo pasa en
     pantallas anchas Y altas. La condicion es la MISMA que en styles.css: si
     cambia una, cambia la otra. Donde no cabe, el hero es normal y la maqueta
     se limita a girar con el scroll, que es lo que si funciona en un movil. */
  var mqFull = window.matchMedia('(min-width:1040px) and (min-height:680px)');

  // Inclinacion que aporta el raton, en -0.5..0.5. Se SUMA al giro del scroll.
  var tiltX = 0;
  var tiltY = 0;
  var curRx = 7;
  var curRy = -13;
  var spin = 0;
  var heroP = 0;

  function setupDeviceTilt() {
    if (!device || !stage || reduced || coarse) return;
    stage.addEventListener('mousemove', function (e) {
      var r = stage.getBoundingClientRect();
      tiltY = clamp((e.clientX - r.left) / r.width - 0.5, -0.5, 0.5);
      tiltX = clamp((e.clientY - r.top) / r.height - 0.5, -0.5, 0.5);
      device.classList.add('is-live');
      energy = 10;
      schedule();
    }, { passive: true });
    stage.addEventListener('mouseleave', function () {
      tiltX = 0;
      tiltY = 0;
      device.classList.remove('is-live');
      energy = 30;
      schedule();
    });
  }

  function heroProgress() {
    if (!heroTrack) return 0;
    var r = heroTrack.getBoundingClientRect();
    var total = r.height - window.innerHeight;
    // Sin recorrido (pantalla baja o estrecha): el progreso es la salida del
    // hero, asi la maqueta sigue transformandose mientras se abandona.
    if (total <= 8) return clamp(-r.top / (window.innerHeight * 0.9), 0, 1);
    return clamp(-r.top / total, 0, 1);
  }

  function updateHero() {
    if (!device) return;
    if (reduced) return;

    var p = seen.hero ? heroProgress() : heroP;
    heroP = p;

    /* El texto se va entre el 10% y el 40% del recorrido. Cuando ya no se ve,
       `inert` lo saca del tabulador: dos botones invisibles no deben poder
       recibir el foco. */
    var full = mqFull.matches;
    var exit = full ? ramp(p, 0.10, 0.40) : 0;
    if (heroCopy) {
      heroCopy.style.setProperty('--exit', exit.toFixed(3));
      var gone = exit > 0.86;
      if (heroCopy.inert !== gone) heroCopy.inert = gone;
    }
    if (hero) hero.style.setProperty('--exit', exit.toFixed(3));

    /* Abanico: se abre, se queda abierto y se cierra. Nada se reinicia. */
    var fan = full ? ramp(p, 0.32, 0.58) * (1 - ramp(p, 0.70, 0.93)) : 0;
    device.style.setProperty('--fan', fan.toFixed(3));

    /* Giro: el objeto se pone de medio perfil, ensena el canto y acaba de
       frente. El raton suma sobre esa base. El balanceo propio solo existe en
       reposo, para que no pelee con el relato. */
    var idle = p < 0.06 ? Math.sin((spin += 0.16) * Math.PI / 180) * 7 : 0;
    // Sin panel pegajoso el giro es mas corto: el recorrido es la salida del
    // hero, no dos pantallas y media.
    var half = full ? 0.5 : 0.7;
    var baseRy = lerp(-13, full ? 24 : 12, ramp(p, 0, half)) * (1 - ramp(p, 0.72, 1));
    var baseRx = lerp(7, full ? -7 : -3, ramp(p, 0, half)) * (1 - ramp(p, 0.72, 1));
    var rx = baseRx - tiltX * 11;
    var ry = baseRy + tiltY * 15 + idle;

    curRx = lerp(curRx, rx, 0.12);
    curRy = lerp(curRy, ry, 0.12);
    device.style.setProperty('--rx', curRx.toFixed(2) + 'deg');
    device.style.setProperty('--ry', curRy.toFixed(2) + 'deg');

    /* Se acerca y se centra cuando el texto deja el sitio libre. */
    /* La escala se mueve a saltos de 0,02. Un giro solo recompone una capa ya
       pintada, pero un cambio de escala obliga a volver a rasterizar todo el
       subarbol — y dentro de la maqueta hay texto pequeño. A saltos, el ojo no
       ve la diferencia y el navegador rasteriza ocho veces en vez de doscientas. */
    var sc = 1 + (full ? 0.17 : 0.05) * ramp(p, 0.1, 0.62) - 0.04 * ramp(p, 0.8, 1);
    device.style.setProperty('--sc', (Math.round(sc / 0.02) * 0.02).toFixed(2));
    // Se centra en la pantalla a medida que el texto se va: el objeto ocupa el
    // sitio que deja, en vez de quedarse en su columna con medio hero vacio.
    device.style.setProperty('--dx', (-Math.min(240, window.innerWidth * 0.16) * exit).toFixed(1) + 'px');
    // 22 px de subida en el movil serian un salto sobre un hero corto.
    device.style.setProperty('--dy', ((full ? -22 : -8) * ramp(p, 0.2, 1)).toFixed(1) + 'px');

    /* Los tres rotulos: uno por momento del relato. */
    var cap = p < 0.40 ? 0 : (p < 0.68 ? 1 : 2);
    heroCaps.forEach(function (el, i) { el.classList.toggle('on', i === cap); });

    return Math.abs(rx - curRx) > 0.05 || Math.abs(ry - curRy) > 0.05;
  }

  /* --------------------------------------------- paralaje de las pastillas --
     Las dos chapas de dato del hero se mueven a distinta velocidad. */
  var floats = $$('.float');

  function updateFloats() {
    if (reduced || !floats.length || !seen.hero) return;
    var y = window.scrollY;
    floats.forEach(function (el, i) {
      if (el.offsetParent === null) return;              // oculta: no se toca
      var depth = [150, 130][i] || 140;
      var shift = y * (0.04 + i * 0.03);
      el.style.transform = 'translate3d(0,' + (-shift).toFixed(1) + 'px,' + depth + 'px)';
    });
  }

  /* ===========================================================================
     LAS CUATRO ETAPAS — un prisma de cuatro caras
     Cada cara es una pantalla real del mismo negocio: la web que hay, la
     auditoria con sus 13 comprobaciones, la propuesta montandose y la web
     publicada. El scroll gira el conjunto 270 grados, de la primera cara a la
     ultima, sin saltos.
     =========================================================================== */
  var morphTrack = $('#morphTrack');
  var morphPrism = $('#morphPrism');
  var morphStepsBox = $('#morphSteps');
  var morphSteps = $$('#morphSteps .morph__step');
  var stgs = morphPrism ? Array.prototype.slice.call(morphPrism.children) : [];
  var audit = $('.audit__scan');
  var propBar = $('.prop__bar i');

  /* ------------------------------------------------------------- mesetas --
     Un giro lineal deja el objeto SIEMPRE a medio girar: nunca se lee ninguna
     cara del todo. Con meseta, cada cara se queda quieta de frente la primera
     mitad de su tramo y gira deprisa en la segunda. El scroll sigue mandando
     (mismo sitio, mismo fotograma), pero el relato tiene pausas.

     `k` caras reparten el recorrido en k tramos: en los k-1 primeros se pasa a
     la cara siguiente y el ultimo es la pausa final. */
  function stepTurn(eased, k, step) {
    var x = eased * k;
    var i = Math.min(k - 1, Math.floor(x));
    var turn = step * i;
    if (i < k - 1) turn += step * ramp(x - i, 0.5, 0.94);
    return turn;
  }

  /* Cuanto mira una cara a la camara: 1 de frente, 0 de canto o de espaldas.
     Sirve igual para el prisma de cuatro caras, el anillo de seis y el
     escaparate de tres; solo cambia el paso. */
  function facing(i, step, turn, span) {
    var delta = ((i * step - turn) % 360 + 360) % 360;
    if (delta > 180) delta = 360 - delta;
    return Math.max(0, 1 - delta / span);
  }

  /* Escribe las dos versiones de la misma señal: --f continua, para la opacidad
     (recomponer es gratis), y --fq en pasos de 0,1 para la escala (rasterizar
     no lo es). */
  function setFacing(el, f) {
    el.style.setProperty('--f', f.toFixed(3));
    el.style.setProperty('--fq', (Math.round(f * 10) / 10).toFixed(1));
  }

  function updateMorph() {
    if (!morphTrack || reduced || !seen.morph) return;
    var r = morphTrack.getBoundingClientRect();
    var total = r.height - window.innerHeight;
    if (total <= 0) return;
    var p = clamp(-r.top / total, 0, 1);
    // Margen al principio y al final para que la primera y la ultima etapa se
    // queden quietas de frente un momento.
    var eased = clamp((p - 0.08) / 0.84, 0, 1);

    var turn = stepTurn(eased, stgs.length, 90);
    if (morphPrism) morphPrism.style.setProperty('--deg', turn.toFixed(2) + 'deg');
    for (var i = 0; i < stgs.length; i += 1) {
      stgs[i].style.setProperty('--f', facing(i, 90, turn, 62).toFixed(3));
    }

    // Texto y rail: la etapa activa manda, las anteriores quedan tenues.
    var active = Math.min(morphSteps.length - 1, Math.round(turn / 90));
    morphSteps.forEach(function (el, k) {
      el.classList.toggle('on', k === active);
      el.classList.toggle('done', k < active);
    });
    // El rail se rellena con el giro: llega al nodo cuando la cara llega de
    // frente, no antes.
    if (morphStepsBox) {
      morphStepsBox.style.setProperty('--p', (turn / 270).toFixed(4));
    }

    // Barrido de la auditoria y montaje de la propuesta: cada uno dentro de su
    // propio tramo, asi que solo se mueven cuando su cara se esta viendo.
    if (audit) audit.style.setProperty('--scan', ramp(eased, 0.26, 0.48).toFixed(3));
    if (propBar) propBar.style.setProperty('--build', (0.15 + 0.85 * ramp(eased, 0.52, 0.74)).toFixed(3));
  }

  /* ===========================================================================
     PROCESO — la etapa activa manda
     La linea vertical se rellena conforme se lee, y el paso que queda a la
     altura de lectura se enciende mientras los demas bajan de intensidad.
     =========================================================================== */
  var steps = $('#steps');
  var stepEls = $$('#steps .step');

  function updateSteps() {
    if (!steps || reduced || !seen.steps) return;
    var r = steps.getBoundingClientRect();
    var start = window.innerHeight * 0.75;
    steps.style.setProperty('--p', clamp((start - r.top) / (r.height * 0.85), 0, 1).toFixed(4));

    // El paso mas cercano a la linea de lectura es el activo.
    var line = window.innerHeight * 0.46;
    var best = -1;
    var bestD = Infinity;
    stepEls.forEach(function (el, i) {
      var b = el.getBoundingClientRect();
      var d = Math.abs(b.top + b.height / 2 - line);
      if (d < bestD) { bestD = d; best = i; }
    });
    stepEls.forEach(function (el, i) {
      el.classList.toggle('is-active', i === best);
      el.classList.toggle('is-dim', i !== best);
    });
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
        // 8 grados, no 11: con el filo iluminado ya se nota el volumen, y
        // cuanto menos se mueve la ficha, mas caro parece el movimiento.
        card.style.transform = 'perspective(1000px) rotateY(' + ((px - 0.5) * 8).toFixed(2)
          + 'deg) rotateX(' + ((0.5 - py) * 8).toFixed(2) + 'deg) translate3d(0,-6px,0)';
      }, { passive: true });
      card.addEventListener('mouseleave', function () {
        card.style.transform = '';
      });
    });
  }

  /* ----------------------------------------------- brillo en toda la pagina --
     `.tilt` ya movia --mx/--my en las fichas. El resto de superficies que se
     pueden señalar (las preguntas, los pasos, las tarjetas del anillo, los
     botones de demo) usan la MISMA variable, pero con un solo oyente delegado
     en el documento en lugar de uno por elemento: se busca el ancestro que
     responde y se le escriben sus dos numeros. Un elemento por fotograma,
     ninguna medicion de los demas. */
  var GLOW_SEL = '.faq summary, .demo-btn, .hero__stat, .speed__item, .step';
  var lastGlow = null;

  function setupAmbientGlow() {
    if (reduced || coarse) return;
    document.addEventListener('mousemove', function (e) {
      var el = e.target && e.target.closest ? e.target.closest(GLOW_SEL) : null;
      if (el !== lastGlow) {
        if (lastGlow) { lastGlow.style.removeProperty('--mx'); lastGlow.style.removeProperty('--my'); }
        lastGlow = el;
      }
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      el.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
      el.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
    }, { passive: true });
  }

  /* -------------------------------------------------------- iman de botones --
     El boton sigue al cursor seis pixeles. Es suficiente para que la mano lo
     note y demasiado poco para que parezca que se escapa. */
  function setupMagnets() {
    if (reduced || coarse) return;
    $$('.btn, .ring-ctrl button, .show-link').forEach(function (btn) {
      btn.addEventListener('mousemove', function (e) {
        var r = btn.getBoundingClientRect();
        btn.style.setProperty('--tx', clamp((e.clientX - r.left - r.width / 2) * 0.16, -6, 6).toFixed(1) + 'px');
        btn.style.setProperty('--ty', clamp((e.clientY - r.top - r.height / 2) * 0.16, -4, 4).toFixed(1) + 'px');
      }, { passive: true });
      btn.addEventListener('mouseleave', function () {
        btn.style.setProperty('--tx', '0px');
        btn.style.setProperty('--ty', '0px');
      });
    });
  }

  /* ------------------------------------------------ campo de puntos en 3D --
     Proyección en perspectiva escrita a mano: cada punto vive en un volumen
     con coordenadas x, y, z; se rota alrededor del eje Y y se proyecta sobre
     el plano de la pantalla dividiendo por la profundidad. Sin librerías. */
  var fieldRaf = 0;

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
    // 1,5 en vez de 2: son puntos difusos de menos de 3 px, y a 2x hay que
    // pintar el doble de pixeles para no ver ninguna diferencia.
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    function build() {
      var rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Menos puntos en pantallas pequeñas: el coste es de pintado, no de cálculo.
      var count = w < 700 ? 60 : 120;
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

    function frame() {
      angle += 0.0016;
      ctx.clearRect(0, 0, w, h);

      var cos = Math.cos(angle);
      var sin = Math.sin(angle);
      var px = hasPointer ? (pointerX / window.innerWidth) - 0.5 : 0;
      var py = hasPointer ? (pointerY / window.innerHeight) - 0.5 : 0;
      var cx = w / 2 + px * 30;
      var cy = h / 2 + py * 20;

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
        ctx.globalAlpha = Math.min(0.5, scale * 0.5);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.4, size), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      fieldRaf = requestAnimationFrame(frame);
    }

    // Se detiene cuando el hero sale de pantalla: no tiene sentido pintar
    // 160 puntos que nadie ve.
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

  /* ===========================================================================
     ANILLO DE SECTORES — una vuelta completa mientras se recorre
     =========================================================================== */
  var ringTrack = $('#ringTrack');
  var ring = $('#ring');

  /* Giro añadido a mano, en grados. El scroll manda, pero pulsar una flecha o
     una tarjeta de lado suma sobre lo que el scroll ya ha girado. */
  var giroManual = 0;
  var giroDestino = 0;
  var PASO = 60;                       // seis tarjetas: 360 / 6
  var cardCount = ring ? ring.children.length : 0;

  function girar(grados) {
    giroDestino += grados;
    ring.classList.add('is-turning');
    energy = 90;                       // frames suficientes para llegar
    schedule();
  }

  function updateRing() {
    if (!ringTrack || !ring || reduced || !seen.ring) return false;
    var r = ringTrack.getBoundingClientRect();
    var total = r.height - window.innerHeight;
    if (total <= 0) return false;
    var p = clamp(-r.top / total, 0, 1);
    var eased = clamp((p - 0.1) / 0.8, 0, 1);

    // Acercarse al giro pedido a mano: un 12% por fotograma frena solo al
    // llegar, sin contar el tiempo ni una curva aparte.
    var moving = Math.abs(giroDestino - giroManual) > 0.05;
    if (moving) giroManual += (giroDestino - giroManual) * 0.12;
    else if (ring.classList.contains('is-turning')) {
      giroManual = giroDestino;
      ring.classList.remove('is-turning');
    }

    var turn = stepTurn(eased, cardCount, PASO) + giroManual;
    ring.style.setProperty('--deg', turn.toFixed(2) + 'deg');

    var cards = ring.children;
    for (var i = 0; i < cardCount; i += 1) {
      var f = facing(i, PASO, turn, 70);
      setFacing(cards[i], f);
      /* Solo la tarjeta que mira de frente abre su demo. Una girada de canto
         mide unos pocos píxeles en pantalla: imposible de pulsar a propósito y
         facilísima de pulsar por error. Las demás sí se pueden pulsar, pero
         para traerlas al frente, no para abrir nada. */
      cards[i].classList.toggle('is-front', f > 0.85);
    }
    return moving;
  }

  function setupRingClicks() {
    if (!ring || reduced) return;
    Array.prototype.slice.call(ring.children).forEach(function (card, i) {
      card.addEventListener('click', function (e) {
        if (card.classList.contains('is-front')) return;   // deja abrir la demo
        e.preventDefault();
        // Girar por el camino más corto hasta poner esta tarjeta de frente.
        var turn = parseFloat(ring.style.getPropertyValue('--deg')) || 0;
        var actual = ((turn % 360) + 360) % 360;
        var d = ((i * PASO - actual) % 360 + 360) % 360;
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

  /* ===========================================================================
     ESCAPARATE — tres webs sobre un eje
     Restaurante, barberia y gimnasio. El scroll gira el conjunto 240 grados:
     cada una entra de frente, se queda y se va de canto. No hay cambio de
     imagen — es el mismo objeto girando.
     =========================================================================== */
  var showTrack = $('#showTrack');
  var showRing = $('#showRing');
  var showStage = $('.show-stage');
  var showCards = showRing ? Array.prototype.slice.call(showRing.children) : [];
  var showMetas = $$('#showMeta .show-meta__item');
  var showProg = $$('#showProg i');
  var showActive = 0;

  function updateShow() {
    if (!showTrack || !showRing || reduced || !seen.show) return;
    var r = showTrack.getBoundingClientRect();
    var total = r.height - window.innerHeight;
    var eased = 0;
    if (total > 0) eased = clamp((clamp(-r.top / total, 0, 1) - 0.08) / 0.84, 0, 1);

    var turn = stepTurn(eased, showCards.length, 120);
    showRing.style.setProperty('--deg', turn.toFixed(2) + 'deg');
    var maxF = 0;
    for (var i = 0; i < showCards.length; i += 1) {
      var f = facing(i, 120, turn, 64);
      if (f > maxF) maxF = f;
      setFacing(showCards[i], f);
    }
    // La sombra de contacto sigue a la tarjeta de delante: si ninguna esta de
    // frente (a media vuelta) casi desaparece, como pasaria de verdad.
    if (showStage) showStage.style.setProperty('--ground', (0.25 + 0.75 * maxF).toFixed(2));

    var active = Math.min(showCards.length - 1, Math.round(turn / 120));
    if (active === showActive) return;
    showActive = active;
    showMetas.forEach(function (el, k) { el.classList.toggle('on', k === active); });
    showProg.forEach(function (el, k) { el.classList.toggle('on', k === active); });
  }

  /* ------------------------------------------------------ selector de color --
     Cambia el acento de LA DEMO que se esta mirando, no el de Vanguard Tech.
     Es el unico sitio de la web donde el color es una eleccion y no un dato.
     Cada grupo manda sobre su propia tarjeta. */
  function setupTones() {
    showMetas.forEach(function (meta, i) {
      var card = showCards[i];
      if (!card) return;
      var group = $$('button[data-tone]', meta);
      group.forEach(function (btn) {
        btn.addEventListener('click', function () {
          var mock = $('.mock', card);
          if (mock) mock.style.setProperty('--tone', btn.getAttribute('data-tone'));
          group.forEach(function (b) { b.setAttribute('aria-pressed', String(b === btn)); });
        });
      });
    });
  }


  /* ===========================================================================
     EL PRECIO — HAZ DE LUZ CONTROLADO POR EL SCROLL
     Un lienzo, entre treinta y cuarenta y seis trazos, y una sola funcion:
     posicion del scroll -> geometria. No hay temporizadores ni estados: si se
     para a media altura, la escena se queda exactamente ahi, y al subir se
     deshace por el mismo camino.

     Tres tramos que se solapan: nacer (los trazos aparecen juntos en el
     centro), abrirse (se separan hasta la maxima dispersion) y recogerse (se
     ordenan en un halo corto alrededor del numero). El numero sube de opacidad
     con el tercero, asi que cuando el haz se cierra ya esta ahi: no aparece de
     la nada.

     Los tonos son apagados y dos de cada siete son plata, para que el conjunto
     no se lea como un arcoiris. Cada trazo se pinta dos veces — uno ancho y
     casi transparente, otro fino y solido — que es la forma barata de tener
     borde suave sin `shadowBlur`.
     =========================================================================== */
  var burstTrack = $('#burstTrack');
  var burstCanvas = $('#burstCanvas');
  var burstStick = burstCanvas ? burstCanvas.parentElement : null;
  var burstCenter = $('.burst__center');
  var safeX = 0;
  var safeY = 0;
  var burstCtx = null;
  var rays = [];
  var burstW = 0;
  var burstH = 0;
  var burstLast = -1;

  /* Siete tonos, y cinco son metal. El haz tenia un naranja, un rosa, un
     morado, un coral y un amarillo: sobre negro cada uno por separado es
     sobrio, pero cuarenta y cuatro trazos juntos se leen como un arcoiris, que
     es justo lo que la marca no es.

     Ahora la escena es plata y grafito con UN hilo de bronce. El bronce esta
     ahi porque el precio es el unico dato de la pagina que pide atencion; si
     hubiera un segundo color, ninguno de los dos significaria nada. */
  var RAY_COLORS = [
    '#e9ecf1',   /* plata clara */
    '#aeb6c2',   /* plata */
    '#9aa2ae',   /* plata media */
    '#c9a06a',   /* bronce apagado — el unico acento */
    '#8d949f',   /* grafito claro */
    '#6d7684',   /* grafito */
    '#b98e58'    /* bronce, mas cerrado */
  ];

  function buildBurst() {
    if (!burstCanvas) return;
    var r = burstCanvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    burstW = r.width;
    burstH = r.height;
    burstCanvas.width = Math.round(burstW * dpr);
    burstCanvas.height = Math.round(burstH * dpr);
    burstCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* Rectangulo que ocupan el precio y su texto. Al recogerse, ningun trazo
       entra aqui: el numero no compite con el haz. Se mide una vez por
       tamaño de ventana, no en cada fotograma. */
    if (burstCenter) {
      var box = burstCenter.getBoundingClientRect();
      safeX = box.width / 2 + 26;
      safeY = box.height / 2 + 18;
    }

    var n = burstW < 700 ? 26 : 44;
    rays = [];
    for (var i = 0; i < n; i += 1) {
      // Reparto regular con un poco de desorden: un abanico perfecto parece
      // una rueda de bicicleta, y uno al azar parece ruido.
      var a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.14;
      rays.push({
        a: a,
        spin: (Math.random() - 0.5) * 0.7,
        len: 0.55 + Math.random() * 0.55,
        /* Trazos finos, no capsulas. A 6–14 px el haz parecia un juego de
           fichas de colores; a 2–6 px parece luz, que es lo que cuenta. El
           cuerpo suave lo sigue poniendo el doble trazado de mas abajo. */
        wd: (burstW < 700 ? 1.6 : 2.2) + Math.random() * (burstW < 700 ? 2.2 : 3.6),
        col: RAY_COLORS[i % RAY_COLORS.length]
      });
    }
    burstLast = -1;
  }

  function drawBurst(p) {
    if (!burstCtx) return;
    burstCtx.clearRect(0, 0, burstW, burstH);

    var cx = burstW / 2;
    var cy = burstH / 2;
    var R = Math.max(burstW, burstH) * 0.62;

    var born = ramp(p, 0.02, 0.20);
    var grow = ramp(p, 0.04, 0.44);
    var pull = ramp(p, 0.46, 0.92);

    // Agujero central: crece al recogerse, asi que el halo final nunca pisa el
    // numero. El numero va encima del lienzo, pero un trazo cruzandolo por
    // detras al final restaria legibilidad.
    var hole = lerp(0.0, 0.3, pull) * R;

    burstCtx.lineCap = 'round';
    for (var i = 0; i < rays.length; i += 1) {
      var ray = rays[i];
      // Nacen en un anillo apretado (0,12 R), no en el punto exacto: en el
      // centro los taparia el numero y no se veria nacer nada.
      // La maxima dispersion es 0,72 R, no 0,95: por encima de eso los trazos
      // se van todos fuera del encuadre y queda un fotograma vacio justo entre
      // la explosion y la recogida — un agujero en el relato.
      var spread = lerp(lerp(0.12, 0.72, grow), 0.32, pull);
      var len = lerp(lerp(0.05, 0.34, grow), 0.13, pull) * (0.6 + 0.8 * ray.len);
      var alpha = lerp(born * 0.9, 0.55, pull);
      if (alpha <= 0.004) continue;

      // Giran al abrirse y deshacen el giro al ordenarse: el movimiento no es
      // solo radial, tiene inercia.
      var ang = ray.a + ray.spin * (grow * 0.55 - pull * 0.5);
      var ca = Math.cos(ang);
      var sa = Math.sin(ang);
      /* Distancia del centro al borde del rectangulo del precio en ESTA
         direccion. Al recogerse (pull = 1) es el suelo del trazo, asi que el
         halo final rodea el texto en vez de cruzarlo — y funciona igual con un
         bloque ancho de escritorio o alto de movil. */
      var rSafe = Math.min(safeX / Math.max(Math.abs(ca), 1e-4),
                           safeY / Math.max(Math.abs(sa), 1e-4));
      // El agujero es un SUELO, no un desplazamiento: si se suma, al recogerse
      // los trazos se van al borde en vez de cerrarse alrededor del numero.
      var r0 = Math.max(hole, rSafe * pull, spread * R * (0.3 + 0.7 * ray.len));
      var r1 = r0 + len * R;

      burstCtx.strokeStyle = ray.col;
      burstCtx.beginPath();
      burstCtx.moveTo(cx + ca * r0, cy + sa * r0);
      burstCtx.lineTo(cx + ca * r1, cy + sa * r1);
      burstCtx.globalAlpha = alpha * 0.17;
      burstCtx.lineWidth = ray.wd * 4.2;
      burstCtx.stroke();
      burstCtx.globalAlpha = alpha;
      burstCtx.lineWidth = ray.wd;
      burstCtx.stroke();
    }

    // Luz de fondo detras del numero: lo separa del haz sin taparlo.
    var lift = ramp(p, 0.3, 0.95);
    if (lift > 0.01) {
      var g = burstCtx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5);
      g.addColorStop(0, 'rgba(255,255,255,' + (0.07 * lift).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      burstCtx.globalAlpha = 1;
      burstCtx.fillStyle = g;
      burstCtx.fillRect(0, 0, burstW, burstH);
    }
    burstCtx.globalAlpha = 1;
  }

  function updateBurst() {
    if (!burstTrack || !burstCtx) return;
    if (reduced) return;
    if (!seen.burst) return;
    var r = burstTrack.getBoundingClientRect();
    var total = r.height - window.innerHeight;
    // Sin recorrido (pantalla baja): se pinta la escena ya resuelta.
    var p = total <= 8 ? 0.95 : clamp(-r.top / total, 0, 1);
    if (Math.abs(p - burstLast) < 0.0015) return;
    burstLast = p;
    drawBurst(p);
    if (burstStick) burstStick.style.setProperty('--bp', ramp(p, 0.42, 0.9).toFixed(3));
  }

  function setupBurst() {
    if (!burstCanvas) return;
    burstCtx = burstCanvas.getContext('2d', { alpha: true });
    if (!burstCtx) return;
    buildBurst();
    // Con movimiento reducido no hay recorrido: una sola pasada, ya resuelta.
    if (reduced) {
      drawBurst(0.95);
      if (burstStick) burstStick.style.setProperty('--bp', '1');
    }
    window.addEventListener('resize', function () {
      buildBurst();
      if (reduced) drawBurst(0.95);
      else updateBurst();
    }, { passive: true });
  }

  /* ===========================================================================
     VISTA AMPLIADA DE UNA DEMO
     "View demo" no lleva a un dominio inventado: abre la misma maqueta a
     tamaño grande. El contenido se CLONA de la tarjeta que se ha pulsado, asi
     que no hay una segunda copia del contenido que se pueda desincronizar — y
     si las pastillas de color han cambiado el acento, la copia lo lleva.
     =========================================================================== */
  function setupPeek() {
    var peek = $('#peek');
    var frame = $('#peekFrame');
    var closeBtn = $('#peekClose');
    var link = $('#peekLink');
    var title = $('#peekTitle');
    if (!peek || !frame) return;

    // Nombre de cada sector: se lee del propio anillo, no se repite aqui.
    var labels = {};
    $$('.ring__card[data-demo]').forEach(function (card) {
      var h = $('h3', card);
      labels[card.getAttribute('data-demo')] = h ? h.textContent.trim() : 'Demo';
    });

    var lastFocus = null;
    var openKey = null;

    /* La barra de la vista ampliada enseña el dominio de ESA demo, no un
       "yourbusiness.es" generico: es el detalle que separa una maqueta de una
       captura de una web. Sale de la propia tarjeta, asi que no hay una
       segunda lista de dominios que se pueda quedar desfasada. */
    var peekUrl = $('.peek__chrome .chrome__url');

    function open(key, source) {
      var mock = $('.mock', source);
      if (!mock) return;
      if (peekUrl) {
        var own = source.getAttribute('data-url')
               || (source.closest('[data-url]') && source.closest('[data-url]').getAttribute('data-url'));
        peekUrl.textContent = own || 'yourbusiness.es';
      }
      var clone = mock.cloneNode(true);
      clone.classList.add('mock--full');
      frame.innerHTML = '';
      frame.appendChild(clone);

      title.textContent = (labels[key] || 'Demo') + ' · demo';
      link.setAttribute('href', '/work/' + key + '/');
      openKey = key;
      lastFocus = document.activeElement;

      peek.hidden = false;
      document.body.classList.add('peek-open');
      // Un fotograma entre quitar `hidden` y poner la clase: si no, no hay
      // estado inicial desde el que transicionar y la vista aparece de golpe.
      requestAnimationFrame(function () {
        peek.classList.add('is-open');
        closeBtn.focus();
      });
    }

    function close() {
      if (!openKey) return;
      openKey = null;
      peek.classList.remove('is-open');
      document.body.classList.remove('peek-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      // Se vacia al acabar la transicion: quitarlo antes deja el panel vacio
      // durante el desvanecido.
      window.setTimeout(function () {
        if (!openKey) { peek.hidden = true; frame.innerHTML = ''; }
      }, reduced ? 0 : 380);
    }

    $$('[data-peek]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();           // no llega al giro del anillo
        var key = btn.getAttribute('data-peek');
        var host = btn.closest('.ring__card, .show-card');
        /* El boton del pie del escaparate vive fuera de la tarjeta: se coge la
           del escaparate de ese sector, no la del anillo. Importa: es la que
           lleva el acento que hayan elegido en las pastillas de color. */
        if (!host) {
          host = $('.show-card[data-demo="' + key + '"]')
              || $('.ring__card[data-demo="' + key + '"]');
        }
        if (host) open(key, host);
      });
    });

    closeBtn.addEventListener('click', close);
    peek.addEventListener('click', function (e) {
      if (e.target === peek) close();          // fondo
    });
    document.addEventListener('keydown', function (e) {
      if (!openKey) return;
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      // Solo hay dos elementos enfocables dentro: el cierre y el enlace. Se
      // hace el ciclo a mano para que el foco no salga a la pagina de detras.
      var first = closeBtn;
      var last = link;
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    });
  }

  /* ===========================================================================
     BUCLE UNICO
     Un fotograma hace dos pasadas: la del scroll (solo si el scroll o el
     tamaño han cambiado) y la del puntero. Si ninguna tiene nada que mover, no
     se pide otro fotograma.
     =========================================================================== */
  var queued = false;
  var energy = 0;              // fotogramas que quedan por inercia del puntero
  var lastY = -1;
  var lastW = -1;

  function scrollPass() {
    updateNav();
    updateHero();
    updateMorph();
    updateSteps();
    updateRing();
    updateShow();
    updateBurst();
    updateFloats();
  }

  function frame() {
    queued = false;
    var y = window.scrollY;
    var w = window.innerWidth;
    var moved = y !== lastY || w !== lastW;
    lastY = y;
    lastW = w;

    if (moved || needPass) {
      needPass = false;
      scrollPass();
    } else { updateRing(); updateHero(); }    // inercias: giro a mano y raton

    var busy = updateSpot();
    if (energy > 0) energy -= 1;
    if (busy || energy > 0 || Math.abs(giroDestino - giroManual) > 0.05) schedule();
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------- formulario --
     Lo procesa Netlify (`data-netlify="true"`) y aterriza en /gracias.html, asi
     que el envio NO se intercepta: hacerlo dejaba el formulario muerto. Lo
     unico que se hace aqui es evitar el doble envio mientras el primero viaja,
     que es lo que pasa cuando la respuesta tarda y se vuelve a pulsar. */
  function setupForm() {
    var form = $('form.form');
    if (!form) return;
    form.addEventListener('submit', function () {
      if (!form.checkValidity()) return;          // el navegador ya avisa
      var button = form.querySelector('button[type=submit]');
      if (!button) return;
      button.setAttribute('aria-busy', 'true');
      window.setTimeout(function () { button.disabled = true; }, 0);
    });
  }

  /* ------------------------------------------------------------- arranque -- */
  watch(hero, 'hero');
  watch(morphTrack, 'morph');
  watch(steps, 'steps');
  watch(ringTrack, 'ring');
  watch(showTrack, 'show');
  watch(burstTrack, 'burst');

  setupReveal();
  setupRingClicks();
  setupTones();
  setupPeek();
  setupBurst();
  setupField();
  setupDeviceTilt();
  setupCardTilt();
  setupAmbientGlow();
  setupMagnets();
  setupCounter();
  setupForm();

  if (!reduced && !coarse) {
    window.addEventListener('mousemove', function (e) {
      pointerX = e.clientX;
      pointerY = e.clientY;
      if (!hasPointer) { hasPointer = true; lightX = pointerX; lightY = pointerY; }
      energy = 12;
      schedule();
    }, { passive: true });
    window.addEventListener('mouseleave', function () {
      if (spot) { spot.classList.remove('is-on'); spot.classList.remove('is-on-light'); }
    });
  }

  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', function () { lastW = -1; schedule(); }, { passive: true });
  // Primera pasada: deja todo colocado antes del primer scroll.
  lastY = -1;
  schedule();
}());
