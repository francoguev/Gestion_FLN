-- Pulso · Columna shift_type para horario_turnos
-- Ejecutar en Supabase > SQL Editor (opcional para mantener orden en la BD).

alter table public.horario_turnos 
add column if not exists shift_type text default 'NORMAL';
