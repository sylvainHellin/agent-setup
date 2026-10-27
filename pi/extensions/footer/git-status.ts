/**
 * Cached git branch and working tree counts.
 *
 * The footer re-renders on every keystroke, so git is never shelled out to on
 * the render path. A background refresh fills a cache, renders read whatever
 * the cache currently holds, and writes that touch the tree invalidate it.
 */

import { execFile } from "node:child_process";

export type GitStatus = {
	branch: string | null;
	staged: number;
	unstaged: number;
	untracked: number;
};

const EMPTY: GitStatus = { branch: null, staged: 0, unstaged: 0, untracked: 0 };
const CACHE_TTL_MS = 2000;

let cache: GitStatus = EMPTY;
let cachedAt = 0;
let inFlight = false;

function run(args: string[], timeoutMs: number): Promise<string | null> {
	return new Promise((resolve) => {
		execFile("git", args, { timeout: timeoutMs, cwd: process.cwd() }, (err, stdout) => {
			resolve(err ? null : stdout);
		});
	});
}

function parsePorcelain(output: string): Omit<GitStatus, "branch"> {
	let staged = 0;
	let unstaged = 0;
	let untracked = 0;
	for (const line of output.split("\n")) {
		if (line.length < 2) continue;
		const x = line[0];
		const y = line[1];
		if (x === "?" && y === "?") {
			untracked++;
			continue;
		}
		if (x !== " ") staged++;
		if (y !== " ") unstaged++;
	}
	return { staged, unstaged, untracked };
}

async function refresh(providerBranch: string | null): Promise<void> {
	if (inFlight) return;
	inFlight = true;
	try {
		// The footer data provider already tracks the branch and is cheaper than
		// shelling out, so only fall back to git when it has nothing.
		let branch = providerBranch;
		if (!branch) {
			const out = await run(["rev-parse", "--abbrev-ref", "HEAD"], 300);
			branch = out ? out.trim() || null : null;
		}
		const status = await run(["status", "--porcelain"], 800);
		cache = status === null ? { ...EMPTY, branch } : { branch, ...parsePorcelain(status) };
		cachedAt = Date.now();
	} finally {
		inFlight = false;
	}
}

/**
 * Return the cached status, kicking off a background refresh when it is stale.
 * Always returns synchronously so it is safe to call from render().
 */
export function getGitStatus(providerBranch: string | null, onRefresh?: () => void): GitStatus {
	if (Date.now() - cachedAt > CACHE_TTL_MS) {
		void refresh(providerBranch).then(() => onRefresh?.());
	}
	// Trust the provider's branch immediately even if the counts are still stale.
	return providerBranch && providerBranch !== cache.branch ? { ...cache, branch: providerBranch } : cache;
}

export function invalidateGitStatus(): void {
	cachedAt = 0;
}
