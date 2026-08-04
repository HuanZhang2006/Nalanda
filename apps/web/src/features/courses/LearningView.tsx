import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LearningAttemptRequest, LearningAttemptResult, LearningAudioManifest, LearningCourseDetail,
  LearningSession, LearningSpellingTranslationAssessmentResult,
  LearningTranslationTranscriptionResult, PronunciationAssessment, VocabularyWord,
} from "@nalanda/types";
import { ApiClientError, apiErrorMessage, authedFetch } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { coursesApi } from "./api";
import { beginWavRecording } from "./recording";
import { AudioWaveform } from "./AudioWaveform";
import { useI18n } from "../../i18n";
import { CourseLocaleButton } from "./CourseLocaleButton";
import {
  cachedAudioCount,
  playAudioAsset,
  prefetchAudioAssets,
  removeCachedAudioAssets,
  requestPersistentAudioStorage,
} from "./audioCache";
import {
  clearPendingAttemptsForSession,
  clearPendingAttemptsForUser,
  listPendingAttempts,
  PendingLearningAttempt,
  putPendingAttempt,
  removePendingAttempt,
  retryDelay,
} from "./attemptOutbox";
import {
  applySessionPatch,
  predictAttempt,
  readExamState,
  readQueueState,
} from "./learningSessionState";

const STAGES = ["recognition", "pronunciation", "translation", "spelling"] as const;
const CORRECT_FEEDBACK_MS = 520;
const SPELLING_CORRECT_FEEDBACK_MS = 1_500;
const AUDIO_QUOTA_CODES = new Set([
  "SPEECH_TTS_RATE_LIMIT",
  "SPEECH_TTS_MONTHLY_LIMIT",
  "SPEECH_QUOTA_EXCEEDED",
]);

function quotaPausedCount(manifest: LearningAudioManifest | null) {
  return manifest?.assets.filter((asset) =>
    asset.status === "pending" && AUDIO_QUOTA_CODES.has(asset.lastErrorCode || "")).length || 0;
}

type AttemptFeedback = {
  result: LearningAttemptResult;
  serverResult?: LearningAttemptResult;
  predictedSession: LearningSession;
  request: LearningAttemptRequest;
  skill: "pronunciation" | "translation" | "spelling";
  wordId: string;
  actual?: string;
  triggerValue?: string;
  selectedWordId?: string;
  translationActual?: string;
  translationFeedback?: string;
};

type AudioFallbackNotice = {
  wordId: string;
  message: string;
};

type RecordingPurpose = "pronunciation" | "translation";
type RecordingTarget = {
  purpose: RecordingPurpose;
  sessionId: string;
  wordId: string;
  revision: number;
};

function fallbackSpeak(text: string) {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance); return true;
}

function isPronunciationExam(session: LearningSession | null | undefined) {
  return Boolean(session && session.mode === "exam"
    && readExamState(session).kind === "pronunciation");
}

