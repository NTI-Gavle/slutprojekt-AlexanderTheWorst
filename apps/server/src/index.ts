import { Server, Socket } from "socket.io";
import { Session, SubmittedAnswer } from "@repo/session";
import { SignJWT, jwtVerify } from "jose";
import type { QuestionType } from "@repo/ai";

const secret = new TextEncoder().encode(process.env.JWT_SECRET ?? "dev-secret");

// ─── Auth helpers ──────────────────────────────────────────────────────────

async function issueToken(fingerprint: string): Promise<string> {
  return new SignJWT({ fingerprint })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(secret);
}

async function verifyToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload.fingerprint as string;
  } catch {
    return null;
  }
}

// ─── Round timer management ────────────────────────────────────────────────

// Map of roomId -> { phase: "answering"|"voting", timeout }
const roundTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearRoomTimer(roomId: string) {
  const t = roundTimers.get(roomId);
  if (t) clearTimeout(t);
  roundTimers.delete(roomId);
}

// ─── Safe round strip ─────────────────────────────────────────────────────

function normalizeForVoting(answer: SubmittedAnswer): SubmittedAnswer {
  let text = answer.answer.trim();

  // Strip leading/trailing special characters
  text = text.replace(/^[*_~`]+|[*_~`]+$/g, "").trim();

  // Fix double spaces
  text = text.replace(/\s{2,}/g, " ");

  // Fix spacing around punctuation
  text = text.replace(/\s*([:\-,;!?])\s*/g, "$1 ").trim();

  // Strip trailing period
  text = text.replace(/\.$/, "");

  // Smart quotes / weird unicode quotes to plain
  text = text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

  // All caps → title-ish: lowercase everything first, then capitalize first letter
  if (text === text.toUpperCase() && text.length > 2) {
    text = text.toLowerCase();
  }

  // Standalone i → I
  text = text.replace(/\bi\b/g, "I");

  // Capitalize first letter
  text = text.charAt(0).toUpperCase() + text.slice(1);

  return { ...answer, answer: text };
}

/** Remove isCorrect and playerName from answers before broadcasting to voters */
function sanitizeForVoting(round: any) {
  console.log(round);
  return {
    ...round,
    submittedAnswers: round.submittedAnswers
      .map(({ isCorrect: _ic, playerName: _pn, ...rest }: any) => rest)
      .map(normalizeForVoting),
  };
}

// ─── Question broadcast ───────────────────────────────────────────────────

async function sendQuestionToSocket(
  socket: Socket,
  session: Session,
  questionIndex: number
) {
  const question = await session.getQuestion(questionIndex);

  const {
    answer: _answer,
    blendedAnswer: _blended,
    ...safeQuestion
  } = question;

  const round = await session.getRound(questionIndex);

  socket.emit("round_question", {
    question: safeQuestion,
    questionIndex,
    round,
  });
}

async function broadcastQuestion(
  io: Server,
  session: Session,
  questionIndex: number
) {
  try {
    const question = await session.getQuestion(questionIndex);
    // Strip the real answer before sending
    const {
      answer: _answer,
      blendedAnswer: _blended,
      ...safeQuestion
    } = question;

    const round = await session.getRound(questionIndex);

    io.to(session.id).emit("round_question", {
      question: safeQuestion,
      questionIndex,
      round,
    });
  } catch (err) {
    console.log(err);
  }
}

// ─── Timer helpers (inside connection scope to access io + session) ────────

// ── OUTSIDE io.on("connection") ──────────────────────────────────────────

function startAnsweringTimer(
  io: Server,
  roomId: string,
  questionIndex: number
) {
  clearRoomTimer(roomId);
  const t = setTimeout(async () => {
    try {
      const session = await Session.load(roomId);
      if (!session) return;

      const round = await session.getRound(questionIndex);
      if (round?.phase !== "answering" && round !== null) return;

      const data = await session.getData();
      if (data.currentQuestion !== questionIndex) return; // already moved on, bail

      const forced = await session.forceVoting(questionIndex);
      io.to(roomId).emit("round_voting", { round: sanitizeForVoting(forced) });
      startVotingTimer(io, roomId, questionIndex);
    } catch (e) {
      console.error("answering timer:", e);
    }
  }, 32_000);
  roundTimers.set(roomId, t);
}

