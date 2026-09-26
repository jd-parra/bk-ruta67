/**
 * Esquema propio de Postgres. No es `public` para que la API REST automática de Supabase
 * (PostgREST) no exponga las tablas. Todas las consultas lo nombran explícitamente
 * (`pasaje.usuarios`) porque con el Transaction pooler no se puede fijar el search_path.
 */
export const ESQUEMA = 'pasaje';
