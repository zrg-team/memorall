import type { PGlite } from "@electric-sql/pglite";

export const up = async (db: PGlite) => {
	// Example future migration - add new table or modify existing schema
	await db.exec(`
    -- Example: Add a new table for user preferences
    -- CREATE TABLE IF NOT EXISTS user_preferences (
    --   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    --   key TEXT NOT NULL,
    --   value JSONB NOT NULL,
    --   created_at TIMESTAMP DEFAULT NOW() NOT NULL,
    --   updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    -- );
    --
    -- CREATE INDEX IF NOT EXISTS user_preferences_key_idx ON user_preferences(key);

    -- This is a placeholder migration - uncomment and modify as needed
    SELECT 1; -- No-op placeholder
  `);
};

export const down = async (db: PGlite) => {
	// Optional: Rollback functionality
	await db.exec(`
    -- DROP TABLE IF EXISTS user_preferences;
    SELECT 1; -- No-op placeholder
  `);
};
