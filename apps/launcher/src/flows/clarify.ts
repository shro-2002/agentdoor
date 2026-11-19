import { HTTP_CONFLICT, LauncherError, validationFailed } from "../claude/errors.js";
import { compileState, type CompileResponse, type Deps } from "./compile.js";

export interface Answer {
  questionId: string;
  text: string;
}

const MAX_ANSWER_CHARS = 1000;

/**
 * The single clarification round (R0-2): answers become `Q: ...\nA: ...` turns so provenance can
 * quote them, then the whole transcript is recompiled (not patched). A second round is refused;
 * anything still unknown stays as an "AgentDoor default — confirm" card on the review screen.
 */
export async function answerQuestions(
  deps: Deps,
  sessionId: string,
  answers: Answer[],
): Promise<CompileResponse> {
  const session = deps.store.getSession(sessionId);
  if (session.clarifyUsed)
    throw new LauncherError("CLARIFY_LIMIT", "Only one round of questions is allowed.", HTTP_CONFLICT);
  const latest = deps.store.latestVersion(sessionId);
  if (latest === 0) throw new LauncherError("NOT_COMPILED", "Compile the description before answering questions.", HTTP_CONFLICT);

  const asked = (deps.store.readCompile(sessionId, latest) as { result: { questions: { id: string; text: string }[] } }).result.questions;
  const turns = toTurns(asked, answers);
  const next = { ...session, turns: [...session.turns, ...turns], clarifyUsed: true };

  const result = await compileState(deps, next);
  deps.store.saveSession(next); // only after a successful recompile, so a failure does not burn the round
  return result;
}

function toTurns(asked: { id: string; text: string }[], answers: Answer[]): string[] {
  if (answers.length === 0) throw validationFailed("Send at least one answer.");
  const seen = new Set<string>();
  return answers.map((a) => {
    const q = asked.find((x) => x.id === a.questionId);
    const text = a.text.trim();
    if (!q || seen.has(a.questionId)) throw validationFailed(`Unknown or repeated question "${a.questionId.slice(0, 40)}".`);
    if (text === "" || text.length > MAX_ANSWER_CHARS) throw validationFailed("An answer must be 1-1000 characters.");
    seen.add(a.questionId);
    return `Q: ${q.text}\nA: ${text}`;
  });
}
