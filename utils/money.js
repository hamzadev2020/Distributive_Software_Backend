/**
 * Money Utility Functions
 * All monetary values are represented as integer paisa (1 PKR = 100 paisa)
 * Floating point operations are strictly rounded using roundHalfUp
 */

/**
 * Standard round half up to nearest integer
 * @param {number} val
 * @returns {number}
 */
export function roundHalfUp(val) {
  if (typeof val !== 'number' || isNaN(val)) {
    throw new TypeError('Value to round must be a valid number');
  }
  return Math.round(val);
}

/**
 * Convert PKR decimal float or string to integer paisa
 * @param {number|string} pkr
 * @returns {number}
 */
export function pkrToPaisa(pkr) {
  const num = typeof pkr === 'string' ? parseFloat(pkr) : pkr;
  if (isNaN(num)) throw new TypeError('Invalid PKR amount');
  return roundHalfUp(num * 100);
}

/**
 * Convert integer paisa to PKR decimal float
 * @param {number} paisa
 * @returns {number}
 */
export function paisaToPkr(paisa) {
  if (!Number.isInteger(paisa)) {
    throw new TypeError('Paisa must be an integer');
  }
  return paisa / 100;
}

/**
 * Format paisa into formatted PKR string, e.g. "PKR 1,250.50"
 * @param {number} paisa
 * @returns {string}
 */
export function formatPaisa(paisa) {
  const pkr = paisaToPkr(paisa);
  return `PKR ${pkr.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Calculate tax on net amount in integer paisa
 * @param {number} netPaisa - Amount in paisa
 * @param {number} taxRateBasisPoints - Tax rate in basis points (e.g. 18% = 1800 basis points)
 * @returns {number} Tax in paisa
 */
export function calculateTax(netPaisa, taxRateBasisPoints) {
  if (!Number.isInteger(netPaisa)) throw new TypeError('netPaisa must be integer');
  if (!Number.isInteger(taxRateBasisPoints)) throw new TypeError('taxRateBasisPoints must be integer');
  return roundHalfUp((netPaisa * taxRateBasisPoints) / 10000);
}

/**
 * Calculate line net after percent and flat discounts
 * @param {number} lineGrossPaisa
 * @param {number} discountPercentBasisPoints - e.g. 5% = 500
 * @param {number} discountFlatPaisa
 * @returns {number} Line net in paisa (minimum 0)
 */
export function calculateLineNet(lineGrossPaisa, discountPercentBasisPoints = 0, discountFlatPaisa = 0) {
  const percentDiscount = discountPercentBasisPoints > 0
    ? roundHalfUp((lineGrossPaisa * discountPercentBasisPoints) / 10000)
    : 0;
  const net = lineGrossPaisa - percentDiscount - discountFlatPaisa;
  return Math.max(0, net);
}
