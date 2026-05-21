import { generateQuestion, type QuestionType } from "@repo/ai";
import { redis } from "@repo/redis";

export type SessionStatus = "waiting" | "active" | "finished";

export type Player = {
  id: string;
  name: string;
  score: number;
  disconnected?: boolean;
};

export type SessionData = {
  id: string;
  code: string;
  host: string;
  status: SessionStatus;
  players: Record<string, Player>; // does NOT include host
  currentQuestion: number;
  totalQuestions: number;
  aiBluffs: number;
  theme: QuestionType;
  previousQuestions: string[];
};

export type RoundPhase = "answering" | "voting" | "results";

export type SubmittedAnswer = {
  playerId: string;
  playerName: string;
  type: "ai" | "player";
  answer: string;
  isCorrect: boolean;
};

export type RoundData = {
  phase: RoundPhase;
  phaseStartedAt: number;
  phaseDuration: number;
  submittedAnswers: SubmittedAnswer[];
  votes: Record<string, string>; // voterId -> votedPlayerId
};

export class Session {
  id: string;
  code: string;
  host: string;

  constructor(id: string, code: string, hostId: string) {
    this.id = id;
    this.code = code;
    this.host = hostId;
  }

  // ─── Static constructors ───────────────────────────────────────────────────

  static async create(
    hostId: string,
    totalQuestions = 20,
    aiBluffs = 1,
    theme: QuestionType = "music"
  ): Promise<Session> {
    const id = crypto.randomUUID();
    const code = Array.from({ length: 6 }, () =>
      Math.floor(Math.random() * 9)
    ).join("");

    const data: SessionData = {
      id,
      code,
      host: hostId,
      status: "waiting",
      players: {},
      currentQuestion: 0,
      totalQuestions,
      aiBluffs,
      theme,
      previousQuestions: [],
    };

    await redis.set(`session:${id}`, JSON.stringify(data));
    await redis.set(`session:code:${code}`, id);
    return new Session(id, code, hostId);
  }

  static async load(id: string): Promise<Session | null> {
    if (!id) return null;
    const raw = await redis.get(`session:${id}`);
    if (!raw) return null;
    const data: SessionData = JSON.parse(raw);
    return new Session(id, data.code, data.host);
  }

  static async loadByCode(code: string): Promise<Session | null> {
    const id = await redis.get(`session:code:${code}`);
    if (!id) return null;
    return Session.load(id);
  }

  static async findByHostId(hostId: string): Promise<Session | null> {
    const keys = await redis.keys("session:*");
    const sessionKeys = keys.filter((k) => /^session:[^:]+$/.test(k));

    for (const key of sessionKeys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const data: SessionData = JSON.parse(raw);
      if (data.host === hostId) {
        return new Session(data.id, data.code, data.host);
      }
    }
    return null;
  }

  static async findByPlayerId(playerId: string): Promise<Session | null> {
    const keys = await redis.keys("session:*");
    const sessionKeys = keys.filter((k) => /^session:[^:]+$/.test(k));

    for (const key of sessionKeys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const data: SessionData = JSON.parse(raw);
      if (data.players[playerId]) {
        return new Session(data.id, data.code, data.host);
      }
    }
    return null;
  }

  // ─── Data helpers ──────────────────────────────────────────────────────────

  isHost(id: string): boolean {
    return this.host === id;
  }

  async getData(): Promise<SessionData> {
    const raw = await redis.get(`session:${this.id}`);
    if (!raw) throw new Error("Session not found");
    return JSON.parse(raw);
  }

  async update(patch: Partial<SessionData>) {
    const current = await this.getData();
    await redis.set(
      `session:${this.id}`,
      JSON.stringify({ ...current, ...patch })
    );
  }

  // ─── Players ───────────────────────────────────────────────────────────────

  async addPlayer(player: Player) {
    const data = await this.getData();
    if (data.status !== "waiting") throw new Error("Game already started");
    data.players[player.id] = player;
    await this.update({ players: data.players });
  }

  async removePlayer(playerId: string) {
    const data = await this.getData();
    delete data.players[playerId];
    await this.update({ players: data.players });
  }

  async reconnectPlayer(playerId: string) {
    const data = await this.getData();
    if (data.players[playerId]) {
      data.players[playerId].disconnected = false;
      await this.update({ players: data.players });
    }
  }

  async markDisconnected(playerId: string) {
    const data = await this.getData();
    if (data.players[playerId]) {
      data.players[playerId].disconnected = true;
      await this.update({ players: data.players });
    }
  }

