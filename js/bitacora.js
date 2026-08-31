(function () {
  'use strict';

  var state = {
    activeTab: 'timeline', // 'timeline' | 'resumen'
    categories: [],
    alerts: [],
    pdvFilter: '',
    catFilter: '',
    selectedImageBase64: null,
    resolvingAlertId: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(isoStr) {
    if (!isoStr) return '—';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    var day = String(d.getDate()).padStart(2, '0');
    var monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    var month = monthNames[d.getMonth()];
    var year = d.getFullYear();
    var hours = d.getHours();
    var minutes = String(d.getMinutes()).padStart(2, '0');
    var ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    var formattedHours = String(hours).padStart(2, '0');
    return day + ' ' + month + ' ' + year + ' · ' + formattedHours + ':' + minutes + ' ' + ampm;
  }

  function formatDateParts(isoStr) {
    if (!isoStr) return { date: '—', time: '—' };
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return { date: isoStr, time: '' };
    var day = String(d.getDate()).padStart(2, '0');
    var month = String(d.getMonth() + 1).padStart(2, '0');
    var year = d.getFullYear();
    var hours = d.getHours();
    var minutes = String(d.getMinutes()).padStart(2, '0');
    var ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    var formattedHours = String(hours).padStart(2, '0');
    return {
      date: day + '/' + month + '/' + year,
      time: formattedHours + ':' + minutes + ' ' + ampm
    };
  }

  function getActiveUserEmail() {
    if (window.currentUserProfile && window.currentUserProfile.email) {
      return window.currentUserProfile.email;
    }
    try {
      var stored = localStorage.getItem('pulso_user_email');
      if (stored) return stored;
    } catch (e) {}
    return null;
  }

  function isSupervisorOrHigher() {
    var p = window.currentUserProfile || {};
    var cargo = (p.cargo || '').toLowerCase();
    var isAdm = p.es_administrador === true || cargo === 'administrador';
    return isAdm || cargo === 'supervisor' || cargo === 'operaciones' || cargo === 'gerente';
  }

  function isAsesor() {
    return !isSupervisorOrHigher();
  }

  async function loadBitacoraPage() {
    var activeEmail = getActiveUserEmail();
    if (!window.currentUserProfile && activeEmail && window.supabaseClient) {
      try {
        var profRes = await window.supabaseClient.from('profiles').select('*').eq('email', activeEmail).single();
        if (profRes && profRes.data) {
          window.currentUserProfile = profRes.data;
        }
      } catch (e) {}
    }
    setupRoleUI();

    var container = el('bitacoraTimelineContainer');
    if (container && (!state.alerts || state.alerts.length === 0)) {
      container.style.display = 'block';
      container.innerHTML = '<div style="text-align:center; padding:36px 16px; color:#64748b; font-weight:600;">' +
        '<div style="font-size:14px;">⏳ Cargando bitácora de alertas...</div>' +
        '</div>';
    }

    try { await fetchCategories(); } catch (e) { console.error('fetchCategories error:', e); }
    try { await fetchAlerts(); } catch (e) { console.error('fetchAlerts error:', e); }

    renderActiveView();
  }

  function setupRoleUI() {
    var isSup = isSupervisorOrHigher();

    var subtabsWrapper = el('bitacoraSubtabsWrapper');
    if (subtabsWrapper) {
      subtabsWrapper.style.display = isSup ? 'flex' : 'none';
    }

    var summaryTabBtn = el('bitacoraTabResumenBtn');
    if (summaryTabBtn) {
      summaryTabBtn.style.display = isSup ? 'inline-flex' : 'none';
    }

    var pdvFilterWrapper = el('bitacoraPdvFilterWrapper');
    if (pdvFilterWrapper) {
      pdvFilterWrapper.style.display = isSup ? 'flex' : 'none';
    }

    populatePdvFilterOptions();
  }

  function populatePdvFilterOptions() {
    var pdvSel = el('bitacoraPdvFilter');
    if (!pdvSel) return;
    var currentVal = pdvSel.value;

    var pdvs = [
      "TE ICA", "TE ICA 2", "TE CHINCHA", "TE CHINCHA 2", "TE PISCO", "TE PISCO 2",
      "TE PUQUIO", "TE MARCONA", "TE NAZCA", "TE HUANCAYO", "TE HUANCAYO 2",
      "TE CHANCHAMAYO", "TE TARMA", "TE JAUJA", "TE HUANUCO", "TE TINGO MARIA",
      "TE SANTA ANITA", "TE AYACUCHO", "TE HUANTA", "TE ANDAHUAYLAS", "TE ABANCAY", "OFICINA"
    ];

    pdvSel.innerHTML = '<option value="">Todos los PDVs</option>' +
      pdvs.map(function (p) {
        return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>';
      }).join('');

    pdvSel.value = currentVal;
  }

  var DEFAULT_CATEGORIES = [
    'SISTEMA',
    'STOCK',
    'COMPETENCIA',
    'PRECIO',
    'OFERTA COMERCIAL',
    'OTRO CANAL',
    'BIOMÉTRICO'
  ];

  function getCombinedCategories() {
    var catMap = {};
    DEFAULT_CATEGORIES.forEach(function (name) {
      catMap[name.toUpperCase()] = true;
    });

    (state.categories || []).forEach(function (c) {
      var n = typeof c === 'string' ? c : (c && c.nombre);
      if (n) catMap[n.toUpperCase()] = true;
    });

    return Object.keys(catMap).map(function (name) {
      return { nombre: name };
    });
  }

  async function fetchCategories() {
    try {
      var res = await window.supabaseClient.rpc('bitacora_get_categories');
      if (res.error) throw res.error;
      state.categories = res.data || [];
      renderCategoryCheckboxes();
      renderCategoryFilterOptions();
    } catch (err) {
      console.error('Error al cargar categorías de bitácora:', err);
      renderCategoryCheckboxes();
      renderCategoryFilterOptions();
    }
  }

  function renderCategoryCheckboxes() {
    var container = el('bitacoraModalCatContainer');
    if (!container) return;

    var allCats = getCombinedCategories();

    var html = allCats.map(function (cat) {
      return '<label style="display:flex; align-items:center; gap:8px; background:#fff; padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px; font-weight:600; color:#334155; cursor:pointer;">' +
        '<input type="checkbox" value="' + escapeHtml(cat.nombre) + '" class="bitacora-cat-cb"> ' +
        escapeHtml(cat.nombre) +
        '</label>';
    }).join('');

    html += '<label style="display:flex; align-items:center; gap:8px; background:#eff6ff; padding:6px 10px; border:1px solid #bfdbfe; border-radius:6px; font-size:12px; font-weight:700; color:#1e40af; cursor:pointer;">' +
      '<input type="checkbox" id="bitacoraCatOtroCb"> OTRO (Agregar nueva)' +
      '</label>';

    container.innerHTML = html;

    var otroCb = el('bitacoraCatOtroCb');
    if (otroCb) {
      otroCb.addEventListener('change', function () {
        var customBox = el('bitacoraCustomCatWrapper');
        if (customBox) customBox.style.display = otroCb.checked ? 'block' : 'none';
      });
    }
  }

  function renderCategoryFilterOptions() {
    var catSel = el('bitacoraCatFilter');
    if (!catSel) return;
    var currentVal = catSel.value;
    var allCats = getCombinedCategories();

    var html = '<option value="">Todas las categorías</option>' +
      allCats.map(function (c) {
        return '<option value="' + escapeHtml(c.nombre) + '">' + escapeHtml(c.nombre) + '</option>';
      }).join('');

    catSel.innerHTML = html;
    catSel.value = currentVal;
  }

  async function fetchAlerts() {
    try {
      var activeEmail = getActiveUserEmail();
      var res = await window.supabaseClient.rpc('bitacora_get_alertas', {
        p_user_email: activeEmail,
        p_pdv_filter: state.pdvFilter || null,
        p_categoria_filter: state.catFilter || null
      });
      if (!res.error && res.data && res.data.length > 0) {
        state.alerts = res.data;
        return;
      }
      var directRes = await window.supabaseClient.from('bitacora_alertas').select('*').order('created_at', { ascending: false });
      if (directRes.data) {
        state.alerts = directRes.data;
      } else {
        state.alerts = res.data || [];
      }
    } catch (err) {
      console.error('Error al cargar alertas de bitácora via RPC, intentando consulta directa:', err);
      try {
        var directRes = await window.supabaseClient.from('bitacora_alertas').select('*').order('created_at', { ascending: false });
        if (directRes.data) {
          state.alerts = directRes.data;
        }
      } catch (e2) {
        console.error('Error en consulta directa:', e2);
      }
    }
  }

  function renderActiveView() {
    var tc = el('bitacoraTimelineContainer');
    var rc = el('bitacoraResumenContainer');
    var tabResumenBtn = el('bitacoraTabResumenBtn');

    if (state.activeTab === 'resumen' && isSupervisorOrHigher()) {
      if (tc) tc.style.display = 'none';
      if (rc) rc.style.display = 'block';
      if (tabResumenBtn) {
        tabResumenBtn.className = 'bitacora-subtab-btn active';
        tabResumenBtn.innerHTML = '⏱️ Volver a Línea de Tiempo';
      }
      renderResumen();
    } else {
      state.activeTab = 'timeline';
      if (tc) tc.style.display = 'block';
      if (rc) rc.style.display = 'none';
      if (tabResumenBtn) {
        tabResumenBtn.className = 'bitacora-subtab-btn';
        tabResumenBtn.innerHTML = '📊 Resumen Ejecutivo';
      }
      renderTimeline();
    }
  }

  function renderTimeline() {
    var container = el('bitacoraTimelineContainer');
    if (!container) return;
    container.style.display = 'block';

    try {
      if (!state.alerts || !Array.isArray(state.alerts) || state.alerts.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:48px 16px; background:#fff; border-radius:12px; border:1px solid #e2e8f0; color:#64748b;">' +
          '<div style="font-size:32px; margin-bottom:8px;">📋</div>' +
          '<div style="font-weight:700; font-size:15px; color:#1e293b;">No hay alertas registradas</div>' +
          '<div style="font-size:13px; margin-top:4px;">No se encontraron incidencias en esta vista o filtro seleccionado.</div>' +
          '</div>';
        return;
      }

      var isSup = isSupervisorOrHigher();

      var html = '<div class="bitacora-timeline-wrapper" style="position:relative; padding:10px 0 20px 0;">';
      html += state.alerts.map(function (item) {
        if (!item) return '';
        var dt = formatDateParts(item.created_at || new Date().toISOString());
        var isSol = item.estado === 'solucionado' || (item.detalle && item.detalle.indexOf('🟢 ALERTA SOLUCIONADA') === 0);
        var isValidated = item.validado === true;

        var nodeClass = isSol ? 'node-sol' : (isValidated ? 'node-val' : 'node-pen');
        var cardBorder = isSol ? 'border-left:5px solid #16a34a;' : (isValidated ? 'border-left:5px solid #2563eb;' : 'border-left:5px solid #eab308;');
        var bgCard = isSol ? '#f0fdf4' : '#ffffff';

        var catBadges = (item.categorias || []).map(function (c) {
          var bg = '#f1f5f9';
          var col = '#334155';
          if (c === 'SISTEMA') { bg = '#fee2e2'; col = '#991b1b'; }
          else if (c === 'STOCK') { bg = '#fef3c7'; col = '#92400e'; }
          else if (c === 'COMPETENCIA') { bg = '#e0e7ff'; col = '#3730a3'; }
          else if (c === 'PRECIO') { bg = '#dcfce7'; col = '#166534'; }
          return '<span class="gx-status" style="background:' + bg + '; color:' + col + '; border:1px solid rgba(0,0,0,0.08); font-weight:800; font-size:11.5px; margin-right:4px;">' + escapeHtml(c) + '</span>';
        }).join('');

        var globalBadge = item.aplica_todos_pdv
          ? '<span class="gx-status" style="background:#4338ca; color:#ffffff; border:none; font-weight:800; font-size:11px; margin-right:4px;">🌐 APLICA A TODOS LOS PDV</span>'
          : '';

        var valBadge = isValidated
          ? '<span style="font-size:11.5px; font-weight:700; color:#1d4ed8; background:#eff6ff; border:1px solid #bfdbfe; padding:2px 8px; border-radius:12px; display:inline-flex; align-items:center; gap:4px;">✓ Validado por ' + escapeHtml(item.validado_por || 'Supervisor') + '</span>'
          : '<span style="font-size:11.5px; font-weight:600; color:#a16207; background:#fefce8; border:1px solid #fef08a; padding:2px 8px; border-radius:12px;">⏳ Pendiente de Validación</span>';

        var imgHtml = item.imagen_url
          ? '<div style="margin-top:10px;">' +
          '<img src="' + escapeHtml(item.imagen_url) + '" onclick="window.gxZoomBitacoraImage(\'' + escapeHtml(item.imagen_url) + '\')" style="max-width:180px; max-height:120px; border-radius:8px; border:1px solid #cbd5e1; cursor:pointer; object-fit:cover; display:block;" title="Clic para ampliar fotogafía">' +
          '</div>'
          : '';

        var supActions = isSup
          ? '<div style="margin-top:12px; padding-top:10px; border-top:1px dashed #e2e8f0; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">' +
          (!isValidated ? '<button type="button" class="gx-row-btn" style="background:#2563eb; color:#fff; font-size:11.5px; font-weight:700; padding:4px 10px;" onclick="window.gxValidateBitacoraAlert(\'' + item.id + '\')">✓ Validar Alerta</button>' : '') +
          (!item.aplica_todos_pdv ? '<button type="button" class="gx-row-btn" style="background:#4338ca; color:#fff; font-size:11.5px; font-weight:700; padding:4px 10px;" onclick="window.gxValidateBitacoraAlert(\'' + item.id + '\', true)">🌐 Marcar para Todos los PDV</button>' : '') +
          (!isSol ? '<button type="button" class="gx-row-btn" style="background:#16a34a; color:#fff; font-size:11.5px; font-weight:700; padding:4px 10px;" onclick="window.gxResolveBitacoraAlert(\'' + item.id + '\')">🟢 Marcar como Solucionada</button>' : '') +
          '<button type="button" class="gx-row-btn" style="background:#fff; color:#dc2626; border:1px solid #fca5a5; font-size:11.5px; padding:4px 10px; margin-left:auto;" onclick="window.gxDeleteBitacoraAlert(\'' + item.id + '\')">🗑️ Eliminar</button>' +
          '</div>'
          : '';

        return '<div class="bitacora-timeline-row" style="display:flex; align-items:flex-start; gap:16px; position:relative; margin-bottom:28px;">' +
          '<div style="width:105px; text-align:right; flex:0 0 105px; padding-top:4px;">' +
          '<div style="font-size:12.5px; font-weight:800; color:#0f172a; font-family:\'IBM Plex Mono\',monospace; letter-spacing:-0.02em;">' + dt.date + '</div>' +
          '<div style="font-size:11.5px; font-weight:600; color:#64748b; margin-top:2px;">' + dt.time + '</div>' +
          '</div>' +

          '<div style="position:relative; flex:0 0 20px; display:flex; justify-content:center; padding-top:4px;">' +
          '<div class="bitacora-node ' + nodeClass + '" style="width:14px; height:14px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 0 2px #0f172a; z-index:2; position:relative;"></div>' +
          '</div>' +

          '<div style="flex:1; min-width:0;">' +
          '<div style="font-size:14px; font-weight:800; color:#0f172a; letter-spacing:0.01em; margin-bottom:6px; display:flex; align-items:center; gap:8px;">' +
          '<span>📍 ' + escapeHtml(item.pdv || 'PDV') + '</span>' +
          '<span style="font-size:12px; font-weight:500; color:#64748b;">por <strong>' + escapeHtml(item.user_name || 'Asesor') + '</strong> (' + escapeHtml(item.cargo || 'asesor') + ')</span>' +
          '</div>' +

          '<div style="background:' + bgCard + '; border:2px solid #0f172a; ' + cardBorder + ' border-radius:14px; padding:16px 18px; box-shadow:0 3px 6px -1px rgba(0,0,0,0.06);">' +
          '<div style="margin-bottom:8px; display:flex; align-items:center; gap:4px; flex-wrap:wrap;">' +
          globalBadge + catBadges + valBadge +
          '</div>' +

          '<div style="font-size:14px; color:#1e293b; line-height:1.5; font-weight:600; white-space:pre-wrap;">' + escapeHtml(item.detalle || '') + '</div>' +

          imgHtml + supActions +
          '</div>' +
          '</div>' +
          '</div>';
      }).join('');

      html += '</div>';
      container.innerHTML = html;
    } catch (err) {
      console.error('Error al renderizar línea de tiempo:', err);
    }
  }

  function renderResumen() {
    var container = el('bitacoraResumenContainer');
    if (!container) return;

    var alerts = state.alerts || [];

    var now = new Date();
    var todayStr = now.toISOString().slice(0, 10);
    var monthStr = now.toISOString().slice(0, 7);

    var dayAlerts = alerts.filter(function (a) {
      return a.created_at && a.created_at.slice(0, 10) === todayStr;
    });

    var monthAlerts = alerts.filter(function (a) {
      return a.created_at && a.created_at.slice(0, 7) === monthStr;
    });

    function groupStats(list) {
      var byCat = {};
      var byPdv = {};

      list.forEach(function (a) {
        var pdv = a.pdv || 'Sin PDV';
        byPdv[pdv] = (byPdv[pdv] || 0) + 1;

        (a.categorias || ['OTRO']).forEach(function (c) {
          byCat[c] = (byCat[c] || 0) + 1;
        });
      });

      return { byCat: byCat, byPdv: byPdv, total: list.length };
    }

    var dayStats = groupStats(dayAlerts);
    var monthStats = groupStats(monthAlerts);

    function renderGroupCards(stats, title, subtitle, icon) {
      var catKeys = Object.keys(stats.byCat);
      var pdvKeys = Object.keys(stats.byPdv);

      var catBadgesHtml = catKeys.length
        ? catKeys.map(function (k) {
          return '<div style="display:flex; justify-content:space-between; align-items:center; background:#fff; padding:6px 12px; border-radius:8px; border:1px solid #e2e8f0; font-size:12.5px; font-weight:600; color:#334155;">' +
            '<span>' + escapeHtml(k) + '</span>' +
            '<span style="background:#0f172a; color:#fff; font-size:11px; padding:2px 8px; border-radius:12px;">' + stats.byCat[k] + '</span>' +
            '</div>';
        }).join('')
        : '<div style="font-size:12px; color:#94a3b8; font-style:italic;">No hay alertas registradas</div>';

      var pdvBadgesHtml = pdvKeys.length
        ? pdvKeys.map(function (p) {
          return '<div style="display:flex; justify-content:space-between; align-items:center; background:#fff; padding:6px 12px; border-radius:8px; border:1px solid #e2e8f0; font-size:12.5px; font-weight:600; color:#334155;">' +
            '<span>📍 ' + escapeHtml(p) + '</span>' +
            '<span style="background:#2563eb; color:#fff; font-size:11px; padding:2px 8px; border-radius:12px;">' + stats.byPdv[p] + '</span>' +
            '</div>';
        }).join('')
        : '<div style="font-size:12px; color:#94a3b8; font-style:italic;">Sin alertas en PDVs</div>';

      return '<div style="background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:18px 20px; box-shadow:0 2px 4px rgba(0,0,0,0.03);">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid #f1f5f9; padding-bottom:10px;">' +
        '<div>' +
        '<div style="font-size:16px; font-weight:700; color:#0f172a;">' + icon + ' ' + title + '</div>' +
        '<div style="font-size:12px; color:#64748b;">' + subtitle + '</div>' +
        '</div>' +
        '<div style="background:#eff6ff; color:#1d4ed8; font-family:Space Grotesk,sans-serif; font-size:18px; font-weight:700; padding:4px 14px; border-radius:20px; border:1px solid #bfdbfe;">' + stats.total + ' Alertas</div>' +
        '</div>' +

        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">' +
        '<div>' +
        '<div style="font-size:11.5px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:8px;">Por Categorías</div>' +
        '<div style="display:grid; gap:6px;">' + catBadgesHtml + '</div>' +
        '</div>' +
        '<div>' +
        '<div style="font-size:11.5px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:8px;">Por PDV</div>' +
        '<div style="display:grid; gap:6px;">' + pdvBadgesHtml + '</div>' +
        '</div>' +
        '</div>' +
        '</div>';
    }

    var html = '<div style="display:grid; gap:20px;">';
    html += renderGroupCards(dayStats, 'Alertas del Día', 'Incidencias registradas hoy (' + formatDate(now.toISOString()).slice(0, 11) + ')', '📅');
    html += renderGroupCards(monthStats, 'Alertas del Mes', 'Acumulado del mes en curso', '📊');
    html += '</div>';

    container.innerHTML = html;
  }

  async function openCreateModal() {
    var modal = el('bitacoraModal');
    if (!modal) return;
    var form = el('bitacoraForm');
    if (form) form.reset();
    state.selectedImageBase64 = null;
    var imgPreview = el('bitacoraModalImgPreview');
    if (imgPreview) imgPreview.style.display = 'none';

    var customBox = el('bitacoraCustomCatWrapper');
    if (customBox) customBox.style.display = 'none';

    try { await fetchCategories(); } catch (e) {}
    renderCategoryCheckboxes();
    modal.style.display = 'flex';
  }

  function closeCreateModal() {
    var modal = el('bitacoraModal');
    if (modal) modal.style.display = 'none';
  }

  window.gxOpenBitacoraCreateModal = openCreateModal;
  window.gxCloseBitacoraCreateModal = closeCreateModal;

  async function handleCreateAlert(e) {
    e.preventDefault();
    var submitBtn = el('bitacoraSubmitBtn');
    if (submitBtn) submitBtn.disabled = true;

    try {
      var selectedCats = Array.from(document.querySelectorAll('.bitacora-cat-cb:checked')).map(function (cb) {
        return cb.value;
      });

      var otroCb = el('bitacoraCatOtroCb');
      if (otroCb && otroCb.checked) {
        var customCatInp = el('bitacoraCustomCatInput');
        var customCatName = customCatInp ? customCatInp.value.trim() : '';
        if (customCatName) {
          var catRes = await window.supabaseClient.rpc('bitacora_add_category', { p_nombre: customCatName });
          if (catRes.error) throw catRes.error;
          selectedCats.push(catRes.data.nombre || customCatName.toUpperCase());
        }
      }

      if (selectedCats.length === 0) {
        alert('Por favor selecciona al menos una categoría para la alerta.');
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      var detalleInp = el('bitacoraDetalleInput');
      var detalle = detalleInp ? detalleInp.value.trim() : '';
      if (!detalle) {
        alert('Por favor describe la alerta o evento.');
        if (submitBtn) submitBtn.disabled = false;
        return;
      }

      var activeEmail = getActiveUserEmail();
      var res = await window.supabaseClient.rpc('bitacora_create_alerta', {
        p_categorias: selectedCats,
        p_detalle: detalle,
        p_imagen_url: state.selectedImageBase64,
        p_user_email: activeEmail
      });

      if (res.error) throw res.error;

      closeCreateModal();
      await fetchCategories();
      await fetchAlerts();
      renderActiveView();
      alert('¡Alerta registrada exitosamente en Bitácora!');
    } catch (err) {
      console.error('Error al crear alerta:', err);
      alert('Error al registrar alerta: ' + (err.message || err));
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function handleImageFileSelect(e) {
    var file = e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (evt) {
      state.selectedImageBase64 = evt.target.result;
      var imgPreview = el('bitacoraModalImgPreview');
      if (imgPreview) {
        imgPreview.src = state.selectedImageBase64;
        imgPreview.style.display = 'block';
      }
    };
    reader.readAsDataURL(file);
  }

  window.gxValidateBitacoraAlert = async function (id, appliesAll) {
    var confirmMsg = appliesAll
      ? '¿Validar esta alerta y marcarla como VÁLIDA PARA TODOS LOS PDVs?'
      : '¿Validar esta alerta como Supervisor?';

    if (!confirm(confirmMsg)) return;

    try {
      var res = await window.supabaseClient.rpc('bitacora_validar_alerta', {
        p_alerta_id: id,
        p_aplica_todos_pdv: appliesAll === true
      });
      if (res.error) throw res.error;
      await fetchAlerts();
      renderActiveView();
    } catch (err) {
      console.error('Error al validar alerta:', err);
      alert('Error al validar alerta: ' + (err.message || err));
    }
  };

  window.gxResolveBitacoraAlert = function (id) {
    state.resolvingAlertId = id;
    var modal = el('bitacoraResolveModal');
    if (modal) modal.style.display = 'flex';
  };

  async function handleConfirmResolve(e) {
    e.preventDefault();
    if (!state.resolvingAlertId) return;

    var noteInp = el('bitacoraResolveNoteInput');
    var note = noteInp ? noteInp.value.trim() : '';

    try {
      var res = await window.supabaseClient.rpc('bitacora_solucionar_alerta', {
        p_alerta_id: state.resolvingAlertId,
        p_detalle_solucion: note
      });
      if (res.error) throw res.error;

      el('bitacoraResolveModal').style.display = 'none';
      state.resolvingAlertId = null;
      if (noteInp) noteInp.value = '';

      await fetchAlerts();
      renderActiveView();
      alert('¡Alerta marcada como SOLUCIONADA y evento de cierre registrado!');
    } catch (err) {
      console.error('Error al solucionar alerta:', err);
      alert('Error al marcar como solucionada: ' + (err.message || err));
    }
  }

  window.gxDeleteBitacoraAlert = async function (id) {
    if (!confirm('¿Estás seguro de que deseas eliminar este registro de bitácora?')) return;
    try {
      var res = await window.supabaseClient.rpc('bitacora_eliminar_alerta', { p_alerta_id: id });
      if (res.error) throw res.error;
      await fetchAlerts();
      renderActiveView();
    } catch (err) {
      console.error('Error al eliminar alerta:', err);
      alert('Error al eliminar alerta: ' + (err.message || err));
    }
  };

  window.gxZoomBitacoraImage = function (url) {
    var modal = el('bitacoraImageModal');
    var img = el('bitacoraZoomedImage');
    if (modal && img) {
      img.src = url;
      modal.style.display = 'flex';
    }
  };

  function initBitacora() {
    var openBtn = el('bitacoraNewBtn');
    if (openBtn) openBtn.onclick = openCreateModal;

    var closeBtn = el('bitacoraModalClose');
    if (closeBtn) closeBtn.onclick = closeCreateModal;

    var form = el('bitacoraForm');
    if (form) form.onsubmit = handleCreateAlert;

    var imgInput = el('bitacoraImageInput');
    if (imgInput) imgInput.onchange = handleImageFileSelect;

    var tabResumenBtn = el('bitacoraTabResumenBtn');
    if (tabResumenBtn) {
      tabResumenBtn.onclick = function () {
        if (state.activeTab === 'timeline') {
          state.activeTab = 'resumen';
        } else {
          state.activeTab = 'timeline';
        }
        renderActiveView();
      };
    }

    var pdvSel = el('bitacoraPdvFilter');
    if (pdvSel) {
      pdvSel.onchange = async function () {
        state.pdvFilter = pdvSel.value;
        await fetchAlerts();
        renderActiveView();
      };
    }

    var catSel = el('bitacoraCatFilter');
    if (catSel) {
      catSel.onchange = async function () {
        state.catFilter = catSel.value;
        await fetchAlerts();
        renderActiveView();
      };
    }

    var resolveForm = el('bitacoraResolveForm');
    if (resolveForm) resolveForm.onsubmit = handleConfirmResolve;

    var resolveCloseBtn = el('bitacoraResolveModalClose');
    if (resolveCloseBtn) {
      resolveCloseBtn.onclick = function () {
        if (el('bitacoraResolveModal')) el('bitacoraResolveModal').style.display = 'none';
      };
    }

    var imageModalCloseBtn = el('bitacoraImageModalClose');
    if (imageModalCloseBtn) {
      imageModalCloseBtn.onclick = function () {
        if (el('bitacoraImageModal')) el('bitacoraImageModal').style.display = 'none';
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBitacora);
  } else {
    initBitacora();
  }

  window.loadBitacoraPage = loadBitacoraPage;
  window.gxOpenBitacoraCreateModal = openCreateModal;
  window.gxCloseBitacoraCreateModal = closeCreateModal;
})();
