// Pragmatic utility to convert Drizzle schemas to SQL
// Uses type assertions to work with Drizzle's internal structure

import type { PgTable } from "drizzle-orm/pg-core";

// Helper function to safely access Drizzle internal symbols
function getTableName(table: PgTable): string {
  return (table as unknown as Record<string | symbol, unknown>)[Symbol.for("drizzle:Name")] as string;
}

function getTableColumns(table: PgTable): Record<string, unknown> {
  return (table as unknown as Record<string | symbol, unknown>)[Symbol.for("drizzle:Columns")] as Record<string, unknown>;
}

function getTableIndexBuilder(table: PgTable): ((mockTable: Record<string, { name: string }>) => unknown[]) | undefined {
  return (table as unknown as Record<string | symbol, unknown>)[Symbol.for("drizzle:ExtraConfigBuilder")] as
    ((mockTable: Record<string, { name: string }>) => unknown[]) | undefined;
}

export function toCreateTableSQL(table: PgTable): string {
  try {
    const tableName = getTableName(table);
    const columns = getTableColumns(table);

    const columnDefinitions: string[] = [];
    const foreignKeys: string[] = [];

    for (const [fieldName, column] of Object.entries(columns)) {
      const col = column as Record<string, unknown>;
      // Extract the actual database column name from the Drizzle column definition
      const columnName = (col.name as string) || fieldName;
      let columnDef = `${columnName} `;

      // Map column types
      const columnType = col.columnType as string;
      switch (columnType) {
        case 'PgUUID':
          columnDef += 'UUID';
          break;
        case 'PgText':
          columnDef += 'TEXT';
          break;
        case 'PgTimestamp':
          columnDef += 'TIMESTAMP';
          break;
        case 'PgJsonb':
          columnDef += 'JSONB';
          break;
        case 'PgReal':
          columnDef += 'REAL';
          break;
        case 'PgInteger':
          columnDef += 'INTEGER';
          break;
        case 'PgSerial':
          columnDef += 'SERIAL';
          break;
        case 'PgBigSerial':
          columnDef += 'BIGSERIAL';
          break;
        case 'PgBoolean':
          columnDef += 'BOOLEAN';
          break;
        case 'PgVarchar':
          const size = col.size as number | undefined;
          columnDef += size ? `VARCHAR(${size})` : 'VARCHAR';
          break;
        case 'PgVector':
          const dimensions = (col.dimensions as number) || 768;
          columnDef += `VECTOR(${dimensions})`;
          break;
        default:
          columnDef += 'TEXT';
      }

      // Handle primary key
      if (col.primary) {
        columnDef += ' PRIMARY KEY';
      }

      // Handle NOT NULL
      if (col.notNull) {
        columnDef += ' NOT NULL';
      }

      // Handle defaults (including defaultRandom, defaultNow, autoincrement)
      const defaultValue = col.default;
      const hasDefault = col.hasDefault as boolean;
      const isAutoIncrement = (col.generated as { type?: string })?.type === 'always' || col.autoIncrement;

      // Check for defaultRandom() and defaultNow() functions
      // Debug: log the column structure to understand Drizzle's internal format
      if (process.env.NODE_ENV === 'development') {
        console.log(`Column ${columnName}:`, {
          columnType,
          hasDefault,
          defaultValue,
          defaultValueType: typeof defaultValue,
          defaultValueString: String(defaultValue)
        });
      }

      // More robust detection of Drizzle defaults
      let hasDefaultRandom = false;
      let hasDefaultNow = false;

      if (hasDefault && defaultValue) {
        const defaultStr = String(defaultValue);
        // Check for various patterns that indicate defaultRandom/defaultNow
        hasDefaultRandom = defaultStr.includes('defaultRandom') ||
                          defaultStr.includes('gen_random_uuid') ||
                          defaultStr.includes('random');
        hasDefaultNow = defaultStr.includes('defaultNow') ||
                       defaultStr.includes('NOW') ||
                       defaultStr.includes('now');
      }

      // Special handling for UUID columns that should have random defaults
      if (columnType === 'PgUUID' && col.primary && !hasDefaultRandom) {
        // If it's a primary key UUID without explicit default, assume it should be random
        hasDefaultRandom = true;
      }

      // Special handling for timestamp columns that should have now defaults
      if (columnType === 'PgTimestamp' && (columnName.includes('created') || columnName.includes('updated')) && !hasDefaultNow) {
        hasDefaultNow = true;
      }

      if (hasDefaultRandom && columnType === 'PgUUID') {
        columnDef += ' DEFAULT gen_random_uuid()';
      } else if (hasDefaultNow && columnType === 'PgTimestamp') {
        columnDef += ' DEFAULT NOW()';
      } else if (isAutoIncrement && (columnType === 'PgInteger' || columnType === 'PgSerial')) {
        // For auto-increment integers, use SERIAL or add AUTO_INCREMENT
        if (columnType === 'PgInteger') {
          columnDef = columnDef.replace('INTEGER', 'SERIAL');
        }
      } else if (defaultValue !== undefined) {
        if (typeof defaultValue === 'function') {
          const funcStr = defaultValue.toString();
          if (funcStr.includes('gen_random_uuid') || funcStr.includes('defaultRandom')) {
            columnDef += ' DEFAULT gen_random_uuid()';
          } else if (funcStr.includes('now') || funcStr.includes('defaultNow')) {
            columnDef += ' DEFAULT NOW()';
          }
        } else if (columnType === 'PgJsonb' && typeof defaultValue === 'object') {
          columnDef += ` DEFAULT '${JSON.stringify(defaultValue)}'`;
        } else if (typeof defaultValue === 'string') {
          columnDef += ` DEFAULT '${defaultValue}'`;
        } else if (typeof defaultValue === 'boolean') {
          columnDef += ` DEFAULT ${defaultValue}`;
        } else if (typeof defaultValue === 'number') {
          columnDef += ` DEFAULT ${defaultValue}`;
        }
      }

      // Handle foreign key references
      if (col.references && typeof col.references === 'function') {
        try {
          const referencedColumn = col.references() as Record<string, unknown>;
          const referencedTable = getTableName(referencedColumn.table as PgTable);
          const referencedColumnName = referencedColumn.name as string;
          if (referencedTable && referencedColumnName) {
            foreignKeys.push(`FOREIGN KEY (${columnName}) REFERENCES ${referencedTable}(${referencedColumnName})`);
          }
        } catch {
          // Skip if reference resolution fails
        }
      }

      columnDefinitions.push(columnDef);
    }

    const allDefinitions = [...columnDefinitions, ...foreignKeys];
    return `CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${allDefinitions.join(',\n  ')}\n);`;
  } catch (error) {
    console.warn('Failed to generate CREATE TABLE SQL:', error);
    return '-- Failed to generate table SQL';
  }
}

