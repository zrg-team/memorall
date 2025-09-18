# Database Migrations

This directory contains the database migration system for the Memorall application.

## Overview

The migration system provides:
- **Version tracking**: Tracks which migrations have been applied
- **Sequential execution**: Runs migrations in order based on version numbers
- **Rollback support**: Optional down migrations for reverting changes
- **Error handling**: Comprehensive error reporting and transaction safety

## How It Works

1. **Migration Tracking Table**: `_migrations` table stores applied migration history
2. **Sequential Execution**: Migrations run in version order, skipping already applied ones
3. **Atomic Operations**: Each migration runs independently with proper error handling
4. **Logging**: Detailed console output shows migration progress

## File Structure

```
migrations/
├── README.md                           # This documentation
├── index.ts                           # Migration system core
├── initial.ts                         # Version 1: Initial schema
├── 002_example_future_migration.ts    # Example for future migrations
└── [future migrations...]
```

## Adding New Migrations

### 1. Create Migration File

Create a new file with format: `{version}_{description}.ts`

```typescript
// 003_add_user_settings.ts
import type { PGlite } from "@electric-sql/pglite";

export const up = async (db: PGlite) => {
  await db.exec(\`
    CREATE TABLE IF NOT EXISTS user_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      setting_key TEXT NOT NULL UNIQUE,
      setting_value JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE INDEX IF NOT EXISTS user_settings_key_idx ON user_settings(setting_key);
  \`);
};

export const down = async (db: PGlite) => {
  await db.exec(\`
    DROP TABLE IF EXISTS user_settings;
  \`);
};
```

### 2. Register Migration

Add the migration to `index.ts`:

```typescript
import { up as userSettingsUp, down as userSettingsDown } from './003_add_user_settings';

export const migrations: Migration[] = [
  // ... existing migrations
  {
    id: '003_add_user_settings',
    version: 3,
    description: 'Add user settings table',
    up: userSettingsUp,
    down: userSettingsDown,
  },
];
```

### 3. Test Migration

Migrations run automatically on database initialization. Test by:

1. Starting the application
2. Checking console output for migration logs
3. Verifying the `_migrations` table contains your new entry

## Migration Guidelines

### ✅ Best Practices

- **Incremental Changes**: Make small, focused changes per migration
- **Backwards Compatible**: Avoid breaking existing data when possible
- **Descriptive Names**: Use clear, descriptive migration IDs and descriptions
- **Test Thoroughly**: Test both up and down migrations if provided
- **Use Transactions**: Complex migrations should use explicit transaction blocks

### ⚠️ Important Notes

- **Version Numbers**: Always increment version numbers sequentially
- **No Edits**: Never edit existing migrations that have been applied
- **Schema Changes**: Update Drizzle schema definitions when adding tables/columns
- **Data Migrations**: Be careful with data transformations in production

### 🚫 Avoid

- Editing applied migrations
- Skipping version numbers
- Complex business logic in migrations
- Dropping data without backup considerations

## Example Migrations

### Adding a New Table

```typescript
export const up = async (db: PGlite) => {
  await db.exec(\`
    CREATE TABLE IF NOT EXISTS new_feature (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE INDEX IF NOT EXISTS new_feature_name_idx ON new_feature(name);
  \`);
};
```

### Adding a Column

```typescript
export const up = async (db: PGlite) => {
  await db.exec(\`
    ALTER TABLE existing_table
    ADD COLUMN IF NOT EXISTS new_column TEXT;

    CREATE INDEX IF NOT EXISTS existing_table_new_column_idx
    ON existing_table(new_column);
  \`);
};
```

### Data Migration

```typescript
export const up = async (db: PGlite) => {
  await db.exec(\`
    -- Add new column
    ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;

    -- Migrate existing data
    UPDATE users
    SET full_name = first_name || ' ' || last_name
    WHERE full_name IS NULL;
  \`);
};
```

## Migration System API

### Core Functions

- `runMigrations(db: PGlite)`: Run all pending migrations
- `getAppliedMigrations(db: PGlite)`: Get list of applied migration IDs
- `markMigrationApplied(db: PGlite, migration: Migration)`: Mark migration as applied

### Migration Interface

```typescript
interface Migration {
  id: string;                           // Unique identifier
  version: number;                      // Sequential version number
  description: string;                  // Human-readable description
  up: (db: PGlite) => Promise<void>;   // Forward migration
  down?: (db: PGlite) => Promise<void>; // Optional rollback
}
```

## Troubleshooting

### Failed Migration

If a migration fails:

1. Check console error output
2. Verify SQL syntax and PGlite compatibility
3. Check for missing dependencies or extensions
4. Fix the migration file and restart the application

### Rollback Migration

Currently, rollbacks are manual. To rollback:

1. Remove the migration entry from `_migrations` table
2. Run the down migration manually if provided
3. Restart the application to re-run migrations

### Reset Database

To start fresh (development only):

1. Clear IndexedDB data in browser dev tools
2. Restart the application
3. All migrations will run from scratch

## Monitoring

Check migration status:

```sql
-- View applied migrations
SELECT * FROM _migrations ORDER BY version;

-- Check latest migration
SELECT * FROM _migrations ORDER BY version DESC LIMIT 1;
```

This migration system ensures reliable, trackable database schema evolution while maintaining data integrity and providing clear upgrade paths.