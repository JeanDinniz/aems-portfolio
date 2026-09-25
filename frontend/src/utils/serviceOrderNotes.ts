// Remove as tags [CORTESIA]/[RETORNO] que o backend anexa ao briefing do consultor (`notes`).
// Retorna null quando não sobra texto.
export function cleanConsultantNotes(notes: string | null | undefined): string | null {
    if (!notes) return null;
    const clean = notes
        .replace(/\s*\|\s*\[CORTESIA\]|\[CORTESIA\]\s*\|\s*/g, '')
        .replace(/\s*\|\s*\[RETORNO\]|\[RETORNO\]\s*\|\s*/g, '')
        .trim();
    return clean || null;
}
