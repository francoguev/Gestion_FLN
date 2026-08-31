(function () {
  var state = {
    users: [],
    pdvs: [],
    roleFilter: "",
    pdvFilter: "",
    search: "",
    editingEmail: null
  };

  function el(id) { return document.getElementById(id); }
  function escapeHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function isUserAdmin() {
    var profile = window.currentUserProfile || {};
    return profile.es_administrador === true || (profile.cargo && profile.cargo.toLowerCase() === "administrador");
  }

  function cargoBadge(cargo) {
    var c = (cargo || "").toLowerCase();
    if (c === "operaciones" || c === "administrador") {
      return '<span class="gx-status" style="background:#dbeafe; color:#1e40af; border:1px solid #93c5fd;">' + escapeHtml(cargo || "Operaciones") + '</span>';
    } else if (c === "supervisor") {
      return '<span class="gx-status" style="background:#f3e8ff; color:#6b21a8; border:1px solid #d8b4fe;">' + escapeHtml(cargo) + '</span>';
    } else if (c === "gerente") {
      return '<span class="gx-status" style="background:#fef3c7; color:#92400e; border:1px solid #fcd34d;">Gerente</span>';
    }
    return '<span class="gx-status" style="background:#dcfce7; color:#166534; border:1px solid #86efac;">' + escapeHtml(cargo || "Asesor") + '</span>';
  }

  function formatVistasBadges(vistas, isAdm) {
    if (isAdm) {
      return '<span class="gx-status" style="background:#e0e7ff; color:#3730a3; border:1px solid #c7d2fe;">Todos los Módulos</span>';
    }
    if (!vistas || !vistas.trim()) {
      return '<span style="color:#94a3b8; font-style:italic; font-size:12px;">Sin módulos asignados</span>';
    }
    var map = {
      "novedades": "Novedades",
      "powerbi": "Power BI",
      "stock": "Stock",
      "calculadora": "Calculadora",
      "formulario": "Form. Ventas",
      "avance": "Avance Link",
      "avancedia": "Avance Día",
      "arribos": "Arribos",
      "horario": "Horario",
      "xstore": "Control Xstore",
      "gestionxstore": "Gestión Xstore",
      "comprobante": "Comprobante",
      "bitacora": "Bitácora"
    };
    var items = vistas.split(",").map(function (v) { return v.trim(); }).filter(Boolean);
    return items.map(function (v) {
      var label = map[v] || v;
      return '<span class="gx-status" style="background:#f1f5f9; color:#334155; border:1px solid #cbd5e1; margin:1px 2px; font-size:11px;">' + escapeHtml(label) + '</span>';
    }).join(" ");
  }

  function formatStatusBadge(activo, isAdm) {
    if (isAdm) {
      return '<span class="gx-status" style="background:#dcfce7; color:#166534; border:1px solid #86efac;">🟢 Activo</span>';
    }
    if (activo !== false) {
      return '<span class="gx-status" style="background:#dcfce7; color:#166534; border:1px solid #86efac;">🟢 Activo</span>';
    }
    return '<span class="gx-status" style="background:#fee2e2; color:#991b1b; border:1px solid #fca5a5;">🔴 Inactivo</span>';
  }

  async function loadUsersData() {
    if (!window.supabaseClient) return;
    var hint = el("usersSummaryHint");
    if (hint) hint.textContent = "Cargando lista de usuarios…";
    try {
      var res = await window.supabaseClient.rpc("xstore_admin_list_users");
      if (res.error) throw res.error;
      state.users = res.data || [];
      state.pdvs = Array.from(new Set(state.users.map(function (u) { return u.pdv; }).filter(Boolean))).sort();
      populatePdvDropdowns();
      renderUsersTable();
      if (hint) hint.textContent = state.users.length + " usuario(s) registrado(s)";
    } catch (e) {
      console.error("Error cargando usuarios:", e);
      try {
        var pRes = await window.supabaseClient.from("profiles").select("email, full_name, cargo, pdv, es_administrador, clave_asignada, vistas, activo, created_at").order("full_name", { ascending: true });
        if (pRes.error) throw pRes.error;
        state.users = pRes.data || [];
        state.pdvs = Array.from(new Set(state.users.map(function (u) { return u.pdv; }).filter(Boolean))).sort();
        populatePdvDropdowns();
        renderUsersTable();
        if (hint) hint.textContent = state.users.length + " usuario(s) registrado(s)";
      } catch (err2) {
        if (hint) hint.textContent = "No se pudo cargar la lista de usuarios.";
      }
    }
  }

  function populatePdvDropdowns() {
    var sel = el("usersPdvFilter"), formPdv = el("userFormPdv");
    if (sel) {
      var curr = sel.value;
      sel.innerHTML = '<option value="">PDV · Todos</option>' + state.pdvs.map(function (p) {
        return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>';
      }).join("");
      sel.value = curr;
    }
    if (formPdv) {
      var currForm = formPdv.value;
      formPdv.innerHTML = '<option value="">Sin asignar</option>' + state.pdvs.map(function (p) {
        return '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>';
      }).join("");
      formPdv.value = currForm;
    }
  }

  function filteredUsers() {
    return state.users.filter(function (u) {
      if (u.es_administrador || (u.cargo && u.cargo.toLowerCase() === "administrador")) return false;
      if (state.roleFilter && (u.cargo || "").toLowerCase() !== state.roleFilter.toLowerCase()) return false;
      if (state.pdvFilter && u.pdv !== state.pdvFilter) return false;
      if (state.search) {
        var q = state.search.toLowerCase();
        var name = (u.full_name || "").toLowerCase();
        var email = (u.email || "").toLowerCase();
        if (name.indexOf(q) === -1 && email.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  var EYE_SVG_SHOW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  var EYE_SVG_HIDE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0e1aa1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

  function renderUsersTable() {
    var tbody = el("usersTbody");
    if (!tbody) return;
    var list = filteredUsers();
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:24px; color:#64748b;">No se encontraron usuarios.</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(function (u, index) {
      var isAdm = u.es_administrador || (u.cargo && u.cargo.toLowerCase() === "administrador");
      var passInputId = "userPassRow_" + index;
      var btnPassId = "btnTogglePassRow_" + index;
      var rawPass = u.clave_asignada || "";

      var passCellHtml =
        '<div style="display:inline-flex; align-items:center; gap:6px;">' +
        '<input type="password" id="' + passInputId + '" value="' + escapeHtml(rawPass || "••••••••") + '" data-real-pass="' + escapeHtml(rawPass) + '" readonly style="width:140px; height:28px; padding:0 8px; border:1px solid #e2e8f0; border-radius:6px; font-size:12px; font-family:monospace; background:#f8fafc; text-overflow:ellipsis;">' +
        '<button type="button" id="' + btnPassId + '" onclick="window.gxToggleRowPass(\'' + passInputId + '\', \'' + btnPassId + '\')" style="background:none; border:none; cursor:pointer; padding:2px; display:inline-flex; align-items:center;" title="Ver u ocultar clave">' + EYE_SVG_SHOW + '</button>' +
        '</div>';

      var toggleStatusBtn = u.activo !== false
        ? '<button type="button" class="gx-row-btn" style="background:#fee2e2; color:#991b1b; border:1px solid #fca5a5; padding:4px 8px; font-size:11px;" onclick="window.gxToggleUserStatus(\'' + escapeHtml(u.email) + '\', false)" title="Inhabilitar cuenta">🔴 Inhabilitar</button>'
        : '<button type="button" class="gx-row-btn" style="background:#dcfce7; color:#166534; border:1px solid #86efac; padding:4px 8px; font-size:11px;" onclick="window.gxToggleUserStatus(\'' + escapeHtml(u.email) + '\', true)" title="Reactivar cuenta">🟢 Reactivar</button>';

      var deleteBtn = '<button type="button" class="gx-row-btn" style="background:#fff; color:#dc2626; border:1px solid #fca5a5; padding:4px 8px; font-size:11px; margin-left:4px;" onclick="window.gxDeleteUser(\'' + escapeHtml(u.email) + '\')" title="Eliminar cuenta definitivamente">🗑️ Eliminar</button>';

      var actionsHtml = isAdm
        ? '<span style="color:#94a3b8; font-size:12px; font-style:italic;">Asignado vía Supabase</span>'
        : '<div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">' +
          '<button type="button" class="gx-row-btn" onclick="window.gxEditUser(\'' + escapeHtml(u.email) + '\')">Editar Ficha</button>' +
          toggleStatusBtn +
          deleteBtn +
          '</div>';

      return '<tr>' +
        '<td><strong>' + escapeHtml(u.full_name || "—") + '</strong><br><small style="color:#64748b;">' + escapeHtml(u.email) + '</small></td>' +
        '<td>' + cargoBadge(u.cargo) + '</td>' +
        '<td>' + escapeHtml(u.pdv || "Sin asignar") + '</td>' +
        '<td>' + formatVistasBadges(u.vistas, isAdm) + '</td>' +
        '<td>' + passCellHtml + '</td>' +
        '<td>' + formatStatusBadge(u.activo, isAdm) + '</td>' +
        '<td>' + actionsHtml + '</td>' +
        '</tr>';
    }).join("");
  }

  window.gxToggleRowPass = function (inputId, btnId) {
    var input = el(inputId);
    if (!input) return;
    var btn = el(btnId);
    var realPass = input.getAttribute("data-real-pass") || "";
    if (input.type === "password") {
      input.type = "text";
      input.value = realPass || "(Sin clave)";
      if (btn) btn.innerHTML = EYE_SVG_HIDE;
    } else {
      input.type = "password";
      input.value = realPass || "••••••••";
      if (btn) btn.innerHTML = EYE_SVG_SHOW;
    }
  };

  window.gxToggleUserStatus = async function (email, setActivo) {
    var actionName = setActivo ? "reactivar" : "inhabilitar";
    if (!confirm("¿Estás seguro de que deseas " + actionName + " al usuario " + email + "?")) return;
    try {
      var res = await window.supabaseClient.rpc("xstore_admin_toggle_user_status", {
        p_email: email,
        p_activo: setActivo
      });
      if (res.error) throw res.error;
      await loadUsersData();
      alert("¡Usuario " + (setActivo ? "reactivado" : "inhabilitado") + " correctamente!");
    } catch (err) {
      console.error("Error al cambiar estado:", err);
      alert("No se pudo cambiar el estado: " + (err.message || "Error desconocido"));
    }
  };

  window.gxDeleteUser = async function (email) {
    if (!confirm("⚠️ ¿Estás seguro de que deseas ELIMINAR DEFINITIVAMENTE la cuenta de " + email + "? Esta acción no se puede deshacer.")) return;
    try {
      var res = await window.supabaseClient.rpc("xstore_admin_delete_user", { p_email: email });
      if (res.error) throw res.error;
      await loadUsersData();
      alert("¡Cuenta de usuario eliminada definitivamente!");
    } catch (err) {
      console.error("Error al eliminar usuario:", err);
      alert("No se pudo eliminar el usuario: " + (err.message || "Error desconocido"));
    }
  };

  function setModalVistasCheckboxes(vistasStr) {
    var selected = (vistasStr || "").split(",").map(function (v) { return v.trim(); }).filter(Boolean);
    var checkboxes = document.querySelectorAll(".user-vista-cb");
    checkboxes.forEach(function (cb) {
      cb.checked = selected.indexOf(cb.value) !== -1;
    });
  }

  function getModalSelectedVistas() {
    var checkboxes = document.querySelectorAll(".user-vista-cb");
    var selected = [];
    checkboxes.forEach(function (cb) {
      if (cb.checked) selected.push(cb.value);
    });
    return selected.join(",");
  }

  window.gxEditUser = function (email) {
    var u = state.users.find(function (item) { return item.email === email; });
    if (!u) return;
    state.editingEmail = email;
    el("usersModalTitle").textContent = "Editar Ficha de Trabajador";
    el("userFormEmail").value = u.email;
    el("userFormEmail").readOnly = true;
    el("userFormFullName").value = u.full_name || "";
    el("userFormPassword").value = u.clave_asignada || "";
    el("userFormPassword").placeholder = "Ingresa la contraseña asignada";
    el("userFormCargo").value = (u.cargo || "asesor").toLowerCase();
    el("userFormPdv").value = u.pdv || "";
    setModalVistasCheckboxes(u.vistas || "");
    el("userFormActivo").checked = u.activo !== false;
    el("usersModal").style.display = "flex";
  };

  function openCreateUserModal() {
    state.editingEmail = null;
    el("usersModalTitle").textContent = "Crear Nuevo Usuario";
    el("userFormEmail").value = "";
    el("userFormEmail").readOnly = false;
    el("userFormFullName").value = "";
    el("userFormPassword").value = "";
    el("userFormPassword").placeholder = "Ingresa la contraseña inicial";
    el("userFormCargo").value = "asesor";
    el("userFormPdv").value = "";
    setModalVistasCheckboxes(""); // Por defecto, sin ningún módulo seleccionado
    el("userFormActivo").checked = true;
    el("usersModal").style.display = "flex";
  }

  function closeUsersModal() {
    el("usersModal").style.display = "none";
  }

  async function handleSaveUser(e) {
    e.preventDefault();
    var email = el("userFormEmail").value.trim();
    var fullName = el("userFormFullName").value.trim();
    var pass = el("userFormPassword").value;
    var cargo = el("userFormCargo").value;
    var pdv = el("userFormPdv").value;
    var vistas = getModalSelectedVistas();
    var activo = el("userFormActivo").checked;

    if (!email || !fullName) {
      alert("Ingresa el correo y nombre completo.");
      return;
    }

    var saveBtn = el("usersModalSave");
    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando…";

    try {
      var res = await window.supabaseClient.rpc("xstore_admin_save_profile", {
        p_email: email,
        p_full_name: fullName,
        p_cargo: cargo,
        p_pdv: pdv,
        p_password: pass || null,
        p_vistas: vistas,
        p_activo: activo
      });
      if (res.error) throw res.error;
      closeUsersModal();
      await loadUsersData();
      alert("¡Ficha de usuario guardada correctamente!");
    } catch (err) {
      console.error("Error al guardar usuario:", err);
      alert("No se pudo guardar el usuario: " + (err.message || "Error al conectar con Supabase"));
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar Usuario";
    }
  }

  function checkSidebarVisibility() {
    var navItem = el("navUsersItem");
    if (!navItem) return;
    if (isUserAdmin()) {
      navItem.style.display = "";
    } else {
      navItem.style.display = "none";
    }
  }

  window.loadUsuarios = function () {
    checkSidebarVisibility();
    if (!isUserAdmin()) return;
    loadUsersData();
  };

  document.addEventListener("DOMContentLoaded", function () {
    checkSidebarVisibility();

    var createBtn = el("usersCreateBtn");
    if (createBtn) createBtn.addEventListener("click", openCreateUserModal);

    var closeBtn = el("usersModalClose");
    if (closeBtn) closeBtn.addEventListener("click", closeUsersModal);

    var cancelBtn = el("usersModalCancel");
    if (cancelBtn) cancelBtn.addEventListener("click", closeUsersModal);

    var refreshBtn = el("usersRefreshBtn");
    if (refreshBtn) refreshBtn.addEventListener("click", loadUsersData);

    var roleSel = el("usersRoleFilter");
    if (roleSel) roleSel.addEventListener("change", function () { state.roleFilter = roleSel.value; renderUsersTable(); });

    var pdvSel = el("usersPdvFilter");
    if (pdvSel) pdvSel.addEventListener("change", function () { state.pdvFilter = pdvSel.value; renderUsersTable(); });

    var searchInp = el("usersSearchInput");
    if (searchInp) searchInp.addEventListener("input", function () { state.search = searchInp.value; renderUsersTable(); });

    var togglePassBtn = el("userFormTogglePass");
    if (togglePassBtn) {
      togglePassBtn.addEventListener("click", function () {
        var pInp = el("userFormPassword");
        pInp.type = pInp.type === "password" ? "text" : "password";
      });
    }

    var selectAllVistasBtn = el("userFormSelectAllVistas");
    if (selectAllVistasBtn) {
      selectAllVistasBtn.addEventListener("click", function () {
        var checkboxes = document.querySelectorAll(".user-vista-cb");
        var allChecked = Array.from(checkboxes).every(function (cb) { return cb.checked; });
        checkboxes.forEach(function (cb) { cb.checked = !allChecked; });
        selectAllVistasBtn.textContent = allChecked ? "Marcar todos" : "Desmarcar todos";
      });
    }

    var form = el("usersForm");
    if (form) form.addEventListener("submit", handleSaveUser);
  });
})();
