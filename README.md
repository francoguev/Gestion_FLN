# Calculadora de Comisiones — Fortalecernos SAC

Sitio estático de una sola página (`index.html`, sin dependencias de backend) para calcular el
"Ganado" mensual del equipo comercial: sueldo básico + comisión variable calculada por producto.

## Cómo publicarlo gratis en GitHub Pages

1. Crea un repositorio nuevo en GitHub (por ejemplo `comisiones-fortalecernos`). Puede ser público
   o privado (Pages funciona en ambos si tienes plan que lo permita; en repos públicos siempre es gratis).
2. Sube estos dos archivos a la raíz del repositorio: `index.html` y `README.md`.
   - Desde la web de GitHub: botón **Add file → Upload files**, arrastra `index.html` y confirma el commit.
   - O desde tu computadora:
     ```bash
     git init
     git add index.html README.md
     git commit -m "Calculadora de comisiones"
     git branch -M main
     git remote add origin https://github.com/TU_USUARIO/comisiones-fortalecernos.git
     git push -u origin main
     ```
3. En el repositorio, ve a **Settings → Pages**.
4. En "Build and deployment", selecciona **Deploy from a branch**, rama `main`, carpeta `/ (root)`, y guarda.
5. Espera 1-2 minutos. GitHub te dará una URL como:
   `https://TU_USUARIO.github.io/comisiones-fortalecernos/`
6. Comparte esa URL con el equipo. Cada vez que subas un nuevo commit a `main`, la página se actualiza sola.

## Configurar el acceso con Supabase (login + panel para agregar/quitar accesos)

El sitio pide correo y contraseña antes de mostrar la calculadora. La verificación ocurre en los servidores
de Supabase (no en el navegador), y tú administras quién entra desde un panel web, sin tocar código. Es
gratis, sin tarjeta, para el tamaño de tu equipo.

### 1. Crear el proyecto en Supabase (gratis, sin tarjeta)

1. Ve a [supabase.com](https://supabase.com) → **Start your project** → crea una cuenta (puedes usar tu Gmail).
2. Dale **New project**, ponle un nombre (ej. "comisiones-fortalecernos"), elige una contraseña para la base
   de datos (guárdala, no es la que usarán los empleados) y una región cercana (ej. South America).
3. Espera 1-2 minutos a que se cree el proyecto.

### 2. Copiar la URL y la llave pública al código

1. En el panel de tu proyecto, ve a **Project Settings (ícono de engranaje) → Data API**.
2. Copia el **Project URL** (algo como `https://xxxxxxxx.supabase.co`).
3. Ve a **Project Settings → API Keys** y copia la llave **anon public** (NO la `service_role`, esa es secreta
   y nunca debe ir en el sitio web).
4. En `index.html`, busca estas líneas y reemplaza los valores:
   ```js
   var SUPABASE_URL = "https://TU_PROYECTO.supabase.co";
   var SUPABASE_ANON_KEY = "TU_ANON_KEY_PUBLICA";
   ```

### 3. Desactivar el registro público (para que solo tú puedas crear cuentas)

1. Ve a **Authentication → Sign In / Providers** (o **Authentication → Settings**, según la versión del panel).
2. Busca la opción **"Allow new users to sign up"** (permitir que nuevos usuarios se registren) y **desactívala**.
   Así nadie puede crearse una cuenta por su cuenta — solo las que tú agregues manualmente van a poder entrar.

### 4. Agregar o quitar accesos del equipo

Todo esto se hace desde **Authentication → Users**, sin tocar el código ni volver a subir nada:

- **Agregar a alguien**: botón **Add user → Create new user**. Pon su correo y una contraseña temporal
  (dile que la cambie después, o compártesela de forma segura). Marca **Auto Confirm User** para que no
  necesite confirmar por email.
- **Quitarle acceso**: busca su usuario en la lista y dale **Delete user**, o usa **Ban user** si quieres
  bloquearlo temporalmente sin borrar su cuenta.

### Nota sobre el plan gratis

Los proyectos gratis de Supabase se "pausan" automáticamente si nadie los usa durante 7 días seguidos. Como
tu equipo va a iniciar sesión seguido, esto no debería pasar; pero si alguna vez el login tarda mucho o falla
después de varios días sin uso, entra al panel de Supabase (esto ya lo "despierta") y vuelve a intentar en un
par de minutos.

## Notas sobre el cálculo

- **Cumplimiento** = Venta ÷ Cuota, por producto.
- La comisión de un producto solo se paga si el cumplimiento es **70% o más**.
- Comisión del producto = Mix% × Comisión variable (monto ingresado arriba) × Cumplimiento.
- En **VR CAPTURA** el cumplimiento tiene tope de 100% (aunque venda más, no se paga de más por ese tope).
- En el resto de productos no hay tope: si el cumplimiento supera 100%, la comisión sigue creciendo.
- **Bonos por unidad adicional**: por cada unidad vendida por encima de la cuota se suma un monto fijo:
  - OSS MONO + OSS LLAA: S/10 por unidad extra.
  - OPP BASE: S/5 por unidad extra.
  - VR LLAA BASE: S/10 por unidad extra.
- **NPS de venta**: si el NPS logrado es ≥ 70%, se suman S/50.
- **MIS IN**: si la venta alcanza la cuota indicada, se suman S/50.
- Los datos ingresados se guardan automáticamente en el navegador (localStorage), así que si
  recargan la página no se pierden. El botón "Reiniciar datos" los borra.

## Personalización rápida

Los productos, porcentajes de mix y condiciones están definidos al inicio del `<script>` en
`index.html`, dentro del arreglo `PRODUCTS`. Puedes editar nombres, `mix`, `bono` (monto por unidad
extra) o el texto de `condicion` directamente ahí sin tocar el resto del código.
