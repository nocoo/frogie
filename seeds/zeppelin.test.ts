import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDefinition } from "../packages/core/src/definitions/index.js";

const root = fileURLToPath(new URL("../squads/zeppelin", import.meta.url));

describe("zeppelin definition from docs05", () => {
  it("loads the complete shared definition without a hardcoded model", () => {
    const bundle = loadDefinition(root);
    expect(bundle).toMatchObject({
      schemaVersion: 1,
      squadId: "zeppelin",
      projectId: "frogie",
      title: "zeppelin",
      rootRoleId: "command",
      defaults: { thinkingLevel: "medium" },
    });
    expect(bundle.defaults).not.toHaveProperty("model");
    expect(bundle.files.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        "SQUAD.md",
        "roles/command/ROLE.md",
        "roles/command/operations/ROLE.md",
        "roles/command/operations/navigation/ROLE.md",
        "roles/command/operations/tactical/ROLE.md",
        "roles/command/engineering/ROLE.md",
        "roles/command/logistics/ROLE.md",
        "roles/command/crew/ROLE.md",
        "roles/command/crew/medical/ROLE.md",
        "roles/command/crew/habitat/ROLE.md",
        "skills/fleet-command/SKILL.md",
        "skills/mission-planning/SKILL.md",
        "skills/resource-budget/SKILL.md",
        "skills/resource-budget/scripts/calculate.mjs",
        "skills/crew-care/SKILL.md",
        "workflows/emergency-transit.md",
      ]),
    );
    expect(bundle.contentHash).toMatch(/^[a-f0-9]{64}$/);
    for (const role of bundle.roles) expect(role).not.toHaveProperty("model");
    for (const content of [
      bundle.content,
      ...bundle.roles.map((role) => role.content),
      ...bundle.skills.map((skill) => skill.content),
      ...bundle.workflows.map((workflow) => workflow.content),
    ])
      expect(content).toMatch(/[\u4e00-\u9fff]/);
  });

  it("preserves the nine-role tree, skills, thinking levels and explicit capabilities", () => {
    const expected = [
      ["command", null, "fleet-command", "high", "delegate"],
      ["crew", "command", "crew-care", "medium", "delegate"],
      ["engineering", "command", "resource-budget", "medium", "run_script"],
      ["habitat", "crew", "crew-care", "low", undefined],
      ["logistics", "command", "resource-budget", "low", "run_script"],
      ["medical", "crew", "crew-care", "medium", undefined],
      ["navigation", "operations", "mission-planning", "low", undefined],
      ["operations", "command", "mission-planning", "medium", "delegate"],
      ["tactical", "operations", "mission-planning", "medium", undefined],
    ] as const;
    const roles = loadDefinition(root).roles;
    expect(roles).toHaveLength(expected.length);
    for (const [id, parentRoleId, skill, thinkingLevel, tool] of expected) {
      expect(roles.find((role) => role.id === id)).toMatchObject({
        id,
        parentRoleId,
        skills: [skill],
        thinkingLevel,
        extensions: ["frogie"],
        tools: [
          "read_artifact",
          "write_artifact",
          ...(tool === undefined ? [] : [tool]),
        ],
        scripts: tool === "run_script" ? ["resource-budget/calculate"] : [],
      });
    }
  });

  it("declares four skills and only the safe Node resource calculation entry", () => {
    const bundle = loadDefinition(root);
    expect(bundle.skills.map(({ id, scripts }) => ({ id, scripts }))).toEqual([
      { id: "crew-care", scripts: [] },
      { id: "fleet-command", scripts: [] },
      { id: "mission-planning", scripts: [] },
      {
        id: "resource-budget",
        scripts: [
          {
            id: "calculate",
            entry: "scripts/calculate.mjs",
            runtime: "node",
            replay: "safe",
          },
        ],
      },
    ]);
    expect(bundle.files).toContainEqual(
      expect.objectContaining({
        path: "skills/resource-budget/scripts/calculate.mjs",
        encoding: "utf8",
      }),
    );
  });

  it("loads exactly eight emergency-transit nodes and ten documented handoffs", () => {
    const { workflows } = loadDefinition(root);
    expect(workflows).toHaveLength(1);
    const workflow = workflows[0];
    expect(workflow).toMatchObject({
      id: "emergency-transit",
      entry: "receive-brief",
      entryRole: "command",
      participants: [
        "command",
        "operations",
        "navigation",
        "tactical",
        "engineering",
        "logistics",
      ],
      tools: ["read_artifact", "write_artifact", "delegate", "run_script"],
      scripts: ["resource-budget/calculate"],
    });
    expect(workflow?.nodes.map(({ id, role }) => [id, role])).toEqual([
      ["receive-brief", "command"],
      ["coordinate-route", "operations"],
      ["assess-route", "navigation"],
      ["assess-threat", "tactical"],
      ["merge-route", "operations"],
      ["check-power", "engineering"],
      ["check-supplies", "logistics"],
      ["publish-plan", "command"],
    ]);
    expect(
      workflow?.edges.map(({ source, target }) => [source, target]),
    ).toEqual([
      ["receive-brief", "coordinate-route"],
      ["receive-brief", "check-power"],
      ["receive-brief", "check-supplies"],
      ["coordinate-route", "assess-route"],
      ["coordinate-route", "assess-threat"],
      ["assess-route", "merge-route"],
      ["assess-threat", "merge-route"],
      ["merge-route", "publish-plan"],
      ["check-power", "publish-plan"],
      ["check-supplies", "publish-plan"],
    ]);
  });
});
