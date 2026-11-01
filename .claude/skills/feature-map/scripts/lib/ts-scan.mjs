// Reads one TypeScript/JavaScript file with the TypeScript compiler's parser (no type checking) and
// returns the facts the feature map needs: imports, exported route handlers, Supabase calls,
// /api/ paths, env names, MCP tool definitions, local functions and what they call.

import { createRequire } from "node:module";
import { join } from "node:path";

let ts;

export function loadTypeScript(root) {
  if (!ts) ts = createRequire(join(root, "package.json"))("typescript");
  return ts;
}

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const ENV_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

function stringValue(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/**
 * A template literal as text: `${NAME}` becomes NAME's value when `constants` knows it (a string
 * constant of the same file), anything else becomes `*`.
 */
function templateText(node, constants = new Map(), returns = new Map(), depth = 0) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  // `${NAME}` (a constant) or `${helper(id)}` (a local function that returns a template).
  const value = (expression) => {
    if (ts.isIdentifier(expression) && constants.has(expression.text)) return constants.get(expression.text);
    if (depth < 5 && ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && returns.has(expression.expression.text)) {
      return templateText(returns.get(expression.expression.text), constants, returns, depth + 1) ?? "*";
    }
    return "*";
  };
  return node.head.text + node.templateSpans.map((span) => `${value(span.expression)}${span.literal.text}`).join("");
}

/** A comment's text: JSDoc stars and `//` markers removed. */
function commentText(comment) {
  return comment.startsWith("//") ? comment.split("\n").map((line) => line.replace(/^\s*\/\/\s?/, "")).join("\n") : comment;
}

function firstSentence(text) {
  const plain = text
    .replace(/^\/\*\*?|\*\/$/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trim())
    .filter((line) => line && !line.startsWith("@"))
    .join(" ")
    .replace(/\{@link ([^}]+)\}/g, "$1")
    .trim();
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(plain)?.[1] ?? plain;
  return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence;
}

/** The callee and leading string arguments of a call such as `withPermission("expenses", "edit", …)`. */
function describeCall(node) {
  if (!node || !ts.isCallExpression(node)) return null;
  const callee = node.expression.getText();
  const args = node.arguments.map((arg) => stringValue(arg)).filter((value) => value !== null);
  return { callee, args };
}

