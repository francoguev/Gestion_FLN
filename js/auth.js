(function(){
  // ======================================================================
  // LISTA DE CORREOS AUTORIZADOS
  // Agrega o quita correos de Gmail del equipo aquí (en minúsculas).
  // ======================================================================
  // ======================================================================
  // CONFIGURACIÓN DE SUPABASE
  // Reemplaza estos dos valores con los de tu proyecto de Supabase:
  // Project Settings → API → Project URL / anon public key
  // ======================================================================
var SUPABASE_URL = "https://zarpfzsvkqfuhvjglmaa.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphcnBmenN2a3FmdWh2amdsbWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1OTA4NTgsImV4cCI6MjEwMDE2Njg1OH0.Lb51XFTMeRmxOoUv3pisv8eBvdo-S9C2SOMP4zwRPQs";

  var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.supabaseClient = supabaseClient;

  function formatUserRoleLabel(cargo, pdv) {
    var c = (cargo || "").toUpperCase();
    var p = (pdv || "").toUpperCase();
    if (c && p) return c + " · " + p;
    if (c) return c;
    if (p) return p;
    return "";
  }

  function showApp(email){
    document.getElementById("loginGate").style.display = "none";
    document.getElementById("appContent").style.display = "block";
    var label = document.getElementById("userEmailLabel");
    if(label) label.textContent = email;
    try { localStorage.setItem("pulso_user_email", email); }catch(e){}
    loadProfile(email);
  }

  async function loadProfile(email){
    var nameLabel = document.getElementById("userNameLabel") || document.getElementById("profileUserName");
    var roleLabel = document.getElementById("userRoleLabel") || document.getElementById("profileUserRole");
    var emailLabel = document.getElementById("userEmailLabel");
    if (emailLabel) emailLabel.textContent = email;

    try{
      var res = await window.supabaseClient
        .from("profiles")
        .select("full_name, cargo, vistas, pdv, es_administrador, activo")
        .ilike("email", email);
      var pData = (res && res.data && res.data.length > 0) ? res.data[0] : null;
      if(pData){
        if(pData.activo === false){
          alert("Tu cuenta ha sido inhabilitada por la administración.");
          await window.supabaseClient.auth.signOut();
          window.location.reload();
          return;
        }
        if(nameLabel) nameLabel.textContent = pData.full_name || email;
        if(roleLabel) roleLabel.textContent = formatUserRoleLabel(pData.cargo, pData.pdv);
      }else{
        if(nameLabel) nameLabel.textContent = email;
        if(roleLabel) roleLabel.textContent = "";
      }
      window.currentUserProfile = {
        email: email,
        fullName: (pData && pData.full_name) || email,
        pdv: (pData && pData.pdv) || "",
        cargo: (pData && pData.cargo) || "",
        es_administrador: (pData && pData.es_administrador === true),
        activo: (pData && pData.activo !== false)
      };

      var isAdm = window.currentUserProfile.es_administrador || (window.currentUserProfile.cargo && window.currentUserProfile.cargo.toLowerCase() === "administrador");
      var vistasRaw = (pData && pData.vistas) ? pData.vistas : "";
      var allowed = vistasRaw.split(",").map(function(v){ return v.trim(); }).filter(Boolean);
      if(isAdm && allowed.indexOf("usuarios") === -1){
        allowed.push("usuarios");
      }
      if(allowed.indexOf("bitacora") === -1){
        allowed.push("bitacora");
      }

      applyViewPermissions(allowed);
      restoreLastPage(allowed);
      if(allowed.indexOf("novedades") !== -1){
        if(typeof window.loadNovedadesPage === "function") window.loadNovedadesPage();
        if(typeof window.checkImportantNovedadPopup === "function") window.checkImportantNovedadPopup();
      }

      var currentActivePage = null;
      try{ currentActivePage = sessionStorage.getItem("pulso-active-page"); }catch(e){}
      if((currentActivePage === "bitacora" || allowed.indexOf("bitacora") !== -1) && typeof window.loadBitacoraPage === "function"){
        window.loadBitacoraPage();
      }
    }catch(e){
      console.error("Excepción cargando profiles:", e);
      if(nameLabel) nameLabel.textContent = email;
      if(roleLabel) roleLabel.textContent = "";
      window.currentUserProfile = { email: email, fullName: email, pdv: "", es_administrador: false };
      applyViewPermissions(["bitacora"]);
    }
  }

  function applyViewPermissions(allowed){
    allowed = allowed || [];
    if(allowed.indexOf("bitacora") === -1){
      allowed.push("bitacora");
    }
    var navItems = document.querySelectorAll(".nav-item");
    var firstAllowedItem = null;
    navItems.forEach(function(item){
      var page = item.getAttribute("data-page");
      var isAllowed = (page === "bitacora") || (allowed.indexOf(page) !== -1);
      item.style.display = isAllowed ? "" : "none";
      if(isAllowed && !firstAllowedItem) firstAllowedItem = item;
    });

    var activeItem = document.querySelector(".nav-item.active");
    var activePageName = activeItem && activeItem.getAttribute("data-page");
    var activeAllowed = activeItem && (activePageName === "bitacora" || allowed.indexOf(activePageName) !== -1);
    if(!activeAllowed && firstAllowedItem){
      navItems.forEach(function(i){ i.classList.remove("active"); });
      firstAllowedItem.classList.add("active");
      document.querySelectorAll(".page").forEach(function(p){ p.classList.remove("active"); });
      var targetPage = document.getElementById("page-" + firstAllowedItem.getAttribute("data-page"));
      if(targetPage) targetPage.classList.add("active");
    }

    var sidebarNav = document.getElementById("sidebarNav");
    if(sidebarNav) sidebarNav.classList.remove("pending");
  }

  function openAppPage(target){
    var item = document.querySelector('.nav-item[data-page="' + target + '"]');
    var page = document.getElementById("page-" + target);
    if(!item || !page) return;
    if(target !== "bitacora" && item.style.display === "none") return;
    document.querySelectorAll(".nav-item").forEach(function(navItem){ navItem.classList.remove("active"); });
    item.classList.add("active");
    document.querySelectorAll(".page").forEach(function(section){ section.classList.remove("active"); });
    page.classList.add("active");
    try{ sessionStorage.setItem("pulso-active-page", target); }catch(e){}
    if(target === "stock" && typeof window.loadStock === "function") window.loadStock();
    if(target === "avance" && typeof window.loadAvance === "function") window.loadAvance();
    if(target === "avancedia" && typeof window.loadAvanceDia === "function") window.loadAvanceDia();
    if(target === "arribos" && typeof window.loadArribos === "function") window.loadArribos();
    if(target === "horario" && typeof window.loadHorario === "function") window.loadHorario();
    if(target === "xstore" && typeof window.loadXstore === "function") window.loadXstore();
    if(target === "gestionxstore" && typeof window.loadGestionXstore === "function") window.loadGestionXstore();
    if(target === "novedades" && typeof window.loadNovedadesPage === "function") window.loadNovedadesPage();
    if(target === "bitacora" && typeof window.loadBitacoraPage === "function") window.loadBitacoraPage();
    if(target === "usuarios" && typeof window.loadUsuarios === "function") window.loadUsuarios();
  }

  function restoreLastPage(allowed){
    var saved = null;
    try{ saved = sessionStorage.getItem("pulso-active-page"); }catch(e){}
    if(!saved) return; // Primera apertura: se mantiene Novedades.
    if(allowed.indexOf(saved) === -1) return;
    openAppPage(saved);
  }

  function showLoginError(message){
    document.getElementById("loginErrorText").textContent = message;
    document.getElementById("loginDenied").classList.add("show");
  }

  function hideLoginError(){
    document.getElementById("loginDenied").classList.remove("show");
  }

  async function checkExistingSession(){
    try{
      var res = await supabaseClient.auth.getSession();
      var session = res && res.data && res.data.session;
      if(session && session.user && session.user.email){
        showApp(session.user.email);
      }
    }catch(e){ /* sin sesión previa */ }
  }

  document.addEventListener("DOMContentLoaded", function(){
    checkExistingSession();

    var form = document.getElementById("loginForm");
    if(form){
      form.addEventListener("submit", async function(e){
        e.preventDefault();
        hideLoginError();
        var email = document.getElementById("loginEmail").value.trim();
        var password = document.getElementById("loginPassword").value;
        var btn = document.getElementById("loginSubmitBtn");
        btn.disabled = true;
        btn.textContent = "Ingresando…";
        try{
          var result = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
          if(result.error){
            console.error("Error en login:", result.error);
            var errStr = (result.error.message || "").toLowerCase();
            var status = result.error.status || 0;

            if(errStr.includes("fetch") || errStr.includes("network") || errStr.includes("failed to fetch") || status === 0){
              showLoginError("Error de conexión a internet o DNS. Verifica tu red e intenta nuevamente.");
            }else if(errStr.includes("invalid login credentials") || status === 400){
              showLoginError("Correo o contraseña incorrectos.");
            }else{
              showLoginError(result.error.message || "Error al iniciar sesión. Intenta de nuevo.");
            }
          }else{
            showApp(result.data.user.email);
          }
        }catch(err){
          console.error("Excepción en login:", err);
          showLoginError("No se pudo conectar con el servidor. Verifica tu conexión a internet.");
        }
        btn.disabled = false;
        btn.textContent = "Iniciar sesión";
      });
    }

    var logoutBtn = document.getElementById("logoutBtn");
    if(logoutBtn){
      logoutBtn.addEventListener("click", async function(){
        try{ await supabaseClient.auth.signOut(); }catch(e){}
        try{ sessionStorage.removeItem("pulso-active-page"); }catch(e){}
        window.location.reload();
      });
    }

    var navItems = document.querySelectorAll(".nav-item");
      navItems.forEach(function(item){
        item.addEventListener("click", function(){
        openAppPage(item.getAttribute("data-page"));
        });
      });

    var sidebar = document.getElementById("sidebar");
    var sidebarToggles = document.querySelectorAll(".topbar-toggle");
    if(sidebar && sidebarToggles.length){
      // En cada apertura se parte del menú compacto; el usuario puede abrirlo
      // durante la sesión actual sin que esa elección se guarde al recargar.
      sidebar.classList.add("collapsed");
      sidebarToggles.forEach(function(btn){
        btn.addEventListener("click", function(){
          sidebar.classList.toggle("collapsed");
        });
      });
    }
  });
  window.showApp = showApp;
  window.openAppPage = openAppPage;
})();
