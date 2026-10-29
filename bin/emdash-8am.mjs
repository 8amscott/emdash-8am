#!/usr/bin/env node
// Copies site content between local dev and live: `emdash-8am pull` / `emdash-8am push`
// (npm run pull:live / push:live). Run from the site's root, next to wrangler.jsonc.
// Content tables are replaced in one transaction and missing media files are copied.
// Each side keeps its own accounts, passkeys, API tokens, comments, form submissions,
// plugin settings (secrets are encrypted per environment) and logs.
import { getPlatformProxy, unstable_readConfig } from "wrangler";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";

const direction = process.argv[2];
const yes = process.argv.includes("--yes");
const dryRun = process.argv.includes("--dry-run");
if (!["pull", "push"].includes(direction)) throw new Error("usage: emdash-8am pull|push [--dry-run | --yes]");

const CONTENT_TABLES = [
	"revisions", "media", "media_folders", "taxonomies", "content_taxonomies",
	"_emdash_collections", "_emdash_fields", "_emdash_block_types", "_emdash_block_type_versions",
	"_emdash_menus", "_emdash_menu_items", "_emdash_sections", "_emdash_seo", "_emdash_widget_areas", "_emdash_widgets",
	"_emdash_redirects", "_emdash_redirect_state", "_emdash_redirect_artifacts", "_emdash_redirect_generation_artifacts",
	"_emdash_taxonomy_defs", "_emdash_taxonomy_def_groups", "_emdash_bylines", "_emdash_byline_fields",
	"_emdash_byline_field_values", "_emdash_byline_field_group_values", "_emdash_content_bylines",
	"_emdash_content_references", "_emdash_relations", "_emdash_revision_prune_queue",
];
const CONTENT_PREFIXES = ["_emdash_media_usage"];
// Collection tables are dropped and recreated from the source, so content-type changes move too
const COLLECTION_PREFIX = "ec_";
// Content rows inside tables that otherwise stay
const CONTENT_ROWS = {
	options: "name LIKE 'site:%'",
	_plugin_storage: "plugin_id = 'core-forms' AND collection = 'forms'",
};
const KEPT_TABLES = [
	"users", "credentials", "auth_challenges", "auth_tokens", "oauth_accounts", "allowed_domains", "audit_logs",
	"_emdash_api_tokens", "_emdash_authorization_codes", "_emdash_device_codes", "_emdash_oauth_clients", "_emdash_oauth_tokens",
	"_emdash_comments", "_emdash_comment_reactions", "_emdash_404_log", "_emdash_rate_limits", "_emdash_entry_locks",
	"_emdash_cron_tasks", "_emdash_media_upload_attempts", "_emdash_migrations", "_emdash_migrations_lock",
	"_emdash_redirect_write_lock", "_plugin_indexes", "_plugin_state", "_cf_METADATA", "d1_migrations",
];
const KEPT_PREFIXES = ["_emdash_transfer_", "sqlite_", "_cf_"];

const config = unstable_readConfig({ config: "wrangler.jsonc" });
const dbName = config.d1_databases[0].database_name;
mkdirSync(".wrangler/sync", { recursive: true });
writeFileSync(".wrangler/sync/remote.json", JSON.stringify({
	name: config.name,
	account_id: config.account_id,
	compatibility_date: config.compatibility_date,
	d1_databases: config.d1_databases.map(({ binding, database_name, database_id }) => ({ binding, database_name, database_id, remote: true })),
	r2_buckets: config.r2_buckets.map(({ binding, bucket_name }) => ({ binding, bucket_name, remote: true })),
}));

// Two processes on one local database can corrupt it; the dev server must be stopped to write locally
if (direction === "pull" && (await fetch("http://localhost:4321/", { signal: AbortSignal.timeout(1500) }).then(() => true, () => false))) {
	throw new Error("Stop the dev server first (localhost:4321 is answering).");
}

