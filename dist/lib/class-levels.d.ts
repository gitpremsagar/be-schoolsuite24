export declare const CLASS_LEVELS: readonly ["Pre-nursery", "Nursery", "Lower kindergarten", "Upper kindergarten", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
export type ClassLevel = (typeof CLASS_LEVELS)[number];
export declare function isClassLevel(value: string): value is ClassLevel;
/** Map free-text / legacy values onto the fixed class list when possible. */
export declare function normalizeClassLevel(input: string | null | undefined): ClassLevel | null;
export declare function classLevelSortIndex(level: string): number;
export declare function formatClassLabel(classLevel: string | null | undefined, section?: string | null): string;
//# sourceMappingURL=class-levels.d.ts.map