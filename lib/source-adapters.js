import { DEFAULT_FRESHNESS_WINDOWS } from "./constants.js";
import { fetchWithTrace, headWithFallback } from "./http.js";
import { normalizeArtifactRecord } from "./manifest.js";

function toIsoOrNull(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

function urlToPageIdentifier(rawUrl) {
  const parsed = new URL(rawUrl);
  const pathname = `${parsed.pathname}${parsed.search}${parsed.hash}`.replace(/^\/+/, "");
  return pathname ? `${parsed.hostname}/${pathname}` : parsed.hostname;
}

function auditsPageMentionsSkill(auditsHtml, requestedRef) {
  const probes = [requestedRef];
  try {
    const parsed = new URL(requestedRef);
    probes.push(parsed.pathname);
    probes.push(parsed.pathname.replace(/^\/+/, ""));
    probes.push(`href="${parsed.pathname}"`);
    probes.push(`href='${parsed.pathname}'`);
  } catch {
    // Keep the absolute URL probe only when requestedRef is not a valid URL.
  }

  return probes.some((probe) => probe && auditsHtml.includes(probe));
}

function buildBaseArtifact(category, entry, overrides = {}, freshnessWindowDays) {
  const collectedAt = new Date().toISOString();
  return normalizeArtifactRecord({
    artifact_id: entry.artifact_id,
    category,
    tier: entry.tier || "runtime_live",
    freshness_tier: entry.freshness_tier || "established",
    freshness_window_days:
      entry.freshness_window_days ??
      freshnessWindowDays ??
      DEFAULT_FRESHNESS_WINDOWS[category],
    label: entry.label || "safe",
    source_name: entry.source_name,
    source_kind: entry.source_kind || "live_direct",
    requested_ref: entry.requested_ref,
    resolved_ref: overrides.resolved_ref || entry.resolved_ref || null,
    collected_at: entry.collected_at || collectedAt,
    source_published_at:
      overrides.source_published_at ??
      entry.source_published_at ??
      null,
    source_first_seen_at:
      overrides.source_first_seen_at ??
      entry.source_first_seen_at ??
      null,
    fetched_at: overrides.fetched_at || null,
    content_hash: overrides.content_hash || null,
    selection_reason: entry.selection_reason,
    freshness_note:
      overrides.freshness_note ??
      entry.freshness_note ??
      null,
    metadata: {
      ...(entry.metadata || {}),
      ...(overrides.metadata || {})
    }
  });
}

async function fetchJson(url) {
  const trace = await fetchWithTrace(url);
  return {
    trace,
    data: JSON.parse(trace.text)
  };
}

async function buildWebArtifacts(config) {
  const entries = config.web?.artifacts || [];
  if (entries.length === 0) {
    return [];
  }

  const trancoApiUrl =
    config.web?.tranco_api_url || "https://tranco-list.eu/api/lists/date/latest";
  const trancoRankApiBase =
    config.web?.tranco_rank_api_base || "https://tranco-list.eu/api/ranks/domain";
  const latestList = await fetchJson(trancoApiUrl);

  const artifacts = [];
  for (const entry of entries) {
    if ((entry.label || "safe") !== "safe") {
      throw new Error("Phase 1 web artifacts must be safe");
    }

    const domain = entry.domain || new URL(entry.requested_ref).hostname;
    let rankHistory = [];

    try {
      const ranks = await fetchJson(
        `${trancoRankApiBase.replace(/\/+$/u, "")}/${encodeURIComponent(domain)}`
      );
      rankHistory = ranks.data.ranks || [];
    } catch {
      rankHistory = [];
    }

    artifacts.push(
      buildBaseArtifact(
        "web",
        {
          ...entry,
          source_name: entry.source_name || "tranco"
        },
        {
          resolved_ref: entry.resolved_ref || entry.requested_ref,
          source_published_at: toIsoOrNull(latestList.data.created_on),
          freshness_note:
            entry.freshness_note ||
            "Web freshness is approximate in phase 1. Tranco gives list recency, not page publish time.",
          metadata: {
            domain,
            brin_origin: entry.brin_origin || "page",
            brin_identifier: entry.brin_identifier || urlToPageIdentifier(entry.requested_ref),
            tranco_list: {
              list_id: latestList.data.list_id || null,
              created_on: latestList.data.created_on || null,
              download: latestList.data.download || null
            },
            tranco_rank_history: rankHistory
          }
        },
        config.freshness_windows?.web
      )
    );
  }

  return artifacts;
}

async function buildSkillArtifacts(config) {
  const entries = config.skill?.artifacts || [];
  if (entries.length === 0) {
    return [];
  }

  const auditsUrl = config.skill?.audits_url || "https://skills.sh/audits";
  const auditsPage = await fetchWithTrace(auditsUrl);

  return entries.map((entry) => {
    if ((entry.label || "safe") !== "safe") {
      throw new Error("Phase 1 skill artifacts must be safe");
    }

    const requestedRef = entry.requested_ref;
    const auditsPageMentionsEntry = auditsPageMentionsSkill(auditsPage.text, requestedRef);

    return buildBaseArtifact(
      "skill",
      {
        ...entry,
        source_name: entry.source_name || "skills.sh"
      },
      {
        resolved_ref: requestedRef,
        freshness_note:
          entry.freshness_note ||
          "skills.sh audits does not expose reliable publish timestamps in phase 1. Freshness is driven by selection metadata.",
        metadata: {
          brin_origin: "skill",
          brin_identifier: entry.brin_identifier,
          audits_url: auditsUrl,
          audits_page_mentions_entry: auditsPageMentionsEntry
        }
      },
      config.freshness_windows?.skill
    );
  });
}

function buildPackageMetadataUrl(ecosystem, name) {
  if (ecosystem === "npm") {
    return `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  }
  if (ecosystem === "pypi") {
    return `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;
  }
  if (ecosystem === "crate") {
    return `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;
  }
  throw new Error(`Unsupported package ecosystem ${ecosystem}`);
}

function inferPackagePublishTime(ecosystem, metadata, requestedVersion) {
  if (ecosystem === "npm") {
    if (requestedVersion && metadata.time?.[requestedVersion]) {
      return metadata.time[requestedVersion];
    }
    if (metadata["dist-tags"]?.latest && metadata.time?.[metadata["dist-tags"].latest]) {
      return metadata.time[metadata["dist-tags"].latest];
    }
    return metadata.time?.modified || metadata.time?.created || null;
  }

  if (ecosystem === "pypi") {
    const version = requestedVersion || metadata.info?.version;
    const releases = metadata.releases?.[version] || [];
    const upload = releases.find((release) => release.upload_time_iso_8601);
    return upload?.upload_time_iso_8601 || null;
  }

  if (ecosystem === "crate") {
    return metadata.crate?.updated_at || metadata.crate?.created_at || null;
  }

  return null;
}

async function buildPackageArtifacts(config) {
  const entries = config.package?.artifacts || [];
  if (entries.length === 0) {
    return [];
  }

  const artifacts = [];

  for (const entry of entries) {
    if ((entry.label || "safe") !== "safe") {
      throw new Error("Phase 1 package artifacts must be safe");
    }

    const ecosystem = entry.ecosystem;
    const packageName = entry.name;
    const requestedRef = entry.requested_ref || buildPackageMetadataUrl(ecosystem, packageName);
    const metadataResponse = await fetchJson(requestedRef);
    const publishTime = inferPackagePublishTime(
      ecosystem,
      metadataResponse.data,
      entry.version || null
    );

    artifacts.push(
      buildBaseArtifact(
        "package",
        {
          ...entry,
          requested_ref: requestedRef,
          source_name: entry.source_name || `${ecosystem}-registry`
        },
        {
          resolved_ref: metadataResponse.trace.resolved_url,
          source_published_at: toIsoOrNull(publishTime),
          freshness_note:
            entry.freshness_note ||
            "Package freshness is based on registry metadata, not install-time execution.",
          metadata: {
            ecosystem,
            brin_origin: ecosystem,
            brin_identifier: packageName,
            requested_version: entry.version || null,
            registry_metadata_url: requestedRef
          }
        },
        config.freshness_windows?.package
      )
    );
  }

  return artifacts;
}

async function buildEmailArtifacts(config) {
  const entries = config.email?.artifacts || [];
  if (entries.length === 0) {
    return [];
  }

  const artifacts = [];

  for (const entry of entries) {
    if ((entry.label || "safe") !== "safe") {
      throw new Error("Phase 1 email artifacts must be safe");
    }

    const trace = await headWithFallback(entry.requested_ref);

    artifacts.push(
      buildBaseArtifact(
        "email",
        {
          ...entry,
          source_name: entry.source_name || "remote-rfc822"
        },
        {
          resolved_ref: trace.resolved_url,
          source_published_at: toIsoOrNull(trace.headers["last-modified"]),
          freshness_note:
            entry.freshness_note ||
            "Phase 1 email inputs are runtime-fetched raw .eml samples. Official Enron mirroring is deferred to phase 2.",
          metadata: {
            brin_origin: "email",
            brin_identifier: entry.brin_identifier || entry.message_id || null,
            message_id: entry.message_id || null,
            sample_family: entry.sample_family || null,
            validation_headers: trace.headers
          }
        },
        config.freshness_windows?.email
      )
    );
  }

  return artifacts;
}

export async function buildPhase1Artifacts(config) {
  const [web, email, skill, packageArtifacts] = await Promise.all([
    buildWebArtifacts(config),
    buildEmailArtifacts(config),
    buildSkillArtifacts(config),
    buildPackageArtifacts(config)
  ]);

  return [...web, ...email, ...skill, ...packageArtifacts];
}