export function scanSource(path, text) {
  const isTsx = path.endsWith(".tsx") || path.endsWith(".jsx");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  const facts = {
    imports: [],
    exports: [],
    routeMethods: [],
    rpcs: new Set(),
    tables: new Set(),
    buckets: new Set(),
    apiPaths: new Set(),
    definedApi: {},
    envNames: new Set(),
    upperStrings: new Set(),
    jsxGates: [],
    tools: [],
    functions: [],
    objectMethods: [],
    calledIdentifiers: new Set(),
    testCases: 0,
    description: null,
    runtime: null,
    useClient: false,
  };

  facts.useClient = /^\s*(["'])use client\1/.test(text);

  // The file's description: a header comment (one before the imports, or set off by a blank line
  // from the first declaration). Without one, the first exported declaration's JSDoc, named.
  const isPreamble = (statement) => ts.isImportDeclaration(statement)
    || (ts.isExportDeclaration(statement) && !!statement.moduleSpecifier)
    || (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression));
  for (const statement of source.statements) {
    const ranges = ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? [];
    const preamble = isPreamble(statement);
    const header = ranges.find((range) => preamble || /\n\s*\n/.test(text.slice(range.end, statement.getStart())));
    if (header) {
      // Consecutive `//` lines form one comment.
      let end = header.end;
      for (const range of ranges.slice(ranges.indexOf(header) + 1)) {
        if (!text.slice(header.pos, header.end).startsWith("//") || !/^\s*$/.test(text.slice(end, range.pos)) || /\n\s*\n/.test(text.slice(end, range.pos))) break;
        end = range.end;
      }
      const comment = commentText(text.slice(header.pos, end)).trim();
      if (!/^(eslint|@ts-|prettier)/.test(comment)) facts.description = firstSentence(comment);
      break;
    }
    if (!preamble) break;
  }
  if (!facts.description) {
    for (const statement of source.statements) {
      if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const doc = (ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? []).map((r) => text.slice(r.pos, r.end)).filter((c) => c.startsWith("/**")).pop();
      if (!doc) continue;
      const name = statement.name?.text ?? statement.declarationList?.declarations[0]?.name.getText();
      facts.description = `${name ? `\`${name}\`: ` : ""}${firstSentence(doc)}`;
      break;
    }
  }

  // Module-level string constants and URL helpers, so `${REMINDERS_API_KEY}/summary` and
  // `${reminderApiUrl(id)}/complete` read as paths.
  const constants = new Map();
  const returns = new Map();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      const returned = statement.body.statements.find((s) => ts.isReturnStatement(s) && s.expression && (ts.isTemplateExpression(s.expression) || ts.isStringLiteral(s.expression) || ts.isNoSubstitutionTemplateLiteral(s.expression)));
      if (returned) returns.set(statement.name.text, returned.expression);
    }
  }
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const value = templateText(declaration.initializer, constants, returns);
      if (value !== null) constants.set(declaration.name.text, value);
    }
  }
  // The exported declaration being visited: an /api/ path inside it is what it *defines* (callers
  // that import it make the call); a path anywhere else is a call this file makes.
  let currentExport = null;

  const localDeclarations = new Map();

  const functionStack = [];
  const currentFunction = () => functionStack[functionStack.length - 1];

  const docOf = (node) => {
    const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
    const doc = ranges.map((range) => text.slice(range.pos, range.end)).filter((comment) => comment.startsWith("/**")).pop();
    return doc ? firstSentence(doc) : null;
  };

  const recordFunction = (name, node, exported) => {
    const entry = { name, exported, description: docOf(node), localCalls: new Set(), memberCalls: new Set(), rpcs: new Set(), tables: new Set() };
    facts.functions.push(entry);
    return entry;
  };

  const isExported = (node) => !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

  const visit = (node) => {
    let pushed = null;

    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const names = [];
      const clause = node.importClause;
      if (clause?.name) names.push(clause.name.text);
      if (clause?.namedBindings) {
        if (ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) names.push((element.propertyName ?? element.name).text);
        } else names.push("*");
      }
      facts.imports.push({ spec: node.moduleSpecifier.text, names, typeOnly: !!clause?.isTypeOnly });
    } else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        facts.imports.push({ spec: node.moduleSpecifier.text, names: [], typeOnly: !!node.isTypeOnly, reexport: true });
      }
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          const exported = element.name.text;
          const local = (element.propertyName ?? element.name).text;
          facts.exports.push(exported);
          if (HTTP_METHODS.has(exported)) facts.routeMethods.push({ method: exported, local });
        }
      }
    } else if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const calleeText = expression.getText();
      // Vitest cases: it(…), test(…), it.skip(…), it.each(table)(…).
      if (/^(it|test)(\.(skip|only|todo|concurrent|fails|sequential))?$/.test(calleeText)
        || (ts.isCallExpression(expression) && /^(it|test)\.each$/.test(expression.expression.getText()))) facts.testCases++;
      // import("x") and require("x")
      if (expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(expression) && expression.text === "require")) {
        const spec = stringValue(node.arguments[0]);
        if (spec) facts.imports.push({ spec, names: [], typeOnly: false, dynamic: true });
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const method = expression.name.text;
        const first = stringValue(node.arguments[0]);
        if (first && method === "rpc") {
          facts.rpcs.add(first);
          currentFunction()?.rpcs.add(first);
        }
        if (first && method === "from") {
          const target = expression.expression.getText();
          if (/\.storage$|^storage$/.test(target)) facts.buckets.add(first);
          else if (target !== "Array" && target !== "Buffer" && /^[a-z_][a-z0-9_]*$/.test(first)) {
            facts.tables.add(first);
            currentFunction()?.tables.add(first);
          }
        }
        if (ts.isIdentifier(expression.expression)) currentFunction()?.memberCalls.add(`${expression.expression.text}.${method}`);
      }
      if (ts.isIdentifier(expression)) {
        facts.calledIdentifiers.add(expression.text);
        currentFunction()?.localCalls.add(expression.text);
        if (expression.text === "defineTool" && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
          const tool = {};
          for (const prop of node.arguments[0].properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const key = prop.name.getText();
            const value = stringValue(prop.initializer);
            if (["name", "title", "module", "notFound"].includes(key) && value !== null) tool[key] = value;
            if (key === "description") tool.description = value ?? prop.initializer.getText().replace(/\s+/g, " ").slice(0, 200);
            if (key === "annotations") tool.annotations = prop.initializer.getText();
          }
          if (tool.name) facts.tools.push(tool);
        }
      }
    } else if (ts.isPropertyAccessExpression(node)) {
      // process.env.NAME, and env.NAME on an injected env record (`env = process.env`).
      if (node.expression.getText() === "process.env") facts.envNames.add(node.name.text);
      else if (ENV_NAME.test(node.name.text) && /(^|\.)env$/i.test(node.expression.getText())) facts.envNames.add(node.name.text);
    } else if (ts.isElementAccessExpression(node)) {
      const key = stringValue(node.argumentExpression);
      if (key && node.expression.getText() === "process.env") facts.envNames.add(key);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const value = ts.isTemplateExpression(node) ? templateText(node, constants, returns) : node.text;
      if (value?.startsWith("/api/")) {
        const path = value.split(/[?#]/)[0];
        if (currentExport) for (const name of currentExport) (facts.definedApi[name] ??= []).includes(path) || facts.definedApi[name].push(path);
        else facts.apiPaths.add(path);
      }
      if (value && ENV_NAME.test(value)) facts.upperStrings.add(value);
    } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      if (tag === "PermissionGate") {
        const attrs = {};
        for (const attr of node.attributes.properties) {
          if (ts.isJsxAttribute(attr) && attr.initializer) {
            const value = ts.isStringLiteral(attr.initializer) ? attr.initializer.text : attr.initializer.getText();
            attrs[attr.name.getText()] = value;
          }
        }
        facts.jsxGates.push({ tag, ...attrs });
      }
    }

    // Local functions: `function x() {}` and `const x = (…) => …` / `const x = function () {}`.
    if (ts.isFunctionDeclaration(node) && node.name && ts.isSourceFile(node.parent)) {
      const exported = isExported(node);
      if (exported) facts.exports.push(node.name.text);
      if (exported && HTTP_METHODS.has(node.name.text)) facts.routeMethods.push({ method: node.name.text, local: node.name.text, wrapper: null });
      pushed = recordFunction(node.name.text, node, exported);
    } else if (ts.isVariableStatement(node) && ts.isSourceFile(node.parent)) {
      const exported = isExported(node);
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        localDeclarations.set(name, declaration.initializer);
        if (exported) facts.exports.push(name);
        if (name === "runtime" && declaration.initializer) facts.runtime = stringValue(declaration.initializer);
        if (exported && HTTP_METHODS.has(name)) facts.routeMethods.push({ method: name, local: name });
      }
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      && ts.isSourceFile(node.parent?.parent?.parent)) {
      pushed = recordFunction(node.name.text, node.parent.parent, isExported(node.parent.parent));
    } else if ((ts.isMethodDeclaration(node) || (ts.isPropertyAssignment(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))))
      && ts.isObjectLiteralExpression(node.parent)) {
      const entry = { name: node.name.getText(), exported: false, localCalls: new Set(), memberCalls: new Set(), rpcs: new Set(), tables: new Set() };
      facts.objectMethods.push(entry);
      pushed = entry;
    }

    const exportScope = node.parent && ts.isSourceFile(node.parent) && isExported(node)
      ? ts.isVariableStatement(node) ? node.declarationList.declarations.map((d) => d.name.getText()) : node.name ? [node.name.getText()] : null
      : null;
    if (exportScope) currentExport = exportScope;
    if (pushed) functionStack.push(pushed);
    ts.forEachChild(node, visit);
    if (pushed) functionStack.pop();
    if (exportScope) currentExport = null;
  };
  visit(source);

  // Resolve each route method's wrapper: `export const GET = withUser(…)`, or a re-exported local.
  for (const method of facts.routeMethods) {
    if (method.wrapper === null) continue;
    let initializer = localDeclarations.get(method.local);
    // `const handle = withX(…)`, or `const handle = async (…) => …` (no wrapper).
    method.wrapper = describeCall(initializer);
    if (!method.wrapper && initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) method.wrapper = null;
    delete method.local;
  }
  for (const method of facts.routeMethods) delete method.local;

  const toArrays = (entry) => ({
    ...entry,
    localCalls: [...entry.localCalls],
    memberCalls: [...entry.memberCalls],
    rpcs: [...entry.rpcs],
    tables: [...entry.tables],
  });

  return {
    ...facts,
    rpcs: [...facts.rpcs],
    tables: [...facts.tables],
    buckets: [...facts.buckets],
    apiPaths: [...facts.apiPaths],
    envNames: [...facts.envNames],
    upperStrings: [...facts.upperStrings],
    calledIdentifiers: [...facts.calledIdentifiers],
    functions: facts.functions.map(toArrays),
    objectMethods: facts.objectMethods.map(toArrays),
    exports: [...new Set(facts.exports)],
  };
}
