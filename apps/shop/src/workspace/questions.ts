import { LIMITS } from "./config.js";
import type { DraftState, Question } from "./state.js";

/** The next question nobody has answered yet; null when the batch is complete (or there is none). */
export const nextQuestion = (state: DraftState): Question | null => state.questions.find((q) => !(q.id in state.answers)) ?? null;

export const answeredCount = (state: DraftState): number => state.questions.filter((q) => q.id in state.answers).length;

/** The transcript turns for the answered questions, quotable by the compiler (`Q: ...` / `A: ...`). */
export function answerTurns(questions: Question[], answers: Record<string, string>): string[] {
  return questions.filter((q) => q.id in answers).map((q) => `Q: ${q.text}\nA: ${answers[q.id]}`);
}

/** Stores one answer; false when the question is unknown or the answer is empty or too long. */
export function recordAnswer(state: DraftState, questionId: string, raw: string): boolean {
  const text = raw.trim();
  if (text === "" || text.length > LIMITS.maxAnswerChars) return false;
  if (!state.questions.some((q) => q.id === questionId)) return false;
  state.answers[questionId] = text;
  return true;
}
