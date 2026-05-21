export type MusicPromptConfig = {
    era?: string;
    genre?: string;
    previousArtists?: string[];
};

const examples = {
    lyrics: {
        type: "lyrics",
        blanked: "I can't get no ____",
        answer: "satisfaction",
        artist: "The Rolling Stones",
        song: "Satisfaction",
        genre: "Rock",
        era: "1960s",
    },
    artist: {
        type: "artist",
        question: "Which artist released the album 'Thriller' in 1982?",
        answer: "Michael Jackson",
        search: "Michael Jackson musician",
        genre: "Pop",
        era: "1980s",
    },
};

const musicPrompt = (config?: MusicPromptConfig) => {
    const constraints = [
        config?.era && `Era: ${config.era}`,
        config?.genre && `Genre: ${config.genre}`,
        config?.previousArtists?.length &&
            `Do NOT use these artists: ${config.previousArtists.join(", ")}`,
    ]
        .filter(Boolean)
        .join("\n");

    return `
You are a music quiz generator. Generate a single music quiz question.

QUESTION TYPE: Pick one — "lyrics" or "artist"
${constraints ? `\nCONSTRAINTS:\n${constraints}` : ""}

RULES:
- For lyrics: blank out a meaningful word (not "the", "a", "and")
- For artist: ask about albums, awards, or career facts — not just song names
- Only use real, well-known songs and artists
- If the era/genre combination is historically invalid (e.g. Rock in the 1500s), pick the closest valid era instead and add a "correction" field explaining what you changed and why
- Only use real recorded music by actual music artists — not plays, poems, or literature

OUTPUT: Return ONLY a valid JSON object matching one of these shapes:

${JSON.stringify(examples.lyrics, null, 2)}

OR

${JSON.stringify(examples.artist, null, 2)}
`.trim();
};

export default musicPrompt;