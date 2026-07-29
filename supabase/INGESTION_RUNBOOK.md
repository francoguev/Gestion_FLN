# Ingesta de Tally y carga histórica

## Qué prepara esta carpeta

- `002_form_submissions.sql`: tabla privada de recepción. Conserva cada envío completo como JSON; todavía no modifica la aplicación Pulso.
- `functions/tally-ingest/index.ts`: receptor de webhook. Verifica la firma de Tally y evita duplicar reintentos del mismo envío.
- `functions/import-google-sheet.mjs`: carga inicial de la hoja principal en lotes de 200 filas.

## Orden seguro de puesta en marcha

1. Ejecutar `002_form_submissions.sql` en Supabase SQL Editor.
2. Configurar el secreto `TALLY_SIGNING_SECRET` en Supabase. Nunca se copia al navegador ni al repositorio.
3. Desplegar `tally-ingest` y probarlo con un envío de prueba de Tally.
4. Conservar activa la integración actual Tally → Google Sheets.
5. Ejecutar el importador con `--dry-run`, revisar que las columnas y la cantidad de filas sean correctas, y luego hacer la importación real.
6. Comparar los conteos antes de migrar las vistas de Pulso o Power BI.

El webhook y la hoja pueden convivir. Durante la transición se prioriza no perder datos: si un envío cae justo en el instante del cambio, puede quedar duplicado entre ambas fuentes, pero se identifica por su origen y se reconcilia antes de convertirlo en venta o arribo definitivo.

## Información aún necesaria

Antes de ejecutar la importación real, confirmar los encabezados exactos de la hoja principal y cuál es el identificador de respuesta de Tally, si existe. Con ello se creará la vista que reemplaza a la hoja derivada de ventas y una regla de conciliación de duplicados.
