<script lang="ts">
	import { io } from 'socket.io-client';
	import { onMount } from 'svelte';
	import { writable, derived } from 'svelte/store';

	// ─── Types ────────────────────────────────────────────────────────────────

	type Player = { id: string; name: string; score: number; disconnected?: boolean };

	type SubmittedAnswer = {
		playerId: string;
		answer: string;
		type: 'ai' | 'player';
		isCorrect?: boolean;
	};

	type RoundData = {
		phase: 'answering' | 'voting' | 'results';
		phaseStartedAt: number;
		phaseDuration: number;
		submittedAnswers: SubmittedAnswer[];
		votes: Record<string, string>;
	};

	type Question = {
		type: 'lyrics' | 'artist' | 'factual';
		question: string;
		genre?: string;
		era?: string;
		theme: string;
	};

	type Theme = 'music' | 'film' | 'geography' | 'history' | 'science' | 'sport' | 'random';

	type Screen =
		| 'lobby'
		| 'host-waiting'
		| 'waiting'
		| 'host-question' // host big screen — question display
		| 'host-voting' // host big screen — voting in progress
		| 'host-results' // host big screen — round results
		| 'answering' // player — submitting answer
		| 'voting' // player — picking real answer
		| 'results' // player — seeing results
		| 'finished';

	type GameState = {
		screen: Screen;
		roomId: string | null;
		roomCode: string | null;
		isHost: boolean;
		playerName: string | null;
		players: Record<string, Player>;
		question: Question | null;
		round: RoundData | null;
		questionIndex: number;
		totalQuestions: number;
		aiBluffs: number;
		myAnswer: string | null;
		myVote: string | null;
		timeLeft: number;
		theme: Theme;
	};

	const RESET: GameState = {
		screen: 'lobby',
		roomId: null,
		roomCode: null,
		isHost: false,
		playerName: null,
		players: {},
		question: null,
		round: null,
		questionIndex: 0,
		totalQuestions: 20,
		aiBluffs: 1,
		myAnswer: null,
		myVote: null,
		timeLeft: 30,
		theme: 'music'
	};

	const game = writable<GameState>({ ...RESET });
	const sortedPlayers = derived(game, ($g) =>
		Object.values($g.players).sort((a, b) => b.score - a.score)
	);

	// ─── UI state ─────────────────────────────────────────────────────────────

	const CODE_LENGTH = 6;
	let segments = $state<string[]>(new Array(CODE_LENGTH).fill(''));
	let inputRefs = $state<HTMLInputElement[]>([]);
	let inputPlayerName = $state('');
	let inputAnswer = $state('');
	let selectedTheme = $state<Theme>('music');
	let questionsAmount = $state<number>(20);
	let aiBluffs = $state<number>(1);
	let client: ReturnType<typeof io>;
	let timerInterval: ReturnType<typeof setInterval>;

	const THEMES: { id: Theme; label: string; icon: string }[] = [
		{ id: 'music', label: 'Music', icon: '🎵' },
		{ id: 'film', label: 'Film', icon: '🎬' },
		{ id: 'geography', label: 'Geography', icon: '🌍' },
		{ id: 'history', label: 'History', icon: '📜' },
		{ id: 'science', label: 'Science', icon: '🔬' },
		{ id: 'sport', label: 'Sport', icon: '⚽' },
		{ id: 'random', label: 'Random', icon: '🎲' }
	];

	// ─── Code input helpers ───────────────────────────────────────────────────

	function focusAt(index: number) {
		inputRefs[Math.max(0, Math.min(CODE_LENGTH - 1, index))]?.focus();
	}

	function handleInput(e: Event, i: number) {
		const val = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(-1);
		segments[i] = val;
		if (val) focusAt(i + 1);
	}

	function handleKeydown(e: KeyboardEvent, i: number) {
		if (e.key === 'Backspace') {
			if (segments[i]) segments[i] = '';
			else {
				focusAt(i - 1);
				segments[Math.max(0, i - 1)] = '';
			}
		} else if (e.key === 'ArrowLeft') focusAt(i - 1);
		else if (e.key === 'ArrowRight') focusAt(i + 1);
	}

	function handlePaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
		if (!text) return;
		e.preventDefault();
		segments = [...text.split(''), ...new Array(CODE_LENGTH - text.length).fill('')];
		focusAt(Math.min(text.length, CODE_LENGTH - 1));
	}

	$effect(() => {
		inputRoomCode = segments.join('');
	});
	let inputRoomCode = $state('');

	// ─── Timer ────────────────────────────────────────────────────────────────

	function startPhaseTimer(round: RoundData) {
		clearInterval(timerInterval);

		timerInterval = setInterval(() => {
			const now = Date.now();
			const elapsed = now - round.phaseStartedAt;
			const remaining = round.phaseDuration - elapsed;

			game.update((g) => ({
				...g,
				timeLeft: Math.max(0, Math.ceil(remaining / 1000))
			}));

			console.log(Math.max(0, Math.ceil(remaining / 1000)));

			if (remaining <= 0) {
				clearInterval(timerInterval);
			}
		}, 100);
	}

	// ─── Actions ──────────────────────────────────────────────────────────────

	function submitAnswer() {
		if (!inputAnswer.trim()) return;
		client.emit('submit_answer', { answer: inputAnswer });
	}

	function submitVote(playerId: string) {
		client.emit('submit_vote', { votedPlayerId: playerId });
	}

	// ─── Mount / socket ───────────────────────────────────────────────────────

	onMount(() => {
		const token = localStorage.getItem('bluffify_token');
		client = io(import.meta.env.VITE_SERVER_URL ?? 'https://app-server.backman.lol', {
			auth: { token }
		});

		client.on('token_issued', (t: string) => localStorage.setItem('bluffify_token', t));

		// ── Recovery ──────────────────────────────────────────────────────────

		client.on(
			'host_recovered',
			({ id, code, players, status, questionIndex, totalQuestions, theme }: any) => {
				game.update((g) => ({
					...g,
					isHost: true,
					roomId: id,
					roomCode: code,
					players: players ?? {},
					questionIndex,
					totalQuestions,
					theme,
					screen: status === 'waiting' ? 'host-waiting' : 'host-question'
				}));
			}
		);

		client.on(
			'player_recovered',
			({ id, name, score, status, questionIndex, totalQuestions }: any) => {
				game.update((g) => ({
					...g,
					isHost: false,
					roomId: id,
					playerName: name,
					questionIndex,
					totalQuestions,
					screen: status === 'waiting' ? 'waiting' : 'answering'
				}));
			}
		);

		// ── Lobby ─────────────────────────────────────────────────────────────

		client.on('created_room', ({ id, code, players, theme, totalQuestions, aiBluffs }: any) => {
			game.set({
				...RESET,
				screen: 'host-waiting',
				roomId: id,
				roomCode: code,
				totalQuestions,
				aiBluffs,
				isHost: true,
				players: players ?? {},
				theme
			});
		});

		client.on('joined_room', ({ id, name, totalQuestions }: any) => {
			game.update((g) => ({
				...g,
				screen: 'waiting',
				roomId: id,
				totalQuestions,
				playerName: name
			}));
		});

		client.on('player_joined', ({ players }: any) => {
			game.update((g) => ({ ...g, players }));
		});

		client.on('player_left', ({ players }: any) => {
			game.update((g) => ({ ...g, players }));
		});

		client.on('player_disconnected', ({ playerId }: any) => {
			game.update((g) => ({
				...g,
				players: {
					...g.players,
					[playerId]: { ...g.players[playerId], disconnected: true }
				}
			}));
		});

		// ── Game ──────────────────────────────────────────────────────────────

		client.on('answer_submitted', ({ answer }: { answer: string }) => {
			game.update((g) => ({ ...g, myAnswer: answer }));
			inputAnswer = '';
		});

		client.on('vote_submitted', (votedPlayerId) => {
			game.update((g) => ({ ...g, myVote: votedPlayerId }));
		});

		client.on('game_started', ({ round }: any) => {
			console.log(round);
			game.update((g) => ({ ...g, screen: g.isHost ? 'host-question' : 'answering' }));
		});

		client.on('round_question', ({ round, question, questionIndex }: any) => {
			console.log(round);
			clearInterval(timerInterval);
			game.update((g) => ({
				...g,
				screen: g.isHost ? 'host-question' : 'answering',
				question,
				questionIndex,
				myAnswer: null,
				myVote: null,
				round
			}));
			if (round) startPhaseTimer(round);
		});

		client.on('round_voting', ({ round }: any) => {
			console.log(round);
			clearInterval(timerInterval);
			game.update((g) => ({
				...g,
				screen: g.isHost ? 'host-voting' : 'voting',
				round
			}));
			if (round) startPhaseTimer(round);
		});

		client.on('round_results', ({ round, scores }: any) => {
			console.log(round);
			clearInterval(timerInterval);
			game.update((g) => ({
				...g,
				screen: g.isHost ? 'host-results' : 'results',
				round,
				players: scores
			}));
		});

		client.on('game_over', ({ scores }: any) => {
			clearInterval(timerInterval);
			game.update((g) => ({ ...g, screen: 'finished', players: scores }));
		});

		client.on('left_game', () => game.set({ ...RESET }));
		client.on('room_closed', () => game.set({ ...RESET }));
		client.on('error', (msg: string) => alert(`Error: ${msg}`));

		return () => {
			client.disconnect();
			clearInterval(timerInterval);
		};
	});
