/**
 * Céntimos → texto en bolívares ("1.234,50 Bs").
 * @param {number} centimos
 * @returns {string}
 */
export function formatearBs(centimos) {
  const bolivares = (centimos / 100).toFixed(2);
  const [entero, decimales] = bolivares.split('.');
  return `${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimales} Bs`;
}
