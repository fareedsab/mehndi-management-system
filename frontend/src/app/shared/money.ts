export function money(value: number | string | null | undefined): string {
  const num = Number(value ?? 0);
  const safe = Number.isFinite(num) ? num : 0;
  return `Rs. ${safe.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
