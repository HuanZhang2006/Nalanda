import type {
  LearningAttemptRequest,
  LearningAttemptResult,
  LearningSession,
  LearningSessionPatch,
  LearningSkill,
  VocabularyWord,
} from "@nalanda/types";

type QueueState = {
  queue: string[];
  nextQueue: string[];
  cursor: number;
  round: number;
  awaitingRetryConfirmation: boolean;
  retrySummaryIds: string[];
  retryFromRound: number | null;
};

export function readQueueState(session: LearningSession): QueueState {
  const raw = session.state as {
    queue?: unknown;
    nextQueue?: unknown;
    cursor?: unknown;
    round?: unknown;
    awaitingRetryConfirmation?: unknown;
    retrySummaryIds?: unknown;
    retryFromRound?: unknown;
  };
  return {
    queue: Array.isArray(raw.queue) ? raw.queue.map(String) : session.items.map((item) => item.word.id),
    nextQueue: Array.isArray(raw.nextQueue) ? raw.nextQueue.map(String) : [],
    cursor: Math.max(0, Number(raw.cursor || 0)),
    round: Math.max(1, Number(raw.round || 1)),
    awaitingRetryConfirmation: raw.awaitingRetryConfirmation === true,
    retrySummaryIds: Array.isArray(raw.retrySummaryIds)
      ? raw.retrySummaryIds.map(String) : [],
    retryFromRound: Number.isSafeInteger(Number(raw.retryFromRound))
      && Number(raw.retryFromRound) > 0 ? Number(raw.retryFromRound) : null,
  };
}

export function readExamState(session: LearningSession) {
  const raw = session.state as Record<string, unknown>;
  const total = Math.max(1, Number(raw.examTotal || session.items.length || 1));
  const answered = Math.max(0, Math.min(total, Number(raw.examAnswered || 0)));
  const correct = Math.max(0, Math.min(answered, Number(raw.examCorrect || 0)));
  const accuracyPercent = answered > 0
    ? Math.round(correct / answered * 1_000) / 10
    : 0;
  return {
    total,
    answered,
    correct,
    accuracyPercent,
    requiredPercent: Math.max(1, Math.min(100, Number(raw.examRequiredPercent || 90))),
    firstRoundComplete: raw.examFirstRoundComplete === true,
    passed: typeof raw.examPassed === "boolean" ? raw.examPassed : null,
  };
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeSpellingText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u02bb\u02bc\u2018\u2019\uff07]/gu, "'")
    .replace(/[\u2010-\u2015\u2212\ufe63\uff0d]/gu, "-")
    .trim()
    .replace(/\s+/gu, " ")
    .replace(/[A-Z]/g, (character) => character.toLowerCase());
}

