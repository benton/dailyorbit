import type { Where } from "better-auth";

export function buildWhereClause(
  where: Where[],
  startIndex = 1,
): { params: unknown[]; sql: string } {
  const parts: string[] = [];
  const params: unknown[] = [];
  let i = startIndex;

  for (const condition of where) {
    const field = `"${condition.field}"`;
    switch (condition.operator ?? "eq") {
      case "eq":
        parts.push(`${field} = $${i++}`);
        params.push(condition.value);
        break;
      case "in":
        if (Array.isArray(condition.value)) {
          const placeholders = condition.value.map(() => `$${i++}`).join(", ");
          parts.push(`${field} IN (${placeholders})`);
          params.push(...condition.value);
        }
        break;
      case "contains":
        parts.push(`${field} LIKE $${i++}`);
        params.push(`%${String(condition.value)}%`);
        break;
      case "starts_with":
        parts.push(`${field} LIKE $${i++}`);
        params.push(`${String(condition.value)}%`);
        break;
      case "ends_with":
        parts.push(`${field} LIKE $${i++}`);
        params.push(`%${String(condition.value)}`);
        break;
      case "gt":
        parts.push(`${field} > $${i++}`);
        params.push(condition.value);
        break;
      case "gte":
        parts.push(`${field} >= $${i++}`);
        params.push(condition.value);
        break;
      case "lt":
        parts.push(`${field} < $${i++}`);
        params.push(condition.value);
        break;
      case "lte":
        parts.push(`${field} <= $${i++}`);
        params.push(condition.value);
        break;
      case "ne":
        parts.push(`${field} != $${i++}`);
        params.push(condition.value);
        break;
    }
  }

  return {
    sql: parts.length > 0 ? `WHERE ${parts.join(" AND ")}` : "",
    params,
  };
}