function startVotingTimer(io: Server, roomId: string, questionIndex: number) {
  clearRoomTimer(roomId);
  const t = setTimeout(async () => {
    try {
      const session = await Session.load(roomId);
      if (!session) return;
      const data = await session.getData();
      if (data.currentQuestion !== questionIndex) return;

      const round = await session.getRound(questionIndex);
      if (round?.phase === "results") return;

      const forced = await session.forceResults(questionIndex);
      const updated = await session.getData();
      io.to(roomId).emit("round_results", {
        round: forced,
        scores: updated.players,
      });
    } catch (e) {
      console.error("voting timer:", e);
    }
  }, 22_000);
  roundTimers.set(roomId, t);
}

// ── INSIDE io.on("connection") just update the call sites ────────────────
// startAnsweringTimer(session.id, 0)       → startAnsweringTimer(io, session.id, 0)
// startVotingTimer(session.id, index)      → startVotingTimer(io, session.id, index)

// ─── Server ───────────────────────────────────────────────────────────────

const io = new Server(9999, {
  cors: {
    origin: process.env.CLIENT_ORIGIN ?? "https://app-game.backman.lol",
    methods: ["GET", "POST"],
  },
});

io.on("connection", async (socket: Socket) => {
  // ── Auth / fingerprint ──────────────────────────────────────────────────
  const token = socket.handshake.auth.token as string | undefined;
  let fingerprint: string;

  if (token) {
    const verified = await verifyToken(token);
    fingerprint = verified ?? crypto.randomUUID();
    if (!verified) socket.emit("token_issued", await issueToken(fingerprint));
  } else {
    fingerprint = crypto.randomUUID();
    socket.emit("token_issued", await issueToken(fingerprint));
  }

  socket.data.fingerprint = fingerprint;
  console.log("connect:", fingerprint.slice(0, 8));

  // ── Reconnection recovery ───────────────────────────────────────────────
  const hostSession = await Session.findByHostId(fingerprint);
  const playerSession = await Session.findByPlayerId(fingerprint);

  try {
    if (hostSession) {
      const data = await hostSession.getData();
      socket.data.roomId = hostSession.id;
      socket.join(hostSession.id);
      socket.emit("host_recovered", {
        id: hostSession.id,
        code: hostSession.code,
        players: data.players,
        status: data.status,
        questionIndex: data.currentQuestion,
        totalQuestions: data.totalQuestions,
        theme: data.theme,
      });

      // If game was active, resend current question
      if (data.status === "active") {
        await sendQuestionToSocket(socket, hostSession, data.currentQuestion);
        const round = await hostSession.getRound(data.currentQuestion);
        if (!round) return;

        if (round?.phase === "voting") {
          socket.emit("round_voting", { round: sanitizeForVoting(round) });
        } else if (round?.phase === "results") {
          socket.emit("round_results", { round, scores: data.players });
        }
      }
    } else if (playerSession) {
      const data = await playerSession.getData();
      const player = data.players[fingerprint];
      if (player) {
        await playerSession.reconnectPlayer(fingerprint);
        socket.data.roomId = playerSession.id;
        socket.join(playerSession.id);

        socket.emit("player_recovered", {
          id: playerSession.id,
          name: player.name,
          score: player.score,
          status: data.status,
          questionIndex: data.currentQuestion,
          totalQuestions: data.totalQuestions,
        });

        io.to(playerSession.id).emit("player_joined", {
          players: (await playerSession.getData()).players,
        });

        // If game was active, resend current question state
        if (data.status === "active") {
          await sendQuestionToSocket(socket, playerSession, data.currentQuestion);
          const round = await playerSession.getRound(data.currentQuestion);
          if (round?.phase === "voting") {
            socket.emit("round_voting", { round: sanitizeForVoting(round) });
          } else if (round?.phase === "results") {
            socket.emit("round_results", { round, scores: data.players });
          }
        }
      }
    }
  } catch (err) {
    console.log((err as Error).message);
  }

  // ── create_room ─────────────────────────────────────────────────────────
  socket.on(
    "create_room",
    async ({
      theme,
      totalQuestions = 20,
      aiBluffs = 1,
    }: {
      theme?: QuestionType;
      totalQuestions?: number;
      aiBluffs?: number;
    } = {}) => {
      try {
        const session = await Session.create(
          fingerprint,
          totalQuestions,
          Math.min(aiBluffs, 20),
          theme ?? "music"
        );
        socket.data.roomId = session.id;
        socket.join(session.id);
        socket.emit("created_room", {
          id: session.id,
          code: session.code,
          totalQuestions,
          aiBluffs,
          players: {},
          theme: theme ?? "music",
        });
      } catch (e) {
        socket.emit("error", String(e));
      }
    }
  );

  // ── join_room ────────────────────────────────────────────────────────────
  socket.on(
    "join_room",
    async ({ code, name }: { code: string; name: string }) => {
      try {
        const session = await Session.loadByCode(code);
        if (!session) return socket.emit("error", "Room not found");

        const data = await session.getData();
        if (data.status !== "waiting")
          return socket.emit("error", "Game already started");

        await session.addPlayer({ id: fingerprint, name, score: 0 });
        socket.data.roomId = session.id;
        socket.join(session.id);

        socket.emit("joined_room", {
          id: session.id,
          totalQuestions: data.totalQuestions,
          aiBluffs: data.aiBluffs,
          name,
        });
        io.to(session.id).emit("player_joined", {
          players: (await session.getData()).players,
        });
      } catch (e) {
        console.error("join_room:", e);
        socket.emit("error", String(e));
      }
    }
  );

  // ── start_game ───────────────────────────────────────────────────────────
  socket.on("start_game", async () => {
    try {
      const session = await Session.load(socket.data.roomId);
      if (!session?.isHost(fingerprint))
        return socket.emit("error", "Only host can start");

      const data = await session.getData();
      if (Object.keys(data.players).length < 1)
        return socket.emit("error", "Need at least 1 player");

      await session.start();
      await session.startRound(0);
      io.to(socket.data.roomId).emit("game_started");
      await broadcastQuestion(io, session, 0);
      startAnsweringTimer(io, session.id, 0);

      setTimeout(() => session.destroy, 60_000 * 60);
    } catch (e) {
      socket.emit("error", String(e));
    }
  });

  // ── submit_answer ────────────────────────────────────────────────────────
  socket.on("submit_answer", async ({ answer }: { answer: string }) => {
    try {
      const session = await Session.load(socket.data.roomId);
      if (!session) return;

      const data = await session.getData();

      const question = await session.getQuestion(data.currentQuestion);

      if (question.answer.toLowerCase() == answer.toLowerCase()) {
        return socket.emit("error", "Boringgg, write a fake one instead.");
      }

      const round = await session.submitAnswer(
        data.currentQuestion,
        fingerprint,
        answer
      );

      if (round.phase === "voting") {
        clearRoomTimer(session.id);
        io.to(socket.data.roomId).emit("round_voting", {
          round: sanitizeForVoting(round),
        });
        startVotingTimer(io, session.id, data.currentQuestion);
        session.prefetch(data.currentQuestion + 1, 2);
      }

      socket.emit("answer_submitted", {
        answer,
      });
    } catch (e) {
      console.error("submit_answer:", e);
      socket.emit("error", String(e));
    }
  });

  // ── submit_vote ──────────────────────────────────────────────────────────
  socket.on(
    "submit_vote",
    async ({ votedPlayerId }: { votedPlayerId: string }) => {
      try {
        const session = await Session.load(socket.data.roomId);
        if (!session) return;

        const data = await session.getData();

        console.log(votedPlayerId, socket.data.fingerprint);
        if (votedPlayerId == socket.data.fingerprint)
          return socket.emit("error", "You cannot vote for yourself");

        const round = await session.submitVote(
          data.currentQuestion,
          fingerprint,
          votedPlayerId
        );

        socket.emit("vote_submitted", votedPlayerId);

        if (round.phase === "results") {
          clearRoomTimer(session.id);
          const updated = await session.getData();
          io.to(socket.data.roomId).emit("round_results", {
            round,
            scores: updated.players,
          });
        }
      } catch (e) {
        console.error("submit_vote:", e);
        socket.emit("error", String(e));
      }
    }
  );

  // ── next_round ───────────────────────────────────────────────────────────
  socket.on("next_round", async () => {
    try {
      const session = await Session.load(socket.data.roomId);
      if (!session?.isHost(fingerprint))
        return socket.emit("error", "Only host can advance");

      const data = await session.getData();
      const nextIndex = data.currentQuestion + 1;

      if (nextIndex >= data.totalQuestions) {
        await session.finish();
        const final = await session.getData();
        io.to(socket.data.roomId).emit("game_over", { scores: final.players });
        return;
      }

      await session.update({ currentQuestion: nextIndex });
      await session.startRound(nextIndex);
      await broadcastQuestion(io, session, nextIndex);
      startAnsweringTimer(io, session.id, nextIndex);
    } catch (e) {
      socket.emit("error", String(e));
    }
  });

  // ── close_room ───────────────────────────────────────────────────────────
  socket.on("close_room", async () => {
    try {
      const session = await Session.load(socket.data.roomId);
      if (!session?.isHost(fingerprint))
        return socket.emit("error", "Only host can close");

      clearRoomTimer(session.id);
      io.to(socket.data.roomId).emit("room_closed");
      await session.destroy();
      socket.data.roomId = null;
    } catch (e) {
      socket.emit("error", String(e));
    }
  });

  // ── leave_game ───────────────────────────────────────────────────────────
  socket.on("leave_game", async () => {
    try {
      const session = await Session.load(socket.data.roomId);
      if (!session) return;

      await session.removePlayer(fingerprint);
      socket.leave(socket.data.roomId);
      socket.emit("left_game");

      const data = await session.getData();
      io.to(socket.data.roomId).emit("player_left", { players: data.players });
      socket.data.roomId = null;
    } catch (e) {
      socket.emit("error", String(e));
    }
  });

  // ── disconnect ───────────────────────────────────────────────────────────
  socket.on("disconnect", async () => {
    if (!socket.data.roomId) return;
    try {
      const session = await Session.load(socket.data.roomId);
      if (!session) return;

      if (!session.isHost(fingerprint)) {
        await session.markDisconnected(fingerprint);
        io.to(socket.data.roomId).emit("player_disconnected", {
          playerId: fingerprint,
        });

        // Check if all remaining connected players have answered/voted to unblock
        const data = await session.getData();
        if (data.status === "active") {
          const round = await session.getRound(data.currentQuestion);
          if (round?.phase === "answering") {
            const activePlayers = Object.values(data.players).filter(
              (p) => !p.disconnected
            );
            const answered = round.submittedAnswers.filter(
              (a) => a.playerId !== "correct" && a.playerId !== "ai"
            );
            if (answered.length >= activePlayers.length) {
              clearRoomTimer(session.id);
              const updated = await session.forceVoting(data.currentQuestion);
              io.to(session.id).emit("round_voting", {
                round: sanitizeForVoting(updated),
              });
              startVotingTimer(io, session.id, data.currentQuestion);
            }
          }
        }
      }
    } catch (e) {
      console.error("disconnect:", e);
    }
  });
});

console.log("Socket server running on :9999");
