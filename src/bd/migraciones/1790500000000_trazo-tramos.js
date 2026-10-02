// Recorrido de cada tramo en el mapa: lista de puntos [lat, lng] que la central marca en el panel.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE pasaje.tramos
      ADD COLUMN trazo JSONB CHECK (trazo IS NULL OR jsonb_typeof(trazo) = 'array');
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('ALTER TABLE pasaje.tramos DROP COLUMN IF EXISTS trazo;');
};
