/* =========================================================
   Gym Tracker — PWA vanilla JS
   Persistencia: localStorage (key "gym-tracker-data")
   ========================================================= */
(function () {
  'use strict';

  var STORAGE_KEY = 'gym-tracker-data';

  /* ---------------------------------------------------------
     Estado
     --------------------------------------------------------- */
  var data = { exercises: [], sessions: [], settings: defaultSettings() };
  var editingSessionId = null;   // si != null, el form está editando
  var editingExerciseId = null;
  var chart = null;

  function defaultSettings() {
    return {
      weeklyNotify: false,
      lastWeeklyNotice: '',   // clave del lunes ya notificado (YYYY-MM-DD)
      restSeconds: 90,
      weeklyOpen: false       // resumen semanal desplegado o plegado
    };
  }

  /* Listas largas: se muestran de a tandas con un botón "mostrar más",
     así ninguna pantalla queda con scroll infinito. */
  var PAGE_SIZE = { exercises: 12, weekly: 6, history: 8 };
  var shownCount = { exercises: 12, weekly: 6, history: 8 };

  function resetPager(key) { shownCount[key] = PAGE_SIZE[key]; }

  // deja el botón al día y devuelve cuántos ítems hay que pintar
  function applyPager(key, total, btn) {
    var n = Math.min(shownCount[key], total);
    var rest = total - n;
    if (rest > 0) {
      btn.textContent = 'Mostrar ' + Math.min(PAGE_SIZE[key], rest) + ' más · quedan ' + rest;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
    return n;
  }

  /* ---------------------------------------------------------
     Utilidades
     --------------------------------------------------------- */
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    var d = new Date();
    // fecha local, no UTC (toISOString correría el día según zona horaria)
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function formatDate(iso) {
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    return p[2] + '/' + p[1] + '/' + p[0].slice(2);
  }

  function round(n, dec) {
    var f = Math.pow(10, dec === undefined ? 1 : dec);
    return Math.round(n * f) / f;
  }

  function fmtNum(n, dec) {
    if (!isFinite(n)) return '—';
    var d = dec === undefined ? 1 : dec;
    return round(n, d).toLocaleString('es-AR', { maximumFractionDigits: d });
  }

  // pesos: hasta 2 decimales (2.5, 22.75 kg…)
  function fmtW(n) { return fmtNum(n, 2); }

  // acepta coma o punto como separador decimal (teclados en español)
  function parseNum(raw) {
    var s = String(raw).trim().replace(',', '.');
    if (s === '') return NaN;
    return Number(s);
  }

  // "press banca" ~ "Préss Bánca": comparación sin acentos ni mayúsculas.
  // El rango ̀-ͯ son los diacríticos que deja NFD al descomponer.
  var DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g');
  function norm(s) {
    s = String(s == null ? '' : s).toLowerCase();
    return s.normalize ? s.normalize('NFD').replace(DIACRITICS, '') : s;
  }

  function mmss(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var base = String(m).padStart(h ? 2 : 1, '0') + ':' + String(sec).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') : base;
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2400);
  }

  // numerito de posición que llevan todos los ítems de lista
  function idxTag(n) {
    var el = document.createElement('span');
    el.className = 'li-idx';
    el.textContent = n;
    return el;
  }

  // pastilla con el total al lado del título de la tarjeta
  function setCountPill(el, n) {
    if (!el) return;
    el.textContent = n;
    el.classList.toggle('hidden', !n);
  }

  // scroll teniendo en cuenta la topbar sticky
  function scrollToEl(el) {
    if (!el) return;
    var bar = $('.topbar');
    var offset = (bar ? bar.offsetHeight : 0) + 10;
    var top = Math.max(0, el.getBoundingClientRect().top + window.pageYOffset - offset);
    try { window.scrollTo({ top: top, behavior: 'smooth' }); }
    catch (err) { window.scrollTo(0, top); }
  }

  function showError(el, msg) {
    if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  /* ---------------------------------------------------------
     Persistencia
     --------------------------------------------------------- */
  function sanitize(raw) {
    var out = { exercises: [], sessions: [], settings: defaultSettings() };
    if (!raw || typeof raw !== 'object') return out;

    if (raw.settings && typeof raw.settings === 'object') {
      out.settings.weeklyNotify = raw.settings.weeklyNotify === true;
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw.settings.lastWeeklyNotice))) {
        out.settings.lastWeeklyNotice = String(raw.settings.lastWeeklyNotice);
      }
      var rs = Number(raw.settings.restSeconds);
      if (isFinite(rs) && rs >= 5 && rs <= 3600) out.settings.restSeconds = Math.round(rs);
      out.settings.weeklyOpen = raw.settings.weeklyOpen === true;
    }

    if (Array.isArray(raw.exercises)) {
      raw.exercises.forEach(function (e) {
        if (!e || typeof e !== 'object') return;
        var name = String(e.name == null ? '' : e.name).trim();
        if (!name) return;
        out.exercises.push({
          id: e.id ? String(e.id) : uid(),
          name: name,
          muscleGroup: String(e.muscleGroup == null ? '' : e.muscleGroup).trim()
        });
      });
    }

    var validIds = {};
    out.exercises.forEach(function (e) { validIds[e.id] = true; });

    if (Array.isArray(raw.sessions)) {
      raw.sessions.forEach(function (s) {
        if (!s || typeof s !== 'object') return;
        if (!s.exerciseId || !validIds[String(s.exerciseId)]) return;
        if (!Array.isArray(s.sets)) return;

        var sets = [];
        s.sets.forEach(function (st) {
          if (!st || typeof st !== 'object') return;
          var reps = Number(st.reps);
          var weight = Number(st.weight);
          if (!isFinite(reps) || !isFinite(weight)) return;
          if (reps <= 0 || weight < 0) return;
          sets.push({ reps: Math.round(reps), weight: round(weight, 2) });
        });
        if (!sets.length) return;

        var date = /^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) ? String(s.date) : todayISO();
        out.sessions.push({
          id: s.id ? String(s.id) : uid(),
          date: date,
          exerciseId: String(s.exerciseId),
          sets: sets
        });
      });
    }
    return out;
  }

  function load() {
    var raw = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      toast('No se puede acceder al almacenamiento del navegador');
      data = { exercises: [], sessions: [], settings: defaultSettings() };
      return;
    }
    if (!raw) { data = { exercises: [], sessions: [], settings: defaultSettings() }; return; }
    try {
      data = sanitize(JSON.parse(raw));
    } catch (err) {
      console.error('Datos corruptos en localStorage:', err);
      data = { exercises: [], sessions: [], settings: defaultSettings() };
      toast('Los datos guardados estaban dañados, se empezó de cero');
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (err) {
      console.error(err);
      toast('No se pudo guardar (almacenamiento lleno o bloqueado)');
      return false;
    }
  }

  /* ---------------------------------------------------------
     Cálculos
     --------------------------------------------------------- */
  function volume(sets) {
    return sets.reduce(function (acc, s) { return acc + s.reps * s.weight; }, 0);
  }

  // Epley sobre la serie de mayor peso (desempate: más reps)
  function estimate1RM(sets) {
    var best = null;
    sets.forEach(function (s) {
      if (!best || s.weight > best.weight || (s.weight === best.weight && s.reps > best.reps)) best = s;
    });
    if (!best) return 0;
    return best.weight * (1 + best.reps / 30);
  }

  function pctChange(prev, curr) {
    if (prev === 0 || !isFinite(prev)) return null;   // sin base de comparación
    return (curr - prev) / prev * 100;
  }

  function sessionsFor(exerciseId) {
    return data.sessions
      .filter(function (s) { return s.exerciseId === exerciseId; })
      .sort(function (a, b) {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.id < b.id ? -1 : 1;     // desempate estable dentro del mismo día
      });
  }

  function exerciseById(id) {
    for (var i = 0; i < data.exercises.length; i++) {
      if (data.exercises[i].id === id) return data.exercises[i];
    }
    return null;
  }

  /* ---------------------------------------------------------
     Navegación
     --------------------------------------------------------- */
  var TITLES = { registrar: 'Registrar', ejercicios: 'Ejercicios', progreso: 'Progreso' };
  var currentView = 'registrar';

  function showView(name) {
    currentView = name;
    $$('.view').forEach(function (v) { v.classList.add('hidden'); });
    $('#view-' + name).classList.remove('hidden');
    $$('.tab').forEach(function (t) {
      if (t.dataset.view === name) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    $('#screen-title').textContent = TITLES[name];
    window.scrollTo(0, 0);
    if (name === 'progreso') renderProgress();
  }

  /* ---------------------------------------------------------
     Ejercicios
     --------------------------------------------------------- */
  function renderExercises() {
    var list = $('#exercise-list');
    var more = $('#exercise-more');
    list.innerHTML = '';
    setCountPill($('#exercise-count'), data.exercises.length);

    if (!data.exercises.length) {
      more.classList.add('hidden');
      var li = document.createElement('li');
      li.className = 'empty-state';
      li.textContent = 'Todavía no cargaste ningún ejercicio.';
      list.appendChild(li);
      return;
    }

    var sorted = data.exercises.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name, 'es');
    });

    sorted.slice(0, applyPager('exercises', sorted.length, more)).forEach(function (ex, i) {
      var count = data.sessions.filter(function (s) { return s.exerciseId === ex.id; }).length;

      var li = document.createElement('li');
      li.className = 'ex-item';

      var info = document.createElement('div');
      info.className = 'ex-info';
      var name = document.createElement('span');
      name.className = 'ex-name';
      name.textContent = ex.name;
      var meta = document.createElement('span');
      meta.className = 'ex-meta';
      meta.textContent = (ex.muscleGroup ? ex.muscleGroup + ' · ' : '') +
        count + (count === 1 ? ' sesión' : ' sesiones');
      info.appendChild(name);
      info.appendChild(meta);

      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'mini-btn';
      edit.title = 'Editar';
      edit.setAttribute('aria-label', 'Editar ' + ex.name);
      edit.textContent = '✎';
      edit.addEventListener('click', function () { startEditExercise(ex.id); });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'mini-btn danger';
      del.title = 'Eliminar';
      del.setAttribute('aria-label', 'Eliminar ' + ex.name);
      del.textContent = '✕';
      del.addEventListener('click', function () { deleteExercise(ex.id); });

      li.appendChild(idxTag(i + 1));
      li.appendChild(info);
      li.appendChild(edit);
      li.appendChild(del);
      list.appendChild(li);
    });
  }

  function startEditExercise(id) {
    var ex = exerciseById(id);
    if (!ex) return;
    editingExerciseId = id;
    $('#exercise-name').value = ex.name;
    $('#exercise-group').value = ex.muscleGroup;
    $('#btn-save-exercise').textContent = 'Guardar cambios';
    $('#btn-cancel-exercise').classList.remove('hidden');
    $('#exercise-name').focus();
  }

  function resetExerciseForm() {
    editingExerciseId = null;
    $('#form-exercise').reset();
    $('#btn-save-exercise').textContent = 'Agregar ejercicio';
    $('#btn-cancel-exercise').classList.add('hidden');
    showError($('#exercise-error'), '');
  }

  function submitExercise(evt) {
    evt.preventDefault();
    var errEl = $('#exercise-error');
    var name = $('#exercise-name').value.trim();
    var group = $('#exercise-group').value.trim();

    if (!name) { showError(errEl, 'Poné un nombre para el ejercicio.'); return; }

    var dup = data.exercises.some(function (e) {
      return e.id !== editingExerciseId && e.name.toLowerCase() === name.toLowerCase();
    });
    if (dup) { showError(errEl, 'Ya existe un ejercicio con ese nombre.'); return; }

    if (editingExerciseId) {
      var ex = exerciseById(editingExerciseId);
      if (ex) { ex.name = name; ex.muscleGroup = group; }
      toast('Ejercicio actualizado');
    } else {
      data.exercises.push({ id: uid(), name: name, muscleGroup: group });
      toast('Ejercicio agregado');
    }

    save();
    resetExerciseForm();
    renderExercises();
    refreshExerciseSelects();
  }

  function deleteExercise(id) {
    var ex = exerciseById(id);
    if (!ex) return;
    var count = data.sessions.filter(function (s) { return s.exerciseId === id; }).length;
    var msg = count
      ? 'Eliminar "' + ex.name + '" y sus ' + count + (count === 1 ? ' sesión' : ' sesiones') + '? Esta acción no se puede deshacer.'
      : 'Eliminar "' + ex.name + '"?';
    if (!window.confirm(msg)) return;

    data.exercises = data.exercises.filter(function (e) { return e.id !== id; });
    data.sessions = data.sessions.filter(function (s) { return s.exerciseId !== id; });
    save();

    if (editingExerciseId === id) resetExerciseForm();
    if (editingSessionId && !data.sessions.some(function (s) { return s.id === editingSessionId; })) resetSessionForm();

    renderAll();
    toast('Ejercicio eliminado');
  }

  /* ---------------------------------------------------------
     Combobox con buscador predictivo
     El valor elegido vive en un <input type="hidden">, así el resto
     del código sigue leyendo/escribiendo #session-exercise.value.
     --------------------------------------------------------- */
  function createCombobox(cfg) {
    var input = $(cfg.input);
    var hidden = $(cfg.hidden);
    var list = $(cfg.list);
    var clear = $(cfg.clear);
    var items = [];        // [{id, name, group, label}]
    var shown = [];        // opciones visibles
    var active = -1;       // índice resaltado por teclado
    var open = false;

    function labelFor(ex) {
      return ex.muscleGroup ? ex.name + ' (' + ex.muscleGroup + ')' : ex.name;
    }

    function refresh() {
      items = data.exercises.slice()
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); })
        .map(function (ex) {
          return { id: ex.id, name: ex.name, group: ex.muscleGroup, label: labelFor(ex) };
        });

      // si el ejercicio elegido dejó de existir (o cambió de nombre), resincronizamos
      var cur = find(hidden.value);
      if (hidden.value && !cur) setValue('', true);
      else if (cur) { input.value = cur.label; clear.classList.remove('hidden'); }

      if (open) render('');
    }

    function find(id) {
      for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
      return null;
    }

    // resalta en negrita la parte del nombre que coincide con lo tipeado
    function highlight(text, q) {
      var frag = document.createDocumentFragment();
      if (!q) { frag.appendChild(document.createTextNode(text)); return frag; }
      var at = norm(text).indexOf(q);
      if (at < 0) { frag.appendChild(document.createTextNode(text)); return frag; }
      var mark = document.createElement('mark');
      mark.textContent = text.slice(at, at + q.length);
      frag.appendChild(document.createTextNode(text.slice(0, at)));
      frag.appendChild(mark);
      frag.appendChild(document.createTextNode(text.slice(at + q.length)));
      return frag;
    }

    function render(query) {
      var q = norm(query).trim();
      shown = q
        ? items.filter(function (it) {
            return norm(it.name).indexOf(q) >= 0 || norm(it.group).indexOf(q) >= 0;
          })
        : items.slice();

      list.innerHTML = '';
      active = -1;

      if (!items.length) {
        var none = document.createElement('li');
        none.className = 'combo-empty';
        none.textContent = 'No tenés ejercicios cargados todavía.';
        list.appendChild(none);
        return;
      }
      if (!shown.length) {
        var nores = document.createElement('li');
        nores.className = 'combo-empty';
        nores.textContent = 'Sin resultados para "' + query.trim() + '"';
        list.appendChild(nores);
        return;
      }

      shown.forEach(function (it, i) {
        var li = document.createElement('li');
        li.className = 'combo-opt';
        li.setAttribute('role', 'option');
        li.id = list.id + '-opt-' + i;
        li.setAttribute('aria-selected', it.id === hidden.value ? 'true' : 'false');

        var body = document.createElement('span');
        body.className = 'opt-body';

        var nameEl = document.createElement('span');
        nameEl.appendChild(highlight(it.name, q));
        body.appendChild(nameEl);

        if (it.group) {
          var meta = document.createElement('span');
          meta.className = 'opt-meta';
          meta.textContent = it.group;
          body.appendChild(meta);
        }

        li.appendChild(idxTag(i + 1));
        li.appendChild(body);

        // mousedown y no click: se dispara antes del blur del input
        li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(it.id); });
        li.addEventListener('click', function () { choose(it.id); });
        list.appendChild(li);
      });
    }

    function setActive(i) {
      var opts = $$('#' + list.id + ' .combo-opt');
      if (!opts.length) return;
      if (i < 0) i = opts.length - 1;
      if (i >= opts.length) i = 0;
      opts.forEach(function (o) { o.classList.remove('active'); });
      opts[i].classList.add('active');
      opts[i].scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', opts[i].id);
      active = i;
    }

    function openList(query) {
      render(query === undefined ? '' : query);
      list.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
      open = true;
    }

    function closeList() {
      list.classList.add('hidden');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      open = false;
      active = -1;
      // el input siempre vuelve a mostrar lo que está realmente elegido
      var cur = find(hidden.value);
      input.value = cur ? cur.label : '';
    }

    function choose(id) {
      setValue(id);
      closeList();
    }

    function setValue(id, silent) {
      var cur = find(id);
      hidden.value = cur ? cur.id : '';
      input.value = cur ? cur.label : '';
      clear.classList.toggle('hidden', !cur);
      if (!silent && cfg.onChange) cfg.onChange(hidden.value);
    }

    input.addEventListener('focus', function () { openList(''); input.select(); });
    input.addEventListener('input', function () { openList(input.value); });
    input.addEventListener('blur', function () { setTimeout(function () { if (open) closeList(); }, 120); });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open) { openList(''); setActive(0); return; }
        setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
      } else if (e.key === 'Enter') {
        if (open) {
          e.preventDefault();
          // sin selección explícita, Enter toma el único resultado filtrado
          if (active >= 0 && shown[active]) choose(shown[active].id);
          else if (shown.length === 1) choose(shown[0].id);
          else closeList();
        }
      } else if (e.key === 'Escape') {
        if (open) { e.preventDefault(); closeList(); }
      }
    });

    clear.addEventListener('click', function () {
      setValue('');
      input.focus();
    });

    return { refresh: refresh, setValue: setValue, getValue: function () { return hidden.value; } };
  }

  var sessionCombo = null;
  var progressCombo = null;

  function refreshExerciseSelects() {
    if (sessionCombo) sessionCombo.refresh();
    if (progressCombo) progressCombo.refresh();
    $('#no-exercises-hint').classList.toggle('hidden', data.exercises.length > 0);
  }

  /* ---------------------------------------------------------
     Series (form de sesión)
     --------------------------------------------------------- */
  function addSetRow(reps, weight, afterRow) {
    var list = $('#sets-list');
    var row = document.createElement('div');
    row.className = 'set-row';

    var idx = document.createElement('span');
    idx.className = 'set-idx';

    var repsIn = document.createElement('input');
    repsIn.type = 'number';
    repsIn.className = 'in-reps';
    repsIn.min = '1';
    repsIn.step = '1';
    repsIn.inputMode = 'numeric';
    repsIn.placeholder = 'reps';
    repsIn.setAttribute('aria-label', 'Repeticiones');
    if (reps !== undefined && reps !== null) repsIn.value = reps;

    // text + inputMode decimal: type="number" rechaza la coma en varios teclados
    // mobile y deja el campo en blanco; así aceptamos "2.5" y "2,5" por igual.
    var wIn = document.createElement('input');
    wIn.type = 'text';
    wIn.className = 'in-weight';
    wIn.inputMode = 'decimal';
    wIn.autocomplete = 'off';
    wIn.placeholder = 'kg';
    wIn.setAttribute('aria-label', 'Kilos');
    if (weight !== undefined && weight !== null) wIn.value = weight;

    var dup = document.createElement('button');
    dup.type = 'button';
    dup.className = 'set-dup';
    dup.textContent = '⧉';
    dup.title = 'Duplicar serie';
    dup.setAttribute('aria-label', 'Duplicar serie');
    dup.addEventListener('click', function () {
      var copy = addSetRow(repsIn.value, wIn.value, row);
      updateLiveSummary();
      copy.querySelector('.in-weight').focus();
    });

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'set-del';
    del.textContent = '✕';
    del.setAttribute('aria-label', 'Quitar serie');
    del.addEventListener('click', function () {
      row.remove();
      renumberSets();
      updateLiveSummary();
    });

    [repsIn, wIn].forEach(function (i) {
      i.addEventListener('input', updateLiveSummary);
    });

    row.appendChild(idx);
    row.appendChild(repsIn);
    row.appendChild(wIn);
    row.appendChild(dup);
    row.appendChild(del);

    if (afterRow && afterRow.parentNode === list) list.insertBefore(row, afterRow.nextSibling);
    else list.appendChild(row);

    renumberSets();
    return row;
  }

  function renumberSets() {
    var rows = $$('#sets-list .set-row');
    rows.forEach(function (r, i) {
      r.querySelector('.set-idx').textContent = (i + 1) + '.';
      r.querySelector('.set-del').disabled = rows.length === 1;
    });
  }

  function readSets() {
    // devuelve { sets, error }
    var rows = $$('#sets-list .set-row');
    var sets = [];
    for (var i = 0; i < rows.length; i++) {
      var repsRaw = rows[i].querySelector('.in-reps').value.trim();
      var wRaw = rows[i].querySelector('.in-weight').value.trim();

      if (repsRaw === '' && wRaw === '') continue;   // fila vacía: se ignora
      if (repsRaw === '' || wRaw === '') {
        return { error: 'Serie ' + (i + 1) + ': completá reps y kg (o dejá la fila vacía).' };
      }

      var reps = parseNum(repsRaw);
      var weight = parseNum(wRaw);

      if (!isFinite(reps) || !isFinite(weight)) {
        return { error: 'Serie ' + (i + 1) + ': los valores deben ser números.' };
      }
      if (reps <= 0 || !Number.isInteger(reps)) {
        return { error: 'Serie ' + (i + 1) + ': las repeticiones deben ser un entero mayor a 0.' };
      }
      if (weight < 0) {
        return { error: 'Serie ' + (i + 1) + ': los kilos no pueden ser negativos.' };
      }
      if (reps > 1000 || weight > 2000) {
        return { error: 'Serie ' + (i + 1) + ': valor fuera de rango.' };
      }
      sets.push({ reps: reps, weight: round(weight, 2) });   // 2 decimales: 2.5, 22.75…
    }
    return { sets: sets };
  }

  /* ---------------------------------------------------------
     Referencia: última sesión del ejercicio elegido
     --------------------------------------------------------- */
  var lastRef = null;   // { session, vol, rm } o null

  function setsLabel(sets) {
    return sets.map(function (st) { return st.reps + '×' + fmtW(st.weight); }).join('  ·  ');
  }

  /* Cada serie como pastilla numerada: en una sola línea corrida
     ("10×50 · 10×50 · 8×55") se hacía imposible leer dónde termina una. */
  function setChips(sets) {
    var ol = document.createElement('ol');
    ol.className = 'set-chips';
    ol.setAttribute('aria-label', 'Series: ' + setsLabel(sets));
    sets.forEach(function (st, i) {
      var li = document.createElement('li');
      li.className = 'set-chip';

      var n = document.createElement('span');
      n.className = 'chip-idx';
      n.textContent = i + 1;

      var v = document.createElement('span');
      v.className = 'chip-val';
      v.textContent = st.reps + ' × ' + fmtW(st.weight) + ' kg';

      li.appendChild(n);
      li.appendChild(v);
      ol.appendChild(li);
    });
    return ol;
  }

  function daysAgo(iso) {
    var p = String(iso).split('-');
    if (p.length !== 3) return null;
    var then = Date.UTC(+p[0], +p[1] - 1, +p[2]);
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - then) / 86400000);
  }

  function agoLabel(iso) {
    var d = daysAgo(iso);
    if (d === null) return '';
    if (d <= 0) return 'hoy';
    if (d === 1) return 'ayer';
    if (d < 7) return 'hace ' + d + ' días';
    var w = Math.floor(d / 7);
    return w === 1 ? 'hace 1 semana' : 'hace ' + w + ' semanas';
  }

  // la última sesión "real": si estamos editando una, esa no cuenta como referencia
  function lastSessionFor(exerciseId, excludeId) {
    var list = sessionsFor(exerciseId).filter(function (s) { return s.id !== excludeId; });
    return list.length ? list[list.length - 1] : null;
  }

  function renderLastSession() {
    var id = $('#session-exercise').value;
    var box = $('#last-session');
    var none = $('#last-session-none');
    lastRef = null;

    if (!id || !exerciseById(id)) {
      box.classList.add('hidden');
      none.classList.add('hidden');
      updateLiveSummary();
      return;
    }

    var last = lastSessionFor(id, editingSessionId);
    if (!last) {
      box.classList.add('hidden');
      none.classList.remove('hidden');
      updateLiveSummary();
      return;
    }

    none.classList.add('hidden');
    box.classList.remove('hidden');
    lastRef = { session: last, vol: volume(last.sets), rm: estimate1RM(last.sets) };

    $('#last-session-date').textContent = formatDate(last.date) + ' · ' + agoLabel(last.date);
    var lsSets = $('#last-session-sets');
    lsSets.innerHTML = '';
    lsSets.appendChild(setChips(last.sets));
    $('#last-session-vol').textContent = fmtNum(lastRef.vol) + ' kg';
    $('#last-session-rm').textContent = fmtW(lastRef.rm) + ' kg';
    updateLiveSummary();
  }

  function copyLastSession() {
    if (!lastRef) return;
    $('#sets-list').innerHTML = '';
    lastRef.session.sets.forEach(function (st) { addSetRow(st.reps, st.weight); });
    updateLiveSummary();
    toast('Series copiadas de la última sesión');
  }

  function paintDelta(el, pct) {
    if (pct === null || pct === undefined) { el.classList.add('hidden'); return; }
    var r = round(pct, 1);
    el.classList.remove('hidden', 'up', 'down', 'flat');
    el.classList.add('delta');
    if (r > 0) { el.classList.add('up'); el.textContent = '+' + fmtNum(r) + '% vs anterior'; }
    else if (r < 0) { el.classList.add('down'); el.textContent = fmtNum(r) + '% vs anterior'; }
    else { el.classList.add('flat'); el.textContent = 'igual que la anterior'; }
  }

  function updateLiveSummary() {
    var res = readSets();
    var box = $('#live-summary');
    if (res.error || !res.sets || !res.sets.length) {
      box.classList.add('hidden');
      return;
    }
    box.classList.remove('hidden');
    var vol = volume(res.sets);
    var rm = estimate1RM(res.sets);
    $('#ls-volume').textContent = fmtNum(vol) + ' kg';
    $('#ls-1rm').textContent = fmtW(rm) + ' kg';

    paintDelta($('#ls-volume-delta'), lastRef ? pctChange(lastRef.vol, vol) : null);
    paintDelta($('#ls-1rm-delta'), lastRef ? pctChange(lastRef.rm, rm) : null);
  }

  function resetSessionForm() {
    editingSessionId = null;
    $('#session-date').value = todayISO();
    if (sessionCombo) sessionCombo.setValue('', true);
    else $('#session-exercise').value = '';
    $('#sets-list').innerHTML = '';
    addSetRow();
    showError($('#session-error'), '');
    renderLastSession();
    $('#form-session').querySelector('button[type="submit"]').textContent = 'Guardar sesión';
    $('#btn-cancel-edit').classList.add('hidden');
  }

  function startEditSession(id) {
    var s = null;
    data.sessions.forEach(function (x) { if (x.id === id) s = x; });
    if (!s) return;

    editingSessionId = id;
    showView('registrar');
    $('#session-date').value = s.date;
    sessionCombo.setValue(s.exerciseId, true);
    $('#sets-list').innerHTML = '';
    s.sets.forEach(function (st) { addSetRow(st.reps, st.weight); });
    renderLastSession();
    $('#form-session').querySelector('button[type="submit"]').textContent = 'Guardar cambios';
    $('#btn-cancel-edit').classList.remove('hidden');
    showError($('#session-error'), '');
  }

  function submitSession(evt) {
    evt.preventDefault();
    var errEl = $('#session-error');
    var date = $('#session-date').value;
    var exerciseId = $('#session-exercise').value;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      showError(errEl, 'Elegí una fecha válida.'); return;
    }
    if (!exerciseId || !exerciseById(exerciseId)) {
      showError(errEl, 'Elegí un ejercicio.'); return;
    }

    var res = readSets();
    if (res.error) { showError(errEl, res.error); return; }
    if (!res.sets.length) { showError(errEl, 'Cargá al menos una serie con reps y kg.'); return; }

    if (editingSessionId) {
      data.sessions.forEach(function (s) {
        if (s.id === editingSessionId) {
          s.date = date;
          s.exerciseId = exerciseId;
          s.sets = res.sets;
        }
      });
      toast('Sesión actualizada');
    } else {
      data.sessions.push({ id: uid(), date: date, exerciseId: exerciseId, sets: res.sets });
      toast('Sesión guardada');
    }

    save();
    resetSessionForm();
    renderRecent();
    renderExercises();
    if (currentView === 'progreso') renderProgress();
  }

  function deleteSession(id) {
    if (!window.confirm('¿Eliminar esta sesión?')) return;
    data.sessions = data.sessions.filter(function (s) { return s.id !== id; });
    save();
    if (editingSessionId === id) resetSessionForm();
    renderAll();
    toast('Sesión eliminada');
  }

  /* ---------------------------------------------------------
     Últimas sesiones
     --------------------------------------------------------- */
  function renderRecent() {
    var ul = $('#recent-sessions');
    ul.innerHTML = '';

    var recent = data.sessions.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    }).slice(0, 6);

    setCountPill($('#recent-count'), data.sessions.length);

    if (!recent.length) {
      var li = document.createElement('li');
      li.className = 'empty-state';
      li.textContent = 'Sin sesiones registradas todavía.';
      ul.appendChild(li);
      return;
    }

    recent.forEach(function (s, i) {
      var ex = exerciseById(s.exerciseId);
      var li = document.createElement('li');
      li.className = 'recent-item';

      var info = document.createElement('div');
      info.className = 'recent-info';
      var name = document.createElement('span');
      name.className = 'recent-name';
      name.textContent = ex ? ex.name : '(ejercicio eliminado)';
      var meta = document.createElement('span');
      meta.className = 'recent-meta';
      meta.textContent = formatDate(s.date) + ' · ' + s.sets.length +
        (s.sets.length === 1 ? ' serie' : ' series') + ' · ' + fmtNum(volume(s.sets)) + ' kg';
      info.appendChild(name);
      info.appendChild(meta);

      var edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'mini-btn';
      edit.setAttribute('aria-label', 'Editar sesión');
      edit.textContent = '✎';
      edit.addEventListener('click', function () { startEditSession(s.id); });

      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'mini-btn danger';
      del.setAttribute('aria-label', 'Eliminar sesión');
      del.textContent = '✕';
      del.addEventListener('click', function () { deleteSession(s.id); });

      li.appendChild(idxTag(i + 1));
      li.appendChild(info);
      li.appendChild(edit);
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  /* ---------------------------------------------------------
     Progreso: tabla + gráfico
     --------------------------------------------------------- */
  function deltaBadge(pct) {
    var span = document.createElement('span');
    if (pct === null) {
      span.className = 'delta flat';
      span.textContent = '—';
      return span;
    }
    var r = round(pct, 1);
    if (r > 0) { span.className = 'delta up'; span.textContent = '+' + fmtNum(r) + '%'; }
    else if (r < 0) { span.className = 'delta down'; span.textContent = fmtNum(r) + '%'; }
    else { span.className = 'delta flat'; span.textContent = '0%'; }
    return span;
  }

  function renderProgress() {
    renderWeekly();
    var id = $('#progress-exercise').value;
    var empty = $('#progress-empty');
    var content = $('#progress-content');

    if (!id || !exerciseById(id)) {
      content.classList.add('hidden');
      empty.classList.remove('hidden');
      empty.textContent = data.exercises.length
        ? 'Elegí un ejercicio para ver su historial y evolución.'
        : 'Primero cargá un ejercicio en la solapa Ejercicios.';
      destroyChart();
      return;
    }

    var list = sessionsFor(id);
    if (!list.length) {
      content.classList.add('hidden');
      empty.classList.remove('hidden');
      empty.textContent = 'Todavía no registraste sesiones de este ejercicio.';
      destroyChart();
      return;
    }

    empty.classList.add('hidden');
    content.classList.remove('hidden');

    // métricas por sesión
    var rows = list.map(function (s) {
      return { s: s, vol: volume(s.sets), rm: estimate1RM(s.sets) };
    });

    // stats
    var bestRM = rows.reduce(function (m, r) { return Math.max(m, r.rm); }, 0);
    var bestVol = rows.reduce(function (m, r) { return Math.max(m, r.vol); }, 0);
    $('#stat-count').textContent = rows.length;
    $('#stat-best-1rm').textContent = fmtW(bestRM) + ' kg';
    $('#stat-best-vol').textContent = fmtNum(bestVol) + ' kg';

    // historial: una tarjeta por día, más reciente arriba
    var histList = $('#history-list');
    var histMore = $('#history-more');
    histList.innerHTML = '';
    setCountPill($('#history-count'), rows.length);

    var ordered = rows.slice().reverse();
    ordered.slice(0, applyPager('history', ordered.length, histMore)).forEach(function (r, i) {
      var pos = rows.length - 1 - i;                  // índice cronológico real
      histList.appendChild(historyItem(r, pos + 1, pos > 0 ? rows[pos - 1] : null));
    });

    renderChart(rows);
  }

  function metricBox(label, value, pct) {
    var box = document.createElement('div');
    box.className = 'hist-metric';

    var l = document.createElement('span');
    l.className = 'hist-metric-label';
    l.textContent = label;

    var v = document.createElement('strong');
    v.className = 'hist-metric-value';
    v.textContent = value;

    box.appendChild(l);
    box.appendChild(v);
    if (pct !== undefined) box.appendChild(deltaBadge(pct));
    return box;
  }

  /* num = número de sesión (1 = la más vieja); prev = sesión anterior para los % */
  function historyItem(r, num, prev) {
    var li = document.createElement('li');
    li.className = 'hist-item';

    var head = document.createElement('div');
    head.className = 'hist-head';

    var idx = document.createElement('span');
    idx.className = 'li-idx';
    idx.textContent = num;

    var date = document.createElement('span');
    date.className = 'hist-date';
    date.textContent = formatDate(r.s.date);

    var ago = document.createElement('span');
    ago.className = 'hist-ago';
    ago.textContent = agoLabel(r.s.date);

    var edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'mini-btn';
    edit.setAttribute('aria-label', 'Editar sesión del ' + formatDate(r.s.date));
    edit.textContent = '✎';
    edit.addEventListener('click', function () { startEditSession(r.s.id); });

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'mini-btn danger';
    del.setAttribute('aria-label', 'Eliminar sesión del ' + formatDate(r.s.date));
    del.textContent = '✕';
    del.addEventListener('click', function () { deleteSession(r.s.id); });

    var when = document.createElement('div');
    when.className = 'hist-when';
    when.appendChild(date);
    when.appendChild(ago);

    head.appendChild(idx);
    head.appendChild(when);
    head.appendChild(edit);
    head.appendChild(del);

    var metrics = document.createElement('div');
    metrics.className = 'hist-metrics';
    metrics.appendChild(metricBox('Volumen', fmtNum(r.vol) + ' kg', prev ? pctChange(prev.vol, r.vol) : null));
    metrics.appendChild(metricBox('1RM est.', fmtW(r.rm) + ' kg', prev ? pctChange(prev.rm, r.rm) : null));
    metrics.appendChild(metricBox('Series', String(r.s.sets.length)));

    li.appendChild(head);
    li.appendChild(metrics);
    li.appendChild(setChips(r.s.sets));
    return li;
  }

  function destroyChart() {
    if (chart) { chart.destroy(); chart = null; }
  }

  function renderChart(rows) {
    var canvas = $('#progress-chart');
    if (typeof window.Chart === 'undefined') {
      $('#chart-fallback').classList.remove('hidden');
      canvas.classList.add('hidden');
      return;
    }
    $('#chart-fallback').classList.add('hidden');
    canvas.classList.remove('hidden');

    var labels = rows.map(function (r) { return formatDate(r.s.date); });
    var vols = rows.map(function (r) { return round(r.vol, 1); });
    var rms = rows.map(function (r) { return round(r.rm, 1); });

    destroyChart();

    var grid = 'rgba(154,164,180,.15)';
    var tick = '#9aa4b4';

    chart = new window.Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Volumen (kg)',
            data: vols,
            borderColor: '#4c8dff',
            backgroundColor: 'rgba(76,141,255,.15)',
            yAxisID: 'y',
            tension: .3,
            fill: true,
            pointRadius: 3,
            borderWidth: 2
          },
          {
            label: '1RM est. (kg)',
            data: rms,
            borderColor: '#37d67a',
            backgroundColor: 'rgba(55,214,122,.12)',
            yAxisID: 'y1',
            tension: .3,
            fill: false,
            pointRadius: 3,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: tick, boxWidth: 12, usePointStyle: true } },
          tooltip: {
            callbacks: {
              label: function (ctx) { return ctx.dataset.label + ': ' + fmtNum(ctx.parsed.y) + ' kg'; }
            }
          }
        },
        scales: {
          x: { ticks: { color: tick, maxRotation: 0, autoSkipPadding: 12 }, grid: { color: grid } },
          y: {
            position: 'left',
            title: { display: true, text: 'Volumen', color: tick },
            ticks: { color: tick }, grid: { color: grid }
          },
          y1: {
            position: 'right',
            title: { display: true, text: '1RM', color: tick },
            ticks: { color: tick }, grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  /* ---------------------------------------------------------
     Cronómetro / descanso
     El tiempo se calcula con timestamps (Date.now), no acumulando
     ticks: así no se atrasa si el navegador frena el timer en segundo plano.
     --------------------------------------------------------- */
  var timer = {
    mode: 'rest',        // 'rest' | 'stopwatch'
    running: false,
    startedAt: 0,        // ms epoch del último arranque
    elapsed: 0,          // ms acumulados de tramos anteriores
    target: 90000,       // objetivo en ms (solo modo descanso)
    fired: false         // ya sonó el aviso de este descanso
  };
  var timerTick = null;
  var audioCtx = null;

  function timerElapsed() {
    return timer.elapsed + (timer.running ? Date.now() - timer.startedAt : 0);
  }

  function primeAudio() {
    // el contexto de audio hay que crearlo/reanudarlo dentro de un gesto del usuario
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (err) { /* sin audio, seguimos igual */ }
  }

  function beep() {
    if (!audioCtx) return;
    try {
      [0, 0.3, 0.6].forEach(function (offset) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        var t = audioCtx.currentTime + offset;
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.26);
      });
    } catch (err) { /* ignorado */ }
  }

  function renderTimer() {
    var display = $('#timer-display');
    var btn = $('#btn-timer');
    var caption = $('#timer-caption');
    var ms = timerElapsed();
    var text, over = false;

    if (timer.mode === 'rest') {
      var left = timer.target - ms;
      if (left <= 0) {
        over = true;
        text = '+' + mmss(-left / 1000);
        if (!timer.fired) {
          timer.fired = true;
          beep();
          if (navigator.vibrate) { try { navigator.vibrate([200, 100, 200, 100, 300]); } catch (e) {} }
          notify('¡Descanso terminado!', 'Van ' + mmss(timer.target / 1000) + '. A la próxima serie.', 'rest');
          toast('¡Descanso terminado!');
        }
      } else {
        text = mmss(Math.ceil(left / 1000));
      }
      caption.textContent = over
        ? 'Pasaste el descanso de ' + mmss(timer.target / 1000) + '.'
        : 'Descanso de ' + mmss(timer.target / 1000) + '.';
    } else {
      text = mmss(ms / 1000);
      caption.textContent = 'Tiempo total del entrenamiento.';
    }

    display.textContent = text;
    display.classList.toggle('done', over);

    $('#btn-timer-toggle').textContent = timer.running ? 'Pausar' : (ms > 0 ? 'Seguir' : 'Iniciar');

    // el botón de la topbar muestra el tiempo mientras corre
    if (timer.running || ms > 0) {
      btn.textContent = text;
      btn.classList.add('running');
      btn.classList.toggle('ringing', over);
    } else {
      btn.textContent = '⏱';
      btn.classList.remove('running', 'ringing');
    }
  }

  function timerLoop(on) {
    clearInterval(timerTick);
    timerTick = null;
    if (on) timerTick = setInterval(renderTimer, 250);
  }

  function timerStart() {
    primeAudio();
    if (timer.running) return;
    timer.running = true;
    timer.startedAt = Date.now();
    timerLoop(true);
    renderTimer();
  }

  function timerPause() {
    if (!timer.running) return;
    timer.elapsed = timerElapsed();
    timer.running = false;
    timerLoop(false);
    renderTimer();
  }

  function timerReset() {
    timer.running = false;
    timer.elapsed = 0;
    timer.startedAt = 0;
    timer.fired = false;
    timerLoop(false);
    renderTimer();
  }

  function timerSetMode(mode) {
    timer.mode = mode;
    timerReset();
    $$('#timer-sheet .seg').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.mode === mode ? 'true' : 'false');
    });
    $('#timer-presets').classList.toggle('hidden', mode !== 'rest');
    renderTimer();
  }

  function timerSetTarget(secs) {
    timer.target = secs * 1000;
    if (data.settings.restSeconds !== secs) {
      data.settings.restSeconds = secs;
      save();
    }
    $$('#timer-presets .chip').forEach(function (c) {
      c.setAttribute('aria-pressed', Number(c.dataset.secs) === secs ? 'true' : 'false');
    });
    renderTimer();
  }

  // arranca un descanso desde cero (botón "Descanso" del form)
  function startRest(secs) {
    timerSetMode('rest');
    timerSetTarget(secs);
    timerStart();
    toast('Descanso de ' + mmss(secs) + ' iniciado');
  }

  function openTimer() {
    primeAudio();
    $('#timer-sheet').classList.remove('hidden');
    $('#timer-backdrop').classList.remove('hidden');
    renderTimer();
  }

  function closeTimer() {
    $('#timer-sheet').classList.add('hidden');
    $('#timer-backdrop').classList.add('hidden');
  }

  /* ---------------------------------------------------------
     Resumen semanal + notificación de los lunes
     --------------------------------------------------------- */
  function isoOf(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  function addDaysISO(iso, n) {
    var p = String(iso).split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + n);
    return isoOf(d);
  }

  // lunes de la semana en curso (la semana arranca el lunes)
  function mondayISO(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoOf(d);
  }

  function metricsOf(list) {
    var vol = 0, rm = 0;
    list.forEach(function (s) {
      vol += volume(s.sets);
      rm = Math.max(rm, estimate1RM(s.sets));
    });
    return { vol: vol, rm: rm, count: list.length };
  }

  /* Compara la semana que cerró (lunes−7 .. lunes) contra la anterior.
     Si a un ejercicio le falta data en alguna de las dos ventanas, cae a
     comparar sus dos últimas sesiones, sea cuando sea que ocurrieron. */
  function weeklyReport() {
    var monday = mondayISO(new Date());
    var startCur = addDaysISO(monday, -7);
    var startPrev = addDaysISO(monday, -14);

    function inRange(from, to) {
      return function (s) { return s.date >= from && s.date < to; };
    }

    var items = data.exercises.map(function (ex) {
      var all = sessionsFor(ex.id);
      var cur = all.filter(inRange(startCur, monday));
      var prev = all.filter(inRange(startPrev, startCur));
      var basis = 'week';

      if (!cur.length || !prev.length) {
        if (all.length < 2) {
          return { id: ex.id, name: ex.name, basis: 'none', volPct: null, rmPct: null, count: all.length };
        }
        cur = [all[all.length - 1]];
        prev = [all[all.length - 2]];
        basis = 'sessions';
      }

      var c = metricsOf(cur), p = metricsOf(prev);
      return {
        id: ex.id,
        name: ex.name,
        basis: basis,
        volPct: pctChange(p.vol, c.vol),
        rmPct: pctChange(p.rm, c.rm),
        count: c.count,
        cur: c,
        prev: p
      };
    });

    items.sort(function (a, b) {
      var av = a.rmPct === null ? -Infinity : a.rmPct;
      var bv = b.rmPct === null ? -Infinity : b.rmPct;
      if (av !== bv) return bv - av;
      return a.name.localeCompare(b.name, 'es');
    });

    return {
      monday: monday,
      from: startCur,
      to: addDaysISO(monday, -1),
      items: items,
      comparable: items.filter(function (i) { return i.rmPct !== null || i.volPct !== null; })
    };
  }

  function setWeeklyOpen(open, persist) {
    $('#weekly-body').classList.toggle('hidden', !open);
    $('#weekly-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (persist && data.settings.weeklyOpen !== open) {
      data.settings.weeklyOpen = open;
      save();
    }
  }

  /* Tocar un ejercicio del resumen es equivalente a buscarlo en el combo:
     carga su historial y baja hasta el gráfico. */
  function openExerciseProgress(id) {
    if (!exerciseById(id)) return;
    progressCombo.setValue(id);          // dispara onChange → renderProgress()
    setWeeklyOpen(false, true);          // plegado, para no dejar el gráfico lejos
    var content = $('#progress-content');
    var target = content.classList.contains('hidden') ? $('#progress-empty') : content;
    requestAnimationFrame(function () { scrollToEl(target); });
  }

  function renderWeekly() {
    var card = $('#weekly-card');
    var list = $('#weekly-list');
    var more = $('#weekly-more');
    var range = $('#weekly-range');
    list.innerHTML = '';

    if (!data.exercises.length) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');

    var rep = weeklyReport();
    var selected = $('#progress-exercise').value;
    setCountPill($('#weekly-count'), rep.items.length);
    range.textContent = 'Semana del ' + formatDate(rep.from) + ' al ' + formatDate(rep.to) +
      ' contra la anterior. Si falta data en esas semanas, se comparan las 2 últimas sesiones. ' +
      'El % grande es sobre el 1RM estimado. Tocá un ejercicio para ver su progreso.';

    rep.items.slice(0, applyPager('weekly', rep.items.length, more)).forEach(function (it, i) {
      var li = document.createElement('li');

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'weekly-item';
      if (it.id === selected) btn.classList.add('is-selected');
      btn.setAttribute('aria-label', 'Ver el progreso de ' + it.name);
      btn.addEventListener('click', function () { openExerciseProgress(it.id); });

      var info = document.createElement('span');
      info.className = 'weekly-info';
      var name = document.createElement('span');
      name.className = 'weekly-name';
      name.textContent = it.name;
      var meta = document.createElement('span');
      meta.className = 'weekly-meta';
      if (it.basis === 'none') {
        meta.textContent = it.count ? 'Falta una segunda sesión para comparar' : 'Sin sesiones';
      } else {
        meta.textContent = (it.basis === 'sessions' ? 'Últimas 2 sesiones' : it.count + (it.count === 1 ? ' sesión' : ' sesiones')) +
          ' · vol. ' + (it.volPct === null ? '—' : (it.volPct > 0 ? '+' : '') + fmtNum(it.volPct) + '%');
      }
      info.appendChild(name);
      info.appendChild(meta);

      var go = document.createElement('span');
      go.className = 'weekly-go';
      go.setAttribute('aria-hidden', 'true');
      go.textContent = '›';

      btn.appendChild(idxTag(i + 1));
      btn.appendChild(info);
      btn.appendChild(deltaBadge(it.rmPct));
      btn.appendChild(go);

      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function weeklyNotificationText(rep) {
    var lines = rep.comparable.slice(0, 6).map(function (it) {
      var p = it.rmPct === null ? it.volPct : it.rmPct;
      var sign = p > 0 ? '+' : '';
      return it.name + ': ' + sign + fmtNum(p) + '%';
    });
    if (!lines.length) return null;
    var rest = rep.comparable.length - lines.length;
    if (rest > 0) lines.push('y ' + rest + ' ejercicio' + (rest === 1 ? '' : 's') + ' más');
    return lines.join('\n');
  }

  function notify(title, body, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    var opts = {
      body: body,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: tag || 'gym-tracker',
      lang: 'es'
    };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready
          .then(function (reg) { return reg.showNotification(title, opts); })
          .catch(function () { try { new Notification(title, opts); } catch (e) { /* ignorado */ } });
      } else {
        new Notification(title, opts);
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  /* Sin servidor de push no hay forma de despertar la app un lunes a las 9am:
     el aviso se dispara la primera vez que abrís (o volvés a) la app ese lunes. */
  function checkWeeklyNotice() {
    if (!data.settings.weeklyNotify) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (new Date().getDay() !== 1) return;                      // solo lunes

    var monday = mondayISO(new Date());
    if (data.settings.lastWeeklyNotice === monday) return;       // ya avisamos este lunes

    var rep = weeklyReport();
    var body = weeklyNotificationText(rep);
    if (!body) return;

    if (notify('Progreso de la semana', body, 'weekly-' + monday)) {
      data.settings.lastWeeklyNotice = monday;
      save();
    }
  }

  function updateNotifInfo() {
    var el = $('#notif-info');
    if (!('Notification' in window)) {
      el.textContent = 'Este navegador no soporta notificaciones.';
      return;
    }
    if (Notification.permission === 'denied') {
      el.textContent = 'Las notificaciones están bloqueadas para este sitio: habilitalas desde los ajustes del navegador.';
      return;
    }
    el.textContent = data.settings.weeklyNotify
      ? 'Cada lunes vas a recibir el porcentaje de progreso por ejercicio. Como la app no usa servidor, el aviso aparece la primera vez que la abrís ese lunes.'
      : 'Activá el resumen para recibir cada lunes el progreso en % de cada ejercicio.';
  }

  function toggleWeekly(on) {
    if (!on) {
      data.settings.weeklyNotify = false;
      save();
      updateNotifInfo();
      return;
    }
    if (!('Notification' in window)) {
      $('#chk-weekly').checked = false;
      toast('Este navegador no soporta notificaciones');
      return;
    }
    if (Notification.permission === 'granted') {
      data.settings.weeklyNotify = true;
      save();
      updateNotifInfo();
      checkWeeklyNotice();
      return;
    }
    Notification.requestPermission().then(function (perm) {
      var ok = perm === 'granted';
      data.settings.weeklyNotify = ok;
      $('#chk-weekly').checked = ok;
      save();
      updateNotifInfo();
      if (ok) { toast('Resumen semanal activado'); checkWeeklyNotice(); }
      else toast('No se otorgó el permiso de notificaciones');
    }).catch(function () {
      $('#chk-weekly').checked = false;
    });
  }

  function previewWeekly() {
    closeSheet();
    showView('progreso');
    setWeeklyOpen(true, true);
    requestAnimationFrame(function () { scrollToEl($('#weekly-card')); });
    var rep = weeklyReport();
    var body = weeklyNotificationText(rep);
    if (!body) { toast('Todavía no hay dos sesiones para comparar'); return; }
    if (!notify('Progreso de la semana', body, 'weekly-preview')) {
      toast('Mirá el resumen en pantalla (notificaciones sin permiso)');
    }
  }

  /* ---------------------------------------------------------
     Backup: exportar / importar
     --------------------------------------------------------- */
  function exportBackup() {
    var payload = {
      exportedAt: new Date().toISOString(),
      version: 2,
      exercises: data.exercises,
      sessions: data.sessions,
      settings: data.settings
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'gym-tracker-backup-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup descargado');
  }

  function importBackup(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (err) {
        toast('El archivo no es un JSON válido');
        return;
      }
      var clean = sanitize(parsed);
      if (!clean.exercises.length && !clean.sessions.length) {
        toast('El archivo no contiene datos reconocibles');
        return;
      }
      var msg = 'Importar ' + clean.exercises.length + ' ejercicios y ' + clean.sessions.length +
        ' sesiones? Se reemplazan TODOS los datos actuales.';
      if (!window.confirm(msg)) return;

      data = clean;
      save();
      resetSessionForm();
      resetExerciseForm();
      renderAll();
      toast('Backup importado');
      closeSheet();
    };
    reader.onerror = function () { toast('No se pudo leer el archivo'); };
    reader.readAsText(file);
  }

  function wipeData() {
    if (!window.confirm('¿Borrar TODOS los ejercicios y sesiones? No se puede deshacer.')) return;
    if (!window.confirm('Última confirmación: se pierde todo lo cargado. ¿Seguro?')) return;
    data = { exercises: [], sessions: [], settings: defaultSettings() };
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignorado */ }
    resetSessionForm();
    resetExerciseForm();
    renderAll();
    closeSheet();
    toast('Datos borrados');
  }

  /* ---------------------------------------------------------
     Sheet de ajustes
     --------------------------------------------------------- */
  function openSheet() {
    $('#storage-info').textContent =
      data.exercises.length + ' ejercicios · ' + data.sessions.length +
      ' sesiones guardadas en este navegador.';
    $('#sheet').classList.remove('hidden');
    $('#sheet-backdrop').classList.remove('hidden');
  }
  function closeSheet() {
    $('#sheet').classList.add('hidden');
    $('#sheet-backdrop').classList.add('hidden');
  }

  /* ---------------------------------------------------------
     Render global
     --------------------------------------------------------- */
  function renderAll() {
    refreshExerciseSelects();
    renderExercises();
    renderRecent();
    renderLastSession();
    if (currentView === 'progreso') renderProgress();
  }

  /* ---------------------------------------------------------
     Init
     --------------------------------------------------------- */
  function init() {
    load();

    sessionCombo = createCombobox({
      input: '#session-exercise-search',
      hidden: '#session-exercise',
      list: '#session-exercise-list',
      clear: '#session-exercise-clear',
      onChange: function () { renderLastSession(); }
    });
    progressCombo = createCombobox({
      input: '#progress-exercise-search',
      hidden: '#progress-exercise',
      list: '#progress-exercise-list',
      clear: '#progress-exercise-clear',
      onChange: function () { resetPager('history'); renderProgress(); }
    });

    // ---- desplegables y listas paginadas ----
    $('#weekly-toggle').addEventListener('click', function () {
      setWeeklyOpen($('#weekly-body').classList.contains('hidden'), true);
    });
    $('#weekly-more').addEventListener('click', function () {
      shownCount.weekly += PAGE_SIZE.weekly;
      renderWeekly();
    });
    $('#exercise-more').addEventListener('click', function () {
      shownCount.exercises += PAGE_SIZE.exercises;
      renderExercises();
    });
    $('#history-more').addEventListener('click', function () {
      shownCount.history += PAGE_SIZE.history;
      renderProgress();
    });
    setWeeklyOpen(data.settings.weeklyOpen);

    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { showView(t.dataset.view); });
    });

    $('#form-exercise').addEventListener('submit', submitExercise);
    $('#btn-cancel-exercise').addEventListener('click', resetExerciseForm);

    $('#form-session').addEventListener('submit', submitSession);
    $('#btn-add-set').addEventListener('click', function () {
      var row = addSetRow();
      row.querySelector('.in-reps').focus();
    });
    $('#btn-cancel-edit').addEventListener('click', resetSessionForm);
    $('#btn-copy-last').addEventListener('click', copyLastSession);
    $('#btn-rest').addEventListener('click', function () {
      startRest(data.settings.restSeconds);
    });

    // ---- cronómetro ----
    timer.target = data.settings.restSeconds * 1000;
    $('#btn-timer').addEventListener('click', openTimer);
    $('#btn-timer-close').addEventListener('click', closeTimer);
    $('#timer-backdrop').addEventListener('click', closeTimer);
    $('#btn-timer-toggle').addEventListener('click', function () {
      if (timer.running) timerPause(); else timerStart();
    });
    $('#btn-timer-reset').addEventListener('click', timerReset);
    $$('#timer-sheet .seg').forEach(function (b) {
      b.addEventListener('click', function () { timerSetMode(b.dataset.mode); });
    });
    $$('#timer-presets .chip').forEach(function (c) {
      c.addEventListener('click', function () {
        timerSetTarget(Number(c.dataset.secs));
        timerReset();
        timerStart();
      });
    });
    timerSetMode('rest');
    timerSetTarget(data.settings.restSeconds);

    // ---- notificaciones ----
    $('#chk-weekly').checked = data.settings.weeklyNotify;
    $('#chk-weekly').addEventListener('change', function (e) { toggleWeekly(e.target.checked); });
    $('#btn-weekly-preview').addEventListener('click', previewWeekly);
    updateNotifInfo();

    $('#btn-menu').addEventListener('click', openSheet);
    $('#btn-close-sheet').addEventListener('click', closeSheet);
    $('#sheet-backdrop').addEventListener('click', closeSheet);
    $('#btn-export').addEventListener('click', exportBackup);
    $('#btn-import').addEventListener('click', function () { $('#file-import').click(); });
    $('#file-import').addEventListener('change', function (e) {
      importBackup(e.target.files[0]);
      e.target.value = '';
    });
    $('#btn-wipe').addEventListener('click', wipeData);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#sheet').classList.contains('hidden')) closeSheet();
      else if (!$('#timer-sheet').classList.contains('hidden')) closeTimer();
    });

    // al volver a la app: refrescamos el reloj y vemos si toca el aviso del lunes
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      renderTimer();
      checkWeeklyNotice();
    });

    resetSessionForm();
    renderAll();
    showView('registrar');
    renderTimer();
    checkWeeklyNotice();

    // Service worker (solo con http/https; abriendo el archivo con file:// no aplica)
    if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function (err) {
          console.warn('SW no registrado:', err);
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
