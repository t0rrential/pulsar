export function weightedPick<T extends { weight: number }>(items: readonly T[]): T | undefined {
  // Normalization avoids overflow when adding several large, valid weights.
  let maxWeight = 0;
  for (const item of items) {
    if (Number.isFinite(item.weight) && item.weight > maxWeight) {
      maxWeight = item.weight;
    }
  }
  if (maxWeight === 0) return undefined;

  let total = 0;
  for (const item of items) {
    if (Number.isFinite(item.weight) && item.weight > 0) {
      total += item.weight / maxWeight;
    }
  }
  let remaining = Math.random() * total;
  let last: T | undefined;
  for (const item of items) {
    if (!Number.isFinite(item.weight) || item.weight <= 0) continue;
    last = item;
    remaining -= item.weight / maxWeight;
    if (remaining < 0) return item;
  }
  return last;
}
