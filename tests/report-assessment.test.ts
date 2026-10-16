import { describe, expect, it } from "vitest";
import { evaluateSessionReport } from "@/server/sessions";
import type { Message } from "@/lib/contracts";
import { ReportGeneratedSchema } from "@/lib/contracts";
import type { Model } from "@/server/model";
import {
  ctx,
  lessonFixture,
  messageFixture,
  reportFixture,
  sessionFixture,
} from "./fixtures";

describe("report evidence boundaries", () => {
  it("separates transfer from teaching and identifies Milo's misconception opportunity", async () => {
    const lesson = lessonFixture();
    const session = {
      ...sessionFixture(lesson),
      mode: "correct" as const,
      challengeUsed: true,
    };
    const teaching = messageFixture(
      "Twice the speed gives twice the distance, not four times, because distance equals speed times time.",
    );
    const transfer = {
      ...messageFixture("6 times 25 is 150 metres."),
      kind: "transfer" as const,
    };
    const model: Model = {
      async generate(schema, system, data) {
        const input = data as {
          messages: Message[];
          transferAnswer: Message;
          misconceptionIntroduced: boolean;
          misconception: string;
        };
        expect(input.messages).toEqual([teaching]);
        expect(input.transferAnswer).toEqual(transfer);
        expect(input.misconceptionIntroduced).toBe(true);
        expect(input.misconception).toBe(lesson.misconception);
        expect(system).toContain(
          "how the learner corrected MILO'S stated belief",
        );
        return schema.parse(reportFixture(teaching, transfer));
      },
    };
    const report = await evaluateSessionReport(
      session,
      lesson,
      [teaching, transfer],
      false,
      ctx,
      model,
      { distance: 150 },
    );
    expect(report.scores.accuracy.score).toBe(2);
    expect(report.scores.misconception.score).toBe(2);
    expect(report.total).toBe(10);
  });

  it("still withholds teaching scores supported only by the transfer answer", async () => {
    const lesson = lessonFixture();
    const session = sessionFixture(lesson);
    const teaching = messageFixture();
    const transfer = {
      ...messageFixture("6 times 25 is 150 metres."),
      kind: "transfer" as const,
    };
    const model: Model = {
      async generate(schema) {
        const invalid = reportFixture(transfer, transfer);
        expect(schema.safeParse(invalid).success).toBe(false);
        // Even a provider that ignores the constraint cannot create a score.
        return ReportGeneratedSchema.parse(invalid) as ReturnType<
          typeof schema.parse
        >;
      },
    };
    const report = await evaluateSessionReport(
      session,
      lesson,
      [teaching, transfer],
      false,
      ctx,
      model,
      { distance: 150 },
    );
    expect(report.scores.accuracy.score).toBeNull();
    expect(report.scores.misconception.score).toBeNull();
    expect(report.scores.transfer.score).toBe(2);
    expect(report.total).toBeNull();
  });
});
