/** "1 alternative", "2 alternatives", "1,200 findings" (Indian digit grouping); `many` when the plural is not word + "s". */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? word : many}`;
}
