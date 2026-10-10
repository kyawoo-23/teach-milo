import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { CallContext, reserveModelCall } from "./usage";

export interface Model {
  generate<T>(
    schema: z.ZodType<T>,
    system: string,
    data: unknown,
    context: CallContext,
    pdf?: Buffer,
  ): Promise<T>;
}
export const gemini: Model = {
  async generate<T>(
    schema: z.ZodType<T>,
    system: string,
    data: unknown,
    context: CallContext,
    pdf?: Buffer,
  ): Promise<T> {
    if (!process.env.GEMINI_API_KEY)
      throw new AppError(
        "SETUP_REQUIRED",
        "Add GEMINI_API_KEY to .env.local and restart the app to use Milo.",
        503,
      );
    await reserveModelCall(context);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), pdf ? 90_000 : 60_000);
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
        contents: [
          {
            role: "user",
            parts: [
              ...(pdf
                ? [
                    {
                      inlineData: {
                        mimeType: "application/pdf",
                        data: pdf.toString("base64"),
                      },
                    },
                  ]
                : []),
              { text: JSON.stringify(data) },
            ],
          },
        ],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: z.toJSONSchema(schema, { target: "draft-7" }),
          maxOutputTokens: pdf ? 16384 : 10000,
          temperature: 0.35,
          httpOptions: { timeout: pdf ? 90_000 : 60_000 },
          abortSignal: controller.signal,
          automaticFunctionCalling: { disable: true },
        },
      });
      if (
        !response.text ||
        response.candidates?.[0]?.finishReason === "MAX_TOKENS"
      )
        throw new Error("Incomplete response");
      return schema.parse(JSON.parse(response.text));
    } catch (e) {
      if (e instanceof AppError) throw e;
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403 || status === 404)
        throw new AppError(
          "MODEL_CONFIGURATION",
          "Gemini could not use the configured key or model. Check GEMINI_API_KEY and GEMINI_MODEL.",
          503,
        );
      if (status === 429)
        throw new AppError(
          "MODEL_QUOTA",
          "Gemini is at its usage limit. Your progress is saved; try again later.",
          429,
          60,
        );
      throw new AppError(
        "MODEL_FAILURE",
        "I lost my train of thought. Please retry; your lesson has not advanced.",
        502,
      );
    } finally {
      clearTimeout(timer);
    }
  },
};
