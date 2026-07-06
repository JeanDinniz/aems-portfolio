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

    return {
        startDate,
        endDate,
        setStartDate,
        setEndDate,
        appliedStart,
        appliedEnd,
        apply,
    };
}