const local = await getPlatformProxy({ configPath: "wrangler.jsonc", remoteBindings: false });
const openLive = () => getPlatformProxy({ configPath: ".wrangler/sync/remote.json" });
let live = await openLive();
let [from, to] = direction === "pull" ? [live, local] : [local, live];
const [fromName, toName] = direction === "pull" ? ["live", "local"] : ["local", "live"];

const rows = async (db, sql) => (await db.prepare(sql).all()).results;
const q = (name) => `"${name.replaceAll('"', '""')}"`;
const siteUrl = JSON.parse((await live.env.DB.prepare("SELECT value FROM options WHERE name = 'emdash:site_url'").first()).value);

// Both databases must be on the same EmDash schema, or rows won't fit their tables
const migrations = async (env) => (await rows(env.DB, "SELECT name FROM _emdash_migrations ORDER BY name")).map((r) => r.name).join();
if ((await migrations(from.env)) !== (await migrations(to.env))) {
	throw new Error("Local and live are on different EmDash versions: deploy (or update local) and load a page on both first.");
}

const tables = async (env) => (await rows(env.DB, "SELECT name FROM sqlite_master WHERE type = 'table'")).map((r) => r.name);
const sourceTables = await tables(from.env);
const targetTables = await tables(to.env);
const isContent = (t) => CONTENT_TABLES.includes(t) || CONTENT_PREFIXES.some((p) => t.startsWith(p));
const isKept = (t) => KEPT_TABLES.includes(t) || KEPT_PREFIXES.some((p) => t.startsWith(p)) || t in CONTENT_ROWS;
const unknown = sourceTables.filter((t) => !t.startsWith(COLLECTION_PREFIX) && !isContent(t) && !isKept(t));
if (unknown.length) throw new Error(`Unclassified tables (add them to sync.mjs as content or kept): ${unknown.join(", ")}`);