function stableShuffle(words: VocabularyWord[], salt: string) {
  const score = (value: string) => [...`${salt}:${value}`].reduce((sum, char) => ((sum * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
  return [...words].sort((left, right) => score(left.id) - score(right.id) || left.id.localeCompare(right.id));
}

async function playWord(
  word: VocabularyWord,
  manifest: LearningAudioManifest | null,
  setAudioNotice: (value: AudioFallbackNotice | null) => void,
  l: (english: string, chinese: string) => string,
) {
  try {
    const asset = manifest?.assets.find((entry) => entry.wordId === word.id) || {
      wordId: word.id,
      cacheKey: word.id,
      status: "pending" as const,
      audioUrl: `/api/pronunciation/audio/${encodeURIComponent(word.id)}`,
      lastErrorCode: null,
    };
    if (!await playAudioAsset(asset, manifest?.synthesisVersion || "1")) {
      throw new Error(l("Audio is still being prepared.", "音频仍在准备中"));
    }
    setAudioNotice(null);
  } catch (caught) {
    const reason = caught instanceof Error && caught.message
      ? caught.message : l("Azure pronunciation is temporarily unavailable.", "Azure 发音暂不可用");
    setAudioNotice({
      wordId: word.id,
      message: fallbackSpeak(word.term)
        ? l(`${reason} Browser speech is being used.`, `${reason}，已使用浏览器朗读`)
        : l(`${reason} You can continue learning without audio.`, `${reason}，无音频也可继续学习`),
    });
  }
}

function SpellingDiff({ expected, actual }: { expected: string; actual: string }) {
  const length = Math.max(expected.length, actual.length);
  return <span className="mono">{Array.from({ length }, (_, index) => {
    const char = actual[index] || "□";
    return <span key={index} className={expected[index]?.toLowerCase() === actual[index]?.toLowerCase() ? "" : "course-diff-bad"}>{char}</span>;
  })}</span>;
}

export function LearningView({ sessionId, onExit, onChanged }: {
  sessionId: string;
  onExit: () => void;
  onChanged: () => void;
}) {
  const { l } = useI18n();
  const label = (stage: string) => ({
    recognition: l("Recognition", "认单词"),
    pronunciation: l("Pronunciation", "发音记忆"),
    translation: l("Translation", "翻译记忆"),
    spelling: l("Spelling", "拼写记忆"),
    completed: l("Complete", "完成"),
  } as Record<string, string>)[stage] || stage;
  const [session, setSession] = useState<LearningSession | null>(null);
  const [course, setCourse] = useState<LearningCourseDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "pending" | "success">("idle");
  const [audioNotice, setAudioNotice] = useState<AudioFallbackNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [spelling, setSpelling] = useState("");
  const [spellingTranslation, setSpellingTranslation] = useState("");
  const [spellingTranslationResult, setSpellingTranslationResult] =
    useState<LearningSpellingTranslationAssessmentResult | null>(null);
  const [spellingTranslationBusy, setSpellingTranslationBusy] = useState(false);
  const [spellingTranscriptionBusy, setSpellingTranscriptionBusy] = useState(false);
  const [spellingAttemptId, setSpellingAttemptId] = useState(() => crypto.randomUUID());
  const [spellingTimeRemainingMs, setSpellingTimeRemainingMs] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<AttemptFeedback | null>(null);
  const [activeAudioId, setActiveAudioId] = useState("");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [recordingPurpose, setRecordingPurpose] = useState<RecordingPurpose | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [assessment, setAssessment] = useState<PronunciationAssessment | null>(null);
  const [assessmentWordId, setAssessmentWordId] = useState("");
  const [assessmentBusy, setAssessmentBusy] = useState(false);
  const [audioManifest, setAudioManifest] = useState<LearningAudioManifest | null>(null);
  const [audioPrefetchRetry, setAudioPrefetchRetry] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [confirmedRevision, setConfirmedRevision] = useState(0);
  const [offlineAudio, setOfflineAudio] = useState({
    running: false, cached: 0, total: 0, pending: 0, failed: 0,
    quotaPaused: 0, persistent: false,
  });
  const stopRef = useRef<null | (() => Promise<Blob | null>)>(null);
  const recordingPurposeRef = useRef<RecordingPurpose | null>(null);
  const recordingTargetRef = useRef<RecordingTarget | null>(null);
  const aliveRef = useRef(true);
  const sessionRef = useRef<LearningSession | null>(null);
  const audioManifestRef = useRef<LearningAudioManifest | null>(null);
  const feedbackRef = useRef<AttemptFeedback | null>(null);
  const userIdRef = useRef("");
  const flushingRef = useRef(false);
  const cancellingRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const downloadRef = useRef<AbortController | null>(null);
  const audioPrefetchRetryTimerRef = useRef<number | null>(null);
  const prioritizedAudioRef = useRef(new Set<string>());
  const nextQuestionRef = useRef<HTMLButtonElement>(null);
  const spellingSubmittedRef = useRef(false);
  const submitSpellingRef = useRef<(timedOut?: boolean) => void>(() => undefined);
  const [reviewOffsets, setReviewOffsets] = useState<number[]>([]);
  const recording = recordingPurpose === "pronunciation";
  const translationRecording = recordingPurpose === "translation";

  const setCurrentSession = (next: LearningSession | null) => {
    sessionRef.current = next;
    setSession(next);
  };
  const setCurrentFeedback = (next: AttemptFeedback | null) => {
    feedbackRef.current = next;
    setFeedback(next);
  };
  const setCurrentAudioManifest = (next: LearningAudioManifest | null) => {
    audioManifestRef.current = next;
    setAudioManifest(next);
  };

  const attemptMatches = (value: LearningSession, request: LearningAttemptRequest) => {
    if (!value.active || value.stage !== request.skill) return false;
    const state = readQueueState(value);
    if (request.skill === "pronunciation") {
      return state.queue.slice(state.cursor, state.cursor + 5).includes(request.wordId);
    }
    return state.queue[state.cursor] === request.wordId;
  };

  const restoreAfterConflict = async () => {
    setSyncStatus("idle");
    const latest = await coursesApi.session(sessionId);
    const pending = await listPendingAttempts(userIdRef.current, sessionId);
    let optimistic = latest;
    let retained = 0;
    let discarded = 0;
    for (const entry of pending) {
      if (attemptMatches(optimistic, entry.request)) {
        const request = {
          ...entry.request,
          expectedRevision: optimistic.revision,
        };
        await putPendingAttempt({
          ...entry,
          request,
          retryCount: 0,
          nextAttemptAt: Date.now(),
        });
        optimistic = predictAttempt(optimistic, request).session;
        retained += 1;
      } else {
        await removePendingAttempt(entry.attemptId);
        discarded += 1;
      }
    }
    setConfirmedRevision(latest.revision);
    setCurrentSession(optimistic);
    setCurrentFeedback(null);
    setPendingCount(retained);
    setNotice(l(
      retained
        ? `Progress changed on another device. Compatible offline answers are being synchronized.${discarded ? ` ${discarded} superseded answer${discarded === 1 ? " was" : "s were"} discarded.` : ""}`
        : `Progress changed on another device. The latest confirmed question has been restored.${discarded ? ` ${discarded} superseded answer${discarded === 1 ? " was" : "s were"} discarded.` : ""}`,
      retained
        ? `学习进度已在其它设备更新，兼容的离线答案正在继续同步。${discarded ? `已丢弃 ${discarded} 个被新进度取代的答案。` : ""}`
        : `学习进度已在其它设备更新，已恢复最新确认题目。${discarded ? `已丢弃 ${discarded} 个被新进度取代的答案。` : ""}`,
    ));
    return retained;
  };

  const scheduleCorrectAdvance = (
    attemptId: string,
    skill: LearningAttemptRequest["skill"],
  ) => {
    window.setTimeout(() => {
      const current = feedbackRef.current;
      if (aliveRef.current && current?.request.attemptId === attemptId
          && current.result.correct) advanceFeedback();
    }, skill === "spelling" ? SPELLING_CORRECT_FEEDBACK_MS : CORRECT_FEEDBACK_MS);
  };

  const scheduleFlush = (milliseconds: number) => {
    if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = window.setTimeout(() => { void flushOutbox(); }, milliseconds);
  };

  const flushOutbox = async () => {
    const userId = userIdRef.current;
    if (!userId || flushingRef.current || cancellingRef.current || !aliveRef.current) return;
    flushingRef.current = true;
    try {
      const entries = await listPendingAttempts(userId, sessionId);
      setPendingCount(entries.length);
      for (const entry of entries) {
        if (!aliveRef.current || cancellingRef.current) break;
        if (entry.nextAttemptAt > Date.now()) {
          scheduleFlush(entry.nextAttemptAt - Date.now());
          break;
        }
        try {
          const signal = typeof AbortSignal.timeout === "function"
            ? AbortSignal.timeout(8_000)
            : undefined;
          const result = await coursesApi.attempt(sessionId, entry.request, signal);
          await removePendingAttempt(entry.attemptId);
          if (cancellingRef.current) break;
          if (!aliveRef.current || userId !== userIdRef.current) break;
          setConfirmedRevision((value) => Math.max(value, result.revision));
          const activeFeedback = feedbackRef.current;
          if (activeFeedback?.request.attemptId === result.attemptId) {
            setCurrentFeedback({ ...activeFeedback, result, serverResult: result });
            if (!activeFeedback.result.correct && result.correct) {
              scheduleCorrectAdvance(result.attemptId, activeFeedback.request.skill);
            }
          } else {
            const currentSession = sessionRef.current;
            if (currentSession && (
              currentSession.revision === result.revision
              || currentSession.revision === result.revision - 1
            )) {
              setCurrentSession(applySessionPatch(currentSession, result.revision, result.sessionPatch));
            }
          }
          const remaining = await listPendingAttempts(userId, sessionId);
          setPendingCount(remaining.length);
          if (remaining.length === 0) {
            setSyncStatus((current) => current === "pending" ? "success" : current);
          }
          if (!result.sessionPatch.active && !feedbackRef.current && remaining.length === 0) onChanged();
        } catch (caught) {
          if (cancellingRef.current) {
            await removePendingAttempt(entry.attemptId);
            break;
          }
          if (!aliveRef.current || userId !== userIdRef.current) {
            await removePendingAttempt(entry.attemptId);
            break;
          }
          if (caught instanceof ApiClientError && caught.code === "SESSION_REVISION_CONFLICT") {
            if (await restoreAfterConflict()) scheduleFlush(50);
            break;
          }
          if (caught instanceof ApiClientError && caught.status >= 400
              && caught.status < 500
              && ![401, 408, 425, 429].includes(caught.status)) {
            await removePendingAttempt(entry.attemptId);
            setError(caught.message);
            await restoreAfterConflict();
            break;
          }
          const retryCount = entry.retryCount + 1;
          const delay = caught instanceof ApiClientError && caught.status === 429
            ? 30_000
            : retryDelay(retryCount);
          await putPendingAttempt({
            ...entry,
            retryCount,
            nextAttemptAt: Date.now() + delay,
          });
          setSyncStatus("pending");
          scheduleFlush(delay);
          break;
        }
      }
    } finally {
      flushingRef.current = false;
      if (aliveRef.current && userId === userIdRef.current && !cancellingRef.current) {
        const remaining = await listPendingAttempts(userId, sessionId);
        setPendingCount(remaining.length);
        if (remaining.length) {
          scheduleFlush(Math.max(0, remaining[0].nextAttemptAt - Date.now()));
        }
      }
    }
  };

  const load = async () => {
    const auth = await supabase?.auth.getSession();
    if (auth?.error) throw auth.error;
    const userId = auth?.data.session?.user.id || "local-session";
    userIdRef.current = userId;
    const confirmed = await coursesApi.session(sessionId);
    const pending = userId ? await listPendingAttempts(userId, sessionId) : [];
    let optimistic = confirmed;
    for (const entry of pending) {
      if (entry.request.expectedRevision === optimistic.revision
          && attemptMatches(optimistic, entry.request)) {
        optimistic = predictAttempt(optimistic, entry.request).session;
      }
    }
    setConfirmedRevision(confirmed.revision);
    setPendingCount(pending.length);
    setCurrentSession(optimistic);
    if (!course || course.id !== confirmed.courseId) {
      setCourse(await coursesApi.detail(confirmed.courseId));
    }
    window.setTimeout(() => { void flushOutbox(); }, 0);
    return optimistic;
  };

  useEffect(() => {
    let active = true;
    aliveRef.current = true;
    setError("");
    setSyncStatus("idle");
    load().catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : l("Could not load this session.", "会话加载失败"));
    });
    const subscription = supabase?.auth.onAuthStateChange((event, authSession) => {
      if (event === "INITIAL_SESSION") {
        // Supabase can emit INITIAL_SESSION before the getSession() awaited by
        // load() resolves. Seed the account reference without treating that
        // normal mount ordering as a cross-account login.
        if (!userIdRef.current && authSession?.user.id) {
          userIdRef.current = authSession.user.id;
        }
      } else if (event === "SIGNED_OUT") {
        const previous = userIdRef.current;
        userIdRef.current = "";
        if (previous) void clearPendingAttemptsForUser(previous);
        setCurrentFeedback(null);
        setCurrentSession(null);
      } else if (authSession?.user.id && authSession.user.id !== userIdRef.current) {
        const previous = userIdRef.current;
        userIdRef.current = authSession.user.id;
        if (previous) void clearPendingAttemptsForUser(previous);
        setCurrentFeedback(null);
        setCurrentSession(null);
        onExit();
      }
    }).data.subscription;
    const syncWhenOnline = () => scheduleFlush(0);
    window.addEventListener("online", syncWhenOnline);
    return () => {
      active = false;
      aliveRef.current = false;
      window.removeEventListener("online", syncWhenOnline);
      subscription?.unsubscribe();
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current);
      if (audioPrefetchRetryTimerRef.current != null) {
        window.clearTimeout(audioPrefetchRetryTimerRef.current);
      }
      downloadRef.current?.abort();
      const stop = stopRef.current;
      stopRef.current = null;
      recordingPurposeRef.current = null;
      recordingTargetRef.current = null;
      void stop?.().catch(() => null);
    };
  }, [sessionId, l]);
  useEffect(() => {
    if (syncStatus !== "success") return;
    const timer = window.setTimeout(() => setSyncStatus("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [syncStatus]);
  useEffect(() => {
    if (feedback && (!feedback.result.correct || error)) nextQuestionRef.current?.focus();
  }, [error, feedback]);

  const cancelLearning = async () => {
    const currentSession = sessionRef.current;
    if (!currentSession || cancellingRef.current) return;
    const confirmed = window.confirm(l(
      "Cancel this learning session? Confirmed answers and mastery history will be kept, but this session cannot be resumed. Answers still waiting to sync will be discarded.",
      "确定取消本次学习吗？已确认的答案和熟练度历史会保留，但本次会话将无法继续；仍待同步的答案会被丢弃。",
    ));
    if (!confirmed) return;
    cancellingRef.current = true;
    setCancelling(true);
    setError("");
    if (flushTimerRef.current != null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    try {
      await coursesApi.cancelSession(currentSession.id);
      await clearPendingAttemptsForSession(userIdRef.current, currentSession.id);
      setPendingCount(0);
      setSyncStatus("idle");
      setCurrentFeedback(null);
      onChanged();
      onExit();
    } catch (caught) {
      cancellingRef.current = false;
      setCancelling(false);
      setError(caught instanceof Error
        ? caught.message
        : l("Could not cancel this learning session.", "无法取消本次学习。"));
    }
  };

  const q = session ? readQueueState(session) : {
    queue: [], nextQueue: [], cursor: 0, round: 1,
    awaitingRetryConfirmation: false, retrySummaryIds: [], retrySummaryScores: {}, retryFromRound: null,
  };
  const currentId = q.queue[q.cursor];
  const current = session?.items.find((item) => item.word.id === currentId)?.word || null;
  const batchStart = Math.floor(q.cursor / 5) * 5;
  const batch = session ? q.queue.slice(q.cursor, batchStart + 5)
    .map((id) => session.items.find((item) => item.word.id === id)?.word).filter(Boolean) as VocabularyWord[] : [];
  const audioBatch = session ? stableShuffle(batch, `${session.id}:${session.stage}:${q.round}:${batchStart}:audio`) : [];
  const wordBatch = [...audioBatch].reverse();
  const retrySummaryWords = session ? q.retrySummaryIds
    .map((id) => session.items.find((item) => item.word.id === id)?.word)
    .filter((word): word is VocabularyWord => Boolean(word)) : [];
  const assessmentWord = assessmentWordId && session
    ? session.items.find((item) => item.word.id === assessmentWordId)?.word || null
    : null;
  const spellingOptions = session?.spellingOptions || {
    timeLimitEnabled: false,
    timeLimitSeconds: 20,
    translationFirst: false,
  };
  const restoredSpellingTranslation = session?.spellingTranslationAssessment
    && session.spellingTranslationAssessment.wordId === currentId
    && session.spellingTranslationAssessment.revision === session.revision
    ? session.spellingTranslationAssessment
    : null;
  const translationReady = !spellingOptions.translationFirst
    || Boolean(spellingTranslationResult?.correct)
    || Boolean(restoredSpellingTranslation);
  const activeSpellingAttemptId = spellingTranslationResult?.correct
    ? spellingTranslationResult.attemptId
    : restoredSpellingTranslation?.attemptId || spellingAttemptId;
  const spellingTimerWaiting = session?.stage === "spelling"
    && !q.awaitingRetryConfirmation
    && spellingOptions.timeLimitEnabled
    && spellingOptions.translationFirst
    && !translationReady
    && Boolean(current)
    && !feedback;
  const spellingTimerActive = session?.stage === "spelling"
    && !q.awaitingRetryConfirmation
    && spellingOptions.timeLimitEnabled
    && translationReady
    && Boolean(current)
    && !feedback;
  const spellingTimerDisplayMs = spellingTimeRemainingMs
    ?? (spellingTimerActive || spellingTimerWaiting
      ? spellingOptions.timeLimitSeconds * 1_000
      : null);
  useEffect(() => {
    setSelected([]);
    setSpelling("");
    setSpellingTranslation("");
    setSpellingTranslationResult(null);
    setSpellingTranslationBusy(false);
    setSpellingTranscriptionBusy(false);
    setSpellingAttemptId(crypto.randomUUID());
    setSpellingTimeRemainingMs(null);
    spellingSubmittedRef.current = false;
    if (!isPronunciationExam(session) || !assessmentWordId) {
      setAssessment(null);
      setAssessmentWordId("");
    }
    setActiveAudioId("");
    setSelectedMatchId("");
    setAudioNotice(null);
    const recordingTarget = recordingTargetRef.current;
    if (recordingTarget && (
      recordingTarget.sessionId !== session?.id
      || recordingTarget.wordId !== currentId
    )) {
      const stop = stopRef.current;
      stopRef.current = null;
      recordingPurposeRef.current = null;
      recordingTargetRef.current = null;
      setRecordingPurpose(null);
      setWaveform([]);
      void stop?.().catch(() => null);
    }
  }, [currentId, q.cursor, q.round, session?.id, session?.stage, session?.mode, assessmentWordId]);

  const translationOptions = useMemo(() => {
    if (!current || !course) return [];
    const all = [...new Set(course.units.flatMap((unit) => unit.words.flatMap((word) => word.translations)))];
    const distractors = all.filter((value) => !current.translations.includes(value)).slice(0, Math.max(3, 6 - current.translations.length));
    const values = [...current.translations, ...distractors];
    return values.sort((a, b) => `${current.id}:${a}`.localeCompare(`${current.id}:${b}`));
  }, [course, current]);

  useEffect(() => {
    if (!session?.unitId) return;
    let active = true;
    prioritizedAudioRef.current.clear();
    setAudioNotice(null);
    setCurrentAudioManifest(null);
    const update = async (prepare: boolean) => {
      const next = prepare
        ? await coursesApi.prewarmAudio(session.unitId!)
        : await coursesApi.audioManifest(session.unitId!);
      if (active) setCurrentAudioManifest(next);
    };
    void update(true).catch(() => undefined);
    const timer = window.setInterval(() => {
      const manifest = audioManifestRef.current;
      if (manifest?.pending !== 0 && quotaPausedCount(manifest) < (manifest?.pending || 0)) {
        void update(false).catch(() => undefined);
      }
    }, 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [session?.unitId]);

  useEffect(() => {
    if (!audioManifest || !Array.isArray(audioManifest.assets) || !session) return;
    const ids = q.queue.slice(q.cursor, q.cursor + 5);
    const assets = ids.map((id) => audioManifest.assets.find((asset) => asset.wordId === id))
      .filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    const pending = assets.filter((asset) => {
      if (asset.status === "ready") return false;
      const key = `${audioManifest.synthesisVersion}:${asset.cacheKey}`;
      if (prioritizedAudioRef.current.has(key)) return false;
      prioritizedAudioRef.current.add(key);
      return true;
    });
    const ready = assets.filter((asset) => asset.status === "ready");
    void prefetchAudioAssets(
      [...pending, ...ready],
      audioManifest.synthesisVersion,
      2,
      (asset, result) => {
        if (!aliveRef.current || audioManifestRef.current?.unitId !== audioManifest.unitId) return;
        const key = `${audioManifest.synthesisVersion}:${asset.cacheKey}`;
        const scheduleRetry = () => {
          if (audioPrefetchRetryTimerRef.current != null) return;
          audioPrefetchRetryTimerRef.current = window.setTimeout(() => {
            audioPrefetchRetryTimerRef.current = null;
            setAudioPrefetchRetry((value) => value + 1);
          }, 2_000);
        };
        if (result === "failed") {
          if (asset.status !== "ready") prioritizedAudioRef.current.delete(key);
          scheduleRetry();
          return;
        }
        if (result === "pending" && asset.status === "ready") {
          scheduleRetry();
          return;
        }
        if (result === "cached") {
          setAudioNotice((currentNotice) => {
            if (currentNotice?.wordId !== asset.wordId) return currentNotice;
            if ("speechSynthesis" in window) window.speechSynthesis.cancel();
            return null;
          });
        }
      },
    );
  }, [audioManifest, audioPrefetchRetry, currentId, session?.stage]);

  const recognize = async () => {
    if (!current || !session) return;
    setBusy(true); setError("");
    try {
      const result = await coursesApi.recognition(session.id, current.id);
      setConfirmedRevision(result.revision);
      setCurrentSession(applySessionPatch(session, result.revision, result.sessionPatch));
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : l("Could not save progress.", "保存进度失败")); }
    setBusy(false);
  };

  const advanceFeedback = () => {
    const activeFeedback = feedbackRef.current;
    const currentSession = sessionRef.current;
    if (!activeFeedback || !currentSession) return;
    const next = activeFeedback.serverResult
      ? applySessionPatch(currentSession, activeFeedback.serverResult.revision, activeFeedback.serverResult.sessionPatch)
      : activeFeedback.predictedSession;
    setCurrentSession(next);
    if (activeFeedback.serverResult) {
      setConfirmedRevision((value) => Math.max(value, activeFeedback.serverResult!.revision));
    }
    setCurrentFeedback(null);
    setError("");
    if (!next.active && activeFeedback.serverResult && pendingCount === 0) onChanged();
    void flushOutbox();
  };

  const attempt = (
    word: VocabularyWord,
    answer: LearningAttemptRequest["answer"],
    visual: Pick<
      AttemptFeedback,
      "actual" | "triggerValue" | "selectedWordId" | "translationActual" | "translationFeedback"
    > = {},
    requestAttemptId: string = crypto.randomUUID(),
  ) => {
    if (!session || feedback || readQueueState(session).awaitingRetryConfirmation
        || !["pronunciation", "translation", "spelling"].includes(session.stage)) return;
    const skill = session.stage as "pronunciation" | "translation" | "spelling";
    const request: LearningAttemptRequest = {
      attemptId: requestAttemptId,
      expectedRevision: session.revision,
      wordId: word.id,
      skill,
      answer,
    };
    const prediction = predictAttempt(session, request);
    const nextFeedback: AttemptFeedback = {
      result: prediction.result,
      predictedSession: prediction.session,
      request,
      skill,
      wordId: word.id,
      ...visual,
    };
    setError("");
    setCurrentFeedback(nextFeedback);
    const entry: PendingLearningAttempt = {
      attemptId: request.attemptId,
      userId: userIdRef.current,
      sessionId: session.id,
      request,
      createdAt: Date.now(),
      retryCount: 0,
      nextAttemptAt: Date.now(),
    };
    void putPendingAttempt(entry).then(async () => {
      setPendingCount((value) => value + 1);
      await flushOutbox();
    });
    if (prediction.result.correct) {
      scheduleCorrectAdvance(request.attemptId, request.skill);
    }
  };
  const continueAfterFeedback = () => { if (!busy) advanceFeedback(); };

  const continueRetryRound = async () => {
    const currentSession = sessionRef.current;
    if (!currentSession || !q.awaitingRetryConfirmation || busy || pendingCount > 0) return;
    setBusy(true);
    setError("");
    try {
      const result = isPronunciationExam(currentSession)
        ? await coursesApi.continueExamRetryRound(currentSession.id)
        : await coursesApi.continueSpellingRetryRound(currentSession.id);
      setConfirmedRevision(result.revision);
      setCurrentSession(applySessionPatch(
        currentSession,
        result.revision,
        result.sessionPatch,
      ));
    } catch (caught) {
      setError(caught instanceof Error
        ? caught.message
        : l("Could not start the next retry round.", "无法开始下一轮错题重考。"));
    } finally {
      setBusy(false);
    }
  };

  const assessBlob = async (blob: Blob, target: RecordingTarget) => {
    const assessedWordId = target.wordId;
    setAssessmentBusy(true); setNotice("");
    try {
      const form = new FormData(); form.append("sessionId", target.sessionId); form.append("wordId", target.wordId); form.append("audio", blob, "reading.wav");
      const response = await authedFetch("/api/pronunciation/assess", { method: "POST", body: form });
      if (!response.ok) throw new Error(await apiErrorMessage(response));
      const body = await response.json() as PronunciationAssessment;
      const currentSession = sessionRef.current;
      if (!currentSession || currentSession.id !== target.sessionId) {
        setNotice(l(
          "The learning session changed before pronunciation scoring finished.",
          "发音评分完成前学习会话已发生变化。",
        ));
      } else {
        const pronunciationExam = isPronunciationExam(currentSession);
        setAssessment(body);
        setAssessmentWordId(pronunciationExam ? assessedWordId : "");
        setConfirmedRevision(body.revision);
        if (!pronunciationExam) {
          setCurrentSession(applySessionPatch(currentSession, body.revision, body.sessionPatch));
        }
      }
    } catch (caught) { setNotice(l(`${caught instanceof Error ? caught.message : "Pronunciation assessment is temporarily unavailable."} You can continue learning.`, `${caught instanceof Error ? caught.message : "朗读评分暂不可用"}，不影响继续学习`)); }
    setAssessmentBusy(false);
    stopRef.current = null;
  };

  const transcribeTranslationBlob = async (blob: Blob, target: RecordingTarget) => {
    setSpellingTranscriptionBusy(true);
    setError("");
    setNotice(l("Transcribing Chinese speech…", "正在识别中文语音…"));
    try {
      const form = new FormData();
      form.append("wordId", target.wordId);
      form.append("expectedRevision", String(target.revision));
      form.append("audio", blob, "translation.wav");
      const response = await authedFetch(
        `/api/learning-sessions/${encodeURIComponent(target.sessionId)}/spelling-translation-transcriptions`,
        { method: "POST", body: form },
      );
      if (!response.ok) throw new Error(await apiErrorMessage(response));
      const result = await response.json() as LearningTranslationTranscriptionResult;
      const latest = sessionRef.current;
      const latestQueue = latest ? readQueueState(latest) : null;
      const latestWordId = latestQueue?.queue[latestQueue.cursor] || null;
      if (!latest
          || latest.id !== target.sessionId
          || latest.revision !== result.revision
          || latestWordId !== result.wordId) {
        setNotice(l(
          "The question changed before transcription finished, so the transcript was not inserted.",
          "识别完成前题目已发生变化，因此未填入这段识别结果。",
        ));
        return;
      }
      setSpellingTranslation(result.text);
      setNotice(l(
        "Voice input was inserted. You can edit it before submitting.",
        "语音识别结果已填入，提交前仍可编辑。",
      ));
    } catch (caught) {
      setNotice("");
      setError(caught instanceof Error
        ? caught.message
        : l("Voice input is temporarily unavailable.", "语音输入暂不可用。"));
    } finally {
      setSpellingTranscriptionBusy(false);
      setWaveform([]);
    }
  };

  const finishRecording = (blob: Blob, target: RecordingTarget) => {
    if (target.purpose === "translation") {
      void transcribeTranslationBlob(blob, target);
    } else {
      void assessBlob(blob, target);
    }
  };

  const startRecording = async (purpose: RecordingPurpose) => {
    const currentSession = sessionRef.current;
    const queue = currentSession ? readQueueState(currentSession) : null;
    const wordId = queue?.queue[queue.cursor] || "";
    if (!currentSession || !wordId || recordingPurposeRef.current) return;
    const target: RecordingTarget = {
      purpose,
      sessionId: currentSession.id,
      wordId,
      revision: currentSession.revision,
    };
    recordingPurposeRef.current = purpose;
    recordingTargetRef.current = target;
    setRecordingPurpose(purpose);
    setWaveform([]);
    try {
      const stop = await beginWavRecording(
        (blob) => {
          if (recordingTargetRef.current !== target) return;
          stopRef.current = null;
          recordingPurposeRef.current = null;
          recordingTargetRef.current = null;
          setRecordingPurpose(null);
          finishRecording(blob, target);
        },
        (caught) => {
          if (recordingTargetRef.current !== target) return;
          stopRef.current = null;
          recordingPurposeRef.current = null;
          recordingTargetRef.current = null;
          setRecordingPurpose(null);
          setWaveform([]);
          setNotice(purpose === "translation"
            ? l(`${caught.message} Nothing was submitted.`, `${caught.message}，未提交任何答案`)
            : l(`${caught.message} This is not counted as an error.`, `${caught.message}，不计入错误次数`));
        },
        {
          onWaveform: (levels) => {
            if (recordingTargetRef.current === target) {
              setWaveform((currentLevels) => [...currentLevels, ...levels].slice(-40));
            }
          },
        },
      );
      if (!aliveRef.current || recordingTargetRef.current !== target) {
        await stop().catch(() => null);
        return;
      }
      stopRef.current = stop;
      setNotice(purpose === "translation"
        ? l("Recording Chinese translation… Tap stop when finished (6 seconds maximum).", "正在录制中文翻译，完成后点击停止（最多 6 秒）")
        : l("Recording… Read the word, then stop (6 seconds maximum).", "正在录音，朗读后点击停止（最多 6 秒）"));
    } catch (caught) {
      if (recordingTargetRef.current !== target) return;
      stopRef.current = null;
      recordingPurposeRef.current = null;
      recordingTargetRef.current = null;
      setRecordingPurpose(null);
      setWaveform([]);
      setNotice(purpose === "translation"
        ? l(`${caught instanceof Error ? caught.message : "The microphone is unavailable."} Nothing was submitted.`, `${caught instanceof Error ? caught.message : "麦克风不可用"}，未提交任何答案`)
        : l(`${caught instanceof Error ? caught.message : "The microphone is unavailable."} This is not counted as an error.`, `${caught instanceof Error ? caught.message : "麦克风不可用"}，不计入错误次数`));
    }
  };
  const toggleRecording = async (purpose: RecordingPurpose = "pronunciation") => {
    if (recordingPurposeRef.current === purpose && stopRef.current) {
      const stop = stopRef.current;
      const target = recordingTargetRef.current;
      stopRef.current = null;
      try {
        const blob = await stop();
        if (recordingTargetRef.current === target) {
          recordingPurposeRef.current = null;
          recordingTargetRef.current = null;
          setRecordingPurpose(null);
          setWaveform([]);
          if (blob && target) finishRecording(blob, target);
        }
      } catch (caught) {
        if (recordingTargetRef.current === target) {
          recordingPurposeRef.current = null;
          recordingTargetRef.current = null;
          setRecordingPurpose(null);
          setWaveform([]);
          setNotice(purpose === "translation"
            ? l(`${caught instanceof Error ? caught.message : "The recording could not be prepared."} Nothing was submitted.`, `${caught instanceof Error ? caught.message : "无法准备录音"}，未提交任何答案`)
            : l(`${caught instanceof Error ? caught.message : "The recording could not be prepared."} This is not counted as an error.`, `${caught instanceof Error ? caught.message : "无法准备录音"}，不计入错误次数`));
        }
      }
      return;
    }
    if (!recordingPurposeRef.current) await startRecording(purpose);
  };
  const retryAssessment = async () => { setAssessment(null); setNotice(""); await startRecording("pronunciation"); };
  const continueAfterPronunciationAssessment = () => {
    const currentSession = sessionRef.current;
    if (!currentSession || !assessment || assessmentBusy) return;
    const next = applySessionPatch(
      currentSession,
      assessment.revision,
      assessment.sessionPatch,
    );
    setCurrentSession(next);
    setAssessment(null);
    setAssessmentWordId("");
    setNotice("");
    if (!next.active) onChanged();
  };

  const chooseTranslation = (option: string) => {
    if (!current || busy || feedback || selected.includes(option)) return;
    const values = [...selected, option];
    setSelected(values);
    if (current.translations.length === 1 || !current.translations.includes(option)
        || current.translations.every((translation) => values.includes(translation))) {
      void attempt(current, { translations: values }, { triggerValue: option });
    }
  };

  const assessSpellingTranslation = async () => {
    if (!session || !current || spellingTranslationBusy || feedback
        || !spellingTranslation.trim()) return;
    setSpellingTranslationBusy(true);
    setError("");
    try {
      const result = await coursesApi.assessSpellingTranslation(session.id, {
        attemptId: spellingAttemptId,
        expectedRevision: session.revision,
        wordId: current.id,
        answer: spellingTranslation,
      });
      if (result.correct) {
        setSpellingTranslationResult(result);
        setNotice("");
      } else if (result.attemptResult) {
        const request: LearningAttemptRequest = {
          attemptId: result.attemptId,
          expectedRevision: session.revision,
          wordId: current.id,
          skill: "spelling",
          answer: { text: "" },
        };
        const predictedSession = applySessionPatch(
          session,
          result.attemptResult.revision,
          result.attemptResult.sessionPatch,
        );
        setConfirmedRevision((value) => Math.max(value, result.attemptResult!.revision));
        setCurrentFeedback({
          result: result.attemptResult,
          serverResult: result.attemptResult,
          predictedSession,
          request,
          skill: "spelling",
          wordId: current.id,
          actual: "",
          translationActual: spellingTranslation,
          translationFeedback: result.feedback,
        });
      }
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "SESSION_REVISION_CONFLICT") {
        await restoreAfterConflict();
      } else {
        const retryAfter = caught instanceof ApiClientError
          && caught.retryAfterSeconds && caught.retryAfterSeconds > 0
          ? l(
            ` Allowance refreshes in about ${caught.retryAfterSeconds >= 3_600
              ? `${Math.ceil(caught.retryAfterSeconds / 3_600)} hour(s)`
              : `${Math.ceil(caught.retryAfterSeconds / 60)} minute(s)`}.`,
            `额度约在 ${caught.retryAfterSeconds >= 3_600
              ? `${Math.ceil(caught.retryAfterSeconds / 3_600)} 小时`
              : `${Math.ceil(caught.retryAfterSeconds / 60)} 分钟`}后恢复。`,
          ) : "";
        setError(`${caught instanceof Error
          ? caught.message
          : l("Could not check this translation. It was not counted as wrong.", "无法判定该翻译，本次不会记为错误。")}${retryAfter}`);
      }
    } finally {
      setSpellingTranslationBusy(false);
    }
  };

  const submitSpelling = (timedOut = false) => {
    if (!session || !current || feedback || spellingSubmittedRef.current
        || session.stage !== "spelling" || q.awaitingRetryConfirmation || !translationReady) return;
    if (!timedOut && !spelling.trim()) return;
    spellingSubmittedRef.current = true;
    void attempt(
      current,
      { text: spelling },
      { actual: spelling },
      activeSpellingAttemptId,
    );
  };
  submitSpellingRef.current = submitSpelling;

  useEffect(() => {
    const seconds = spellingOptions.timeLimitSeconds;
    if (session?.stage !== "spelling"
        || q.awaitingRetryConfirmation
        || !spellingOptions.timeLimitEnabled
        || !translationReady
        || !current
        || feedback
        || spellingTranslationBusy
        || !Number.isFinite(seconds)) {
      setSpellingTimeRemainingMs(null);
      return;
    }
    const duration = Math.max(3, Math.min(300, Number(seconds))) * 1_000;
    const deadline = Date.now() + duration;
    setSpellingTimeRemainingMs(duration);
    const tick = () => {
      const remaining = Math.max(0, deadline - Date.now());
      setSpellingTimeRemainingMs(remaining);
      if (remaining === 0) {
        window.clearInterval(timer);
        submitSpellingRef.current(true);
      }
    };
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [
    activeSpellingAttemptId,
    currentId,
    feedback,
    session?.id,
    spellingOptions.timeLimitEnabled,
    spellingOptions.timeLimitSeconds,
    session?.stage,
    spellingTranslationBusy,
    translationReady,
    q.awaitingRetryConfirmation,
  ]);

  const downloadOfflineAudio = async () => {
    if (!session?.unitId) return;
    if (offlineAudio.running) {
      downloadRef.current?.abort();
      setOfflineAudio((value) => ({ ...value, running: false }));
      return;
    }
    const controller = new AbortController();
    downloadRef.current = controller;
    const persistent = await requestPersistentAudioStorage();
    setOfflineAudio((value) => ({ ...value, running: true, persistent }));
    try {
      let next = await coursesApi.prewarmAudio(session.unitId);
      while (!controller.signal.aborted && aliveRef.current) {
        setCurrentAudioManifest(next);
        await prefetchAudioAssets(
          next.assets.filter((asset) => asset.status === "ready"),
          next.synthesisVersion,
          2,
        );
        const cached = await cachedAudioCount(next.assets, next.synthesisVersion);
        setOfflineAudio({
          running: next.pending > quotaPausedCount(next),
          cached,
          total: next.total,
          pending: next.pending,
          failed: next.failed,
          quotaPaused: quotaPausedCount(next),
          persistent,
        });
        if (next.pending === 0 || next.pending === quotaPausedCount(next)) break;
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 3_000);
          controller.signal.addEventListener("abort", () => {
            window.clearTimeout(timer);
            resolve();
          }, { once: true });
        });
        if (!controller.signal.aborted) next = await coursesApi.audioManifest(session.unitId);
      }
    } catch (caught) {
      setNotice(caught instanceof Error
        ? caught.message
        : l("Offline audio could not be prepared.", "离线音频准备失败"));
      setOfflineAudio((value) => ({ ...value, running: false }));
    }
  };

  const removeOfflineAudio = async () => {
    if (!audioManifest) return;
    downloadRef.current?.abort();
    await removeCachedAudioAssets(audioManifest.assets, audioManifest.synthesisVersion);
    setOfflineAudio({
      running: false, cached: 0, total: audioManifest.total,
      pending: audioManifest.pending, failed: audioManifest.failed,
      quotaPaused: quotaPausedCount(audioManifest), persistent: false,
    });
  };

  if (error && !session) return <div className="wrap"><div role="alert" className="card card-pad" style={{ color: "var(--pink)" }}>{error}<div className="mt-12"><button className="btn" onClick={onExit}>{l("Back to courses", "返回课程")}</button></div></div></div>;
  if (!session || !course) return <div className="wrap"><div className="card card-pad muted">{l("Restoring learning progress…", "恢复学习进度中…")}</div></div>;
  if (!session.active && session.stage !== "completed") return <div className="wrap"><div role="status" className="card card-pad">
    <h1 className="page-title">{l("This learning session has ended", "本次学习已结束")}</h1><p className="page-sub">{l("The course content was updated elsewhere. Previous attempts are retained; return to the course to start a new session.", "课程内容已在其它位置更新；旧答题事实仍保留，请返回课程开始新的会话。")}</p>
    <button className="btn btn-primary mt-16" onClick={onExit}>{l("Back to courses", "返回课程")}</button>
  </div></div>;
  if (session.stage === "completed" && (
    pendingCount > 0 || confirmedRevision < session.revision
  )) return <div className="wrap course-session courses-root"><div className="card course-study-card" role="status">
    <div className="course-empty-icon">↻</div>
    <h1 className="page-title">{l("Confirming session completion…", "正在确认会话完成…")}</h1>
    <p className="page-sub" style={{ textAlign: "center" }}>{l(
      "Your answers are saved on this device. Points, badges and completion will appear only after the server confirms them.",
      "答案已保存在本机；积分、徽章和完成状态只会在服务器确认后显示。",
    )}</p>
    <div className="faint mt-12">{l(`${pendingCount} answers waiting to sync`, `${pendingCount} 个答案等待同步`)}</div>
    <button className="btn mt-16" onClick={() => void flushOutbox()}>{l("Retry sync", "重试同步")}</button>
  </div></div>;
  if (session.stage === "completed") {
    const unitId = session.unitId;
    if (!unitId) return <div className="wrap"><div role="status" className="card card-pad">
      <h1 className="page-title">{l("Historical session completed", "历史学习已完成")}</h1><p className="page-sub">{l("The original unit was deleted. Attempt history is retained, but reviews can no longer be scheduled for this unit.", "原单元已经删除，历史答题事实仍保留，但不能再为该单元安排复习。")}</p>
      <button className="btn btn-primary mt-16" onClick={onExit}>{l("Back to courses", "返回课程")}</button>
    </div></div>;
    const unit = course.units.find((entry) => entry.id === unitId);
    const saveSchedule = async () => {
      setBusy(true); setError("");
      try { if (reviewOffsets.length) await coursesApi.schedule(unitId, session.id, reviewOffsets); onChanged(); onExit(); }
      catch (caught) { setError(caught instanceof Error ? caught.message : l("Could not save the review schedule.", "复习计划保存失败")); setBusy(false); }
    };
    if (session.mode === "exam") {
      const exam = readExamState(session);
      return <div className="wrap course-session courses-root"><div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}><CourseLocaleButton /></div><div className="card course-study-card" role="status">
        <div className="course-empty-icon">{exam.passed ? "✓" : "!"}</div><div className="eyebrow">{exam.kind === "pronunciation"
          ? l("Pronunciation exam complete", "读音考试完成")
          : l("Spelling exam complete", "拼写考试完成")}</div>
        <h1 className="page-title">{exam.passed ? l("Exam passed", "考试通过") : l("Exam not passed", "考试未通过")}</h1>
        <p className="page-sub" style={{ textAlign: "center" }}>{l(
          `First-round accuracy: ${exam.accuracyPercent}% · Required: ${exam.requiredPercent}%.`,
          `第一轮正确率：${exam.accuracyPercent}% · 要求：${exam.requiredPercent}%。`,
        )}</p>
        <div className={`course-feedback mt-16 ${exam.passed ? "is-correct" : "wrong"}`}>{exam.passed
          ? l("This exam requirement is complete. A word is marked learned only after it has passed both the spelling and pronunciation exams.", "本项考试要求已完成。单词只有同时通过拼写考试和发音考试后才会标为已学习。")
          : l("Every retry word was corrected and this exam ended automatically. The first-round score still did not meet the requirement, so this exam requirement was not passed; start a new exam to try again.", "所有错词均已修正，本次考试已自动结束；但首轮正确率仍未达要求，因此本项考试要求尚未通过，可重新开始一次考试。")}</div>
        <button className="btn btn-primary mt-24" onClick={onExit}>{l("Back to courses", "返回课程")}</button>
      </div></div>;
    }
    return <div className="wrap course-session courses-root"><div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}><CourseLocaleButton /></div><div className="card course-study-card">
      <div className="course-empty-icon">✓</div><div className="eyebrow">{l("Session complete", "会话完成")}</div>
      <h1 className="page-title">{session.mode === "initial" ? l(`${unit?.name || "This unit"}: first learning complete`, `${unit?.name || "本单元"} 首次学习完成`) : l("Review complete", "本次复习完成")}</h1>
      <p className="page-sub" style={{ textAlign: "center" }}>{session.mode === "initial" ? l("Initial learning is complete. A word becomes learned only after it passes both a spelling exam and a pronunciation exam. You may still add review schedules; none are selected by default.", "首次学习已完成。单词只有同时通过拼写考试和发音考试后才标为已学习。仍可选择加入复习日程，均默认不勾选。") : l("Words completed in this session gained one review. Reviews record practice but do not mark words learned; both exams are required.", "本次最终完成的词已累计一次复习。复习只记录练习事实，不会将词标为已学习；必须通过两项考试。")}</p>
      {session.mode === "initial" && <div className="row wrap-flex mt-24">{[3, 7, 15, 30].map((offset) => <label className="chip chip-outline" key={offset}>
        <input type="checkbox" checked={reviewOffsets.includes(offset)} onChange={(event) => setReviewOffsets((values) => event.target.checked ? [...values, offset] : values.filter((value) => value !== offset))} /> {l(`In ${offset} days`, `${offset} 天后`)}
      </label>)}</div>}
      {error && <div role="alert" className="course-feedback wrong">{error}</div>}
      <div className="row mt-24"><button className="btn" onClick={onExit}>{session.mode === "initial" ? l("Not now", "暂不安排") : l("Back to courses", "返回课程")}</button>
        {session.mode === "initial" && <button className="btn btn-primary" disabled={busy} onClick={saveSchedule}>{busy ? l("Saving…", "保存中…") : l("Save and return", "保存并返回")}</button>}</div>
    </div></div>;
  }

  const completedParts = session.items.reduce((sum, item) => sum + Number(item.recognitionSeen) + Number(item.pronunciationPassed) + Number(item.translationPassed) + Number(item.spellingPassed), 0);
  const initialPercent = Math.round(completedParts / Math.max(1, session.items.length * 4) * 100);
  const assessmentThreshold = assessment?.passThreshold ?? 70;
  const assessmentPassed = assessment?.passed ?? Boolean(assessment && assessment.pronunciationScore >= assessmentThreshold);
  const feedbackWord = feedback
    ? session.items.find((item) => item.word.id === feedback.wordId)?.word || null
    : null;
  const examDisplaySession = isPronunciationExam(session) && assessment
    ? applySessionPatch(session, assessment.revision, assessment.sessionPatch)
    : feedback?.serverResult
      ? applySessionPatch(session, feedback.serverResult.revision, feedback.serverResult.sessionPatch)
      : feedback?.predictedSession || session;
  const examState = session.mode === "exam" ? readExamState(examDisplaySession) : null;
  const visibleStages = session.mode === "exam"
    ? ([examState?.kind || "spelling"] as const)
    : STAGES;
  return <div className="wrap course-session courses-root">
    <div className="row between wrap-flex" style={{ marginBottom: 14 }}><div><div className="eyebrow">{course.title} · {session.mode === "exam" ? l(`Exam · Round ${q.round}`, `考试 · 第 ${q.round} 轮`) : l(`Round ${q.round}`, `第 ${q.round} 轮`)}</div>
      <h1 className="page-title">{session.mode === "exam"
        ? examState?.kind === "pronunciation" ? l("Pronunciation exam", "读音考试") : l("Spelling exam", "拼写考试")
        : label(session.stage)}</h1></div><div className="row wrap-flex"><button className="btn btn-sm" onClick={() => void downloadOfflineAudio()}>
        {offlineAudio.running ? l("Stop audio download", "停止音频下载") : l("Download unit audio", "下载单元音频")}
      </button>{offlineAudio.cached > 0 && <button className="btn btn-sm" onClick={() => void removeOfflineAudio()}>{l("Remove offline audio", "删除离线音频")}</button>}<CourseLocaleButton /><button className="btn" disabled={cancelling} onClick={onExit}>{l("Pause and return", "暂停并返回")}</button><button className="btn btn-danger" disabled={cancelling} onClick={() => void cancelLearning()}>{cancelling ? l("Cancelling…", "取消中…") : l("Cancel learning", "取消学习")}</button></div></div>
    {(offlineAudio.running || offlineAudio.total > 0) && <div className="faint" style={{ marginBottom: 10 }}>{l(
      `${offlineAudio.cached}/${offlineAudio.total} audio files stored locally · ${offlineAudio.pending} preparing · ${offlineAudio.quotaPaused} quota-paused · ${offlineAudio.failed} failed${offlineAudio.persistent ? " · persistent storage requested" : ""}`,
      `已在本地保存 ${offlineAudio.cached}/${offlineAudio.total} 个音频 · ${offlineAudio.pending} 个准备中 · ${offlineAudio.quotaPaused} 个因配额暂停 · ${offlineAudio.failed} 个失败${offlineAudio.persistent ? " · 已申请持久存储" : ""}`,
    )}</div>}
    {pendingCount > 0 && <div className="course-feedback" role="status">{l(
      `${pendingCount} answer${pendingCount === 1 ? "" : "s"} waiting for server confirmation.`,
      `${pendingCount} 个答案等待服务器确认。`,
    )}</div>}
    <div className="course-stage-track" style={{ gridTemplateColumns: `repeat(${visibleStages.length}, minmax(0, 1fr))` }}>{visibleStages.map((stage) => <div key={stage} className={`course-stage-step ${session.stage === stage ? "active" : ""}`}>{session.mode === "exam"
      ? examState?.kind === "pronunciation" ? l("Read aloud + score", "朗读 + 评分") : l("Translation + spelling", "翻译 + 拼写")
      : label(stage)}</div>)}</div>
    <div className="row between" style={{ marginBottom: 8 }}><span className="faint">{session.mode === "initial" ? l(`First-learning progress ${initialPercent}%`, `首次学习完成度 ${initialPercent}%`) : session.mode === "exam" && examState ? l(
      `Live first-round accuracy ${examState.accuracyPercent}% (${examState.correct}/${examState.answered}) · Required ${examState.requiredPercent}%`,
      `第一轮实时正确率 ${examState.accuracyPercent}%（${examState.correct}/${examState.answered}）· 要求 ${examState.requiredPercent}%`,
    ) : l(`${session.selectedSkills.length} review skills`, `复习项目 ${session.selectedSkills.length} 项`)}</span><span className="faint">{q.awaitingRetryConfirmation ? l(
      `${q.retrySummaryIds.length} missed word${q.retrySummaryIds.length === 1 ? "" : "s"} from round ${q.retryFromRound}`,
      `第 ${q.retryFromRound} 轮错词 ${q.retrySummaryIds.length} 个`,
    ) : l(`Round ${Math.min(q.cursor + 1, q.queue.length)}/${q.queue.length} · Retry pool ${q.nextQueue.length}`, `本轮 ${Math.min(q.cursor + 1, q.queue.length)}/${q.queue.length} · 候补 ${q.nextQueue.length}`)}</span></div>
    <div className="bar" style={{ marginBottom: 16 }}><i style={{ width: `${Math.round(q.cursor / Math.max(1, q.queue.length) * 100)}%` }} /></div>
    {error && <div role="alert" className="course-feedback wrong">{error}</div>}
    {audioNotice && <div role="status" className="course-feedback">{audioNotice.message}</div>}
    {syncStatus !== "idle" && <div role="status" className="course-feedback">{syncStatus === "pending"
      ? l(
        "Your answer is saved on this device and will sync when the connection recovers.",
        "答案已保存在本机，将在网络恢复后自动同步。",
      )
      : l("Answers synced successfully.", "答案同步成功。")}</div>}
    {notice && <div role="status" className="course-feedback">{notice}</div>}
    <div className="card course-study-card">
      {q.awaitingRetryConfirmation ? <div className="course-retry-summary">
        <div className="eyebrow">{l(`Round ${q.retryFromRound} complete`, `第 ${q.retryFromRound} 轮完成`)}</div>
        <h2 className="serif">{l(
          `${retrySummaryWords.length} word${retrySummaryWords.length === 1 ? "" : "s"} to retry`,
          `${retrySummaryWords.length} 个错词需要重考`,
        )}</h2>
        <p className="muted mt-8">{l(
          "Review every missed word below. The next round starts only after you confirm, and its order will be reshuffled.",
          "请先复盘本轮全部错词。确认后才会进入下一轮，错词顺序会重新打乱。",
        )}</p>
        <div className="course-retry-word-list mt-16">{retrySummaryWords.map((word) => <article className="course-retry-word" key={word.id}>
          <button className="btn btn-sm" aria-label={l(`Play ${word.term}`, `播放 ${word.term}`)} onClick={() => void playWord(word, audioManifest, setAudioNotice, l)}>🔊</button>
          <div><b className="mono">{word.term}</b><div className="course-ipa">{word.ipa || l("IPA not available", "音标待补充")}</div>
            {examState?.kind === "pronunciation" && q.retrySummaryScores[word.id] != null && <div className="faint mt-4">{l(
              `Pronunciation score ${Math.round(q.retrySummaryScores[word.id])}`,
              `发音评分 ${Math.round(q.retrySummaryScores[word.id])} 分`,
            )}</div>}</div>
          <div className="course-result-translations">{word.translations.map((translation) => <em key={translation}>{translation}</em>)}</div>
        </article>)}</div>
        {pendingCount > 0 && <div className="course-feedback mt-16" role="status">{l(
          "The last answers are still waiting for server confirmation. The next round becomes available after synchronization.",
          "最后几题仍在等待服务器确认；同步完成后才能开始下一轮。",
        )}</div>}
        <button className="btn btn-primary btn-lg mt-24" disabled={busy || pendingCount > 0}
          onClick={() => void continueRetryRound()}>{busy
            ? l("Preparing next round…", "正在准备下一轮…")
            : l("Shuffle and start next round", "打乱顺序并开始下一轮")}</button>
      </div> : <>
      {session.stage === "spelling" && current && !feedback && (spellingOptions.timeLimitEnabled
        ? <div
            className={`course-spelling-timer ${spellingTimerWaiting ? "waiting" : ""} ${!spellingTimerWaiting && (spellingTimerDisplayMs ?? 0) <= 5_000 ? "urgent" : ""}`}
            role={spellingTimerWaiting ? "status" : "timer"}
            aria-live="polite"
          >
            <span>{spellingTimerWaiting
              ? l("Spelling countdown", "拼写倒计时")
              : l("Time left", "剩余时间")}</span>
            <b>{Math.ceil((spellingTimerDisplayMs ?? spellingOptions.timeLimitSeconds * 1_000) / 1_000)}s</b>
            {spellingTimerWaiting && <small>{l(
              "Starts after the translation is accepted",
              "翻译通过后开始计时",
            )}</small>}
          </div>
        : <div className="course-spelling-untimed" role="status">{l(
          "No time limit for this session",
          "本次拼写测试不限时",
        )}</div>)}
      {!current ? <div>{l("Syncing the next stage…", "正在同步下一阶段…")}</div> : session.stage === "recognition" ? <>
        <div className="course-term">{current.term}</div><div className="course-ipa">{current.ipa || l("IPA not available", "音标待补充")}</div>
        <div className="row mt-16"><button className="btn" onClick={() => playWord(current, audioManifest, setAudioNotice, l)}>🔊 {l("US pronunciation", "美式发音")}</button>
          <button className={`btn ${recording ? "btn-primary" : ""}`} disabled={assessmentBusy || Boolean(recordingPurpose && !recording)} onClick={() => assessment && !recording ? retryAssessment() : toggleRecording("pronunciation")}>{assessmentBusy ? l("Assessing…", "评分中…") : recording ? l("■ Stop and assess", "■ 停止并评分") : assessment ? l("🎙 Read again", "🎙 重新朗读") : l("🎙 Pronunciation feedback (optional)", "🎙 朗读评分（可选）")}</button></div>
        {recording && <AudioWaveform levels={waveform} label={l("Live microphone waveform", "实时麦克风波形")} />}
        <div style={{ fontSize: 18, marginTop: 24 }}>{current.translations.join(" / ")}</div>
        {assessment && <div role="status" className={`course-feedback ${assessmentPassed ? "is-correct" : "wrong"}`}><b>{l(`Pronunciation ${Math.round(assessment.pronunciationScore)}`, `发音 ${Math.round(assessment.pronunciationScore)} 分`)}</b>
          <div className="muted mt-4">{l(`Pass score: ${assessmentThreshold} or higher.`, `通过分数：${assessmentThreshold} 分及以上。`)}</div>
          <div className="mt-4">{assessmentPassed
            ? l("Passed. This word is not in the pronunciation retry pool.", "已通过，本词不会进入朗读候补池。")
            : assessment.queuedForRetry
              ? l("Below the pass score. This word was added to the recognition retry pool.", "低于通过分数，本词已加入认单词候补池。")
              : l("Below the pass score. Read again before continuing.", "低于通过分数，请在继续前重新朗读。")}</div>
          <div className="course-phonemes">{assessment.phonemes.map((entry, index) => <span key={`${entry.phoneme}-${index}`} className={`course-phoneme ${entry.needsPractice ? "bad" : ""}`}>{entry.phoneme} {Math.round(entry.accuracyScore)}</span>)}</div>
          <button className="btn btn-sm mt-12" disabled={assessmentBusy} onClick={retryAssessment}>🎙 {l("Try pronunciation again", "重新朗读并评分")}</button></div>}
        <button className="btn btn-primary btn-lg mt-24" disabled={busy || assessmentBusy || recording} onClick={recognize}>{busy ? l("Saving…", "保存中…") : l("I recognize it — continue", "认识了，继续")}</button>
      </> : session.stage === "pronunciation" && isPronunciationExam(session) ? <>
        <div className="course-term">{(assessmentWord || current).term}</div>
        <div className="course-ipa">{(assessmentWord || current).ipa || l("IPA not available", "音标待补充")}</div>
        {!assessment ? <>
          <p className="muted mt-16">{l(
            "Read the word aloud. The configured pronunciation pass score decides whether it enters the next-round retry pool.",
            "请朗读这个单词。系统配置的单词发音通过分数决定它是否进入下一轮候补池。",
          )}</p>
          <button className={`btn btn-primary btn-lg mt-24 ${recording ? "active" : ""}`}
            disabled={assessmentBusy || Boolean(recordingPurpose && !recording)} onClick={() => void toggleRecording("pronunciation")}>{assessmentBusy
              ? l("Assessing pronunciation…", "正在进行发音评分…")
              : recording ? l("■ Stop and score", "■ 停止并评分") : l("🎙 Start pronunciation exam", "🎙 开始朗读评分")}</button>
          {recording && <AudioWaveform levels={waveform} label={l("Live microphone waveform", "实时麦克风波形")} />}
        </> : <div role="status" className={`course-feedback mt-24 ${assessmentPassed ? "is-correct" : "wrong"}`}>
          <div><b>{assessmentPassed
            ? l(`Passed · ${Math.round(assessment.pronunciationScore)} points`, `通过 · ${Math.round(assessment.pronunciationScore)} 分`)
            : l(`Needs retry · ${Math.round(assessment.pronunciationScore)} points`, `需要重考 · ${Math.round(assessment.pronunciationScore)} 分`)}</b></div>
          <div className="muted mt-4">{l(
            `Word pass score: ${assessmentThreshold} or higher.`,
            `单词通过分数：${assessmentThreshold} 分及以上。`,
          )}</div>
          <div className="course-phonemes">{assessment.phonemes.map((entry, index) => <span
            key={`${entry.phoneme}-${index}`}
            className={`course-phoneme ${entry.needsPractice ? "bad" : ""}`}>{entry.phoneme} {Math.round(entry.accuracyScore)}</span>)}</div>
          <div className="course-result-grid mt-12">
            <div><span>{l("Word", "单词")}</span> <b className="mono">{assessmentWord?.term || current.term}</b></div>
            <div><span>{l("Translation", "翻译")}</span><div className="course-result-translations">{(assessmentWord || current).translations.map((translation) =>
              <em key={translation}>{translation}</em>)}</div></div>
          </div>
          <div className="row wrap-flex mt-16" style={{ justifyContent: "center" }}>
            <button className="btn" onClick={() => void playWord(assessmentWord || current, audioManifest, setAudioNotice, l)}>🔊 {l("Hear the correct pronunciation", "听正确读音")}</button>
            <button className="btn btn-primary" disabled={assessmentBusy}
              onClick={continueAfterPronunciationAssessment}>{assessment.sessionPatch.active
                ? l("Next word", "下一词") : l("Finish exam", "完成考试")}</button>
          </div>
        </div>}
      </> : session.stage === "pronunciation" ? <>
        <p className="muted">{l("Play a pronunciation on the left, then choose its word on the right. Each batch contains up to 5 words.", "先点击左侧任一发音，再从右侧选择对应单词。每批最多 5 个。")}</p>
        <div className="course-match"><div>{audioBatch.map((word, index) => <button key={word.id} aria-label={l(`Play ${word.term}`, `播放 ${word.term}`)} disabled={busy || Boolean(feedback)}
          className={`btn ${activeAudioId === word.id ? "active" : ""} ${feedback?.skill === "pronunciation" && feedback.wordId === word.id ? feedback.result.correct ? "is-correct" : "is-wrong" : ""}`}
          onClick={() => { setActiveAudioId(word.id); setSelectedMatchId(""); void playWord(word, audioManifest, setAudioNotice, l); }}>🔊 {l(`Audio ${index + 1}`, `发音 ${index + 1}`)}</button>)}</div>
          <div>{wordBatch.map((word) => <button key={word.id} className={`btn ${selectedMatchId === word.id ? "selected" : ""} ${feedback?.skill === "pronunciation" && feedback.selectedWordId === word.id ? feedback.result.correct ? "is-correct" : "is-wrong" : ""}`} disabled={busy || Boolean(feedback) || !activeAudioId}
            onClick={() => { const target = session.items.find((item) => item.word.id === activeAudioId)?.word; if (target) { setSelectedMatchId(word.id); void attempt(target, { wordId: word.id }, { selectedWordId: word.id }); } }}>{word.term}</button>)}</div></div>
      </> : session.stage === "translation" ? <>
        <div className="course-term" style={{ fontSize: 34 }}>{current.term}</div><div className="course-ipa">{current.ipa || l("IPA not available", "音标待补充")}</div>
        <div className="course-options">{translationOptions.map((option) => {
          const selectedOption = selected.includes(option);
          const resultClass = feedback?.skill === "translation" && feedback.wordId === current.id && feedback.triggerValue === option
            ? feedback.result.correct ? "is-correct" : "is-wrong"
            : selectedOption && current.translations.includes(option) ? "picked-correct" : "";
          return <button key={option} aria-pressed={selectedOption} disabled={busy || Boolean(feedback)} className={`course-option ${selectedOption ? "selected" : ""} ${resultClass}`}
            onClick={() => chooseTranslation(option)}>{option}</button>;
        })}</div>
        {current.translations.length > 1 && <div className="faint mt-12">{l("Choose every correct translation. A wrong choice is recorded immediately.", "依次选择全部正确翻译；选错会立即记录。")}</div>}
      </> : <>
        <button className="btn" disabled={busy || Boolean(feedback)} onClick={() => playWord(current, audioManifest, setAudioNotice, l)}>🔊 {l("Play pronunciation", "播放发音")}</button>
        {spellingOptions.translationFirst && !translationReady ? <div className="course-spelling-gate mt-24">
          <label className="course-label" htmlFor="spelling-translation-answer">{l(
            "Translate this word before spelling it",
            "拼写前先输入这个词的翻译",
          )}</label>
          <div className="course-voice-input">
            <input id="spelling-translation-answer" className="course-form-field course-spelling-answer"
              style={{ textAlign: "center", fontSize: 20 }} autoFocus
              aria-label={l("Typed translation answer", "键入翻译答案")}
              value={spellingTranslation}
              onChange={(event) => setSpellingTranslation(event.target.value)}
              disabled={busy || spellingTranslationBusy || spellingTranscriptionBusy || Boolean(feedback) || translationRecording}
              onKeyDown={(event) => {
                if (event.key === "Enter" && spellingTranslation.trim()) {
                  void assessSpellingTranslation();
                }
              }} />
            <button
              type="button"
              className={`course-voice-input-button ${translationRecording ? "recording" : ""}`}
              aria-label={translationRecording
                ? l("Stop translation voice input", "停止翻译语音输入")
                : l("Enter translation by voice", "使用语音输入翻译")}
              title={l("Recognize Chinese speech", "识别中文语音")}
              disabled={busy || spellingTranslationBusy || spellingTranscriptionBusy || Boolean(feedback) || Boolean(recordingPurpose && !translationRecording)}
              onClick={() => void toggleRecording("translation")}
            >{translationRecording ? "■" : spellingTranscriptionBusy ? "…" : "🎙"}</button>
          </div>
          {translationRecording && <AudioWaveform levels={waveform} label={l("Live translation voice waveform", "翻译语音实时波形")} />}
          {spellingTranscriptionBusy && <div className="faint mt-8" role="status">{l(
            "Recognizing Chinese speech…",
            "正在识别中文语音…",
          )}</div>}
          <button className="btn btn-primary mt-16"
            disabled={busy || spellingTranslationBusy || spellingTranscriptionBusy || translationRecording || Boolean(feedback) || !spellingTranslation.trim()}
            onClick={() => void assessSpellingTranslation()}>{spellingTranslationBusy
              ? l("Checking meaning…", "正在判断语义…")
              : l("Check translation", "提交翻译")}</button>
          <div className="faint mt-8">{l(
            "Equivalent meanings and natural paraphrases are accepted. The spelling timer starts only after this check passes.",
            "可接受同义表达和自然改写；翻译通过后才开始拼写计时。",
          )}</div>
        </div> : <>
          {spellingOptions.translationFirst && <div className="course-feedback is-correct mt-16">{l(
            "Translation accepted. Now spell the English term.",
            "翻译已通过，现在请拼写英文。",
          )}</div>}
          <input className={`course-form-field course-spelling-answer mt-24 ${feedback?.skill === "spelling" ? feedback.result.correct ? "is-correct" : "is-wrong" : ""}`} style={{ maxWidth: 420, textAlign: "center", fontSize: 20 }} autoFocus
            aria-label={l("Spelling answer", "拼写答案")} value={spelling} onChange={(event) => setSpelling(event.target.value)}
            disabled={busy || Boolean(feedback)} onKeyDown={(event) => { if (event.key === "Enter" && spelling.trim()) submitSpelling(); }} />
          <button className="btn btn-primary mt-16" disabled={busy || Boolean(feedback) || !spelling.trim()} onClick={() => submitSpelling()}>{l("Submit spelling", "提交拼写")}</button>
          <div className="faint mt-8">{spellingOptions.timeLimitEnabled ? l(
            `This word is submitted automatically after ${spellingOptions.timeLimitSeconds} seconds. Correct answers advance automatically; incorrect feedback waits for you.`,
            `每个词将在 ${spellingOptions.timeLimitSeconds} 秒后自动提交；答对自动进入下一题，答错反馈会等待你手动继续。`,
          ) : l("Press Enter or submit once. Correct answers advance automatically; incorrect feedback waits for you.", "按 Enter 或提交一次；答对自动进入下一题，答错反馈会等待你手动继续。")}</div>
        </>}
      </>}
      {feedback && <div role="status" aria-live="polite" className={`course-feedback ${feedback.result.correct ? "is-correct" : "wrong"}`}>
        <div><b>{feedback.result.correct ? l("Correct — continuing…", "回答正确，正在进入下一题…") : l("Incorrect — added to the next-round retry pool", "回答错误，已加入下一轮候补池")}</b></div>
        {feedback.skill === "spelling" && <div className="course-spelling-result mt-12">
          {feedback.translationActual != null && <div className="course-result-note"><b>{l("Your translation", "你的翻译")}</b><span>{feedback.translationActual}</span>
            {feedback.translationFeedback && <small>{feedback.translationFeedback}</small>}</div>}
          {!feedback.result.correct && typeof feedback.result.expected === "string" && <div className="course-result-note">
            <b>{l("Your spelling", "你的拼写")}</b>
            {feedback.actual ? <SpellingDiff expected={feedback.result.expected} actual={feedback.actual} /> : <span>{feedback.translationActual != null
              ? l("Skipped because the translation was incorrect", "因翻译错误而跳过")
              : l("No answer before time expired", "限时结束前未作答")}</span>}
          </div>}
          <div className="course-result-grid">
            <div><span>{feedback.result.correct ? l("Spelling", "拼写") : l("Correct spelling:", "正确拼写：")}</span>{" "}<b className="mono">{typeof feedback.result.expected === "string"
              ? feedback.result.expected : feedbackWord?.term}</b></div>
            <div><span>{l("Translation", "翻译")}</span><div className="course-result-translations">{feedbackWord?.translations.map((translation) =>
              <em key={translation}>{translation}</em>)}</div></div>
          </div>
        </div>}
        {!feedback.result.correct && feedback.skill !== "spelling" && <div className="mt-8">{l("Correct answer:", "正确答案：")} {Array.isArray(feedback.result.expected) ? feedback.result.expected.join(" / ") : feedback.result.expected}</div>}
        {(!feedback.result.correct || error) && <button ref={nextQuestionRef} className="btn btn-sm mt-12" disabled={busy} onClick={continueAfterFeedback}>{busy
          ? l("Loading…", "加载中…")
          : error ? l("Try next question again", "重试下一题") : l("Next question", "下一题")}</button>}
      </div>}
      </>}
    </div>
  </div>;
}
