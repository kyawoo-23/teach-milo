import { describe, expect, it, vi } from "vitest";
import {
  prepareTransferReference,
  resolveTransferReference,
} from "@/server/transfer-reference";
import { verifyNumericTransfer } from "@/server/calculation";
import { evaluateSessionReport } from "@/server/sessions";
import { finalizeReport, withinTolerance } from "@/lib/assessment";
import type { Model } from "@/server/model";
import {
  ctx,
  lessonFixture,
  messageFixture,
  numericFixture,
  reportFixture,
  sessionFixture,
} from "./fixtures";

// This topic exists only in regression data; production calculations stay generic.
function convolutionFixture() {
  const lesson = lessonFixture();
  lesson.transfer = {
    question:
      "For valid convolution with N=20, K=3, C=2, F=6, S=1 and biases on (B=1), find O, P and M. Explain why a larger image needs more computation but not more weights.",
    expected: "M = 324 × 324 = 104976; O = 18; P = 114.",
    criteria: ["Distinguish spatial work from shared weights"],
    numeric: {
      inputs: Object.entries({ n: 20, k: 3, c: 2, f: 6, s: 1, b: 1 }).map(
        ([id, value]) => ({ id, value }),
      ),
      fields: Object.entries({ o: 18, p: 114, m: 104976 }).map(
        ([id, expected]) => ({
          id,
          label: id.toUpperCase(),
          unit: "",
          tolerance: 0,
          expected,
        }),
      ),
      code: "function calculate(inputs) { const o = Math.floor((inputs.n - inputs.k) / inputs.s) + 1; const weights = inputs.k * inputs.k * inputs.c * inputs.f; return { metrics: { o: o, p: weights + inputs.b * inputs.f, m: o * o * weights } }; }",
    },
  };
  return lesson;
}
function scriptedModel(result: unknown) {
  const generate = vi.fn<Model["generate"]>(async (schema) =>
    schema.parse(result),
  );
  return { model: { generate } as Model, generate };
}

