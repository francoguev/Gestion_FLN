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
var SUPABASE_ANON_KEY = "sb_publishable_ieKMBlB07Pz0ii7s1XFe8w_HOvQYAty";

  var supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  window.supabaseClient = supabaseClient;

  function showApp(email){
    document.getElementById("loginGate").style.display = "none";
    document.getElementById("appContent").style.display = "block";
    var label = document.getElementById("userEmailLabel");
    if(label) label.textContent = email;
    loadProfile(email);
  }

  async function loadProfile(email){
    var nameLabel = document.getElementById("userNameLabel");
    var roleLabel = document.getElementById("userRoleLabel");
    try{
      var res = await supabaseClient
        .from("profiles")
        .select("full_name, cargo, vistas, pdv")
        .eq("email", email)
        .maybeSingle();
      if(res.error){ console.error("Error cargando profiles:", res.error); }
      if(res.data && res.data.full_name){
        if(nameLabel) nameLabel.textContent = res.data.full_name;
        if(roleLabel) roleLabel.textContent = res.data.cargo || "";
      }else{
        // aún no está en la tabla profiles: solo se muestra el correo
        if(nameLabel) nameLabel.textContent = "";
        if(roleLabel) roleLabel.textContent = "";
      }
      window.currentUserProfile = {
        email: email,
        fullName: (res.data && res.data.full_name) || "",
        pdv: (res.data && res.data.pdv) || "",
        cargo: (res.data && res.data.cargo) || ""
      };
      var vistasRaw = (res.data && res.data.vistas) ? res.data.vistas : "calculadora";
      var allowed = vistasRaw.split(",").map(function(v){ return v.trim(); }).filter(Boolean);
      applyViewPermissions(allowed);
      restoreLastPage(allowed);
      if(allowed.indexOf("novedades") !== -1){
        if(typeof window.loadNovedadesPage === "function") window.loadNovedadesPage();
        if(typeof window.checkImportantNovedadPopup === "function") window.checkImportantNovedadPopup();
      }
    }catch(e){
      console.error("Excepción cargando profiles:", e);
      if(nameLabel) nameLabel.textContent = "";
      if(roleLabel) roleLabel.textContent = "";
      window.currentUserProfile = { email: email, fullName:"", pdv:"" };
      // si algo falla, por seguridad solo se deja ver la calculadora
      applyViewPermissions(["calculadora"]);
      if(typeof window.loadNovedadesPage === "function") window.loadNovedadesPage();
      if(typeof window.checkImportantNovedadPopup === "function") window.checkImportantNovedadPopup();
    }
  }

  function applyViewPermissions(allowed){
    var navItems = document.querySelectorAll(".nav-item");
    var firstAllowedItem = null;
    navItems.forEach(function(item){
      var page = item.getAttribute("data-page");
      var isAllowed = allowed.indexOf(page) !== -1;
      item.style.display = isAllowed ? "" : "none";
      if(isAllowed && !firstAllowedItem) firstAllowedItem = item;
    });

    var activeItem = document.querySelector(".nav-item.active");
    var activePageName = activeItem && activeItem.getAttribute("data-page");
    var activeAllowed = activeItem && allowed.indexOf(activePageName) !== -1;
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
    if(!item || !page || item.style.display === "none") return;
    document.querySelectorAll(".nav-item").forEach(function(navItem){ navItem.classList.remove("active"); });
    item.classList.add("active");
    document.querySelectorAll(".page").forEach(function(section){ section.classList.remove("active"); });
    page.classList.add("active");
    try{ sessionStorage.setItem("pulso-active-page", target); }catch(e){}
    if(target === "stock" && typeof loadStock === "function") loadStock();
    if(target === "avance" && typeof loadAvance === "function") loadAvance();
    if(target === "avancedia" && typeof window.loadAvanceDia === "function") window.loadAvanceDia();
    if(target === "arribos" && typeof window.loadArribos === "function") window.loadArribos();
    if(target === "horario" && typeof window.loadHorario === "function") window.loadHorario();
    if(target === "xstore" && typeof loadXstore === "function") loadXstore();
    if(target === "gestionxstore" && typeof window.loadGestionXstore === "function") window.loadGestionXstore();
    if(target === "novedades" && typeof window.loadNovedadesPage === "function") window.loadNovedadesPage();
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
            showLoginError("Correo o contraseña incorrectos.");
          }else{
            showApp(result.data.user.email);
          }
        }catch(err){
          showLoginError("No se pudo conectar. Intenta nuevamente.");
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
})();