const SPELLING_PUNCTUATION_PATTERN =
  /[!"#$%&'()*+,\-.\/:;<=>?@\[\]\\^_`{|}~¡¿«»‹›“”„‟‘’‚‛‐‑‒–—―…·•‧、。〈〉《》「」『』【】〔〕〖〗〘〙〚〛]/gu;

function normalizeSpellingWithoutPunctuation(value: string, punctuationAsSpace: boolean) {
  return normalizeSpellingText(value)
    .replace(SPELLING_PUNCTUATION_PATTERN, punctuationAsSpace ? " " : "")
    .trim()
    .replace(/\s+/gu, " ");
}

export function spellingTextMatches(answer: string, expected: string) {
  const normalizedAnswer = normalizeSpellingText(answer);
  const normalizedExpected = normalizeSpellingText(expected);
  if (normalizedAnswer === normalizedExpected) return true;

  return normalizeSpellingWithoutPunctuation(answer, false)
      === normalizeSpellingWithoutPunctuation(expected, false)
    || normalizeSpellingWithoutPunctuation(answer, true)
      === normalizeSpellingWithoutPunctuation(expected, true);
}

export function evaluateAttempt(
  word: VocabularyWord,
  skill: LearningSkill,
  answer: LearningAttemptRequest["answer"],
) {
  if (skill === "pronunciation") return answer.wordId === word.id;
  if (skill === "translation") {
    const actual = [...(answer.translations || [])].map(normalize).sort();
    const expected = [...word.translations].map(normalize).sort();
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
  }
  return spellingTextMatches(answer.text || "", word.term);
}

function nextStage(session: LearningSession, items: LearningSession["items"]) {
  const all = (key: "pronunciationPassed" | "translationPassed" | "spellingPassed") =>
    items.every((item) => item[key]);
  if (session.stage === "pronunciation" && all("pronunciationPassed")) {
    if (session.selectedSkills.includes("translation")) return "translation" as const;
    if (session.selectedSkills.includes("spelling")) return "spelling" as const;
    return "completed" as const;
  }
  if (session.stage === "translation" && all("translationPassed")) {
    return session.selectedSkills.includes("spelling") ? "spelling" as const : "completed" as const;
  }
  if (session.stage === "spelling" && all("spellingPassed")) return "completed" as const;
  return session.stage;
}

export function applySessionPatch(
  session: LearningSession,
  revision: number,
  patch: LearningSessionPatch,
): LearningSession {
  return {
    ...session,
    revision,
    stage: patch.stage,
    active: patch.active,
    state: patch.state,
    items: patch.changedItem ? session.items.map((item) => item.word.id === patch.changedItem?.wordId
      ? {
        ...item,
        recognitionSeen: patch.changedItem.recognitionSeen,
        pronunciationPassed: patch.changedItem.pronunciationPassed,
        translationPassed: patch.changedItem.translationPassed,
        spellingPassed: patch.changedItem.spellingPassed,
        wrongCount: patch.changedItem.wrongCount,
      }
      : item) : session.items,
  };
}

export function predictAttempt(
  session: LearningSession,
  request: LearningAttemptRequest,
  correct = evaluateAttempt(
    session.items.find((item) => item.word.id === request.wordId)!.word,
    request.skill,
    request.answer,
  ),
): { session: LearningSession; result: LearningAttemptResult } {
  const q = readQueueState(session);
  let queue = [...q.queue];
  let cursor = q.cursor;
  let nextQueue = [...q.nextQueue];
  let round = q.round;
  let retrySummaryIds: string[] = [];
  let retryFromRound: number | null = null;
  let awaitingRetryConfirmation = false;
  const activeWord = queue[cursor];

  if (request.skill === "pronunciation") {
    const targetIndex = queue.findIndex((id, index) =>
      id === request.wordId && index >= cursor && index <= cursor + 4);
    if (targetIndex >= 0 && targetIndex !== cursor) {
      queue[targetIndex] = activeWord;
      queue[cursor] = request.wordId;
    }
  }

  const items = session.items.map((item) => item.word.id === request.wordId ? {
    ...item,
    pronunciationPassed: item.pronunciationPassed || (request.skill === "pronunciation" && correct),
    translationPassed: item.translationPassed || (request.skill === "translation" && correct),
    spellingPassed: item.spellingPassed || (request.skill === "spelling" && correct),
    wrongCount: item.wrongCount + (correct ? 0 : 1),
  } : item);
  if (!correct && !nextQueue.includes(request.wordId)) nextQueue.push(request.wordId);

  let examPatch: Record<string, unknown> = {};
  if (session.mode === "exam" && request.skill === "spelling" && round === 1) {
    const exam = readExamState(session);
    const answered = exam.answered + 1;
    const correctCount = exam.correct + (correct ? 1 : 0);
    const accuracyPercent = Math.round(correctCount / Math.max(1, answered) * 1_000) / 10;
    examPatch = {
      examAnswered: answered,
      examCorrect: correctCount,
      examAccuracyPercent: accuracyPercent,
      examFirstRoundComplete: answered >= exam.total,
      examPassed: answered >= exam.total
        ? correctCount * 100 >= exam.requiredPercent * exam.total : null,
    };
  }

  if (cursor + 1 >= queue.length) {
    if (nextQueue.length) {
      if (request.skill === "spelling") {
        retrySummaryIds = [...nextQueue];
        retryFromRound = round;
        awaitingRetryConfirmation = true;
      }
      queue = nextQueue;
      cursor = 0;
      nextQueue = [];
      round += 1;
    } else {
      cursor += 1;
    }
  } else {
    cursor += 1;
  }

  const stage = nextStage(session, items);
  const active = stage !== "completed";
  if (stage !== session.stage && active) {
    queue = items.map((item) => item.word.id);
    cursor = 0;
    nextQueue = [];
    round = 1;
  }
  const state = {
    ...session.state,
    ...examPatch,
    queue,
    cursor,
    nextQueue,
    round,
    ...(awaitingRetryConfirmation ? {
      awaitingRetryConfirmation: true,
      retrySummaryIds,
      retryFromRound,
    } : {}),
  };
  const changed = items.find((item) => item.word.id === request.wordId)!;
  const patch: LearningSessionPatch = {
    stage,
    active,
    state,
    changedItem: {
      wordId: changed.word.id,
      recognitionSeen: changed.recognitionSeen,
      pronunciationPassed: changed.pronunciationPassed,
      translationPassed: changed.translationPassed,
      spellingPassed: changed.spellingPassed,
      wrongCount: changed.wrongCount,
    },
    nextWordId: active ? queue[cursor] || null : null,
  };
  const revision = session.revision + 1;
  return {
    session: applySessionPatch({ ...session, items }, revision, patch),
    result: {
      attemptId: request.attemptId,
      correct,
      expected: request.skill === "translation"
        ? session.items.find((item) => item.word.id === request.wordId)!.word.translations
        : session.items.find((item) => item.word.id === request.wordId)!.word.term,
      revision,
      replayed: false,
      sessionPatch: patch,
    },
  };
}
