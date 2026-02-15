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
  start: number;
  end: number;
  content: string;
}

interface CallSite {
  methodName: string;
  nameOffset: number;
  argsText: string;
  argsStart: number;
}

// --- Decoration setup ---

const TOKEN_COLORS: Record<TokenType, { light: string; dark: string }> = {
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

function createDecorationTypes(): Map<TokenType, vscode.TextEditorDecorationType> {
  return new Map(
    Object.entries(TOKEN_COLORS).map(([type, colors]) => [
      type as TokenType,
      vscode.window.createTextEditorDecorationType({
        light: { color: colors.light },
        dark: { color: colors.dark },
      }),
    ])
  );
}

// --- SQL tokenizer ---

const KEYWORDS = [
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

const FUNCTIONS = [
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

const TYPES = [
  "INT", "INTEGER", "SMALLINT", "BIGINT", "TINYINT",
  "FLOAT", "REAL", "DOUBLE", "DECIMAL", "NUMERIC", "MONEY",
  "VARCHAR", "NVARCHAR", "CHAR", "NCHAR", "TEXT", "NTEXT", "CLOB",
  "BOOLEAN", "BOOL", "BIT",
  "DATE", "TIME", "TIMESTAMP", "DATETIME", "DATETIME2", "INTERVAL",
  "BLOB", "BINARY", "VARBINARY", "BYTEA", "IMAGE",
  "UUID", "UNIQUEIDENTIFIER", "SERIAL", "BIGSERIAL",
  "JSON", "JSONB", "XML", "ARRAY",
].join("|");

const TOKEN_REGEX = new RegExp(
  `\\b(${KEYWORDS})\\b` +
  `|\\b(${FUNCTIONS})(?=\\s*\\()` +
  `|(<=|>=|<>|!=|!<|!>|::|\\|\\||&&|=|<|>|\\+|-|/|%)` +
  `|('(?:[^'\\\\]|\\\\.)*')` +
  `|(\\b[0-9]+(?:\\.[0-9]+)?\\b)` +
  `|\\b(${TYPES})\\b` +
  `|(\\b\\w+\\b)` +
  `|(\\*)` +
  `|([()])` +
  `|(,)` +
  `|(\\.)`,
  "gi"
);

const GROUP_TO_TYPE: TokenType[] = [
  "keyword", "function", "operator", "string", "number",
  "type", "identifier", "star", "parenthesis", "comma", "dot",
];

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_REGEX.exec(sql)) !== null) {
    for (let i = 1; i < match.length; i++) {
      if (match[i] !== undefined) {
        tokens.push({ type: GROUP_TO_TYPE[i - 1], start: match.index, length: match[0].length });
        break;
      }
    }
  }
  return tokens;
}

// --- C# string literal parsing ---

const RAW_STRING = '"""[\\s\\S]*?"""';
const VERBATIM_STRING = '@"(?:[^"]|"")*"';
const REGULAR_STRING = '"(?:[^"\\\\]|\\\\.)*"';
const CSHARP_STRING = `${RAW_STRING}|${VERBATIM_STRING}|${REGULAR_STRING}`;

function extractStringContent(raw: string, rawStart: number): StringRange | null {
  let skip: number;
  let trim: number;
  if (raw.startsWith('"""'))    { skip = 3; trim = 3; }
  else if (raw.startsWith('@"')) { skip = 2; trim = 1; }
  else if (raw.startsWith('"'))  { skip = 1; trim = 1; }
  else return null;

  const start = rawStart + skip;
  const end = rawStart + raw.length - trim;
  if (end <= start) return null;
  return { start, end, content: raw.slice(skip, -trim) };
}

// --- Call site detection ---

const SKIP_NAMES = new Set([
  "if", "while", "for", "foreach", "switch", "catch", "using",
  "return", "typeof", "nameof", "sizeof", "throw", "await",
  "lock", "when", "var", "class", "struct", "interface",
  "enum", "delegate", "event", "namespace",
]);

const HAS_CSHARP_STRING = new RegExp(CSHARP_STRING);
const CALL_SITE_PATTERN = new RegExp(
  `(\\w+)\\s*(?:<[^>]*>)?\\s*\\(((?:${CSHARP_STRING}|[^)])*)\\)`, "g"
);

function findCallSites(text: string): CallSite[] {
  const sites: CallSite[] = [];
  CALL_SITE_PATTERN.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = CALL_SITE_PATTERN.exec(text)) !== null) {
    const methodName = m[1];
    if (SKIP_NAMES.has(methodName)) continue;

    const argsText = m[2];
    if (!HAS_CSHARP_STRING.test(argsText)) continue;

    sites.push({
      methodName,
      nameOffset: m.index,
      argsText,
      argsStart: m.index + m[0].length - argsText.length - 1,
    });
  }

  return sites;
}

