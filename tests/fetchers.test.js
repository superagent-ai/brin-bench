import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { buildPhase1Artifacts } from "../lib/source-adapters.js";

async function createServer() {
  const server = http.createServer((request, response) => {
    if (request.url === "/tranco/latest") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          list_id: "TEST01",
          created_on: "2026-03-21T00:00:00Z",
          download: "https://example.test/tranco.csv"
        })
      );
      return;
    }

    if (request.url === "/tranco/ranks/example.test") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          ranks: [{ date: "2026-03-21", rank: 42 }]
        })
      );
      return;
    }

    if (request.url === "/skills/audits") {
      response.setHeader("content-type", "text/html");
      response.end(
        [
          "<html><body>",
          '<a href="http://127.0.0.1:0/skill/example-safe">absolute-mismatch</a>',
          '<a href="/skill/relative-safe">relative-match</a>',
          "</body></html>"
        ].join("")
      );
      return;
    }

    if (request.url === "/registry/npm/express") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          "dist-tags": { latest: "5.1.0" },
          time: {
            created: "2024-01-01T00:00:00Z",
            modified: "2026-03-20T00:00:00Z",
            "5.1.0": "2026-03-20T00:00:00Z"
          }
        })
      );
      return;
    }

    if (request.url === "/email/sample.eml") {
      if (request.method === "HEAD") {
        response.setHeader("last-modified", "Sat, 21 Mar 2026 00:00:00 GMT");
        response.statusCode = 200;
        response.end();
        return;
      }
      response.setHeader("content-type", "message/rfc822");
      response.end("Subject: test\n\nhello");
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

test("phase1 source adapters build normalized artifacts with freshness metadata", async () => {
  const { server, baseUrl } = await createServer();
  try {
    const config = {
      freshness_windows: {
        web: 60,
        email: 60,
        skill: 60,
        package: 60
      },
      web: {
        tranco_api_url: `${baseUrl}/tranco/latest`,
        tranco_rank_api_base: `${baseUrl}/tranco/ranks`,
        artifacts: [
          {
            artifact_id: "web-safe",
            source_name: "tranco",
            requested_ref: `${baseUrl}/web/example.test`,
            freshness_tier: "established",
            domain: "example.test",
            selection_reason: "test web"
          }
        ]
      },
      email: {
        artifacts: [
          {
            artifact_id: "email-safe",
            source_name: "remote-rfc822",
            requested_ref: `${baseUrl}/email/sample.eml`,
            freshness_tier: "established",
            selection_reason: "test email"
          }
        ]
      },
      skill: {
        audits_url: `${baseUrl}/skills/audits`,
        artifacts: [
          {
            artifact_id: "skill-safe",
            source_name: "skills.sh",
            requested_ref: `${baseUrl}/skill/example-safe`,
            brin_identifier: "owner/repo/skill",
            freshness_tier: "fresh",
            selection_reason: "test skill"
          },
          {
            artifact_id: "skill-relative-safe",
            source_name: "skills.sh",
            requested_ref: `${baseUrl}/skill/relative-safe`,
            brin_identifier: "owner/repo/relative-skill",
            freshness_tier: "established",
            selection_reason: "test relative skill"
          }
        ]
      },
      package: {
        artifacts: [
          {
            artifact_id: "package-safe",
            source_name: "npm-registry",
            ecosystem: "npm",
            name: "express",
            requested_ref: `${baseUrl}/registry/npm/express`,
            freshness_tier: "fresh",
            selection_reason: "test package"
          }
        ]
      }
    };

    const artifacts = await buildPhase1Artifacts(config);
    assert.equal(artifacts.length, 5);

    const webArtifact = artifacts.find((artifact) => artifact.category === "web");
    assert.equal(webArtifact.metadata.brin_origin, "page");
    assert.equal(webArtifact.metadata.tranco_list.list_id, "TEST01");

    const emailArtifact = artifacts.find((artifact) => artifact.category === "email");
    assert.equal(emailArtifact.metadata.brin_origin, "email");
    assert.ok(emailArtifact.source_published_at);

    const skillArtifact = artifacts.find((artifact) => artifact.artifact_id === "skill-safe");
    assert.equal(skillArtifact.metadata.audits_page_mentions_entry, true);
    assert.equal(skillArtifact.freshness_tier, "fresh");

    const relativeSkillArtifact = artifacts.find(
      (artifact) => artifact.artifact_id === "skill-relative-safe"
    );
    assert.equal(relativeSkillArtifact.metadata.audits_page_mentions_entry, true);
    assert.equal(relativeSkillArtifact.freshness_tier, "established");

    const packageArtifact = artifacts.find((artifact) => artifact.category === "package");
    assert.equal(packageArtifact.metadata.brin_origin, "npm");
    assert.ok(packageArtifact.source_published_at);
  } finally {
    server.close();
  }
});