export function toCreateIndexesSQL(table: PgTable): string[] {
  try {
    const tableName = getTableName(table);
    const extraConfigBuilder = getTableIndexBuilder(table);

    if (!extraConfigBuilder) {
      return [];
    }

    // Create mock table for index builder
    const columns = getTableColumns(table);
    const mockTable: Record<string, { name: string }> = {};

    for (const [fieldName, column] of Object.entries(columns)) {
      const col = column as Record<string, unknown>;
      const columnName = (col.name as string) || fieldName;
      mockTable[fieldName] = { name: columnName };
    }

    const indexes = extraConfigBuilder(mockTable);

    return indexes.map((index) => {
      try {
        const indexData = index as Record<string, unknown>;
        const config = indexData.config as Record<string, unknown> | undefined;
        const indexName = (config?.name as string) || `${tableName}_${Date.now()}_idx`;
        const columns = config?.columns as Array<{ name: string }> | undefined;
        const columnNames = columns
          ?.map(col => col.name)
          .filter(Boolean)
          .join(', ');

        if (columnNames) {
          return `CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName}(${columnNames});`;
        }
        return '';
      } catch {
        return '';
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export function toFullTableSQL(table: PgTable): { table: string; indexes: string[] } {
  return {
    table: toCreateTableSQL(table),
    indexes: toCreateIndexesSQL(table)
  };
}