</script>

<main class="flex flex-col gap-[20px]">
	{#if $game.roomId && $game.screen !== 'lobby' && $game.screen !== 'waiting' && $game.screen !== 'host-waiting'}
		<div class="flex w-full items-start">
			<button
				onclick={() => {
					console.log($game);
					if ($game.isHost) client.emit('close_room');
					else client.emit('leave_game');
				}}
				class="btn btn-ghost">Leave game</button
			>
		</div>
	{/if}

	<!-- ═══════════════════════ LOBBY ════════════════════════════════════════ -->
	{#if $game.screen === 'lobby'}
		<div class="screen lobby">
			<div class="brand">
				<span class="brand-icon">🎭</span>
				<h1>Bluffify</h1>
				<p class="brand-sub">The bluffing trivia game</p>
			</div>

			<div class="lobby-card">
				<div class="lobby-section">
					<h2>Host a game</h2>
					<p class="dim">Pick a theme and create a room</p>
					<div class="theme-grid">
						{#each THEMES as t}
							<button
								class="theme-btn"
								class:active={selectedTheme === t.id}
								onclick={() => (selectedTheme = t.id)}
							>
								<span class="theme-icon">{t.icon}</span>
								<span class="theme-label">{t.label}</span>
							</button>
						{/each}
					</div>

					<div class="questions-amount flex w-full justify-between">
						<div class="flex-1">
							<p>Questions</p>
							<p class="dim">How many questions to answer</p>
						</div>
						<input
							class="inset-[5px] block field-sizing-content max-w-[6ch] overflow-scroll rounded-[6px] border-2 border-[#d9baff]/50 p-[8px]! font-medium outline-0 transition-colors duration-300 focus:border-[#d9baff]"
							bind:value={questionsAmount}
							placeholder="20"
						/>
					</div>

					<div class="questions-amount flex w-full justify-between">
						<div>
							<p>AI bluffs</p>
							<p class="dim">How many fake answers the AI gives</p>
						</div>
						<input
							class="hide-spin inset-[5px] block field-sizing-content max-w-[6ch] overflow-scroll rounded-[6px] border-2 border-[#d9baff]/50 p-[8px]! font-medium outline-0 transition-colors duration-300 focus:border-[#d9baff]"
							type="number"
							style::-webkit-inner-spin-button="hidden"
							min="0"
							max="20"
							onblur={() => {
								aiBluffs = Math.max(Math.min(aiBluffs, 20), 0);
							}}
							bind:value={aiBluffs}
						/>
					</div>

					<button
						class="btn btn-accent"
						onclick={() =>
							client.emit('create_room', {
								theme: selectedTheme,
								totalQuestions: questionsAmount,
								aiBluffs
							})}
					>
						Create room
					</button>
				</div>

				<div class="lobby-divider"><span>or</span></div>

				<div class="lobby-section">
					<h2>Join a game</h2>
					<p class="dim">Enter the 6-digit room code</p>
					<div class="code-inputs">
						{#each segments as _, i}
							<input
								type="text"
								inputmode="numeric"
								maxlength="1"
								class="code-box"
								bind:value={segments[i]}
								bind:this={inputRefs[i]}
								oninput={(e) => handleInput(e, i)}
								onkeydown={(e) => handleKeydown(e, i)}
								onpaste={handlePaste}
								onfocus={(e) => (e.target as HTMLInputElement).select()}
							/>
						{/each}
					</div>
					<input
						class="field"
						bind:value={inputPlayerName}
						type="text"
						placeholder="Your name"
						maxlength="20"
					/>
					<button
						class="btn btn-accent"
						onclick={() => client.emit('join_room', { code: inputRoomCode, name: inputPlayerName })}
						disabled={inputRoomCode.length < 6 || !inputPlayerName.trim()}
					>
						Join room
					</button>
				</div>
			</div>
		</div>

		<!-- ═══════════════════════ HOST WAITING ════════════════════════════════ -->
	{:else if $game.screen === 'host-waiting'}
		<div class="screen host-waiting">
			<div class="brand compact">
				<span class="brand-icon">🎭</span>
				<h1>Bluffify</h1>
			</div>

			<div class="room-hero">
				<div class="room-code-block">
					<span class="room-code-hint">Room code</span>
					<span class="room-code">{$game.roomCode}</span>
				</div>
				<p class="dim">
					{THEMES.find((t) => t.id === $game.theme)?.icon}
					{THEMES.find((t) => t.id === $game.theme)?.label} theme
				</p>
				<p class="dim">
					<span
						>Questions <span
							class="font-medium text-[color-mix(in_srgb,var(--text),var(--text-dim))]"
							>{$game.totalQuestions}</span
						></span
					>
					<br />
					<span
						>AI bluffs <span
							class="font-medium text-[color-mix(in_srgb,var(--text),var(--text-dim))]"
							>{$game.aiBluffs}</span
						></span
					>
				</p>
			</div>

			<div class="player-bubble-list">
				{#each $sortedPlayers as player}
					<div class="player-bubble" class:ghost={player.disconnected}>
						<span class="avatar">{player.name[0].toUpperCase()}</span>
						<span>{player.name}</span>
						{#if player.disconnected}<span class="badge-offline">away</span>{/if}
					</div>
				{/each}

				{#if Object.keys($game.players).length === 0}
					<p class="dim">Waiting for players to join...</p>
				{/if}
			</div>

			<p class="player-count dim">
				{Object.keys($game.players).length} player{Object.keys($game.players).length !== 1
					? 's'
					: ''}
			</p>

			<div class="row gap">
				<button
					class="btn btn-accent"
					disabled={Object.keys($game.players).length < 1}
					onclick={() => client.emit('start_game')}
				>
					Start game →
				</button>
				<button class="btn btn-ghost" onclick={() => client.emit('close_room')}>Close room</button>
			</div>
		</div>

		<!-- ═══════════════════════ PLAYER WAITING ══════════════════════════════ -->
	{:else if $game.screen === 'waiting'}
		<div class="screen player-waiting">
			<div class="brand">
				<span class="brand-icon">🎭</span>
				<h1>Bluffify</h1>
			</div>
			<div class="joined-card">
				<span class="avatar lg">{$game.playerName?.[0].toUpperCase()}</span>
				<p class="player-name-display">{$game.playerName}</p>
				<p class="dim">Waiting for the host to start...</p>
				<div class="pulse-dots">
					<span></span><span></span><span></span>
				</div>
			</div>
			<div class="player-bubble-list">
				{#each $sortedPlayers as player}
					<div class="player-bubble sm">
						<span class="avatar sm">{player.name[0].toUpperCase()}</span>
						<span>{player.name}</span>
					</div>
				{/each}
			</div>
			<button class="btn btn-ghost" onclick={() => client.emit('leave_game')}> Leave game </button>
		</div>

		<!-- ═══════════════════════ HOST: QUESTION SCREEN ═══════════════════════ -->
	{:else if $game.screen === 'host-question'}
		<div class="screen host-game">
			<div class="host-header">
				<span class="pill">Round {$game.questionIndex + 1} / {$game.totalQuestions}</span>
				<div class="timer-ring" class:urgent={$game.timeLeft <= 10}>
					<div
						class="h-full w-full rounded-full p-[5px]!"
						style:--progress={$game.timeLeft / 30}
						style={`
							background: conic-gradient(var(--ring-fill) calc(var(--progress) * 100%), transparent calc(var(--progress) * 100%));
							transition: --progress 1s linear;
						`}
					>
						<div class="h-full w-full rounded-full bg-[#0a0a0e]"></div>
					</div>

					<span class="timer-num">{$game.timeLeft}</span>
				</div>
			</div>

			{#if $game.question}
				<div class="big-question-card">
					<span class="q-type-tag">
						{$game.question.type === 'lyrics'
							? '🎤 Fill in the blank'
							: $game.question.type === 'artist'
								? '🎸 Name the artist'
								: '❓ Trivia'}
					</span>
					<p class="big-question">{$game.question.question}</p>
					{#if $game.question.genre || $game.question.era}
						<div class="q-meta">
							{#if $game.question.genre}<span>{$game.question.genre}</span>{/if}
							{#if $game.question.era}<span>·</span><span>{$game.question.era}</span>{/if}
						</div>
					{/if}
				</div>
			{/if}

			<div class="host-answer-status">
				{#each $sortedPlayers as player}
					<div class="host-player-status" title={player.name}>
						<span class="avatar sm">{player.name[0].toUpperCase()}</span>
						<span
							class="status-dot"
							class:answered={$game.round?.submittedAnswers?.some((a) => a.playerId === player.id)}
						></span>
					</div>
				{/each}
			</div>
		</div>

		<!-- ═══════════════════════ HOST: VOTING SCREEN ═════════════════════════ -->
	{:else if $game.screen === 'host-voting'}
		<div class="screen host-game">
			<div class="host-header">
				<span class="pill">Voting — Round {$game.questionIndex + 1}</span>
				<div class="timer-ring" class:urgent={$game.timeLeft <= 10}>
					<div
						class="h-full w-full rounded-full p-[5px]!"
						style:--progress={$game.timeLeft / 20}
						style={`
							background: conic-gradient(var(--ring-fill) calc(var(--progress) * 100%), transparent calc(var(--progress) * 100%));
							transition: --progress 1s linear;
						`}
					>
						<div class="h-full w-full rounded-full bg-[#0a0a0e]"></div>
					</div>

					<span class="timer-num">{$game.timeLeft}</span>
				</div>
			</div>

			{#if $game.question}
				<div class="big-question-card compact">
					<p class="big-question sm">{$game.question.question}</p>
				</div>
			{/if}

			<p class="host-instruction dim">Players are voting on the screen they're holding</p>

			<div class="host-answers-grid">
				{#each $game.round?.submittedAnswers ?? [] as ans, i}
					<div class="host-answer-tile">
						<span class="tile-letter">{String.fromCharCode(65 + i)}</span>
						<span class="tile-text">{ans.answer}</span>
						<!-- <span class="tile-votes">
							{Object.values($game.round?.votes ?? {}).filter((v) => v === ans.playerId).length} votes
						</span> -->
					</div>
				{/each}
			</div>
		</div>

		<!-- ═══════════════════════ HOST: RESULTS SCREEN ════════════════════════ -->
	{:else if $game.screen === 'host-results'}
		<div class="screen host-game">
			<div class="host-header">
				<span class="pill">Results — Round {$game.questionIndex + 1}</span>
			</div>

			{#if $game.question}
				<div class="big-question-card compact">
					<p class="big-question sm">{$game.question.question}</p>
				</div>
			{/if}

			<div class="reveal-list">
				{#each $game.round?.submittedAnswers ?? [] as ans}
					{@const voteCount = Object.values($game.round?.votes ?? {}).filter(
						(v) => v === ans.playerId
					).length}

					<div
						class="reveal-row"
						class:is-correct={ans.isCorrect}
						class:is-bluff={!ans.isCorrect && voteCount > 0}
					>
						<div class="reveal-left">
							<span class="reveal-answer">{ans.answer}</span>
							{#if ans.isCorrect}
								<span class="badge-real">✓ Real answer</span>
							{:else if ans.type == 'ai'}
								<span class="badge-ai">🤖 AI bluff</span>
							{:else}
								<span class="badge-bluff">by {$game.players[ans.playerId]?.name ?? 'Unknown'}</span>
							{/if}
						</div>
						{#if voteCount > 0}
							<span class="vote-badge">{voteCount} vote{voteCount !== 1 ? 's' : ''}</span>
						{/if}
					</div>
				{/each}
			</div>

			<div class="mini-scores">
				{#each $sortedPlayers.slice(0, 5) as player, i}
					<div class="mini-score-row">
						<span class="mini-rank">#{i + 1}</span>
						<span class="avatar xs">{player.name[0].toUpperCase()}</span>
						<span class="mini-name">{player.name}</span>
						<span class="mini-pts">{player.score}</span>
					</div>
				{/each}
			</div>

			<button class="btn btn-accent" onclick={() => client.emit('next_round')}>
				Next round →
			</button>
		</div>

		<!-- ═══════════════════════ PLAYER: ANSWERING ═══════════════════════════ -->
	{:else if $game.screen === 'answering'}
		<div class="screen player-game">
			<div class="player-header">
				<span class="pill sm">Round {$game.questionIndex + 1} / {$game.totalQuestions}</span>
				<div class="timer-compact" class:urgent={$game.timeLeft <= 10}>{$game.timeLeft}s</div>
			</div>

			{#if $game.question}
				<div class="player-question-card">
					<span class="q-type-tag sm">
						{$game.question.type === 'lyrics'
							? '🎤 Fill in the blank'
							: $game.question.type === 'artist'
								? '🎸 Name the artist'
								: '❓'}
					</span>
					<p class="player-question">{$game.question.question}</p>
					{#if $game.question.genre || $game.question.era}
						<div class="q-meta">
							{#if $game.question.genre}<span>{$game.question.genre}</span>{/if}
							{#if $game.question.era}<span>·</span><span>{$game.question.era}</span>{/if}
						</div>
					{/if}
				</div>
			{/if}

			{#if $game.myAnswer}
				<div class="submitted-notice">
					<span class="check">✓</span>
					<div>
						<p class="submitted-label">Submitted</p>
						<p class="submitted-answer">"{$game.myAnswer}"</p>
					</div>
					<p class="dim sm">Waiting for others...</p>
				</div>
			{:else}
				<div class="answer-input-row">
					<input
						class="field answer-field"
						bind:value={inputAnswer}
						type="text"
						placeholder="Your fake answer..."
						onkeydown={(e) => e.key === 'Enter' && submitAnswer()}
						autofocus
					/>
					<button class="btn btn-accent" onclick={submitAnswer}>Submit</button>
				</div>
				<p class="hint dim">Tip: write something believable to fool others!</p>
			{/if}
		</div>

		<!-- ═══════════════════════ PLAYER: VOTING ══════════════════════════════ -->
	{:else if $game.screen === 'voting'}
		<div class="screen player-game">
			<div class="player-header">
				<span class="pill sm">Vote</span>
				<div class="timer-compact" class:urgent={$game.timeLeft <= 10}>{$game.timeLeft}s</div>
			</div>

			{#if $game.question}
				<div class="player-question-card compact">
					<p class="player-question sm">{$game.question.question}</p>
				</div>
			{/if}

			<p class="vote-prompt">Which is the <strong>real</strong> answer?</p>

			{#if $game.myVote}
				<div class="vote-submitted">
					<span>✓</span> Vote locked in — waiting for others...
				</div>
				<div class="voted-choices">
					{#each $game.round?.submittedAnswers ?? [] as ans, i}
						<div class="vote-option locked" class:my-pick={$game.myVote === ans.playerId}>
							<span class="option-letter">{String.fromCharCode(65 + i)}</span>
							<span class="option-text">{ans.answer}</span>
							{#if $game.myVote === ans.playerId}<span class="my-pick-dot">●</span>{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="vote-grid">
					{#each $game.round?.submittedAnswers ?? [] as ans, i}
						<button class="vote-option" onclick={() => submitVote(ans.playerId)}>
							<span class="option-letter">{String.fromCharCode(65 + i)}</span>
							<span class="option-text">{ans.answer}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- ═══════════════════════ PLAYER: RESULTS ═════════════════════════════ -->
	{:else if $game.screen === 'results'}
		<div class="screen player-game">
			<div class="player-header">
				<span class="pill sm">Results</span>
			</div>

			<div class="reveal-list">
				{#each $game.round?.submittedAnswers ?? [] as ans}
					{@const voteCount = Object.values($game.round?.votes ?? {}).filter(
						(v) => v === ans.playerId
					).length}
					<div
						class="reveal-row"
						class:is-correct={ans.isCorrect}
						class:is-bluff={!ans.isCorrect && voteCount > 0}
					>
						<div class="reveal-left">
							<span class="reveal-answer">{ans.answer}</span>
							{#if ans.isCorrect}
								<span class="badge-real">✓ Real</span>
							{:else if ans.playerId === 'ai'}
								<span class="badge-ai">🤖 AI</span>
							{/if}
						</div>
						{#if voteCount > 0}
							<span class="vote-badge">{voteCount}✓</span>
						{/if}
					</div>
				{/each}
			</div>

			<p class="dim center waiting-host">Waiting for host to continue...</p>
		</div>

		<!-- ═══════════════════════ FINISHED ════════════════════════════════════ -->
	{:else if $game.screen === 'finished'}
		<div class="screen final-screen">
			<div class="podium-header">
				<span class="trophy">🏆</span>
				<h1>Final Scores</h1>
			</div>

			<div class="podium">
				{#each $sortedPlayers as player, i}
					<div
						class="podium-row"
						class:gold={i === 0}
						class:silver={i === 1}
						class:bronze={i === 2}
					>
						<span class="podium-rank"
							>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span
						>
						<span class="avatar md">{player.name[0].toUpperCase()}</span>
						<span class="podium-name">{player.name}</span>
						<span class="podium-pts">{player.score.toLocaleString()} pts</span>
					</div>
				{/each}
			</div>

			{#if $game.isHost}
				<button class="btn btn-accent" onclick={() => client.emit('close_room')}>End game</button>
			{:else}
				<p class="dim center">Thanks for playing!</p>
			{/if}
		</div>
	{/if}
</main>

<style>
	/* ─── Reset & base ────────────────────────────────────────────────────── */
	:global(*, *::before, *::after) {
		box-sizing: border-box;
		margin: 0;
		padding: 0;
	}
	:global(html) {
		font-size: 16px;
	}
	:global(body) {
		background: #0a0a0e;
		color: #e8e6f0;
		font-family: 'Sora', 'DM Sans', system-ui, sans-serif;
		min-height: 100vh;
		-webkit-font-smoothing: antialiased;
	}

	/* ─── CSS vars ────────────────────────────────────────────────────────── */
	:global(:root) {
		--accent: #c8a2f8;
		--accent-dim: #7e52c0;
		--accent-glow: rgba(200, 162, 248, 0.18);
		--surface: #14121e;
		--surface-2: #1c1929;
		--border: #2e2a42;
		--border-focus: #7e52c0;
		--text: #e8e6f0;
		--text-dim: #6b6880;
		--green: #72d7a4;
		--green-bg: #0d1f18;
		--green-border: #1e4d36;
		--red: #f07070;
		--red-bg: #1f0d0d;
		--red-border: #4d1e1e;
		--gold: #f5c842;
		--ring-track: #2e2a42;
		--ring-fill: var(--accent);
	}

	main {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.screen {
		width: 100%;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-items: center;
		justify-content: center;
		gap: 24px;
		animation: fadeUp 0.3s ease both;
	}

	@keyframes fadeUp {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ─── Brand ───────────────────────────────────────────────────────────── */
	.brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}
	.brand-icon {
		font-size: 3rem;
	}
	.brand h1 {
		font-size: 2.4rem;
		font-weight: 800;
		letter-spacing: -0.04em;
		background: linear-gradient(135deg, #e8e6f0 30%, var(--accent));
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}
	.brand-sub {
		color: var(--text-dim);
		font-size: 0.9rem;
	}
	.brand.compact {
		flex-direction: row;
		gap: 12px;
	}
	.brand.compact .brand-icon {
		font-size: 1.8rem;
	}
	.brand.compact h1 {
		font-size: 1.6rem;
	}

	/* ─── Lobby ───────────────────────────────────────────────────────────── */
	.lobby {
		max-width: 820px;
	}
	.lobby-card {
		display: flex;
		width: 100%;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 24px;
		overflow: hidden;
	}
	.lobby-section {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 40px 32px;
	}
	.lobby-section h2 {
		font-size: 1.1rem;
		font-weight: 700;
	}
	.lobby-divider {
		width: 1px;
		background: var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
	}
	.lobby-divider span {
		background: var(--surface);
		padding: 8px 0;
		font-size: 11px;
		color: var(--text-dim);
		position: absolute;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.theme-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		width: 100%;
	}
	.theme-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 12px 8px;
		background: #0a0a0e;
		border: 2px solid var(--border);
		border-radius: 12px;
		color: var(--text-dim);
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.15s;
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}
	.theme-btn:hover {
		border-color: var(--accent-dim);
		color: var(--text);
	}
	.theme-btn.active {
		border-color: var(--accent);
		background: var(--accent-glow);
		color: var(--accent);
	}
	.theme-icon {
		font-size: 1.4rem;
	}
	.theme-label {
		font-size: 0.7rem;
	}

	/* ─── Code input ──────────────────────────────────────────────────────── */
	.code-inputs {
		display: flex;
		gap: 6px;
	}
	.code-box {
		width: 42px;
		height: 52px;
		background: #0a0a0e;
		border: 2px solid var(--border);
		border-radius: 12px;
		color: var(--text);
		font-size: 1.4rem;
		font-weight: 800;
		text-align: center;
		outline: none;
		transition:
			border-color 0.15s,
			transform 0.1s,
			box-shadow 0.15s;
		caret-color: var(--accent);
	}
	.code-box:focus {
		border-color: var(--accent);
		transform: translateY(-3px);
		box-shadow: 0 6px 20px var(--accent-glow);
	}

	/* ─── Fields & buttons ────────────────────────────────────────────────── */
	.field {
		width: 100%;
		background: #0a0a0e;
		border: 2px solid var(--border);
		border-radius: 12px;
		color: var(--text);
		font-size: 0.95rem;
		padding: 13px 16px;
		outline: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
		font-family: inherit;
	}
	.field:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px var(--accent-glow);
	}
	.field::placeholder {
		color: #3a3650;
	}
	.answer-field {
		font-size: 1rem;
		font-weight: 500;
	}

	.btn {
		padding: 13px 24px;
		border-radius: 12px;
		font-size: 0.9rem;
		font-weight: 700;
		cursor: pointer;
		border: none;
		transition: all 0.15s;
		font-family: inherit;
		letter-spacing: 0.02em;
	}
	.btn:active {
		transform: scale(0.97);
	}
	.btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.btn-accent {
		background: var(--accent);
		color: #0a0a0e;
	}
	.btn-accent:hover:not(:disabled) {
		background: #d9baff;
		box-shadow: 0 4px 16px var(--accent-glow);
	}
	.btn-ghost {
		background: transparent;
		color: var(--text-dim);
		border: 2px solid var(--border);
	}
	.btn-ghost:hover {
		border-color: var(--accent-dim);
		color: var(--text);
	}

	/* ─── Utility ─────────────────────────────────────────────────────────── */
	.dim {
		color: var(--text-dim);
		font-size: 0.875rem;
	}
	.dim.sm {
		font-size: 0.8rem;
	}
	.center {
		text-align: center;
	}
	.row {
		display: flex;
	}
	.row.gap {
		gap: 12px;
	}
	.pill {
		background: var(--surface-2);
		border: 2px solid var(--border);
		border-radius: 99px;
		padding: 5px 14px;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--text-dim);
		letter-spacing: 0.03em;
	}
	.pill.sm {
		font-size: 0.72rem;
		padding: 4px 12px;
	}

	/* ─── Avatar ──────────────────────────────────────────────────────────── */
	.avatar {
		width: 32px;
		height: 32px;
		background: linear-gradient(135deg, var(--accent-dim), var(--accent));
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.8rem;
		font-weight: 800;
		color: #0a0a0e;
		flex-shrink: 0;
	}
	.avatar.sm {
		width: 24px;
		height: 24px;
		font-size: 0.65rem;
	}
	.avatar.xs {
		width: 20px;
		height: 20px;
		font-size: 0.6rem;
	}
	.avatar.md {
		width: 40px;
		height: 40px;
		font-size: 1rem;
	}
	.avatar.lg {
		width: 64px;
		height: 64px;
		font-size: 1.6rem;
		box-shadow:
			0 0 0 6px var(--accent-glow),
			0 0 30px var(--accent-glow);
	}

	/* ─── Player bubbles ──────────────────────────────────────────────────── */
	.player-bubble-list {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		justify-content: center;
		width: 100%;
	}
	.player-bubble {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 99px;
		padding: 6px 14px 6px 8px;
		font-size: 0.875rem;
		font-weight: 500;
		transition: opacity 0.2s;
	}
	.player-bubble.ghost {
		opacity: 0.35;
	}
	.player-bubble.sm {
		padding: 4px 12px 4px 6px;
		font-size: 0.8rem;
	}
	.badge-offline {
		font-size: 0.7rem;
		color: #f0a050;
		background: #2a1f0e;
		border-radius: 4px;
		padding: 1px 6px;
	}
	.player-count {
		margin-top: -10px;
	}

	/* ─── Host waiting ────────────────────────────────────────────────────── */
	.host-waiting {
		max-width: 560px;
	}
	.room-hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.room-code-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 20px;
		padding: 20px 56px;
		gap: 4px;
	}
	.room-code-hint {
		font-size: 0.7rem;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}
	.room-code {
		font-size: 3.2rem;
		font-weight: 900;
		letter-spacing: 0.2em;
		color: var(--accent);
		font-variant-numeric: tabular-nums;
	}

	/* ─── Player waiting ──────────────────────────────────────────────────── */
	.player-waiting {
		max-width: 400px;
	}
	.joined-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 20px;
		padding: 32px;
		width: 100%;
	}
	.player-name-display {
		font-size: 1.3rem;
		font-weight: 700;
	}
	.pulse-dots {
		display: flex;
		gap: 6px;
		margin-top: 4px;
	}
	.pulse-dots span {
		width: 8px;
		height: 8px;
		background: var(--accent);
		border-radius: 50%;
		animation: pulse 1.4s ease-in-out infinite;
		opacity: 0.3;
	}
	.pulse-dots span:nth-child(2) {
		animation-delay: 0.2s;
	}
	.pulse-dots span:nth-child(3) {
		animation-delay: 0.4s;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.15;
			transform: scale(0.8);
		}
		50% {
			opacity: 1;
			transform: scale(1.2);
		}
	}

	/* ─── Host game screen ────────────────────────────────────────────────── */
	.host-game {
		max-width: 860px;
	}
	.host-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}

	.timer-ring {
		position: relative;
		width: 60px;
		height: 60px;
		--ring-fill: var(--accent);
	}
	.timer-ring.urgent {
		--ring-fill: var(--red);
	}
	.timer-ring svg {
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
	}
	.timer-ring circle {
		transition: stroke 0.3s;
	}
	.timer-num {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		font-weight: 800;
		color: var(--ring-fill);
	}

	.big-question-card {
		width: 100%;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 20px;
		padding: 36px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.big-question-card.compact {
		padding: 20px 28px;
	}
	.q-type-tag {
		font-size: 0.78rem;
		font-weight: 700;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.q-type-tag.sm {
		font-size: 0.72rem;
	}
	.big-question {
		font-size: 1.9rem;
		font-weight: 700;
		line-height: 1.35;
		color: var(--text);
	}
	.big-question.sm {
		font-size: 1.1rem;
	}
	.q-meta {
		display: flex;
		gap: 6px;
		font-size: 0.8rem;
		color: var(--text-dim);
	}

	.host-answer-status {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		justify-content: center;
		width: 100%;
	}
	.host-player-status {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	.status-dot {
		width: 8px;
		height: 8px;
		background: var(--border);
		border-radius: 50%;
		transition: background 0.3s;
	}
	.status-dot.answered {
		background: var(--green);
		box-shadow: 0 0 8px var(--green);
	}
	.host-instruction {
		margin-top: -8px;
	}

	.host-answers-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
		width: 100%;
	}
	.host-answer-tile {
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 14px;
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tile-letter {
		font-size: 0.7rem;
		font-weight: 700;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.tile-text {
		font-size: 1rem;
		font-weight: 600;
	}
	.tile-votes {
		font-size: 0.75rem;
		color: var(--text-dim);
		margin-top: 4px;
	}

	/* ─── Reveal / results ────────────────────────────────────────────────── */
	.reveal-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
	}
	.reveal-row {
		display: flex;
		align-items: center;
		overflow: hidden;
		justify-content: space-between;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 14px;
		padding: 14px 18px;
		gap: 12px;
		transition: border-color 0.25s;
	}
	.reveal-row.is-correct {
		border-color: var(--green-border);
		background: var(--green-bg);
	}
	.reveal-row.is-bluff {
		border-color: var(--red-border);
		background: var(--red-bg);
	}
	.reveal-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.reveal-answer {
		font-size: 0.95rem;
		font-weight: 600;
	}
	.badge-real {
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--green-border);
		color: var(--green);
		border-radius: 6px;
		padding: 2px 8px;
	}
	.badge-ai {
		font-size: 0.7rem;
		font-weight: 700;
		background: #1a1f3a;
		color: #8888ff;
		border-radius: 6px;
		padding: 2px 8px;
	}
	.badge-bluff {
		font-size: 0.7rem;
		font-weight: 700;
		background: var(--red-border);
		color: var(--red);
		border-radius: 6px;
		padding: 2px 8px;
	}
	.vote-badge {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--accent);
		background: var(--accent-glow);
		border-radius: 99px;
		padding: 2px 10px;
		white-space: nowrap;
	}

	.mini-scores {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 6px;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 16px;
		padding: 14px 16px;
	}
	.mini-score-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.mini-rank {
		font-size: 0.78rem;
		color: var(--text-dim);
		min-width: 24px;
	}
	.mini-name {
		flex: 1;
		font-size: 0.875rem;
	}
	.mini-pts {
		font-size: 0.875rem;
		font-weight: 800;
		color: var(--accent);
	}

	/* ─── Player game screen ──────────────────────────────────────────────── */
	.player-game {
		max-width: 480px;
	}
	.player-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
	}
	.timer-compact {
		font-size: 1.4rem;
		font-weight: 900;
		color: var(--accent);
		min-width: 44px;
		text-align: right;
		font-variant-numeric: tabular-nums;
		transition: color 0.3s;
	}
	.timer-compact.urgent {
		color: var(--red);
		animation: tick 1s ease infinite;
	}
	@keyframes tick {
		0%,
		100% {
			transform: scale(1);
		}
		50% {
			transform: scale(1.12);
		}
	}

	.player-question-card {
		width: 100%;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 18px;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.player-question-card.compact {
		padding: 16px 20px;
	}
	.player-question {
		font-size: 1.3rem;
		font-weight: 700;
		line-height: 1.4;
	}
	.player-question.sm {
		font-size: 1rem;
	}

	.submitted-notice {
		display: flex;
		align-items: center;
		gap: 14px;
		width: 100%;
		background: var(--green-bg);
		border: 2px solid var(--green-border);
		border-radius: 14px;
		padding: 16px 20px;
	}
	.check {
		font-size: 1.4rem;
		color: var(--green);
	}
	.submitted-label {
		font-size: 0.75rem;
		color: var(--text-dim);
	}
	.submitted-answer {
		font-size: 1rem;
		font-weight: 700;
		color: var(--green);
	}

	.answer-input-row {
		display: flex;
		gap: 10px;
		width: 100%;
	}
	.answer-input-row .field {
		flex: 1;
	}
	.hint {
		width: 100%;
		text-align: center;
		margin-top: -12px;
	}

	/* ─── Voting ──────────────────────────────────────────────────────────── */
	.vote-prompt {
		font-size: 1rem;
		font-weight: 600;
		width: 100%;
		text-align: center;
	}
	.vote-prompt strong {
		color: var(--accent);
	}

	.vote-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		width: 100%;
	}
	.vote-option {
		display: flex;
		overflow: hidden;
		align-items: center;
		gap: 12px;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 14px;
		color: var(--text);
		padding: 16px;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 500;
		transition: all 0.15s;
	}
	.vote-option:hover:not(.locked) {
		border-color: var(--accent);
		background: var(--accent-glow);
		transform: translateY(-2px);
		box-shadow: 0 4px 16px var(--accent-glow);
	}
	.vote-option.locked {
		cursor: default;
	}
	.vote-option.my-pick {
		border-color: var(--accent);
		background: var(--accent-glow);
	}
	.voted-choices {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
	}
	.option-letter {
		font-size: 0.7rem;
		font-weight: 800;
		color: var(--accent);
		min-width: 20px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.option-text {
		flex: 1;
	}
	.my-pick-dot {
		color: var(--accent);
	}
	.vote-submitted {
		width: 100%;
		padding: 12px 18px;
		background: var(--green-bg);
		border: 2px solid var(--green-border);
		border-radius: 12px;
		color: var(--green);
		font-size: 0.9rem;
		font-weight: 600;
		text-align: center;
	}
	.waiting-host {
		width: 100%;
	}

	/* ─── Final screen ────────────────────────────────────────────────────── */
	.final-screen {
		max-width: 500px;
	}
	.podium-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.trophy {
		font-size: 3.5rem;
	}
	.podium-header h1 {
		font-size: 2rem;
		font-weight: 800;
	}
	.podium {
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 100%;
	}
	.podium-row {
		display: flex;
		align-items: center;
		gap: 12px;
		background: var(--surface);
		border: 2px solid var(--border);
		border-radius: 14px;
		padding: 14px 18px;
		transition: border-color 0.2s;
	}
	.podium-row.gold {
		border-color: #b8860b;
		background: #191200;
	}
	.podium-row.silver {
		border-color: #666;
		background: #141414;
	}
	.podium-row.bronze {
		border-color: #7a3f0e;
		background: #180e07;
	}
	.podium-rank {
		font-size: 1.4rem;
		min-width: 32px;
	}
	.podium-name {
		flex: 1;
		font-size: 1rem;
		font-weight: 600;
	}
	.podium-pts {
		font-size: 0.9rem;
		font-weight: 800;
		color: var(--accent);
	}

	/* ─── Responsive ──────────────────────────────────────────────────────── */
	@media (max-width: 620px) {
		.lobby-card {
			flex-direction: column;
		}
		.lobby-divider {
			width: 100%;
			height: 1px;
		}
		.lobby-divider span {
			padding: 0 8px;
		}
		.vote-grid {
			grid-template-columns: 1fr;
		}
		.host-answers-grid {
			grid-template-columns: 1fr 1fr;
		}
		.big-question {
			font-size: 1.4rem;
		}
		.room-code {
			font-size: 2.4rem;
			letter-spacing: 0.1em;
		}
	}

	@property --progress {
		syntax: '<number>';
		inherits: false;
		initial-value: 1;
	}

	input::-webkit-outer-spin-button,
	input::-webkit-inner-spin-button {
		/* display: none; <- Crashes Chrome on hover */
		-webkit-appearance: none;
		margin: 0; /* <-- Apparently some margin are still there even though it's hidden */
	}
</style>
