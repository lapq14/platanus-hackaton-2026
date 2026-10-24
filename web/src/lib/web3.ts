/** Formats a database amount (always USD), e.g. `$1,234.00`. */
export function fmtUsd(n: number | string) {
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
