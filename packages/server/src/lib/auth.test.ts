import { describe, expect, it } from "vitest";
import { buildWhereClause } from "./auth-helpers.ts";

describe("buildWhereClause", () => {
  it("returns empty string and no params when where list is empty", () => {
    const { sql, params } = buildWhereClause([]);
    expect(sql).toEqual("");
    expect(params).toEqual([]);
  });

  it("builds an eq clause for a single condition", () => {
    const { sql, params } = buildWhereClause([{ field: "id", value: "42", operator: "eq" }]);
    expect(sql).toEqual('WHERE "id" = ?');
    expect(params).toEqual(["42"]);
  });

  it("builds an IN clause for multiple values", () => {
    const { sql, params } = buildWhereClause([
      { field: "status", value: ["active", "pending"], operator: "in" },
    ]);
    expect(sql).toEqual('WHERE "status" IN (?, ?)');
    expect(params).toEqual(["active", "pending"]);
  });

  it("builds a LIKE clause for contains operator", () => {
    const { sql, params } = buildWhereClause([
      { field: "name", value: "orbit", operator: "contains" },
    ]);
    expect(sql).toEqual('WHERE "name" LIKE ?');
    expect(params).toEqual(["%orbit%"]);
  });

  it("joins multiple conditions with AND", () => {
    const { sql, params } = buildWhereClause([
      { field: "id", value: "1", operator: "eq" },
      { field: "email", value: "test@example.com", operator: "eq" },
    ]);
    expect(sql).toEqual('WHERE "id" = ? AND "email" = ?');
    expect(params).toEqual(["1", "test@example.com"]);
  });

  it("defaults to eq when operator is omitted", () => {
    const { sql, params } = buildWhereClause([{ field: "id", value: "7" }]);
    expect(sql).toEqual('WHERE "id" = ?');
    expect(params).toEqual(["7"]);
  });
});
