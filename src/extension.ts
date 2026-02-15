import * as vscode from "vscode";

// --- Types ---

type TokenType =
  | "keyword"
  | "function"
  | "operator"
  | "string"
  | "number"
  | "type"
  | "identifier"
  | "star"
  | "parenthesis"
  | "comma"
  | "dot";

interface Token {
  type: TokenType;
  start: number;
  length: number;
}

interface StringRange {
  contentStart: number;
  contentEnd: number;
  content: string;
}

// --- Decoration colors (light / dark theme) ---

const tokenColors: Record<TokenType, { light: string; dark: string }> = {
  keyword:     { light: "#0000FF", dark: "#569CD6" },
  function:    { light: "#795E26", dark: "#DCDCAA" },
  operator:    { light: "#383838", dark: "#D4D4D4" },
  string:      { light: "#A31515", dark: "#CE9178" },
  number:      { light: "#098658", dark: "#B5CEA8" },
  type:        { light: "#267F99", dark: "#4EC9B0" },
  identifier:  { light: "#001080", dark: "#9CDCFE" },
  star:        { light: "#AF00DB", dark: "#C586C0" },
  parenthesis: { light: "#383838", dark: "#D4D4D4" },
  comma:       { light: "#383838", dark: "#D4D4D4" },
  dot:         { light: "#383838", dark: "#D4D4D4" },
};

let decorationTypes: Map<TokenType, vscode.TextEditorDecorationType>;

const createDecorationTypes = () =>
  new Map(
    Object.entries(tokenColors).map(([type, colors]) => [
      type as TokenType,
      vscode.window.createTextEditorDecorationType({
        light: { color: colors.light },
        dark: { color: colors.dark },
      }),
    ])
  );

// --- SQL tokenizer ---

const keywords = [
  "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "OUTER",
  "CROSS", "ON", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE",
  "MERGE", "USING", "MATCHED", "UPSERT",
  "CREATE", "ALTER", "DROP", "TRUNCATE", "RENAME",
  "TABLE", "INDEX", "VIEW", "DATABASE", "SCHEMA", "COLUMN",
  "AS", "DISTINCT", "ALL", "TOP", "LIMIT", "OFFSET", "FETCH", "NEXT",
  "ORDER", "BY", "GROUP", "HAVING", "ROWS", "ONLY",
  "ASC", "DESC", "NULLS", "FIRST", "LAST",
  "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "ILIKE",
  "IS", "NULL", "TRUE", "FALSE", "ANY", "SOME",
  "UNION", "INTERSECT", "EXCEPT",
  "CASE", "WHEN", "THEN", "ELSE", "END",
  "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "CONSTRAINT",
  "DEFAULT", "CHECK", "UNIQUE", "CASCADE", "RESTRICT",
  "ADD", "WITH", "WITHOUT", "RECURSIVE",
  "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "TRANSACTION",
  "RETURNING", "IF", "REPLACE", "TEMP", "TEMPORARY", "EXPLAIN", "ANALYZE",
  "GRANT", "REVOKE", "OVER", "PARTITION", "WINDOW", "FILTER",
  "LATERAL", "UNNEST", "TABLESAMPLE", "WITHIN", "GROUPING",
].join("|");

const functions = [
  "COUNT", "SUM", "AVG", "MIN", "MAX", "ARRAY_AGG", "STRING_AGG",
  "BOOL_AND", "BOOL_OR", "EVERY", "XMLAGG",
  "UPPER", "LOWER", "TRIM", "LTRIM", "RTRIM", "SUBSTRING", "CONCAT",
  "LENGTH", "CHAR_LENGTH", "POSITION", "STRPOS",
  "LPAD", "RPAD", "INITCAP", "TRANSLATE", "FORMAT",
  "ABS", "CEIL", "CEILING", "FLOOR", "ROUND", "TRUNC", "MOD",
  "POWER", "SQRT", "SIGN", "RANDOM", "LOG", "LN", "EXP",
  "NOW", "CURRENT_TIMESTAMP", "CURRENT_DATE", "CURRENT_TIME",
  "GETDATE", "GETUTCDATE", "SYSDATETIME",
  "DATEADD", "DATEDIFF", "DATEPART", "DATENAME", "DATE_TRUNC",
  "EXTRACT", "YEAR", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND",
  "AGE", "MAKE_DATE", "MAKE_TIMESTAMP", "TO_TIMESTAMP",
  "CAST", "CONVERT", "TRY_CAST", "TRY_CONVERT",
  "COALESCE", "NULLIF", "GREATEST", "LEAST",
  "TO_CHAR", "TO_NUMBER", "TO_DATE",
  "ROW_NUMBER", "RANK", "DENSE_RANK", "NTILE",
  "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE", "NTH_VALUE",
  "CUME_DIST", "PERCENT_RANK",
  "JSON_VALUE", "JSON_QUERY", "JSON_OBJECT", "JSON_ARRAY",
  "JSON_AGG", "JSONB_AGG",
  "IIF", "ISNULL", "IFNULL", "NVL", "NVL2", "DECODE",
  "EXISTS", "REPLACE",
].join("|");

const types = [
  "INT", "INTEGER", "SMALLINT", "BIGINT", "TINYINT",
  "FLOAT", "REAL", "DOUBLE", "DECIMAL", "NUMERIC", "MONEY",
  "VARCHAR", "NVARCHAR", "CHAR", "NCHAR", "TEXT", "NTEXT", "CLOB",
  "BOOLEAN", "BOOL", "BIT",
  "DATE", "TIME", "TIMESTAMP", "DATETIME", "DATETIME2", "INTERVAL",
  "BLOB", "BINARY", "VARBINARY", "BYTEA", "IMAGE",
  "UUID", "UNIQUEIDENTIFIER", "SERIAL", "BIGSERIAL",
  "JSON", "JSONB", "XML", "ARRAY",
].join("|");