const statements = [to.env.DB.prepare("PRAGMA defer_foreign_keys = true")];
const counts = {};
// EmDash's triggers guard live edits (redirect write leases, media-usage fences) and would
// reject or silently drop copied rows: drop them, copy, then recreate the source's
const isSynced = (t) => t.startsWith(COLLECTION_PREFIX) || isContent(t) || t in CONTENT_ROWS;
const triggers = async (env) => (await rows(env.DB, "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger'")).filter((r) => isSynced(r.tbl_name));
for (const { name } of await triggers(to.env)) statements.push(to.env.DB.prepare(`DROP TRIGGER IF EXISTS ${q(name)}`));
const insert = async (table, where = "") => {
	const data = await rows(from.env.DB, `SELECT * FROM ${q(table)}${where && ` WHERE ${where}`}`);
	for (const row of data) {
		const cols = Object.keys(row);
		statements.push(to.env.DB.prepare(`INSERT INTO ${q(table)} (${cols.map(q).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).bind(...Object.values(row)));
	}
	counts[table] = data.length;
};
for (const t of targetTables.filter((t) => t.startsWith(COLLECTION_PREFIX) && !sourceTables.includes(t))) {
	statements.push(to.env.DB.prepare(`DROP TABLE ${q(t)}`));
}
for (const t of sourceTables.filter((t) => t.startsWith(COLLECTION_PREFIX))) {
	const schema = await rows(from.env.DB, `SELECT type, sql FROM sqlite_master WHERE tbl_name = '${t}' AND type IN ('table', 'index') AND sql IS NOT NULL ORDER BY type = 'table' DESC`);
	statements.push(to.env.DB.prepare(`DROP TABLE IF EXISTS ${q(t)}`));
	for (const { sql } of schema) statements.push(to.env.DB.prepare(sql));
	await insert(t);
}
for (const t of sourceTables.filter(isContent)) {
	statements.push(to.env.DB.prepare(`DELETE FROM ${q(t)}`));
	await insert(t);
}
for (const [t, where] of Object.entries(CONTENT_ROWS)) {
	statements.push(to.env.DB.prepare(`DELETE FROM ${q(t)} WHERE ${where}`));
	await insert(t, where);
}
for (const { sql } of await triggers(from.env)) statements.push(to.env.DB.prepare(sql));

const list = async (bucket) => {
	const objects = [];
	let cursor;
	do {
		const page = await bucket.list({ cursor, limit: 1000 });
		objects.push(...page.objects);
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return objects;
};
// Only files the source's media library uses; keys are unique per upload, so a key the target has is the same file
const targetKeys = new Set((await list(to.env.MEDIA)).map((o) => o.key));
const missing = (await rows(from.env.DB, "SELECT storage_key AS key FROM media")).filter((o) => !targetKeys.has(o.key));

const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`\n${fromName} → ${toName} (${siteUrl}): ${Object.keys(counts).length} tables, ${totalRows} rows, ${missing.length} media files to copy.`);
console.log(`Replaces all content on ${toName}${direction === "push" ? ", including anything edited on live since the last pull" : ""}. Accounts, submissions and plugin settings stay.`);
if (dryRun || (!yes && !process.stdin.isTTY)) {
	for (const [t, n] of Object.entries(counts)) if (n) console.log(`  ${t}: ${n}`);
	await local.dispose();
	await live.dispose();
	process.exit(0);
}
if (!yes) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(`Type ${direction} to continue: `);
	rl.close();
	if (answer.trim() !== direction) process.exit(1);
}

// Undo point before anything is written
if (direction === "push") {
	const info = JSON.parse(execSync(`npx wrangler d1 time-travel info ${dbName} --json`, { encoding: "utf8" }));
	console.log(`Undo: npx wrangler d1 time-travel restore ${dbName} --bookmark=${info.bookmark}`);
} else {
	const backup = `.wrangler/sync/local-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
	cpSync(".wrangler/state/v3/d1", `${backup}/d1`, { recursive: true });
	console.log(`Undo: copy ${backup}/d1 back over .wrangler/state/v3/d1 (dev server stopped)`);
}

for (const o of missing) {
	const obj = await from.env.MEDIA.get(o.key);
	if (!obj) {
		console.log(`Skipped ${o.key}: in the ${fromName} media library but not in its bucket.`);
		continue;
	}
	await to.env.MEDIA.put(o.key, await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata, customMetadata: obj.customMetadata });
}
// D1 runs a batch as one transaction: the target gets all of it or none of it.
// A large remote batch can lose its reply after committing, so the check below decides.
await to.env.DB.batch(statements).catch((e) => console.log(`Batch reply lost (${e.message}); checking the result.`));
console.log(`Copied ${missing.length} media files and ${totalRows} rows.`);
// The remote session often drops after a large batch; check over a fresh one
await live.dispose().catch(() => {});
live = await openLive();
[from, to] = direction === "pull" ? [live, local] : [local, live];

const fingerprint = async (env, t, where) => JSON.stringify(await rows(env.DB, `SELECT * FROM ${q(t)}${where ? ` WHERE ${where}` : ""} ORDER BY 1, 2`));
const differ = [];
for (const t of Object.keys(counts)) {
	if ((await fingerprint(from.env, t, CONTENT_ROWS[t])) !== (await fingerprint(to.env, t, CONTENT_ROWS[t]))) differ.push(t);
}
if (differ.length) {
	await local.dispose();
	await live.dispose();
	throw new Error(`MISMATCH after copy: ${differ.join(", ")}. Use the undo above.`);
}
console.log(`Verified: all ${Object.keys(counts).length} tables match.`);

if (direction === "push") {
	// Saving site settings purges every cached page (each carries the site-settings tag)
	execSync(`npx emdash whoami -u ${siteUrl}`, { stdio: "ignore" });
	const token = JSON.parse(readFileSync(`${homedir()}/.config/emdash/auth.json`, "utf8"))[siteUrl].accessToken;
	const res = await fetch(`${siteUrl}/_emdash/api/settings`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-EmDash-Request": "1" },
		body: "{}",
	});
	console.log(res.ok ? "Live page cache purged." : `Cache purge failed (${res.status}): save any setting in the admin to purge it.`);
}

await local.dispose();
await live.dispose();
