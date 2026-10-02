// Paradas de cada tramo: dónde sube y baja la gente. Van aparte del trazo, que solo dibuja el camino.

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.sql(`
    ALTER TABLE pasaje.tramos
      ADD COLUMN paradas JSONB CHECK (paradas IS NULL OR jsonb_typeof(paradas) = 'array');
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.sql('ALTER TABLE pasaje.tramos DROP COLUMN IF EXISTS paradas;');
};
