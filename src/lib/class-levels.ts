export const CLASS_LEVELS = [
  "Pre-nursery",
  "Nursery",
  "Lower kindergarten",
  "Upper kindergarten",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
] as const;

export type ClassLevel = (typeof CLASS_LEVELS)[number];

const LEVEL_SET = new Set<string>(CLASS_LEVELS);

const ALIASES: Record<string, ClassLevel> = {
  "pre-nursery": "Pre-nursery",
  prenursery: "Pre-nursery",
  "pre nursery": "Pre-nursery",
  nursery: "Nursery",
  lkg: "Lower kindergarten",
  "lower kindergarten": "Lower kindergarten",
  "lower kg": "Lower kindergarten",
  ukg: "Upper kindergarten",
  "upper kindergarten": "Upper kindergarten",
  "upper kg": "Upper kindergarten",
  "class 1": "1",
  "class 2": "2",
  "class 3": "3",
  "class 4": "4",
  "class 5": "5",
  "class 6": "6",
  "class 7": "7",
  "class 8": "8",
  "class 9": "9",
  "class 10": "10",
  "class 11": "11",
  "class 12": "12",
  "std 1": "1",
  "std 2": "2",
  "std 3": "3",
  "std 4": "4",
  "std 5": "5",
  "std 6": "6",
  "std 7": "7",
  "std 8": "8",
  "std 9": "9",
  "std 10": "10",
  "std 11": "11",
  "std 12": "12",
};

export function isClassLevel(value: string): value is ClassLevel {
  return LEVEL_SET.has(value);
}

/** Map free-text / legacy values onto the fixed class list when possible. */
export function normalizeClassLevel(input: string | null | undefined): ClassLevel | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (LEVEL_SET.has(trimmed)) return trimmed as ClassLevel;
  const key = trimmed.toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  // bare number like "01" -> "1"
  const asNum = String(Number(trimmed));
  if (trimmed !== "" && !Number.isNaN(Number(trimmed)) && LEVEL_SET.has(asNum)) {
    return asNum as ClassLevel;
  }
  return null;
}

export function classLevelSortIndex(level: string): number {
  const idx = CLASS_LEVELS.indexOf(level as ClassLevel);
  return idx === -1 ? CLASS_LEVELS.length + 1 : idx;
}

export function formatClassLabel(
  classLevel: string | null | undefined,
  section?: string | null,
): string {
  if (!classLevel) return "—";
  return section ? `${classLevel} - ${section}` : classLevel;
}
