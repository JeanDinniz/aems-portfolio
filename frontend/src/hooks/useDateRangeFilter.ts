import { useState } from 'react';

interface UseDateRangeFilterOptions {
    defaultStart: string;
    defaultEnd: string;
}

export function useDateRangeFilter({ defaultStart, defaultEnd }: UseDateRangeFilterOptions) {
    const [startDate, setStartDate] = useState(defaultStart);
    const [endDate, setEndDate] = useState(defaultEnd);
    const [appliedStart, setAppliedStart] = useState(defaultStart);
    const [appliedEnd, setAppliedEnd] = useState(defaultEnd);

    const apply = () => {
        setAppliedStart(startDate);
        setAppliedEnd(endDate);
    };

    /** Seta E aplica de uma vez — use nos presets de data. */
    const applyRange = (start: string, end: string) => {
        setStartDate(start);
        setEndDate(end);
        setAppliedStart(start);
        setAppliedEnd(end);
    };

    return {
        startDate,
        endDate,
        setStartDate,
        setEndDate,
        appliedStart,
        appliedEnd,
        apply,
        applyRange,
    };
}
