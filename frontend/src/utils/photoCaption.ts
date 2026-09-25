/**
 * Legenda do lightbox de foto: "ABC1D23 · OS 8891".
 * Omite a parte ausente; sem placa e sem OS retorna string vazia (sem legenda).
 * Obs.: `plate` guarda placa OU chassi do vidro (ver isValidPlateOrChassi).
 */
export function buildPhotoCaption(plate?: string | null, externalOs?: string | null): string {
    const parts: string[] = [];
    if (plate?.trim()) parts.push(plate.trim());
    if (externalOs?.trim()) parts.push(`OS ${externalOs.trim()}`);
    return parts.join(' · ');
}
