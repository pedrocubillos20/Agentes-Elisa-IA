// =============================================
// 🇨🇴 FESTIVOS COLOMBIANOS — Ley 51 de 1983 (Ley Emiliani)
// 
// Colombia has 18 public holidays per year:
// - 7 fixed dates (always the exact date)
// - 11 movable (moved to next Monday per Ley Emiliani)
//
// Easter-based holidays use the Anonymous Gregorian algorithm
// to calculate Easter Sunday, then offset from there.
// =============================================

export interface ColombianHoliday {
  date: string;         // YYYY-MM-DD
  name: string;         // Holiday name in Spanish
  type: 'fixed' | 'emiliani' | 'easter';  // Category
  originalDate?: string; // Original date before Emiliani move
}

// Calculate Easter Sunday using the Anonymous Gregorian algorithm
function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

// Move a date to the next Monday (Ley Emiliani)
function moveToNextMonday(date: Date): Date {
  const day = date.getUTCDay(); // 0=Sun, 1=Mon, ...
  if (day === 1) return date; // Already Monday
  const diff = day === 0 ? 1 : (8 - day); // Days until next Monday
  const moved = new Date(date);
  moved.setUTCDate(moved.getUTCDate() + diff);
  return moved;
}

// Add days to a date
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// Format date as YYYY-MM-DD
function fmt(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get all Colombian holidays for a given year
 * Returns sorted array of holidays with dates and names
 */
export function getColombianHolidays(year: number): ColombianHoliday[] {
  const holidays: ColombianHoliday[] = [];
  const easter = getEasterSunday(year);

  // ═══════════════════════════════════════════
  // FIESTAS FIJAS (no se mueven)
  // ═══════════════════════════════════════════
  holidays.push({ date: `${year}-01-01`, name: 'Año Nuevo', type: 'fixed' });
  holidays.push({ date: `${year}-05-01`, name: 'Día del Trabajo', type: 'fixed' });
  holidays.push({ date: `${year}-07-20`, name: 'Grito de Independencia', type: 'fixed' });
  holidays.push({ date: `${year}-08-07`, name: 'Batalla de Boyacá', type: 'fixed' });
  holidays.push({ date: `${year}-12-08`, name: 'Inmaculada Concepción', type: 'fixed' });
  holidays.push({ date: `${year}-12-25`, name: 'Navidad', type: 'fixed' });

  // ═══════════════════════════════════════════
  // SEMANA SANTA (basadas en Pascua, no se mueven)
  // ═══════════════════════════════════════════
  const juevesSanto = addDays(easter, -3);
  const viernesSanto = addDays(easter, -2);
  holidays.push({ date: fmt(juevesSanto), name: 'Jueves Santo', type: 'easter' });
  holidays.push({ date: fmt(viernesSanto), name: 'Viernes Santo', type: 'easter' });

  // ═══════════════════════════════════════════
  // LEY EMILIANI (se mueven al siguiente lunes)
  // ═══════════════════════════════════════════

  // Reyes Magos — 6 de enero → lunes siguiente
  const reyesOrig = new Date(Date.UTC(year, 0, 6));
  const reyes = moveToNextMonday(reyesOrig);
  holidays.push({ date: fmt(reyes), name: 'Reyes Magos', type: 'emiliani', originalDate: `${year}-01-06` });

  // San José — 19 de marzo → lunes siguiente
  const sanJoseOrig = new Date(Date.UTC(year, 2, 19));
  const sanJose = moveToNextMonday(sanJoseOrig);
  holidays.push({ date: fmt(sanJose), name: 'San José', type: 'emiliani', originalDate: `${year}-03-19` });

  // Ascensión del Señor — 39 días después de Pascua → lunes siguiente
  const ascensionOrig = addDays(easter, 39);
  const ascension = moveToNextMonday(ascensionOrig);
  holidays.push({ date: fmt(ascension), name: 'Ascensión del Señor', type: 'emiliani', originalDate: fmt(ascensionOrig) });

  // Corpus Christi — 60 días después de Pascua → lunes siguiente
  const corpusOrig = addDays(easter, 60);
  const corpus = moveToNextMonday(corpusOrig);
  holidays.push({ date: fmt(corpus), name: 'Corpus Christi', type: 'emiliani', originalDate: fmt(corpusOrig) });

  // Sagrado Corazón — 68 días después de Pascua → lunes siguiente
  const sagradoOrig = addDays(easter, 68);
  const sagrado = moveToNextMonday(sagradoOrig);
  holidays.push({ date: fmt(sagrado), name: 'Sagrado Corazón', type: 'emiliani', originalDate: fmt(sagradoOrig) });

  // San Pedro y San Pablo — 29 de junio → lunes siguiente
  const sanPedroOrig = new Date(Date.UTC(year, 5, 29));
  const sanPedro = moveToNextMonday(sanPedroOrig);
  holidays.push({ date: fmt(sanPedro), name: 'San Pedro y San Pablo', type: 'emiliani', originalDate: `${year}-06-29` });

  // Asunción de la Virgen — 15 de agosto → lunes siguiente
  const asuncionOrig = new Date(Date.UTC(year, 7, 15));
  const asuncionV = moveToNextMonday(asuncionOrig);
  holidays.push({ date: fmt(asuncionV), name: 'Asunción de la Virgen', type: 'emiliani', originalDate: `${year}-08-15` });

  // Día de la Raza — 12 de octubre → lunes siguiente
  const razaOrig = new Date(Date.UTC(year, 9, 12));
  const raza = moveToNextMonday(razaOrig);
  holidays.push({ date: fmt(raza), name: 'Día de la Raza', type: 'emiliani', originalDate: `${year}-10-12` });

  // Todos los Santos — 1 de noviembre → lunes siguiente
  const santosOrig = new Date(Date.UTC(year, 10, 1));
  const santos = moveToNextMonday(santosOrig);
  holidays.push({ date: fmt(santos), name: 'Todos los Santos', type: 'emiliani', originalDate: `${year}-11-01` });

  // Independencia de Cartagena — 11 de noviembre → lunes siguiente
  const cartagenaOrig = new Date(Date.UTC(year, 10, 11));
  const cartagena = moveToNextMonday(cartagenaOrig);
  holidays.push({ date: fmt(cartagena), name: 'Independencia de Cartagena', type: 'emiliani', originalDate: `${year}-11-11` });

  // Sort by date
  holidays.sort((a, b) => a.date.localeCompare(b.date));

  return holidays;
}

/**
 * Check if a specific date is a Colombian holiday
 * Returns the holiday info or null
 */
export function isColombianHoliday(dateStr: string): ColombianHoliday | null {
  const year = parseInt(dateStr.substring(0, 4));
  const holidays = getColombianHolidays(year);
  return holidays.find(h => h.date === dateStr) || null;
}

/**
 * Get holidays for a date range (useful for calendar views)
 */
export function getHolidaysInRange(startDate: string, endDate: string): ColombianHoliday[] {
  const startYear = parseInt(startDate.substring(0, 4));
  const endYear = parseInt(endDate.substring(0, 4));
  const allHolidays: ColombianHoliday[] = [];
  
  for (let y = startYear; y <= endYear; y++) {
    allHolidays.push(...getColombianHolidays(y));
  }
  
  return allHolidays.filter(h => h.date >= startDate && h.date <= endDate);
}

/**
 * Get next N upcoming holidays from a date
 */
export function getUpcomingHolidays(fromDate: string, count: number = 5): ColombianHoliday[] {
  const year = parseInt(fromDate.substring(0, 4));
  const holidays = [...getColombianHolidays(year), ...getColombianHolidays(year + 1)];
  return holidays.filter(h => h.date >= fromDate).slice(0, count);
}

/**
 * Get a human-readable summary of holidays for AI context
 */
export function getHolidaySummaryForAI(fromDate: string): string {
  const upcoming = getUpcomingHolidays(fromDate, 8);
  if (upcoming.length === 0) return '';
  
  const today = fromDate;
  const todayHoliday = upcoming.find(h => h.date === today);
  
  let summary = '🇨🇴 FESTIVOS COLOMBIA:\n';
  if (todayHoliday) {
    summary += `⚠️ HOY es festivo: ${todayHoliday.name}\n`;
  }
  
  summary += 'Próximos festivos:\n';
  for (const h of upcoming) {
    if (h.date === today) continue;
    const d = new Date(h.date + 'T12:00:00Z');
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const dayName = dayNames[d.getUTCDay()];
    summary += `- ${dayName} ${h.date}: ${h.name}\n`;
  }
  
  return summary;
}
