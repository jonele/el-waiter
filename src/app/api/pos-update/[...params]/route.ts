import { NextRequest, NextResponse } from "next/server";

/**
 * Tauri v2 updater endpoint for EL-POS.
 *
 * GET /api/pos-update/{target}/{arch}/{current_version}
 *
 * Returns:
 *   204 — no update available (current version is latest)
 *   200 — JSON with download URL, version, notes, signature
 *
 * Caches the GitHub releases API response for 5 minutes.
 */

interface GitHubRelease {
  tag_name: string;
  published_at: string;
  body: string | null;
}

let cachedRelease: GitHubRelease | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getLatestRelease(): Promise<GitHubRelease | null> {
  const now = Date.now();
  if (cachedRelease && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedRelease;
  }

  try {
    const resp = await fetch(
      "https://api.github.com/repos/jonele/el-pos/releases/latest",
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "el-pos-updater",
        },
        next: { revalidate: 300 },
      }
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as GitHubRelease;
    cachedRelease = data;
    cacheTimestamp = now;
    return data;
  } catch {
    return cachedRelease; // Return stale cache on error
  }
}

function parseVersion(v: string): number[] {
  return v
    .replace(/^pos-v/, "")
    .split(".")
    .map((p) => parseInt(p, 10) || 0);
}

function isNewer(latest: number[], current: number[]): boolean {
  for (let i = 0; i < Math.max(latest.length, current.length); i++) {
    const l = latest[i] ?? 0;
    const c = current[i] ?? 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ params: string[] }> }
) {
  const segments = (await params).params;

  // Expected: [target, arch, current_version]
  if (!segments || segments.length < 3) {
    return NextResponse.json(
      { error: "Expected /api/pos-update/{target}/{arch}/{current_version}" },
      { status: 400 }
    );
  }

  const [_target, _arch, currentVersion] = segments;

  const release = await getLatestRelease();
  if (!release) {
    // Can't reach GitHub — tell client no update (safe fallback)
    return new NextResponse(null, { status: 204 });
  }

  const latestTag = release.tag_name;
  const latestVersion = latestTag.replace(/^pos-v/, "");
  const latestParts = parseVersion(latestTag);
  const currentParts = parseVersion(currentVersion);

  if (!isNewer(latestParts, currentParts)) {
    return new NextResponse(null, { status: 204 });
  }

  // Build the NSIS installer download URL
  const url = `https://github.com/jonele/el-os-downloads/raw/main/el-pos/EL-POS-v${latestVersion}-setup.exe`;

  const body = {
    version: latestVersion,
    url,
    signature: "",
    notes: release.body || "Bug fixes and improvements",
    pub_date: release.published_at || new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=300",
    },
  });
}
