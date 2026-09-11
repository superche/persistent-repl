import { transformFromAstSync } from "@babel/core";
import asyncToGenerator from "@babel/plugin-transform-async-to-generator";
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";
export interface Binding {
  name: string;
  kind: string;
}
export const RESERVED = [
  "output",
  "services",
  "console",
  "globalThis",
  "eval",
  "Proxy",
];
function rejectUnsupportedAsync(ast: t.File) {
  traverse(ast, {
    Function(path) {
      if (path.node.async && path.node.generator)
        throw Object.assign(
          new SyntaxError(
            "Async generators are unsupported; use async functions and registered wait resources.",
          ),
          { loc: path.node.loc?.start },
        );
    },
  });
}
export function compile(
  code: string,
  previous: Binding[],
  globals: string[] = [],
) {
  const ast = parse(code, {
    sourceType: "module",
    allowAwaitOutsideFunction: true,
  });
  rejectUnsupportedAsync(ast);
  const bindings: Binding[] = [];
  const warnings: { code: string; message: string; line?: number }[] = [];
  let programPath: any;
  const reserved = new Set([...RESERVED, ...globals]);
  traverse(ast, {
    Program(path) {
      programPath = path;
    },
    Identifier(path) {
      if (path.node.name.startsWith("__repl"))
        throw Object.assign(
          new SyntaxError("Reserved identifier prefix: __repl"),
          { loc: path.node.loc?.start },
        );
    },
    ImportDeclaration(path) {
      throw Object.assign(
        new SyntaxError(
          "Static import is unsupported; use await import(name).",
        ),
        { loc: path.node.loc?.start },
      );
    },
    ExportDeclaration(path) {
      throw Object.assign(new SyntaxError("Exports are not cell syntax."), {
        loc: path.node.loc?.start,
      });
    },
    ImportExpression(path) {
      path.replaceWith(
        t.callExpression(
          t.memberExpression(
            t.identifier("__repl"),
            t.identifier("importModule"),
          ),
          [path.node.source],
        ),
      );
      path.skip();
    },
    MetaProperty(path) {
      throw Object.assign(
        new SyntaxError("import.meta is not available in cells."),
        { loc: path.node.loc?.start },
      );
    },
  });
  for (const [name, binding] of Object.entries<any>(
    programPath.scope.bindings,
  )) {
    if (reserved.has(name)) throw new SyntaxError(`Reserved global: ${name}`);
    bindings.push({ name, kind: binding.kind });
  }
  const declared = new Map(bindings.map((b) => [b.name, b.kind]));
  const inherited = previous.filter((b) => !declared.has(b.name));
  const hoisted = new Set(
    bindings
      .filter((b) => b.kind === "var" || b.kind === "hoisted")
      .map((b) => b.name),
  );
  const call = (method: string, args: t.Expression[]) =>
    t.callExpression(
      t.memberExpression(t.identifier("__repl"), t.identifier(method)),
      args,
    );
  const namesOf = (n: any) => Object.keys(t.getBindingIdentifiers(n));
  traverse(ast, {
    AssignmentExpression: {
      exit(path) {
        const names = namesOf(path.node.left);
        for (const name of names)
          if (inherited.some((b) => b.name === name && b.kind === "const"))
            warnings.push({
              code: "CONST_REASSIGN_COMPAT",
              message: `${name}: inherited const is mutable in this cell; use let. Compile warning, not execution evidence.`,
              line: path.node.loc?.start.line,
            });
        const track = names.filter(
          (n) =>
            hoisted.has(n) &&
            path.scope.getBinding(n)?.scope === programPath.scope,
        );
        if (track.length) {
          path.replaceWith(
            call("assigned", [
              t.arrayExpression(track.map((n) => t.stringLiteral(n))),
              path.node,
            ]),
          );
          path.skip();
        }
      },
    },
    UpdateExpression: {
      exit(path) {
        if (!t.isIdentifier(path.node.argument)) return;
        const name = path.node.argument.name;
        if (inherited.some((b) => b.name === name && b.kind === "const"))
          warnings.push({
            code: "CONST_REASSIGN_COMPAT",
            message: `${name}: inherited const update compatibility; compile warning, not execution evidence.`,
            line: path.node.loc?.start.line,
          });
        if (
          hoisted.has(name) &&
          path.scope.getBinding(name)?.scope === programPath.scope
        ) {
          path.replaceWith(
            call("assigned", [
              t.arrayExpression([t.stringLiteral(name)]),
              path.node,
            ]),
          );
          path.skip();
        }
      },
    },
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (
        declared.get(name) === "hoisted" &&
        path.scope.getBinding(name)?.scope === programPath.scope
      ) {
        path.replaceWith(
          call("used", [t.stringLiteral(name), t.identifier(name)]),
        );
        path.skip();
      }
    },
    VariableDeclaration: {
      exit(path) {
        if (path.node.kind !== "var" || !path.inList) return;
        const names = namesOf(path.node).filter(
          (n) =>
            hoisted.has(n) &&
            path.scope.getBinding(n)?.scope === programPath.scope,
        );
        if (names.length)
          path.insertAfter(
            t.expressionStatement(
              call("mark", [
                t.arrayExpression(names.map((n) => t.stringLiteral(n))),
              ]),
            ),
          );
      },
    },
    FunctionDeclaration: {
      exit(path) {
        if (path.parentPath.isProgram() && path.node.id)
          path.insertAfter(
            t.expressionStatement(
              call("mark", [
                t.arrayExpression([t.stringLiteral(path.node.id.name)]),
              ]),
            ),
          );
      },
    },
  });
  const all = [...inherited, ...bindings];
  const getters = all.map((b) =>
    t.objectProperty(
      t.stringLiteral(b.name),
      t.arrowFunctionExpression([], t.identifier(b.name)),
    ),
  );
  const prelude = inherited.map((b) =>
    t.variableDeclaration("let", [
      t.variableDeclarator(
        t.identifier(b.name),
        call("previous", [t.stringLiteral(b.name)]),
      ),
    ]),
  );
  const block = t.blockStatement([
    t.expressionStatement(
      call("register", [t.objectExpression(getters), t.valueToNode(bindings)]),
    ),
    ...(ast.program.body as t.Statement[]),
  ]);
  const func = t.functionExpression(
    null,
    [t.identifier("__repl")],
    t.blockStatement([
      ...["output", "services", "console", ...globals].map((name) =>
        t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier(name),
            t.memberExpression(t.identifier("__repl"), t.identifier(name)),
          ),
        ]),
      ),
      ...prelude,
      t.tryStatement(
        block,
        null,
        t.blockStatement([t.expressionStatement(call("commit", []))]),
      ),
    ]),
    false,
    true,
  );
  func.body.directives = [t.directive(t.directiveLiteral("use strict"))];
  const transformed = transformFromAstSync(
    t.file(t.program([t.expressionStatement(func)])),
    code,
    {
      plugins: [asyncToGenerator],
      configFile: false,
      babelrc: false,
      ast: true,
      code: false,
      filename: "cell.js",
    },
  );
  const transformedAst = transformed!.ast as t.File;
  const last = transformedAst.program.body.pop() as t.ExpressionStatement;
  const wrapped = t.arrowFunctionExpression(
    [],
    t.blockStatement([
      ...(transformedAst.program.body as t.Statement[]),
      t.returnStatement(last.expression),
    ]),
  );
  const final = generate(
    t.callExpression(wrapped, []),
    { sourceMaps: true, sourceFileName: "cell.js" },
    code,
  );
  return { source: final.code, map: final.map, warnings };
}
/** All guest async functions, including registered modules/facades, use the tracked Promise. */
export function compileModule(source: string) {
  const ast = parse(source, { sourceType: "module" });
  rejectUnsupportedAsync(ast);
  return generate(
    transformFromAstSync(ast, source, {
      plugins: [asyncToGenerator],
      configFile: false,
      babelrc: false,
      ast: true,
      code: false,
    })!.ast as t.File,
  ).code;
}

