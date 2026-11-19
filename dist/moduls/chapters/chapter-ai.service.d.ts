export type ChapterEffort = "low" | "high" | "max";
export type ChapterImage = {
    buffer: Buffer;
    mimetype: string;
    originalname: string;
};
export type ChapterDraft = {
    title: string;
    content: string;
    exercise: string;
};
export type ChapterAnswer = {
    question: string;
    answer: string;
    explanation: string;
    source: "chapter" | "general";
};
export declare function generateChapterDraft(images: ChapterImage[], effort: ChapterEffort): Promise<ChapterDraft>;
export declare function generateExerciseDraft(chapter: {
    title: string;
    content: string;
}, images: ChapterImage[], effort: ChapterEffort): Promise<string>;
export declare function generateAnswersDraft(chapter: {
    title: string;
    content: string;
    exercise: string;
}, effort: ChapterEffort): Promise<ChapterAnswer[]>;
//# sourceMappingURL=chapter-ai.service.d.ts.map