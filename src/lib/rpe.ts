// 1 = dark red, middle = yellow, 10 = green
export const RPE_COLORS = ['#6E0F0F', '#962015', '#BB3A1C', '#D9661F', '#E8952A', '#EDBB33', '#D9CF3A', '#9EC43C', '#5DAE3F', '#2F8F40'];

export const rpeColor = (n: number) => RPE_COLORS[Math.min(10, Math.max(1, n)) - 1];
export const rpeText = (n: number) => (n >= 4 && n <= 8 ? '#14120A' : '#FFFFFF');

// Readiness of 4 or lower gets flagged for coaches
export const RPE_FLAG_AT = 4;