/** Compile a registered module for the Node/V8 kernel without enabling Node's module loader. */
export function compileModuleForNode(source: string) {
  const ast = parse(source, {
    sourceType: "module",
    allowAwaitOutsideFunction: true,
  });
  rejectUnsupportedAsync(ast);
  const exports: string[] = [];
  for (let index = 0; index < ast.program.body.length; index++) {
    const statement = ast.program.body[index];
    if (t.isImportDeclaration(statement))
      throw Object.assign(
        new Error("Static module imports are unavailable in the Node kernel."),
        {
          code: "MODULE_DENIED",
          stage: "link",
        },
      );
    if (t.isExportAllDeclaration(statement))
      throw Object.assign(
        new Error("Export-all module declarations are unavailable."),
        {
          code: "MODULE_DENIED",
          stage: "link",
        },
      );
    if (t.isExportNamedDeclaration(statement)) {
      const declaration = statement.declaration;
      if (declaration) {
        ast.program.body[index] = declaration as any;
        for (const name of Object.keys(t.getBindingIdentifiers(declaration)))
          exports.push(`__moduleExports[${JSON.stringify(name)}]=${name};`);
      } else {
        for (const specifier of statement.specifiers) {
          if (!t.isExportSpecifier(specifier)) continue;
          const exported = t.isIdentifier(specifier.exported)
            ? specifier.exported.name
            : (specifier.exported as any).value;
          const local = t.isIdentifier(specifier.local)
            ? specifier.local.name
            : (specifier.local as any).value;
          exports.push(
            `__moduleExports[${JSON.stringify(exported)}]=${local};`,
          );
        }
        ast.program.body[index] = t.emptyStatement();
      }
    } else if (t.isExportDefaultDeclaration(statement)) {
      const declaration = statement.declaration;
      if (
        (t.isFunctionDeclaration(declaration) ||
          t.isClassDeclaration(declaration)) &&
        declaration.id
      ) {
        exports.push(`__moduleExports.default=${declaration.id.name};`);
        ast.program.body[index] = declaration;
      } else {
        exports.push("__moduleExports.default=__moduleDefault;");
        ast.program.body[index] = t.variableDeclaration("const", [
          t.variableDeclarator(
            t.identifier("__moduleDefault"),
            declaration as any,
          ),
        ]);
      }
    }
  }
  const body = generate(ast).code;
  return `(async()=>{const __moduleExports=Object.create(null);${body}${exports.join("")}return __moduleExports;})()`;
}
export function compileFacade(source: string) {
  const ast = parse(`(${source})`, { sourceType: "script" });
  rejectUnsupportedAsync(ast);
  const transformed = transformFromAstSync(ast, source, {
    plugins: [asyncToGenerator],
    configFile: false,
    babelrc: false,
    ast: true,
    code: false,
  })!.ast as t.File;
  const last = transformed.program.body.pop() as t.ExpressionStatement;
  return generate(
    t.callExpression(
      t.arrowFunctionExpression(
        [],
        t.blockStatement([
          ...(transformed.program.body as t.Statement[]),
          t.returnStatement(last.expression),
        ]),
      ),
      [],
    ),
  ).code;
}
