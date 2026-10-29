import { genericCsvParser } from "@/lib/imports/parsers/generic-csv";
import { ImportError, type ImportSourceKind, type ParsedStatement } from "@/lib/imports/types";

/**
 * What a parser reads. A CSV is its decoded text; a PDF is its text as pages of lines (filled by
 * the PDF reader of task I12, which doesn't exist yet).
 */
export type StatementSource =
  | { kind: "csv"; text: string }
  | { kind: "pdf"; text: string; pages: string[][] };

export interface StatementParser {
  /** "generic-csv", later one id per bank and format. Stored in `import_batches.parser_id` (1 to 60 characters). */
  id: string;
  /** Shown on the review screen. */
  label: string;
  kinds: readonly ImportSourceKind[];
  /** Looks only at the header or the first lines; never throws. */
  matches(source: StatementSource): boolean;
  /**
   * Reads the whole statement. On a file it matched but can't read it throws an `ImportError`
   * whose message never contains text from the file.
   */
  parse(source: StatementSource): ParsedStatement;
}

/** No parser recognises the layout. A distinct error, so the screen (and a later LLM step) can tell it apart. */
export class UnrecognisedLayoutError extends ImportError {
  constructor() {
    super("unrecognised_layout");
    this.name = "UnrecognisedLayoutError";
  }
}

/**
 * The parsers in the order they are tried: the specific ones (one per bank and format) first, the
 * generic one last, so a bank's own parser claims its files before the generic headers can.
 */
export const STATEMENT_PARSERS: readonly StatementParser[] = [genericCsvParser];

function claims(parser: StatementParser, source: StatementSource): boolean {
  if (!parser.kinds.includes(source.kind)) return false;
  try {
    return parser.matches(source) === true;
  } catch {
    // `matches` must not throw; if it does, the parser simply doesn't claim the file.
    return false;
  }
}

/** Every parser that matches the source, in registry order. Tests use it to check that no file is claimed twice. */
export function claimingParsers(
  source: StatementSource,
  parsers: readonly StatementParser[] = STATEMENT_PARSERS,
): StatementParser[] {
  return parsers.filter((parser) => claims(parser, source));
}

/** The first parser, in registry order, that matches the source; null when none does. */
export function findParser(
  source: StatementSource,
  parsers: readonly StatementParser[] = STATEMENT_PARSERS,
): StatementParser | null {
  return parsers.find((parser) => claims(parser, source)) ?? null;
}

/**
 * Parses a statement with the first parser that matches it. Throws `UnrecognisedLayoutError` when
 * none does, and an `ImportError` when the matching parser can't read the file. Anything else a
 * parser throws becomes `unreadable_statement` with the default message, so no row text leaves
 * through an error.
 */
export function parseStatement(
  source: StatementSource,
  parsers: readonly StatementParser[] = STATEMENT_PARSERS,
): ParsedStatement {
  const parser = findParser(source, parsers);
  if (!parser) throw new UnrecognisedLayoutError();
  try {
    return parser.parse(source);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError("unreadable_statement");
  }
}
