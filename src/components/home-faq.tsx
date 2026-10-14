"use client";

import { ChevronDown } from "lucide-react";
import { useI18n } from "./locale-context";
import type { TranslationKey } from "@/lib/i18n/messages";

const questions: { question: TranslationKey; answer: TranslationKey }[] = [
  {
    question: "Who is Milo?",
    answer:
      "Milo is an AI student. You teach by explaining in your own words, while Milo asks questions that help you spot gaps in your understanding.",
  },
  {
    question: "What learning materials can I use?",
    answer:
      "Upload a PDF, DOCX, or TXT file smaller than 10 MB, or paste your notes. You can review the extracted text before preparing your lesson.",
  },
  {
    question: "What happens in a session?",
    answer:
      "Explain the lesson to Milo, respond to questions, then try a fresh example on your own. Your report highlights what you demonstrated and what to work on next.",
  },
  {
    question: "Can I return to my sessions?",
    answer:
      "Sign in to save and revisit your sessions from history. Sessions expire after the retention period, which is 7 days by default. You can also delete a session anytime.",
  },
];

export function HomeFaq() {
  const { t } = useI18n();
  return (
    <section className="home-faq" aria-labelledby="home-faq-title">
      <h2 id="home-faq-title">{t("Frequently asked questions")}</h2>
      <div className="home-faq-list">
        {questions.map(({ question, answer }) => (
          <details key={question} className="home-faq-item">
            <summary>
              <span>{t(question)}</span>
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <p>{t(answer)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
