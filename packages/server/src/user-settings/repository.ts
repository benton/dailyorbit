import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';

export type UserSettings = {
  userId: string;
  emailDailyOrbit: boolean;
  wideView: boolean;
  theme: string;
};

type RawSettingsRow = {
  user_id: string;
  email_daily_orbit: boolean;
  wide_view: boolean;
  theme: string;
};

function rowToSettings(row: RawSettingsRow): UserSettings {
  return {
    userId: row.user_id,
    emailDailyOrbit: row.email_daily_orbit,
    wideView: row.wide_view,
    theme: row.theme,
  };
}

export async function getSettingsByUserId(
  conn: DuckDBConnection,
  userId: string,
): Promise<UserSettings | null> {
  const result = await conn.runAndReadAll(
    'SELECT * FROM user_settings WHERE user_id = $1',
    [userId],
  );
  const rows = result.getRowObjectsJS();
  return rows.length > 0 ? rowToSettings(rows[0] as RawSettingsRow) : null;
}

export async function getOrCreateSettings(
  conn: DuckDBConnection,
  userId: string,
): Promise<UserSettings> {
  await conn.run(
    'INSERT INTO user_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [userId],
  );
  const result = await conn.runAndReadAll(
    'SELECT * FROM user_settings WHERE user_id = $1',
    [userId],
  );
  return rowToSettings(result.getRowObjectsJS()[0] as RawSettingsRow);
}

export type SettingsPatch = {
  emailDailyOrbit?: boolean;
  wideView?: boolean;
  theme?: string;
};

const FIELD_MAP: Record<keyof SettingsPatch, string> = {
  emailDailyOrbit: 'email_daily_orbit',
  wideView: 'wide_view',
  theme: 'theme',
};

export async function updateSettings(
  conn: DuckDBConnection,
  userId: string,
  patch: SettingsPatch,
): Promise<UserSettings> {
  const setClauses: string[] = [];
  const values: DuckDBValue[] = [];
  let idx: number = 1;

  for (const [key, column] of Object.entries(FIELD_MAP)) {
    const value = patch[key as keyof SettingsPatch];
    if (value !== undefined) {
      setClauses.push(`${column} = $${idx++}`);
      values.push(value as DuckDBValue);
    }
  }

  if (setClauses.length > 0) {
    values.push(userId);
    await conn.run(
      `UPDATE user_settings SET ${setClauses.join(', ')} WHERE user_id = $${idx}`,
      values,
    );
  }

  return (await getSettingsByUserId(conn, userId))!;
}