  async addScore(playerId: string, points: number) {
    const data = await this.getData();
    if (!data.players[playerId]) throw new Error("Player not found");
    data.players[playerId].score += points;
    await this.update({ players: data.players });
  }

  // ─── Questions ─────────────────────────────────────────────────────────────

  async generateAndCacheQuestion(questionIndex: number) {
    const key = `session:${this.id}:question:${questionIndex}`;
    const existing = await redis.get(key);
    if (existing) return JSON.parse(existing);

    // Re-check after potential concurrent write
    const data = await this.getData();

    const oldAnswers: string[] = [];
    for (let oldRound = questionIndex - 1; oldRound >= 0; oldRound--) {
      const round = await this.getRound(oldRound);
      round?.submittedAnswers
        .filter((q) => q.type !== "ai")
        .forEach((answer) => oldAnswers.push(answer.answer));
    }

    console.log(oldAnswers);

    const question = await generateQuestion(
      data.theme,
      data.aiBluffs,
      data.previousQuestions.slice(-10),
      oldAnswers
    );

    // Only cache if still empty (another process may have written it)
    const stillEmpty = !(await redis.get(key));
    if (stillEmpty) {
      await redis.set(key, JSON.stringify(question));
      await this.update({
        previousQuestions: [...data.previousQuestions, question.question].slice(
          -10
        ),
      });
    }
    return question;
  }

  async prefetch(fromIndex: number, count = 2) {
    for (let i = 0; i < count; i++) {
      await this.generateAndCacheQuestion(fromIndex + i); // sequential, not parallel
    }
  }

  async getQuestion(questionIndex: number) {
    const raw = await redis.get(`session:${this.id}:question:${questionIndex}`);
    if (!raw) return this.generateAndCacheQuestion(questionIndex);
    return JSON.parse(raw);
  }

  // ─── Round logic ───────────────────────────────────────────────────────────

  async startRound(questionIndex: number) {
    const round: RoundData = {
      phase: "answering",
      phaseStartedAt: Date.now(),
      phaseDuration: 30000, // 30s
      submittedAnswers: [],
      votes: {},
    };

    await this.saveRound(questionIndex, round);
  }

  async getRound(questionIndex: number): Promise<RoundData | null> {
    const raw = await redis.get(`session:${this.id}:round:${questionIndex}`);
    return raw ? JSON.parse(raw) : null;
  }

  private async saveRound(questionIndex: number, round: RoundData) {
    await redis.set(
      `session:${this.id}:round:${questionIndex}`,
      JSON.stringify(round)
    );
  }

  /**
   * Submit a player's answer. Returns the updated round.
   * When all active (connected) players have answered, transitions to voting phase
   * and injects the AI's blended fake answer + the real answer randomly shuffled in.
   */
  async submitAnswer(
    questionIndex: number,
    playerId: string,
    answer: string
  ): Promise<RoundData> {
    const data = await this.getData();
    const key = `session:${this.id}:round:${questionIndex}`;

    const raw = await redis.get(key);
    const round: RoundData = raw
      ? JSON.parse(raw)
      : {
          phase: "answering",
          phaseStartedAt: Date.now(),
          phaseDuration: 30,
          submittedAnswers: [],
          votes: {},
        };

    if (!data.players[playerId]) throw new Error("Player not found");
    if (round.submittedAnswers.find((a) => a.playerId === playerId)) {
      throw new Error("Already answered");
    }

    const question = await this.getQuestion(questionIndex);
    round.submittedAnswers.push({
      playerId,
      playerName: data.players[playerId].name,
      answer,
      type: "player",
      isCorrect:
        answer.toLowerCase().trim() === question.answer.toLowerCase().trim(),
    });

    // Count only connected players
    const activePlayers = Object.values(data.players).filter(
      (p) => !p.disconnected
    );
    const allAnswered = round.submittedAnswers.length >= activePlayers.length;

    if (allAnswered) {
      round.phase = "voting";
      round.phaseStartedAt = Date.now();
      round.phaseDuration = 20000; // e.g. 20s

      // Inject AI's blended fake answer
      console.log(question);
      if (question.blendedAnswer) {
        console.log(question.blendedAnswer);
        for (let answerIndex in question.blendedAnswer) {
          const answer = question.blendedAnswer[answerIndex];
          console.log(answer, answerIndex);

          round.submittedAnswers.push({
            playerId: `ai_${answerIndex}`,
            playerName: "AI",
            type: "ai",
            answer: answer,
            isCorrect: false,
          });
        }
      }

      // Inject the real answer
      round.submittedAnswers.push({
        playerId: "correct",
        playerName: "correct",
        answer: question.answer,
        type: "ai",
        isCorrect: true,
      });

      // Shuffle so real answer isn't always last
      round.submittedAnswers = round.submittedAnswers.sort(
        () => Math.random() - 0.5
      );
    }

    await this.saveRound(questionIndex, round);
    return round;
  }

