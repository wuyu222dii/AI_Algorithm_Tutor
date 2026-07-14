import ts from 'typescript';

export type TypeScriptCompileResult =
  | { ok: true; code: string }
  | { ok: false; error: string };

function moduleSyntaxError(sourceFile: ts.SourceFile): string | undefined {
  let error: string | undefined;

  function visit(node: ts.Node) {
    if (error) return;

    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isExportAssignment(node) ||
      ts.isImportTypeNode(node)
    ) {
      error =
        'TypeScript imports and exports are not available in practice code.';
      return;
    }

    const modifiers = ts.canHaveModifiers(node)
      ? ts.getModifiers(node)
      : undefined;
    if (
      modifiers?.some(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.ExportKeyword ||
          modifier.kind === ts.SyntaxKind.DefaultKeyword
      )
    ) {
      error =
        'TypeScript imports and exports are not available in practice code.';
      return;
    }

    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        error = 'Dynamic imports are not available in practice code.';
        return;
      }
      if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require'
      ) {
        error = 'require() is not available in practice code.';
        return;
      }
    }

    if (
      ts.isIdentifier(node) &&
      (node.text === 'eval' || node.text === 'Function')
    ) {
      error =
        'eval and Function constructors are not available in practice code.';
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return error;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  if (!diagnostic.file || diagnostic.start === undefined) {
    return `TS${diagnostic.code}: ${message}`;
  }
  const position = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start
  );
  return `TS${diagnostic.code} (${position.line + 1}:${position.character + 1}): ${message}`;
}

export function compileTypeScript(source: string): TypeScriptCompileResult {
  const sourceFile = ts.createSourceFile(
    'solution.ts',
    source,
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.TS
  );
  const restrictedSyntax = moduleSyntaxError(sourceFile);
  if (restrictedSyntax) return { ok: false, error: restrictedSyntax };

  const result = ts.transpileModule(source, {
    fileName: 'solution.ts',
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.None,
      isolatedModules: true,
      strict: true,
      sourceMap: false,
      inlineSourceMap: false,
    },
  });
  const errors = (result.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  if (errors.length > 0) {
    return {
      ok: false,
      error: errors.slice(0, 5).map(formatDiagnostic).join('\n'),
    };
  }

  return { ok: true, code: result.outputText };
}
