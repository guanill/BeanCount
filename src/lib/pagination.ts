export async function collectPages<T>(
  fetchPage: (offset: number, pageSize: number) => Promise<{ rows: T[]; count: number }>,
  pageSize = 500,
): Promise<T[]> {
  const rows: T[] = [];
  let total: number;
  do {
    const page = await fetchPage(rows.length, pageSize);
    total = page.count;
    if (page.rows.length === 0 && rows.length < total) {
      throw new Error("Could not load all transactions for the selected period");
    }
    rows.push(...page.rows);
  } while (rows.length < total);
  return rows;
}
