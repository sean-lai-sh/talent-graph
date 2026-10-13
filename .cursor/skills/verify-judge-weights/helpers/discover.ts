/**
 * Every exported Convex query, from the generated API and from function
 * metadata (`isConvexFunction` / `isQuery` on each module export).
 *
 * The generated `api` / `internal` types are the list Convex codegen publishes,
 * including nested modules and wrappers whose return type is still a query.
 * A second pass types every file under `convex/` (except `_generated`) so a
 * query in a subfolder is still found when codegen is stale.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

export type QueryVisibility = "public" | "internal" | "unknown";

export type DiscoveredQuery = {
  ref: string;
  module: string;
  name: string;
  visibility: QueryVisibility;
  argsEmpty: boolean;
  file: string;
};

export type DiscoverOptions = {
  compilerOptions?: ts.CompilerOptions;
};

const SERVER_DTS = join(
  import.meta.dir,
  "../../../../apps/club/node_modules/convex/dist/esm-types/server/index.d.ts",
);

export function discoverQueries(convexDir: string, options?: DiscoverOptions): DiscoveredQuery[] {
  const files = sourceFiles(convexDir);
  const apiDts = join(convexDir, "_generated", "api.d.ts");
  const hasApi = existsSync(apiDts);
  const compilerOptions = options?.compilerOptions ?? optionsFor(convexDir);
  const host = compilerHost(compilerOptions, dirname(convexDir));
  const rootNames = hasApi ? [apiDts, ...files] : files;
  const program = ts.createProgram({ rootNames, options: compilerOptions, host });
  const checker = program.getTypeChecker();
  const found = new Map<string, DiscoveredQuery>();

  if (hasApi) {
    const apiFile = program.getSourceFile(apiDts);
    if (apiFile) {
      const moduleFiles = moduleFileMap(apiFile);
      for (const root of ["api", "internal"] as const) {
        const symbol = exportedSymbol(checker, apiFile, root);
        if (!symbol) continue;
        const type = checker.getTypeOfSymbolAtLocation(symbol, apiFile);
        walkApi(checker, apiFile, type, [], moduleFiles, found);
      }
    }
  }

  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const modulePath = modulePathOf(convexDir, file);
    if (modulePath === "") continue;
    collectModuleQueries(checker, source, modulePath, found);
  }

  if (found.size === 0) {
    const lines = ts
      .getPreEmitDiagnostics(program)
      .slice(0, 8)
      .map((diag) => ts.flattenDiagnosticMessageText(diag.messageText, "\n"));
    throw new Error(
      `generated API produced no Convex queries${lines.length > 0 ? `\n${lines.join("\n")}` : ""}`,
    );
  }

  return [...found.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

export function generatedApiExists(convexDir: string): boolean {
  return existsSync(join(convexDir, "_generated", "api.d.ts"));
}

function sourceFiles(convexDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith("_")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(tsx?|jsx?|mts)$/.test(entry.name) || entry.name.endsWith(".d.ts")) continue;
      out.push(abs);
    }
  };
  walk(convexDir);
  return out;
}

function optionsFor(convexDir: string): ts.CompilerOptions {
  const configPath = join(dirname(convexDir), "tsconfig.json");
  if (!existsSync(configPath)) return standaloneOptions();
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) return standaloneOptions();
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(convexDir));
  const options: ts.CompilerOptions = { ...parsed.options, noEmit: true, skipLibCheck: true };
  delete options.incremental;
  delete options.tsBuildInfoFile;
  delete options.plugins;
  return options;
}

function standaloneOptions(): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    esModuleInterop: true,
    lib: ["ES2022"],
  };
}

function convexServerDts(clubDir: string): string | undefined {
  const beside = join(clubDir, "node_modules/convex/dist/esm-types/server/index.d.ts");
  if (existsSync(beside)) return beside;
  if (existsSync(SERVER_DTS)) return SERVER_DTS;
  return undefined;
}

function compilerHost(options: ts.CompilerOptions, clubDir: string): ts.CompilerHost {
  const host = ts.createCompilerHost(options, true);
  const fallback = convexServerDts(clubDir);
  const resolveName = (name: string, containingFile: string): ts.ResolvedModuleFull | undefined => {
    const resolved = ts.resolveModuleName(name, containingFile, options, host).resolvedModule;
    if (resolved) return resolved;
    if (name === "convex/server" && fallback) {
      return {
        resolvedFileName: fallback,
        extension: ts.Extension.Dts,
        isExternalLibraryImport: true,
      };
    }
    return undefined;
  };
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((name) => resolveName(name, containingFile));
  return host;
}

function exportedSymbol(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  name: string,
): ts.Symbol | undefined {
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return undefined;
  return checker.getExportsOfModule(moduleSymbol).find((item) => item.getName() === name);
}

function walkApi(
  checker: ts.TypeChecker,
  at: ts.SourceFile,
  type: ts.Type,
  path: string[],
  moduleFiles: Map<string, string>,
  found: Map<string, DiscoveredQuery>,
): void {
  if (path.length > 12) return;
  const apparent = checker.getApparentType(type);
  const kind = literal(checker, at, apparent, "_type");
  if (kind === "query" || kind === "mutation" || kind === "action") {
    if (kind !== "query") return;
    const name = path.at(-1);
    if (!name || path.length < 2) return;
    const modulePath = path.slice(0, -1).join("/");
    const visibility = visibilityOf(literal(checker, at, apparent, "_visibility"));
    const ref = `${modulePath}:${name}`;
    found.set(ref, {
      ref,
      module: modulePath,
      name,
      visibility,
      argsEmpty: argsAreEmpty(checker, at, apparent),
      file: moduleFiles.get(modulePath) ?? "",
    });
    return;
  }
  for (const prop of checker.getPropertiesOfType(apparent)) {
    const propName = prop.getName();
    if (propName.startsWith("_")) continue;
    const propType = checker.getTypeOfSymbolAtLocation(prop, at);
    walkApi(checker, at, propType, [...path, propName], moduleFiles, found);
  }
}

function collectModuleQueries(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  modulePath: string,
  found: Map<string, DiscoveredQuery>,
): void {
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return;
  for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
    const name = symbol.getName();
    if (name === "__exportStar__") continue;
    const apparent = checker.getApparentType(checker.getTypeOfSymbolAtLocation(symbol, source));
    if (!isTrueFlag(checker, source, apparent, "isConvexFunction")) continue;
    if (!isTrueFlag(checker, source, apparent, "isQuery")) continue;
    const visibility = isTrueFlag(checker, source, apparent, "isPublic")
      ? "public"
      : isTrueFlag(checker, source, apparent, "isInternal")
        ? "internal"
        : "unknown";
    const ref = `${modulePath}:${name}`;
    const existing = found.get(ref);
    const file = source.fileName;
    if (existing) {
      if (existing.file === "") existing.file = file;
      continue;
    }
    const initializer = exportInitializer(source, name);
    found.set(ref, {
      ref,
      module: modulePath,
      name,
      visibility,
      argsEmpty: argsEmptyFromInitializer(initializer),
      file,
    });
  }
}

function literal(
  checker: ts.TypeChecker,
  at: ts.Node,
  type: ts.Type,
  prop: string,
): string | undefined {
  const symbol = type.getProperty(prop);
  if (!symbol) return undefined;
  const propType = checker.getTypeOfSymbolAtLocation(symbol, at);
  if (propType.isStringLiteral()) return propType.value;
  return undefined;
}

function visibilityOf(value: string | undefined): QueryVisibility {
  if (value === "public" || value === "internal") return value;
  return "unknown";
}

function isTrueFlag(checker: ts.TypeChecker, at: ts.Node, type: ts.Type, prop: string): boolean {
  const symbol = type.getProperty(prop);
  if (!symbol) return false;
  const propType = checker.getTypeOfSymbolAtLocation(symbol, at);
  return (
    (propType.flags & ts.TypeFlags.BooleanLiteral) !== 0 &&
    checker.typeToString(propType) === "true"
  );
}

function argsAreEmpty(checker: ts.TypeChecker, at: ts.Node, type: ts.Type): boolean {
  const symbol = type.getProperty("_args");
  if (!symbol) return false;
  const args = checker.getTypeOfSymbolAtLocation(symbol, at);
  if (args.flags & ts.TypeFlags.Any) return false;
  if (args.isUnion()) return false;
  if (checker.getIndexInfosOfType(args).length > 0) return false;
  const required = checker
    .getPropertiesOfType(args)
    .filter((prop) => (prop.flags & ts.SymbolFlags.Optional) === 0);
  return required.length === 0;
}

function moduleFileMap(source: ts.SourceFile): Map<string, string> {
  const aliasToSpec = new Map<string, string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause?.namedBindings) continue;
    if (!ts.isNamespaceImport(stmt.importClause.namedBindings)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    aliasToSpec.set(stmt.importClause.namedBindings.name.text, stmt.moduleSpecifier.text);
  }
  const modules = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      node.typeName.text === "ApiFromModules" &&
      node.typeArguments?.[0] &&
      ts.isTypeLiteralNode(node.typeArguments[0])
    ) {
      for (const member of node.typeArguments[0].members) {
        if (!ts.isPropertySignature(member) || !member.name || !member.type) continue;
        if (!ts.isTypeQueryNode(member.type) || !ts.isIdentifier(member.type.exprName)) continue;
        const key = propertyNameText(member.name);
        const spec = key ? aliasToSpec.get(member.type.exprName.text) : undefined;
        if (!key || !spec) continue;
        const file = resolveImported(dirname(source.fileName), spec);
        if (file) modules.set(key, file);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return modules;
}

function resolveImported(fromDir: string, spec: string): string | undefined {
  const raw = resolve(fromDir, spec);
  const stem = raw.replace(/\.(js|mjs|cjs|ts|tsx)$/, "");
  const candidates = [`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.js`, raw];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

function modulePathOf(convexDir: string, fileName: string): string {
  const rel = relative(convexDir, fileName).replaceAll("\\", "/");
  if (rel.startsWith("..") || rel.split("/").some((part) => part.startsWith("_"))) return "";
  return rel.replace(/\.(tsx?|jsx?|mts)$/, "");
}

export function exportInitializer(source: ts.SourceFile, name: string): ts.Expression | undefined {
  let local: ts.Expression | undefined;
  for (const stmt of source.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== name || !decl.initializer) continue;
        if (hasExport(stmt)) return decl.initializer;
        local = decl.initializer;
      }
    }
    if (
      !ts.isExportDeclaration(stmt) ||
      !stmt.exportClause ||
      !ts.isNamedExports(stmt.exportClause)
    ) {
      continue;
    }
    for (const spec of stmt.exportClause.elements) {
      const exported = spec.name.text;
      const original = spec.propertyName?.text ?? exported;
      if (exported === name && local && original === name) return local;
    }
  }
  return local && hasExportNamed(source, name) ? local : undefined;
}

function hasExport(stmt: ts.VariableStatement): boolean {
  return stmt.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasExportNamed(source: ts.SourceFile, name: string): boolean {
  for (const stmt of source.statements) {
    if (
      !ts.isExportDeclaration(stmt) ||
      !stmt.exportClause ||
      !ts.isNamedExports(stmt.exportClause)
    ) {
      continue;
    }
    if (stmt.moduleSpecifier) continue;
    for (const spec of stmt.exportClause.elements) {
      if (spec.name.text === name) return true;
    }
  }
  return false;
}

export function argsEmptyFromInitializer(expr: ts.Expression | undefined): boolean {
  const obj = objectLiteralArg(expr);
  if (!obj) return false;
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (propertyNameText(prop.name) !== "args") continue;
    return (
      ts.isObjectLiteralExpression(prop.initializer) && prop.initializer.properties.length === 0
    );
  }
  return false;
}

export function objectLiteralArg(
  expr: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (!expr || !ts.isCallExpression(expr)) return undefined;
  for (const arg of expr.arguments) {
    if (ts.isObjectLiteralExpression(arg)) return arg;
  }
  if (ts.isCallExpression(expr.expression)) return objectLiteralArg(expr.expression);
  return undefined;
}

export function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return undefined;
}
