export const defaultNowToTrigger = (
	table: string,
	options: {
		createdAt?: boolean;
		updatedAt?: boolean;
	} = {
		createdAt: true,
		updatedAt: true,
	},
) => {
	let sql = "";
	if (options.createdAt) {
		sql += `
DROP TRIGGER IF EXISTS ${table}_set_timestamps_on_insert ON ${table};
CREATE TRIGGER ${table}_set_timestamps_on_insert
	BEFORE INSERT ON ${table}
	FOR EACH ROW
	EXECUTE FUNCTION set_created_updated_timestamps();
`;
	}
	if (options.updatedAt) {
		sql += `
DROP TRIGGER IF EXISTS ${table}_set_updated_at ON ${table};
CREATE TRIGGER ${table}_set_updated_at
	BEFORE UPDATE ON ${table}
	FOR EACH ROW
	EXECUTE FUNCTION update_updated_at_column();
`;
	}
	return sql;
};
