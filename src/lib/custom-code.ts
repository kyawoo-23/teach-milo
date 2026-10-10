import { parse } from "acorn";

// This is an intentionally small language: arithmetic and conditionals, not arbitrary JS.
// Access isolation and a terminable worker remain required even after this validation.
export function validateCalculation(
  code: string,
  inputIds: string[],
  outputIds: string[],
) {
  if (code.length > 12_000) throw new Error("Calculation is too large");
  const ast = parse(code, { ecmaVersion: 2022 }) as unknown as N;
  const body = ast.body as N[];
  if (
    body.length !== 1 ||
    body[0].type !== "FunctionDeclaration" ||
    body[0].id?.name !== "calculate" ||
    body[0].async ||
    body[0].generator ||
    body[0].params?.length !== 1 ||
    body[0].params[0].name !== "inputs"
  )
    throw new Error("Expected one calculate(inputs) function");
  const locals = new Set<string>(["inputs"]);
  let nodes = 0;
  let returns = 0;
  const math = new Set([
    "abs",
    "min",
    "max",
    "round",
    "floor",
    "ceil",
    "sqrt",
    "pow",
    "sin",
    "cos",
    "tan",
    "log",
    "exp",
  ]);
  const walk = (n: N, depth = 0): void => {
    if (++nodes > 1000 || depth > 30)
      throw new Error("Calculation is too complex");
    switch (n.type) {
      case "BlockStatement":
        for (const x of n.body!) walk(x, depth + 1);
        return;
      case "VariableDeclaration":
        if (!["const", "let"].includes(n.kind!))
          throw new Error("Unsupported declaration");
        for (const d of n.declarations!) {
          if (
            d.id?.type !== "Identifier" ||
            !/^[a-z][a-zA-Z0-9_]*$/.test(d.id.name!) ||
            [
              "inputs",
              "Math",
              "__proto__",
              "constructor",
              "prototype",
            ].includes(d.id.name!)
          )
            throw new Error("Invalid local name");
          if (!d.init) throw new Error("Initialize local variables");
          walk(d.init, depth + 1);
          locals.add(d.id.name!);
        }
        return;
      case "ReturnStatement":
        returns++;
        if (n.argument?.type !== "ObjectExpression")
          throw new Error("Return a metrics object");
        {
          const props = n.argument.properties!;
          const metricObject = props[0]?.value as N | undefined;
          if (
            props.length !== 1 ||
            props[0].key?.name !== "metrics" ||
            metricObject?.type !== "ObjectExpression" ||
            props[0].computed ||
            props[0].method
          )
            throw new Error("Return only metrics");
          const metrics = metricObject.properties!;
          if (
            metrics.length !== outputIds.length ||
            new Set(metrics.map((p) => p.key?.name)).size !== outputIds.length
          )
            throw new Error("Return every declared metric");
          for (const p of metrics) {
            if (
              p.type !== "Property" ||
              p.computed ||
              p.method ||
              p.kind !== "init" ||
              !outputIds.includes(p.key?.name || "")
            )
              throw new Error("Invalid metric");
            walk(p.value as N, depth + 1);
          }
          return;
        }
      case "IfStatement":
        walk(n.test!, depth + 1);
        walk(n.consequent!, depth + 1);
        if (n.alternate) walk(n.alternate, depth + 1);
        return;
      case "ConditionalExpression":
        walk(n.test!, depth + 1);
        walk(n.consequent!, depth + 1);
        walk(n.alternate!, depth + 1);
        return;
      case "BinaryExpression":
      case "LogicalExpression":
        if (
          ![
            "+",
            "-",
            "*",
            "/",
            "%",
            "**",
            "<",
            ">",
            "<=",
            ">=",
            "===",
            "!==",
            "&&",
            "||",
          ].includes(n.operator!)
        )
          throw new Error("Invalid operator");
        walk(n.left!, depth + 1);
        walk(n.right!, depth + 1);
        return;
      case "UnaryExpression":
        if (!["+", "-", "!"].includes(n.operator!))
          throw new Error("Invalid unary operator");
        walk(n.argument!, depth + 1);
        return;
      case "Literal":
        if (typeof n.value !== "number" && typeof n.value !== "boolean")
          throw new Error("Only numeric and boolean literals allowed");
        return;
      case "Identifier":
        if (!locals.has(n.name!) || n.name === "inputs")
          throw new Error("Unknown variable");
        return;
      case "MemberExpression":
        if (
          n.computed ||
          n.object?.type !== "Identifier" ||
          n.object.name !== "inputs" ||
          !inputIds.includes(n.property?.name || "")
        )
          throw new Error("Only declared inputs can be accessed");
        return;
      case "CallExpression":
        if (
          n.callee?.type !== "MemberExpression" ||
          n.callee.computed ||
          n.callee.object?.name !== "Math" ||
          !math.has(n.callee.property?.name || "") ||
          n.arguments!.length > 6
        )
          throw new Error("Only approved Math calls allowed");
        for (const a of n.arguments!) walk(a, depth + 1);
        return;
      default:
        throw new Error(`Unsupported calculation syntax: ${n.type}`);
    }
  };
  walk(body[0].body as unknown as N);
  if (!returns) throw new Error("Calculation must return metrics");
}
// Narrow AST view avoids granting executable objects any capabilities.
type N = {
  type: string;
  name?: string;
  body?: N[];
  id?: N;
  params?: N[];
  async?: boolean;
  generator?: boolean;
  kind?: string;
  declarations?: N[];
  init?: N;
  argument?: N;
  arguments?: N[];
  properties?: N[];
  key?: N;
  value?: N | number | boolean;
  computed?: boolean;
  method?: boolean;
  test?: N;
  consequent?: N;
  alternate?: N;
  operator?: string;
  left?: N;
  right?: N;
  object?: N;
  property?: N;
  callee?: N;
};
