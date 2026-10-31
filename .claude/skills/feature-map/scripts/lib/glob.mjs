// Minimal glob matching for features.json: `**` (any depth), `*` (one segment), `?`, `{a,b}`.
// Patterns are matched against repo-relative paths with forward slashes, or against plain names
// (tables, SQL functions, tool names), where `*` matches anything but a dot.

const cache = new Map();

function escape(char) {
  return /[.+^$()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/** Turns a glob into an anchored RegExp. `segment` is the character class `*` may not cross. */
export function globToRegExp(pattern, segment = "/") {
  const key = `${segment}\u0000${pattern}`;
  if (cache.has(key)) return cache.get(key);
  const notSep = `[^${segment === "/" ? "/" : "\\."}]`;
  let source = "";
  let braces = 0;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      // `**/` matches zero or more whole segments; a trailing `**` matches the rest.
      if (pattern[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (char === "*") source += `${notSep}*`;
    else if (char === "?") source += notSep;
    else if (char === "{") {
      braces++;
      source += "(?:";
    } else if (char === "}" && braces > 0) {
      braces--;
      source += ")";
    } else if (char === "," && braces > 0) source += "|";
    else source += escape(char);
  }
  const regExp = new RegExp(`^${source}$`);
  cache.set(key, regExp);
  return regExp;
}

export function matchPath(pattern, path) {
  return globToRegExp(pattern, "/").test(path);
}

export function matchName(pattern, name) {
  return globToRegExp(pattern, ".").test(name);
}

/** How specific a pattern is: its length without wildcards. The most specific match wins. */
export function specificity(pattern) {
  return pattern.replace(/\*\*\/?|\*|\?/g, "").length;
}
