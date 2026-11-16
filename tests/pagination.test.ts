import { test } from "node:test";
import assert from "node:assert/strict";
import { collectPages } from "../src/lib/pagination.ts";

test("collects every transaction even when the server returns smaller pages", async () => {
  const data = Array.from({ length: 1100 }, (_, index) => index);
  const rows = await collectPages(async (offset, pageSize) => ({
    rows: data.slice(offset, offset + Math.min(pageSize, 200)),
    count: data.length,
  }));
  assert.deepEqual(rows, data);
});

test("reports an incomplete read rather than returning partial results", async () => {
  await assert.rejects(collectPages(async () => ({ rows: [], count: 10 })), /Could not load all transactions/);
});
