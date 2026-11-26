export interface ReviewComment {
	lineIndex: number;
	lineText: string;
	comment: string;
	/** A comment on the whole document, tied to no line (stored on line 0). */
	general?: boolean;
}