  /**
   * Force-transition to voting even if not all players answered (timeout).
   * Adds the correct answer and AI blended answer, then transitions.
   */
  async forceVoting(questionIndex: number): Promise<RoundData> {
    const key = `session:${this.id}:round:${questionIndex}`;
    const raw = await redis.get(key);
    const round: RoundData = raw
      ? JSON.parse(raw)
      : {
          phase: "answering",
          updatedAt: Date.now(),
          submittedAnswers: [],
          votes: {},
        };

    if (round.phase !== "answering") return round;

    const question = await this.getQuestion(questionIndex);

    if (question.blendedAnswer) {
      for (let answerIndex in question.blendedAnswer) {
        const answer = question.blendedAnswer[answerIndex];
        round.submittedAnswers.push({
          playerId: `ai_${answerIndex}`,
          playerName: "AI",
          type: "ai",
          answer: answer,
          isCorrect: false,
        });
      }
    }

    round.submittedAnswers.push({
      playerId: "correct",
      playerName: "correct",
      type: "ai",
      answer: question.answer,
      isCorrect: true,
    });

    round.submittedAnswers = round.submittedAnswers.sort(
      () => Math.random() - 0.5
    );
    round.phase = "voting";
    round.phaseStartedAt = Date.now();
    round.phaseDuration = 20000;

    await this.saveRound(questionIndex, round);
    return round;
  }

  /**
   * Force-transition to results even if not all players voted (timeout).
   */
  async forceResults(questionIndex: number): Promise<RoundData> {
    const raw = await redis.get(`session:${this.id}:round:${questionIndex}`);
    if (!raw) throw new Error("Round not found");

    const round: RoundData = JSON.parse(raw);
    if (round.phase === "results") return round;

    round.phase = "results";
    round.phaseStartedAt = Date.now();
    round.phaseDuration = 10000;

    await this.saveRound(questionIndex, round);

    const data = await this.getData();
    return this.calculateScores(questionIndex, round, data);
  }

  async submitVote(
    questionIndex: number,
    voterId: string,
    votedPlayerId: string
  ): Promise<RoundData> {
    const key = `session:${this.id}:round:${questionIndex}`;
    const raw = await redis.get(key);
    if (!raw) throw new Error("Round not found");

    const round: RoundData = JSON.parse(raw);
    // if (voterId === votedPlayerId) throw new Error("Cannot vote for yourself");
    if (round.votes[voterId]) throw new Error("Already voted");

    round.votes[voterId] = votedPlayerId;

    const data = await this.getData();
    const activePlayers = Object.values(data.players).filter(
      (p) => !p.disconnected
    );
    const allVoted = Object.keys(round.votes).length >= activePlayers.length;

    if (allVoted) {
      round.phase = "results";
      round.phaseStartedAt = Date.now();
      round.phaseDuration = 10000;
      await this.saveRound(questionIndex, round);
      return this.calculateScores(questionIndex, round, data);
    }

    await this.saveRound(questionIndex, round);
    return round;
  }

  async calculateScores(
    questionIndex: number,
    round: RoundData,
    data: SessionData
  ): Promise<RoundData> {
    for (const [voterId, votedPlayerId] of Object.entries(round.votes)) {
      const voted = round.submittedAnswers.find(
        (a) => a.playerId === votedPlayerId
      );
      if (!voted) continue;

      if (voted.isCorrect) {
        // Voted for real answer
        if (data.players[voterId]) await this.addScore(voterId, 1000);
      } else {
        // Fooled by a fake — reward the faker (not "ai" or "correct")
        if (
          votedPlayerId !== "ai" &&
          votedPlayerId !== "correct" &&
          data.players[votedPlayerId]
        ) {
          await this.addScore(votedPlayerId, 500);
        }
      }
    }

    await this.saveRound(questionIndex, round);
    return round;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    console.log("I was prefetched");
    await this.update({ status: "active", currentQuestion: 0 });
    await this.prefetch(0, 3);
  }

  async finish() {
    await this.update({ status: "finished" });
  }

  async destroy() {
    const data = await this.getData();
    const keys = [`session:${this.id}`, `session:code:${this.code}`];
    for (let i = 0; i < data.totalQuestions; i++) {
      keys.push(`session:${this.id}:question:${i}`);
      keys.push(`session:${this.id}:round:${i}`);
    }
    await redis.del(keys);
  }
}