const tokenRegex = new RegExp(
  `\\b(${keywords})\\b` +
  `|\\b(${functions})(?=\\s*\\()` +
  `|(<=|>=|<>|!=|!<|!>|::|\\|\\||&&|=|<|>|\\+|-|/|%)` +
  `|('(?:[^'\\\\]|\\\\.)*')` +
  `|(\\b[0-9]+(?:\\.[0-9]+)?\\b)` +
  `|\\b(${types})\\b` +
  `|(\\b\\w+\\b)` +
  `|(\\*)` +
  `|([()])` +
  `|(,)` +
  `|(\\.)`,
  "gi"
);

const groupToType: TokenType[] = [
  "keyword", "function", "operator", "string", "number",
  "type", "identifier", "star", "parenthesis", "comma", "dot",
];

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  tokenRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(text)) !== null) {
    for (let i = 1; i < match.length; i++) {
      if (match[i] !== undefined) {
        tokens.push({
          type: groupToType[i - 1],
          start: match.index,
          length: match[0].length,
        });
        break;
      }
    }
  }
  return tokens;
}

// --- C# string literal regex fragments ---

const RAW_STRING = '"""[\\s\\S]*?"""';
const VERBATIM_STRING = '@"(?:[^"]|"")*"';
const REGULAR_STRING = '"(?:[^"\\\\]|\\\\.)*"';
const ANY_CSHARP_STRING = `${RAW_STRING}|${VERBATIM_STRING}|${REGULAR_STRING}`;

// --- Find SQL strings in C# source ---

function findStrings(text: string): StringRange[] {
  const ranges: StringRange[] = [];

  // Pattern 1: /*lang=sql*/ followed by a string literal
  const commentMarker = new RegExp(
    `\\/\\*\\s*lang\\s*=\\s*sql\\s*\\*\\/\\s*(${ANY_CSHARP_STRING})`, "g"
  );
  let m: RegExpExecArray | null;
  while ((m = commentMarker.exec(text)) !== null) {
    const raw = m[1];
    const rawStart = m.index + m[0].length - raw.length;
    const range = extractStringContent(raw, rawStart);
    if (range) ranges.push(range);
  }

  // Pattern 2: [StringSyntax("sql")] on method parameters → find call sites
  const paramPattern =
    /\[StringSyntax\("sql"\)\]\s*(?:\w+\s+)+?(\w+)\s*[,)]/g;
  const methods = new Set<string>();
  while ((m = paramPattern.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    const methodMatch = before.match(/(\w+)\s*\([^)]*$/);
    if (methodMatch) methods.add(methodMatch[1]);
  }

  for (const methodName of methods) {
    const escaped = methodName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const callPattern = new RegExp(
      `${escaped}\\s*\\(((?:${ANY_CSHARP_STRING}|[^)])*)\\)`, "g"
    );
    while ((m = callPattern.exec(text)) !== null) {
      const argsText = m[1];
      const argsStart = m.index + m[0].length - argsText.length - 1;

      const stringInArgs = new RegExp(ANY_CSHARP_STRING, "g");
      let sm: RegExpExecArray | null;
      while ((sm = stringInArgs.exec(argsText)) !== null) {
        const rawStart = argsStart + sm.index;
        const range = extractStringContent(sm[0], rawStart);
        if (range) ranges.push(range);
      }
    }
  }

  return ranges;
}

function extractStringContent(
  raw: string,
  rawStart: number
): StringRange | null {
  if (raw.startsWith('"""')) {
    const contentStart = rawStart + 3;
    const contentEnd = rawStart + raw.length - 3;
    if (contentEnd <= contentStart) return null;
    return { contentStart, contentEnd, content: raw.slice(3, -3) };
  }
  if (raw.startsWith('@"')) {
    const contentStart = rawStart + 2;
    const contentEnd = rawStart + raw.length - 1;
    if (contentEnd <= contentStart) return null;
    return { contentStart, contentEnd, content: raw.slice(2, -1) };
  }
  if (raw.startsWith('"')) {
    const contentStart = rawStart + 1;
    const contentEnd = rawStart + raw.length - 1;
    if (contentEnd <= contentStart) return null;
    return { contentStart, contentEnd, content: raw.slice(1, -1) };
  }
  return null;
}

// --- Apply decorations ---

function updateDecorations(editor: vscode.TextEditor): void {
  if (editor.document.languageId !== "csharp") return;

  const text = editor.document.getText();
  const strings = findStrings(text);

  const rangesByType = new Map<TokenType, vscode.Range[]>();
  for (const [type] of decorationTypes) {
    rangesByType.set(type, []);
  }

  for (const str of strings) {
    for (const token of tokenize(str.content)) {
      const absStart = str.contentStart + token.start;
      const startPos = editor.document.positionAt(absStart);
      const endPos = editor.document.positionAt(absStart + token.length);
      rangesByType.get(token.type)?.push(new vscode.Range(startPos, endPos));
    }
  }

  for (const [type, decType] of decorationTypes) {
    editor.setDecorations(decType, rangesByType.get(type) ?? []);
  }
}

// --- Extension lifecycle ---

export function activate(context: vscode.ExtensionContext): void {
  decorationTypes = createDecorationTypes();

  for (const decType of decorationTypes.values()) {
    context.subscriptions.push(decType);
  }

  if (vscode.window.activeTextEditor) {
    updateDecorations(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) updateDecorations(editor);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) {
        updateDecorations(editor);
      }
    })
  );
}

export function deactivate(): void {}
