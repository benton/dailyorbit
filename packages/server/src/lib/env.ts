import { defineEnv } from "@nkzw/define-env";

export const { BETTER_AUTH_SECRET, BETTER_AUTH_URL, CLIENT_DOMAIN, DATABASE_URL } = defineEnv([
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "CLIENT_DOMAIN",
  "DATABASE_URL",
]);
