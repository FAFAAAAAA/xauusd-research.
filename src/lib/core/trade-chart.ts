/** Include setup context before entry and the complete position through exit. */
export function tradeChartWindow(entry: number, exit: number | null, interval: number) {
  return { from: entry - 48 * interval, to: Math.max(entry, exit ?? entry) + 20 * interval + 1 };
}
