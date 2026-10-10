import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadHisfmDefinition, loadHisfmPrompts, workPolicy } from "./hisfm.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const expected = {
  coordinator:
    "63d99e0e605a0417fbec5ea3e2387276c3030b7755d41b3b95c49b4a1a8f992e",
  executor: "aba24d303677301ea64a8f69172b2d59078684ca1c43bbab776486f9e39f461a",
  reviewer: "2684663a45809a8947bb3616508a19fb67caa4f1ebdc185a0316a193a95788e2",
  speech: "6aa768e9c5eaaba1243c0aff5e973f14c3c113e4b5df6bbd9b15fe70a3ef8dae",
  voiceComparison:
    "21b205c33d4a64c0e665dd514a4f3a32f085d78524ed107d70ab294cb42df403",
  capabilities:
    "dee20ebb3d8dfe36f13b7d693b2cda2299fd5d63b9c378b4f298b0cb61e7981e",
  network: "a719dd14ec278f7f603f9d2718a64b98c61f76e1f38e1193be59b808ff488af8",
  decisionPlan:
    "475f754525cf4c6ba6019603b588a42283519b9c8de37d5eec3a7e881ece7aa1",
  decisionThinking:
    "68d9600b9f4d8b87335722d1b1022491322fdeb55d9c63a790c056ef96ed0861",
  compaction:
    "26dabc538b587d10bbdfaacae89e3e9de2b1596425b377d2eb7ed724eef5d083",
  editorial: "01a3655cebef7b71809d0e168ac4c4ef563c474e6ccec0a6a4c3b1170ec8b1c9",
  boundary: "08af90291473538b4f45a01d9eff512c19c57b2f52b2abbfd6fcf88e1976acf6",
  brief: "fabbc8c0446748c58bb9785c2c21c7e1427334b542419323f70d0960e28d6486",
  script: "4da0f1644cbe59e093ec4bd498a887a00ef5fffea7fcc3d446c8b6de35608652",
  cover: "5e030c83b787dae34866ccf4ae2f06e0380e0be79ff8a0df9a044b04211464bf",
  description:
    "d73fd96d2b9fea0b85cc55a2a6c97df56e7d3fbe03658e8ade91f1af35b8cac1",
};

describe("hisfm definition parity", () => {
  it.each(["role", "resource"] as const)(
    "rejects a catalog missing a required %s instead of returning partial prompts",
    (missing) => {
      const directory = mkdtempSync(join(tmpdir(), "frogie-hisfm-definition-"));
      try {
        cpSync(
          new URL("../../../../squads/hisfm", import.meta.url),
          directory,
          { recursive: true },
        );
        rmSync(
          join(
            directory,
            missing === "role"
              ? "roles/coordinator/speech"
              : "skills/prompt-catalog/resources/voice-comparison.md",
          ),
          { recursive: true },
        );
        expect(() => loadHisfmPrompts(directory)).toThrow(
          missing === "role"
            ? "Missing his.fm role: speech"
            : "Missing his.fm prompt resource",
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
  it("preserves all 16 original defaults and editorial content byte for byte", () => {
    const { defaultPrompts, channelDefault, narrationStyle } =
      loadHisfmPrompts();
    expect(
      Object.fromEntries(
        Object.entries(defaultPrompts).map(([key, value]) => [
          key,
          hash(value),
        ]),
      ),
    ).toEqual(expected);
    expect(hash(channelDefault)).toBe(
      "d425c1eceed690208abdc5e6ca0c39e08a82aefdec7eca36d0b95cca155dfed3",
    );
    expect(narrationStyle).toBe(
      "自然口语化的普通话旁白，平静温暖，咬字清晰，停顿舒缓。",
    );
    const definition = loadHisfmDefinition();
    expect(definition.roles.map(({ id, tools }) => [id, tools.length])).toEqual(
      [
        ["coordinator", 12],
        ["reviewer", 5],
        ["speech", 2],
        ["writer", 5],
      ],
    );
  });

  it("preserves composition and applies non-default profile overrides exactly", () => {
    const { defaultPrompts } = loadHisfmPrompts();
    expect(hash(workPolicy(defaultPrompts, "writer"))).toBe(
      "420b73a8e68756c2b143e4db6e6f1ef76eca32a34a4a56816feb17fb05cd60f5",
    );
    expect(hash(workPolicy(defaultPrompts, "reviewer"))).toBe(
      "a3610460203171460fc97093a2f58c50ac795eb6ec0c730ae0205c67b7bf58cc",
    );
    expect(workPolicy(defaultPrompts, "speech")).toBe(defaultPrompts.speech);
    const profile = {
      ...defaultPrompts,
      executor: "custom executor",
      reviewer: "custom reviewer",
      speech: "custom speech",
      editorial: "custom editorial",
      boundary: "custom boundary",
    };
    expect(workPolicy(profile, "writer")).toBe(
      "custom executor\ncustom editorial\ncustom boundary",
    );
    expect(workPolicy(profile, "reviewer")).toBe(
      "custom executor\ncustom reviewer\ncustom editorial\ncustom boundary",
    );
    expect(workPolicy(profile, "speech")).toBe("custom speech");
  });
});
