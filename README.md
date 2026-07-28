# Pulso — versión reforzada

## Cambios incluidos

- `css/app.css`: estilos separados del documento HTML.
- `js/`: un módulo por área funcional de la aplicación.
- Novedades: admite un subconjunto seguro de Markdown (`#` a `###`, `**negrita**`, `*cursiva*`, listas con `-`, código entre comillas invertidas y enlaces `https`/`http`/`mailto`). El HTML y JavaScript guardados en la base de datos no se ejecutan.
- Comprobantes: los datos introducidos por el usuario se codifican antes de mostrarse en la vista previa.
- Supabase: `supabase/001_access_policies.sql` contiene políticas RLS iniciales para revisar y aplicar desde el panel de Supabase.

## Antes de publicar

1. Pruebe la aplicación con una cuenta de asesor y otra de Operaciones.
2. Revise los nombres de columnas que presupone la migración (`profiles.pdv`, `cuota_ajustes.pdv`, `mes` y `nombre`).
3. Ejecute la migración primero en un proyecto de prueba y compruebe que el flujo de ajustes de cuota continúa funcionando.

La migración reemplaza las políticas abiertas detectadas `authenticated_can_read_profiles` y `authenticated_can_read_write_ajustes`. Los ajustes de cuota pueden ser consultados por los usuarios autenticados, pero solo el cargo exacto `Supervisor` puede modificarlos. Las políticas actuales de novedades ya restringen la publicación y edición a Operaciones, por lo que se conservan.

## Hojas de Google

Las URLs `docs.google.com/.../pub?...output=csv` son públicas por diseño. No publique allí información personal, IMEI, teléfonos, documentos ni datos que deban limitarse por usuario.

Para hacer privados los datos operativos, el siguiente paso es cargar los CSV en un bucket privado de Supabase y servirlos mediante una Edge Function que valide la sesión y el PDV del usuario. Cuando se habilite ese acceso, se reemplazan las URLs públicas en `js/stock.js`, `js/avance.js`, `js/arribos.js` y `js/xstore.js` por la URL autenticada de esa función.