function extractStringsFromSites(sites: CallSite[]): StringRange[] {
  const ranges: StringRange[] = [];
  for (const site of sites) {
    const pattern = new RegExp(CSHARP_STRING, "g");
    let sm: RegExpExecArray | null;
    while ((sm = pattern.exec(site.argsText)) !== null) {
      const range = extractStringContent(sm[0], site.argsStart + sm.index);
      if (range) ranges.push(range);
    }
  }
  return ranges;
}

// --- LSP-based [StringSyntax] resolution ---

// Precise cache: "definitionUri#methodName" → has attribute
const definitionCache = new Map<string, boolean>();
// Fast cache: "methodName" → has attribute (used for instant sync re-render on text change)
const methodNameCache = new Map<string, boolean>();
let lspTimer: ReturnType<typeof setTimeout> | undefined;

const STRINGSYNTAX_SQL = /\[StringSyntax\("[^"]*sql[^"]*"\)\]/i;

async function resolveMethod(
  doc: vscode.TextDocument,
  nameOffset: number,
  methodName: string,
): Promise<boolean> {
  const position = doc.positionAt(nameOffset);

  let defs: (vscode.Location | vscode.LocationLink)[] | undefined;
  try {
    defs = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      "vscode.executeDefinitionProvider", doc.uri, position,
    );
  } catch {
    return false;
  }
  if (!defs || defs.length === 0) return false;

  const def = defs[0];
  const defUri = "targetUri" in def ? def.targetUri : def.uri;
  const defRange = "targetRange" in def ? def.targetRange : def.range;
  const cacheKey = `${defUri.toString()}#${methodName}`;

  const cached = definitionCache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const defDoc = await vscode.workspace.openTextDocument(defUri);
    const defText = defDoc.getText();
    const defOffset = defDoc.offsetAt(defRange.start);

    const windowStart = Math.max(0, defOffset - 200);
    const windowEnd = Math.min(defText.length, defOffset + 500);
    const result = STRINGSYNTAX_SQL.test(defText.slice(windowStart, windowEnd));

    definitionCache.set(cacheKey, result);
    if (result) methodNameCache.set(methodName, true);
    return result;
  } catch {
    definitionCache.set(cacheKey, false);
    return false;
  }
}

function findStringsCached(text: string): StringRange[] {
  if (methodNameCache.size === 0) return [];
  return extractStringsFromSites(
    findCallSites(text).filter((s) => methodNameCache.get(s.methodName)),
  );
}

async function findStringsLSP(editor: vscode.TextEditor): Promise<StringRange[]> {
  const callSites = findCallSites(editor.document.getText());
  if (callSites.length === 0) return [];

  const resolved = await Promise.all(
    callSites.map((s) => resolveMethod(editor.document, s.nameOffset, s.methodName)),
  );
  return extractStringsFromSites(callSites.filter((_, i) => resolved[i]));
}

// --- Decoration application ---

function applyDecorations(editor: vscode.TextEditor, strings: StringRange[]): void {
  const rangesByType = new Map<TokenType, vscode.Range[]>();
  for (const [type] of decorationTypes) rangesByType.set(type, []);

  for (const str of strings) {
    for (const token of tokenize(str.content)) {
      const absStart = str.start + token.start;
      const startPos = editor.document.positionAt(absStart);
      const endPos = editor.document.positionAt(absStart + token.length);
      rangesByType.get(token.type)!.push(new vscode.Range(startPos, endPos));
    }
  }

  for (const [type, decType] of decorationTypes) {
    editor.setDecorations(decType, rangesByType.get(type)!);
  }
}

function deduplicate(ranges: StringRange[]): StringRange[] {
  const seen = new Set<string>();
  return ranges.filter((r) => {
    const key = `${r.start}:${r.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scheduleLspPass(editor: vscode.TextEditor): void {
  if (lspTimer) clearTimeout(lspTimer);
  const version = editor.document.version;

  lspTimer = setTimeout(async () => {
    if (vscode.window.activeTextEditor !== editor) return;
    if (editor.document.version !== version) return;

    const lspStrings = await findStringsLSP(editor);
    if (lspStrings.length === 0) return;
    if (vscode.window.activeTextEditor !== editor) return;
    if (editor.document.version !== version) return;

    const cached = findStringsCached(editor.document.getText());
    applyDecorations(editor, deduplicate([...cached, ...lspStrings]));
  }, 300);
}

function updateDecorations(editor: vscode.TextEditor): void {
  if (editor.document.languageId !== "csharp") return;

  applyDecorations(editor, findStringsCached(editor.document.getText()));
  scheduleLspPass(editor);
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
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      definitionCache.clear();
      methodNameCache.clear();
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.languageId === "csharp") {
        scheduleLspPass(editor);
      }
    }),
  );
}

export function deactivate(): void {
  if (lspTimer) clearTimeout(lspTimer);
}
