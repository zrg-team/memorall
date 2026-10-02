/** An agent action the user must approve first, or has declined. */
export class MemonApprovalRequiredError extends Error {
	constructor(
		readonly gate: "forms" | "installs" | "deletes",
		message: string,
	) {
		super(message);
		this.name = "MemonApprovalRequiredError";
	}
}
