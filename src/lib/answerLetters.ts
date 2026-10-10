/**
 * SAM — the letters an answer can carry. A question has two to six choices and
 * choice n is the nth letter; a yes/no is a and b. Shared by the answer route
 * (server) and the Notifications row (client), so it imports nothing.
 */

export const ANSWER_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
export type AnswerLetter = (typeof ANSWER_LETTERS)[number];
