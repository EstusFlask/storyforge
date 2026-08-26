import { describe, expect, it } from "vitest";
import { previewTtrpgCheckProbabilityV2 } from "../../src/lib/ttrpg/house-rule";
import { resolveTtrpgResolutionV2 } from "../../src/lib/ttrpg/resolution";
import { createStoryForgeRulePackV1 } from "../../src/lib/ttrpg/storyforge-rule-pack";

describe("TTRPG-3J · StoryForge Narrative 2d6 V2", () => {
  it("10+、7–9、6- 与关键等级形成精确且可解释的成功阶梯", () => {
    const request = {
      mode: "total-vs-target" as const,
      target: 10,
      criticalSuccessMargin: 4,
      criticalFailureMargin: 6,
      partialSuccessWindow: 3,
    };
    expect(resolveTtrpgResolutionV2({ ...request, total: 14 }).degree).toBe(
      "critical-success",
    );
    expect(resolveTtrpgResolutionV2({ ...request, total: 10 }).degree).toBe(
      "success",
    );
    expect(resolveTtrpgResolutionV2({ ...request, total: 9 }).degree).toBe(
      "partial-success",
    );
    expect(resolveTtrpgResolutionV2({ ...request, total: 7 }).degree).toBe(
      "partial-success",
    );
    expect(resolveTtrpgResolutionV2({ ...request, total: 6 }).degree).toBe(
      "failure",
    );
    expect(resolveTtrpgResolutionV2({ ...request, total: 4 }).degree).toBe(
      "critical-failure",
    );
  });

  it("部分成功和失败不是换文案：规则包声明资源/状态代价及作用目标", () => {
    const pack = createStoryForgeRulePackV1();
    expect(pack.ruleSystemVersion).toBe("2.0.0");
    const check = pack.checks.find((item) => item.key === "standard");
    expect(check).toMatchObject({
      resolver: {
        mode: "total-vs-target",
        defaultDifficulty: 10,
        partialSuccessWindow: 3,
      },
    });
    const investigate = pack.actions.find(
      (item) => item.key === "investigate",
    )!;
    expect(investigate.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "resource",
          resourceKey: "focus",
          delta: -1,
          targetScope: "actor",
          appliesOnDegrees: ["partial-success"],
        }),
        expect.objectContaining({
          kind: "condition",
          conditionKey: "hindered",
          targetScope: "actor",
          appliesOnDegrees: ["failure", "critical-failure"],
        }),
      ]),
    );
    const strike = pack.actions.find((item) => item.key === "strike")!;
    expect(strike.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "damage",
          appliesOnDegrees: expect.arrayContaining([
            "partial-success",
            "success",
            "critical-success",
          ]),
        }),
        expect.objectContaining({
          kind: "condition",
          conditionKey: "exposed",
          targetScope: "actor",
          appliesOnDegrees: ["partial-success"],
        }),
      ]),
    );
  });

  it("概率预览把部分成功计入推进概率且保持成功/失败总和为 1", () => {
    const preview = previewTtrpgCheckProbabilityV2({
      rulePack: createStoryForgeRulePackV1(),
      checkKey: "standard",
      attributeValue: 1,
    });
    expect(preview.method).toBe("exact");
    expect(preview.successProbability).toBeGreaterThan(0.5);
    expect(preview.successProbability).toBeLessThan(1);
    expect(preview.successProbability + preview.failureProbability).toBeCloseTo(
      1,
      8,
    );
  });
});