describe("numeric transfer references", () => {
  it("executes changed stride and bias inputs without topic-specific production logic", async () => {
    const numeric = convolutionFixture().transfer.numeric;
    numeric.inputs.find((i) => i.id === "s")!.value = 2;
    numeric.inputs.find((i) => i.id === "b")!.value = 0;
    const result = await verifyNumericTransfer(numeric);
    expect(result.numeric.fields.map((f) => f.expected)).toEqual([
      9, 108, 8748,
    ]);
  });
  it("corrects the multiplication regression and resolves prose from executed values", async () => {
    const lesson = convolutionFixture();
    const { model, generate } = scriptedModel({
      expected:
        "Output size O = {{o}}; shared parameters P = {{p}}; spatial multiplications M = {{m}}.",
    });
    const result = await prepareTransferReference(lesson.transfer, ctx, model);
    expect(result.outcome).toBe("corrected");
    expect(result.transfer.numeric.fields.map((f) => f.expected)).toEqual([
      18, 114, 34992,
    ]);
    expect(result.transfer.expected).toContain("M = 34992");
    expect(result.transfer.expected).not.toContain("104976");
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it.each([
    "M = 104976; O = {{o}}; P = {{p}}",
    "{{o}} {{p}} {{unknown}}",
    "{{o}} {{p}}",
    "{{o}} {{p}} {{m}} = 104,976",
  ])("falls back when rewritten prose is invalid: %s", async (expected) => {
    const { model } = scriptedModel({ expected });
    const result = await prepareTransferReference(
      convolutionFixture().transfer,
      ctx,
      model,
    );
    expect(result.transfer.expected).toBe("O = 18; P = 114; M = 34992");
  });
  it("uses a deterministic reference when rewriting fails", async () => {
    const { model, generate } = scriptedModel(null);
    generate.mockRejectedValue(new Error("model unavailable"));
    expect(
      (
        await prepareTransferReference(
          convolutionFixture().transfer,
          ctx,
          model,
        )
      ).transfer.expected,
    ).toBe("O = 18; P = 114; M = 34992");
  });
  it("resolves valid templates without another generation", async () => {
    const transfer = lessonFixture().transfer;
    transfer.expected = "Distance is speed times time: {{distance}} m.";
    const { model, generate } = scriptedModel(null);
    const result = await prepareTransferReference(transfer, ctx, model);
    expect(result.transfer.expected).toBe(
      "Distance is speed times time: 150 m.",
    );
    expect(generate).not.toHaveBeenCalled();
  });
  it("repairs invalid code once without changing inputs or fields", async () => {
    const transfer = lessonFixture().transfer;
    transfer.numeric.code = "broken";
    const { model, generate } = scriptedModel(numericFixture());
    generate.mockImplementationOnce(async (schema) =>
      schema.parse(numericFixture()),
    );
    generate.mockImplementationOnce(async (schema) =>
      schema.parse({
        expected: "Distance is speed times time: {{distance}} m.",
      }),
    );
    const result = await prepareTransferReference(transfer, ctx, model);
    expect(result.outcome).toBe("corrected");
    expect(result.transfer.question).toBe(transfer.question);
    expect(result.transfer.numeric.inputs).toEqual(transfer.numeric.inputs);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it.each(["broken", "changed inputs", "changed fields"])(
    "fails preparation after an invalid repair: %s",
    async (failure) => {
      const transfer = lessonFixture().transfer;
      transfer.numeric.code = "broken";
      const candidate = numericFixture();
      if (failure === "broken") candidate.code = "broken again";
      if (failure === "changed inputs") candidate.inputs[0].value++;
      if (failure === "changed fields") candidate.fields[0].id = "other";
      const { model, generate } = scriptedModel(candidate);
      await expect(
        prepareTransferReference(transfer, ctx, model),
      ).rejects.toMatchObject({ code: "MODEL_FAILURE", status: 502 });
      expect(generate).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    "nonfinite",
    "duplicate fields",
    "duplicate inputs",
    "negative tolerance",
  ])("rejects %s", async (failure) => {
    const numeric = numericFixture();
    if (failure === "nonfinite")
      numeric.code =
        "function calculate(inputs) { return { metrics: { distance: 1 / 0 } }; }";
    if (failure === "duplicate fields")
      numeric.fields.push({ ...numeric.fields[0] });
    if (failure === "duplicate inputs")
      numeric.inputs.push({ ...numeric.inputs[0] });
    if (failure === "negative tolerance") numeric.fields[0].tolerance = -1;
    expect((await verifyNumericTransfer(numeric)).outcome).toBe("invalid");
  });
  it("supports nonnumeric questions and rejects unknown placeholders", async () => {
    const transfer = lessonFixture().transfer;
    transfer.numeric = { fields: [], inputs: [], code: "" };
    const { model, generate } = scriptedModel(null);
    expect((await prepareTransferReference(transfer, ctx, model)).outcome).toBe(
      "none",
    );
    expect(generate).not.toHaveBeenCalled();
    expect(
      resolveTransferReference("{{unknown}}", numericFixture()),
    ).toBeNull();
  });
});

describe("server numeric grading", () => {
  it.each([2, 1, 0] as const)(
    "uses reasoning score %s independently of a false arithmetic deduction",
    async (score) => {
      const lesson = convolutionFixture();
      lesson.transfer.numeric = (
        await verifyNumericTransfer(lesson.transfer.numeric)
      ).numeric;
      lesson.transfer.expected = "O = 18; P = 114; M = 34992";
      const teaching = messageFixture();
      const answer = {
        ...messageFixture(
          "O=18, P=114, M=34992. Weights are shared; positions increase the work.",
        ),
        kind: "transfer" as const,
      };
      const raw = reportFixture(teaching, answer);
      raw.scores.transfer.score = 1;
      raw.scores.transfer.explanation =
        "Minor arithmetic error; expected 104976.";
      raw.transferReasoning.score = score;
      const { model, generate } = scriptedModel(raw);
      const report = await evaluateSessionReport(
        sessionFixture(lesson),
        lesson,
        [teaching, answer],
        false,
        ctx,
        model,
        { o: 18, p: 114, m: 34992 },
      );
      const data = generate.mock.calls[0][2] as {
        numericCheck: { fields: { matches: boolean }[] };
      };
      expect(data.numericCheck.fields.every((f) => f.matches)).toBe(true);
      expect(report.scores.transfer.score).toBe(score);
      expect(report.transferCorrect).toBe(score === 2);
      expect(report.scores.transfer.explanation).not.toMatch(
        /104976|arithmetic error/,
      );
      expect(report.scores.transfer.explanation).toContain("M = 34992");
      expect(report).not.toHaveProperty("transferReasoning");
    },
  );
  it("retains numeric caps, tolerance boundaries and evidence protections", () => {
    const lesson = lessonFixture();
    const teaching = messageFixture();
    const answer = {
      ...messageFixture("The distance doubles because speed is constant."),
      kind: "transfer" as const,
    };
    const raw = reportFixture(teaching, answer);
    const grade = (answers?: Record<string, number>, skipped = false) =>
      finalizeReport(
        raw,
        lesson,
        [teaching, answer],
        skipped,
        answers,
        [],
        raw.transferReasoning,
      );
    expect(grade({ distance: 300 }).scores.transfer.score).toBe(1);
    expect(grade({ distance: 300 }).scores.transfer.explanation).toContain(
      "expected value is 150",
    );
    expect(grade({ distance: 150.5 }).scores.transfer.score).toBe(2);
    expect(grade({ distance: 150.501 }).scores.transfer.score).toBe(1);
    expect(withinTolerance(150.5, 150, 0.5)).toBe(true);
    expect(grade().scores.transfer.status).toBe("insufficient_evidence");
    expect(grade({ distance: 150 }, true).transferCorrect).toBeNull();
    raw.transferReasoning.citations = [
      { messageId: teaching.id, quote: teaching.text },
    ];
    expect(grade({ distance: 150 }).transferCorrect).toBeNull();
    raw.transferReasoning.citations = [
      { messageId: answer.id, quote: answer.text },
    ];
    lesson.concerns = ["Unresolved source ambiguity"];
    expect(grade({ distance: 150 }).scores.transfer.status).toBe("uncertain");
  });
});
