import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildTemplateStdio,
	findLocalServerTemplate,
	LOCAL_SERVER_TEMPLATES,
	type LocalServerTemplate,
	missingTemplateFields,
	templateDefaults,
	templateKeyRequirement,
} from "../templates";

const sampleValue = (type: string) =>
	type === "directories"
		? "/work\n/notes"
		: type === "secret"
			? "tok-secret"
			: type === "toggle"
				? "true"
				: "/work";

describe("local server templates", () => {
	it("pins every package to an exact version", () => {
		for (const template of LOCAL_SERVER_TEMPLATES) {
			expect(template.version, template.id).toMatch(/^v?\d+(\.\d+)+$/);
		}
	});

	it.each(LOCAL_SERVER_TEMPLATES.map((template) => [template.id, template]))(
		"%s builds a runnable command from filled fields",
		(_id, template) => {
			const values = Object.fromEntries(
				template.fields.map((field) => [field.key, sampleValue(field.type)]),
			);
			const { detail } = buildTemplateStdio(template, values);

			expect(detail.command).toBe(
				{ node: "npx", python: "uvx", docker: "docker" }[template.runtime],
			);
			expect(detail.args).toContain(
				{
					node: `${template.packageName}@${template.version}`,
					python: `${template.packageName}==${template.version}`,
					docker: `${template.packageName}:${template.version}`,
				}[template.runtime],
			);
			// Secrets never reach the command line, however they are passed on.
			expect(detail.args.join(" ")).not.toContain("tok-secret");
			expect(detail.templateId).toBe(template.id);
		},
	);

	it("adds -y for npx so a first run never waits on a prompt nobody can see", () => {
		const filesystem = findLocalServerTemplate(
			"filesystem",
		) as LocalServerTemplate;
		const { detail } = buildTemplateStdio(filesystem, {
			directories: "/work\n  \n/notes ",
		});
		expect(detail.args).toEqual([
			"-y",
			"@modelcontextprotocol/server-filesystem@2026.8.31",
			"/work",
			"/notes",
		]);
	});

	it("passes flag fields as separate argv entries, never through a shell", () => {
		const git = findLocalServerTemplate("git") as LocalServerTemplate;
		const { detail } = buildTemplateStdio(git, {
			repository: "/repo; rm -rf /",
		});
		expect(detail.args).toEqual([
			"mcp-server-git==2026.8.18",
			"--repository",
			"/repo; rm -rf /",
		]);
	});

	it("puts env fields in env and secret fields in the encrypted values only", () => {
		const template: LocalServerTemplate = {
			id: "custom-env",
			category: "utilities",
			runtime: "node",
			packageName: "pkg",
			version: "1.0.0",
			docsUrl: "https://example.test",
			fields: [
				{
					key: "file",
					type: "text",
					required: false,
					target: { kind: "env", name: "DATA_FILE" },
				},
				{
					key: "token",
					type: "secret",
					required: true,
					target: { kind: "env", name: "API_TOKEN" },
				},
			],
		};
		const { detail, secretValues } = buildTemplateStdio(template, {
			file: "/data.json",
			token: "s3cret",
		});
		expect(detail.env).toEqual({ DATA_FILE: "/data.json" });
		expect(detail.secretEnvKeys).toEqual(["API_TOKEN"]);
		expect(secretValues).toEqual({ API_TOKEN: "s3cret" });
		expect(JSON.stringify(detail)).not.toContain("s3cret");
	});

	it("reports and refuses missing required fields", () => {
		const git = findLocalServerTemplate("git") as LocalServerTemplate;
		expect(missingTemplateFields(git, {})).toEqual(["repository"]);
		expect(missingTemplateFields(git, { repository: "  " })).toEqual([
			"repository",
		]);
		expect(() => buildTemplateStdio(git, {})).toThrow("repository");
	});

	it("passes a container's variables by name only", () => {
		const github = findLocalServerTemplate("github") as LocalServerTemplate;
		const { detail, secretValues } = buildTemplateStdio(github, {
			token: "github_pat_123",
		});

		expect(detail.command).toBe("docker");
		expect(detail.args).toEqual([
			"run",
			"-i",
			"--rm",
			"-e",
			"GITHUB_PERSONAL_ACCESS_TOKEN",
			"ghcr.io/github/github-mcp-server:v1.12.1",
		]);
		expect(detail.secretEnvKeys).toEqual(["GITHUB_PERSONAL_ACCESS_TOKEN"]);
		expect(secretValues).toEqual({
			GITHUB_PERSONAL_ACCESS_TOKEN: "github_pat_123",
		});
	});

	it("turns toggles into their on or off flags, starting from the safe default", () => {
		const postgres = findLocalServerTemplate("postgres") as LocalServerTemplate;
		expect(templateDefaults(postgres)).toEqual({ readOnly: "true" });

		const safe = buildTemplateStdio(postgres, {
			...templateDefaults(postgres),
			databaseUrl: "postgresql://u:p@h/db",
		});
		expect(safe.detail.args).toEqual([
			"--with",
			"mcp==1.30.0",
			"postgres-mcp==0.3.0",
			"--access-mode=restricted",
		]);

		const open = buildTemplateStdio(postgres, {
			databaseUrl: "postgresql://u:p@h/db",
			readOnly: "false",
		});
		expect(open.detail.args).toContain("--access-mode=unrestricted");
		expect(open.detail.env).toBeUndefined();
		expect(open.detail.secretEnvKeys).toEqual(["DATABASE_URI"]);
	});

	it("adds a template's fixed flags and environment", () => {
		const figma = findLocalServerTemplate("figma") as LocalServerTemplate;
		const { detail } = buildTemplateStdio(figma, { token: "figd_1" });

		expect(detail.args).toEqual([
			"-y",
			"figma-developer-mcp@0.13.2",
			"--stdio",
		]);
		expect(detail.env).toEqual({ FRAMELINK_TELEMETRY: "off" });
	});

	it("keeps a stored key when an edit leaves the field blank", () => {
		const brave = findLocalServerTemplate(
			"brave-search",
		) as LocalServerTemplate;

		expect(missingTemplateFields(brave, {})).toEqual(["apiKey"]);
		expect(
			missingTemplateFields(
				brave,
				{},
				{ storedSecretEnvKeys: ["BRAVE_API_KEY"] },
			),
		).toEqual([]);

		const { detail, secretValues } = buildTemplateStdio(
			brave,
			{},
			{ storedSecretEnvKeys: ["BRAVE_API_KEY"] },
		);
		expect(detail.secretEnvKeys).toEqual(["BRAVE_API_KEY"]);
		expect(secretValues).toEqual({});
	});

	it("tells required keys from optional ones", () => {
		const find = (id: string) =>
			findLocalServerTemplate(id) as LocalServerTemplate;
		expect(templateKeyRequirement(find("tavily"))).toBe("required");
		expect(templateKeyRequirement(find("exa"))).toBe("optional");
		expect(templateKeyRequirement(find("duckduckgo"))).toBe("none");
	});

	it.each(["en", "vn"])(
		"has %s text for every template, field and key guide step",
		(locale) => {
			const strings = JSON.parse(
				readFileSync(
					resolve(
						__dirname,
						`../../../main/i18n/locales/${locale}/connections.json`,
					),
					"utf8",
				),
			).template;
			for (const template of LOCAL_SERVER_TEMPLATES) {
				expect(strings.catalog[template.id]?.name, template.id).toBeTruthy();
				expect(
					strings.catalog[template.id]?.description,
					template.id,
				).toBeTruthy();
				expect(strings.runtime[template.runtime]).toBeTruthy();
				expect(strings.categories[template.category]).toBeTruthy();
				for (const field of template.fields) {
					const label = strings.fields[template.id]?.[field.key]?.label;
					expect(label, `${template.id}.${field.key}`).toBeTruthy();
					if (!field.guide) continue;
					const guide = strings.guides[template.id]?.[field.key];
					expect(guide?.title, `${template.id}.${field.key}`).toBeTruthy();
					for (let step = 1; step <= field.guide.steps; step += 1) {
						expect(
							guide?.[`step${step}`],
							`${template.id}.${field.key}.step${step}`,
						).toBeTruthy();
					}
					expect(guide?.[`step${field.guide.steps + 1}`]).toBeUndefined();
				}
			}
		},
	);
});
