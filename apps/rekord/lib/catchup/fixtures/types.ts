/** A sample telling and its answer sheet: who owes what, by when. */
export interface Telling {
  id: string;
  minutes: number;
  title: string;
  startedAt: number;
  sheet: { owner: string; due: string }[];
  /** One line per 10 seconds of speech. */
  lines: string[];
}
