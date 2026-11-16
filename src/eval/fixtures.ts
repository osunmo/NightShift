// Small repos with planted bugs. Each has visible tests (the agent can see and run them) and a
// hidden check (only the eval harness runs it) so an agent can't pass by gaming visible tests.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { git } from "../git/workspace.ts";

export interface Fixture {
  name: string;
  task: string;
  files: Record<string, string>;
  hiddenCheck: { file: string; content: string; command: string };
  /** A known-good fix, used only to validate the fixture itself. */
  solution: Record<string, string>;
}

export async function makeRepo(dir: string, files: Record<string, string>, branch = "main") {
  await mkdir(dir, { recursive: true });
  for (const [p, c] of Object.entries(files)) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), c);
  }
  await git(dir, ["init", "-q", "-b", branch]);
  await git(dir, ["config", "user.name", "fixture"]);
  await git(dir, ["config", "user.email", "fixture@example.com"]);
  await git(dir, ["add", "-A"]);
  await git(dir, ["commit", "-q", "-m", "initial"]);
}

const py = (name: string, task: string, src: Record<string, string>, test: string, hidden: string, solution: Record<string, string>): Fixture => ({
  name,
  solution,
  task,
  files: { ...src, "tests/__init__.py": "", "tests/test_visible.py": test },
  hiddenCheck: { file: "tests/test_hidden_ns.py", content: hidden, command: "python3 -m unittest tests.test_hidden_ns -q" },
});

const js = (name: string, task: string, src: Record<string, string>, test: string, hidden: string, solution: Record<string, string>): Fixture => ({
  name,
  solution,
  task,
  files: {
    ...src,
    "package.json": JSON.stringify({ name, version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2),
    "test/visible.test.js": test,
  },
  hiddenCheck: { file: "hidden_ns.test.js", content: hidden, command: "node --test hidden_ns.test.js" },
});

export const FIXTURES: Fixture[] = [
  py(
    "py-add",
    "The add() function in calc.py returns the wrong result. Fix it.",
    { "calc.py": "def add(a, b):\n    return a - b\n\n\ndef mul(a, b):\n    return a * b\n" },
    "import unittest\nfrom calc import add, mul\n\nclass T(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(2, 3), 5)\n    def test_mul(self):\n        self.assertEqual(mul(2, 3), 6)\n",
    "import unittest\nfrom calc import add\n\nclass H(unittest.TestCase):\n    def test_neg(self):\n        self.assertEqual(add(-2, -3), -5)\n    def test_float(self):\n        self.assertAlmostEqual(add(0.1, 0.2), 0.3)\n",
    { "calc.py": "def add(a, b):\n    return a + b\n\n\ndef mul(a, b):\n    return a * b\n" }
  ),
  py(
    "py-median-even",
    "median() in stats.py is wrong for lists with an even number of items. It should return the mean of the two middle values.",
    {
      "stats.py":
        "def median(xs):\n    if not xs:\n        raise ValueError('empty')\n    s = sorted(xs)\n    return s[len(s) // 2]\n",
    },
    "import unittest\nfrom stats import median\n\nclass T(unittest.TestCase):\n    def test_odd(self):\n        self.assertEqual(median([3, 1, 2]), 2)\n",
    "import unittest\nfrom stats import median\n\nclass H(unittest.TestCase):\n    def test_even(self):\n        self.assertEqual(median([4, 1, 3, 2]), 2.5)\n    def test_empty(self):\n        with self.assertRaises(ValueError):\n            median([])\n",
    { "stats.py": "def median(xs):\n    if not xs:\n        raise ValueError('empty')\n    s = sorted(xs)\n    n = len(s)\n    if n % 2:\n        return s[n // 2]\n    return (s[n // 2 - 1] + s[n // 2]) / 2\n" }
  ),
  py(
    "py-slugify",
    "slugify() in text.py should lowercase, turn any run of non-alphanumeric characters into a single hyphen, and strip leading/trailing hyphens. Right now 'Hello,  World!' gives 'hello,--world!'.",
    { "text.py": "def slugify(s):\n    return s.lower().replace(' ', '-')\n" },
    "import unittest\nfrom text import slugify\n\nclass T(unittest.TestCase):\n    def test_simple(self):\n        self.assertEqual(slugify('Hello World'), 'hello-world')\n",
    "import unittest\nfrom text import slugify\n\nclass H(unittest.TestCase):\n    def test_punct(self):\n        self.assertEqual(slugify('Hello,  World!'), 'hello-world')\n    def test_edges(self):\n        self.assertEqual(slugify('--A b--'), 'a-b')\n",
    { "text.py": "import re\n\n\ndef slugify(s):\n    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')\n" }
  ),
  py(
    "py-paginate",
    "paginate(items, page, per_page) in pages.py has an off-by-one: page numbers are 1-based but page 1 skips the first items. Fix it and make pages past the end return an empty list.",
    {
      "pages.py":
        "def paginate(items, page, per_page):\n    start = page * per_page\n    return items[start:start + per_page]\n",
    },
    "import unittest\nfrom pages import paginate\n\nclass T(unittest.TestCase):\n    def test_first(self):\n        self.assertEqual(paginate(list(range(10)), 1, 3), [0, 1, 2])\n",
    "import unittest\nfrom pages import paginate\n\nclass H(unittest.TestCase):\n    def test_last(self):\n        self.assertEqual(paginate(list(range(10)), 4, 3), [9])\n    def test_past(self):\n        self.assertEqual(paginate(list(range(10)), 9, 3), [])\n",
    { "pages.py": "def paginate(items, page, per_page):\n    start = (page - 1) * per_page\n    return items[start:start + per_page]\n" }
  ),
  py(
    "py-cache-mutation",
    "get_config() in config.py returns the cached dict itself, so callers that modify the result corrupt the cache for everyone. Make callers get an independent copy (nested dicts too).",
    {
      "config.py":
        "_CACHE = {'db': {'host': 'localhost', 'port': 5432}, 'debug': False}\n\n\ndef get_config():\n    return _CACHE\n",
    },
    "import unittest\nfrom config import get_config\n\nclass T(unittest.TestCase):\n    def test_values(self):\n        self.assertEqual(get_config()['db']['port'], 5432)\n",
    "import unittest\nfrom config import get_config\n\nclass H(unittest.TestCase):\n    def test_isolated(self):\n        c = get_config(); c['db']['port'] = 1; c['debug'] = True\n        self.assertEqual(get_config()['db']['port'], 5432)\n        self.assertFalse(get_config()['debug'])\n",
    { "config.py": "import copy\n\n_CACHE = {'db': {'host': 'localhost', 'port': 5432}, 'debug': False}\n\n\ndef get_config():\n    return copy.deepcopy(_CACHE)\n" }
  ),
  py(
    "py-retry",
    "retry(fn, attempts) in retry.py should call fn up to `attempts` times total and re-raise the last exception if all fail. It currently swallows the final error and returns None.",
    {
      "retry.py":
        "def retry(fn, attempts=3):\n    for _ in range(attempts):\n        try:\n            return fn()\n        except Exception:\n            pass\n",
    },
    "import unittest\nfrom retry import retry\n\nclass T(unittest.TestCase):\n    def test_ok(self):\n        self.assertEqual(retry(lambda: 7), 7)\n",
    "import unittest\nfrom retry import retry\n\nclass H(unittest.TestCase):\n    def test_raises(self):\n        calls = []\n        def f():\n            calls.append(1); raise KeyError('x')\n        with self.assertRaises(KeyError):\n            retry(f, 4)\n        self.assertEqual(len(calls), 4)\n",
    { "retry.py": "def retry(fn, attempts=3):\n    last = None\n    for _ in range(attempts):\n        try:\n            return fn()\n        except Exception as e:\n            last = e\n    raise last\n" }
  ),
  js(
    "js-sum-cart",
    "cartTotal(items) in cart.js should return the total of price * qty for all items, rounded to 2 decimals. Quantities are being ignored.",
    {
      "cart.js":
        "export function cartTotal(items) {\n  let total = 0;\n  for (const it of items) total += it.price;\n  return total;\n}\n",
    },
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { cartTotal } from '../cart.js';\n\ntest('single', () => assert.equal(cartTotal([{ price: 2, qty: 1 }]), 2));\n",
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { cartTotal } from './cart.js';\n\ntest('qty', () => assert.equal(cartTotal([{ price: 2.5, qty: 3 }, { price: 0.1, qty: 3 }]), 7.8));\ntest('empty', () => assert.equal(cartTotal([]), 0));\n",
    { "cart.js": "export function cartTotal(items) {\n  let total = 0;\n  for (const it of items) total += it.price * it.qty;\n  return Math.round(total * 100) / 100;\n}\n" }
  ),
  js(
    "js-debounce",
    "debounce(fn, ms) in debounce.js should call fn once, with the latest arguments, after calls stop for `ms` milliseconds. Right now it calls fn on every call.",
    {
      "debounce.js": "export function debounce(fn, ms) {\n  return (...args) => {\n    setTimeout(() => fn(...args), ms);\n  };\n}\n",
    },
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { debounce } from '../debounce.js';\n\ntest('calls eventually', async () => {\n  let n = 0; const d = debounce(() => n++, 10); d();\n  await new Promise(r => setTimeout(r, 30)); assert.equal(n, 1);\n});\n",
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { debounce } from './debounce.js';\n\ntest('once with latest args', async () => {\n  const seen = []; const d = debounce((x) => seen.push(x), 15);\n  d(1); d(2); d(3);\n  await new Promise(r => setTimeout(r, 50));\n  assert.deepEqual(seen, [3]);\n});\n",
    { "debounce.js": "export function debounce(fn, ms) {\n  let t;\n  return (...args) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...args), ms);\n  };\n}\n" }
  ),
  js(
    "js-parse-query",
    "parseQuery(qs) in query.js should decode percent-encoding and '+' as space, ignore a leading '?', and collect repeated keys into an array. Today 'a=1&a=2' returns { a: '2' }.",
    {
      "query.js":
        "export function parseQuery(qs) {\n  const out = {};\n  for (const part of qs.split('&')) {\n    const [k, v] = part.split('=');\n    out[k] = v;\n  }\n  return out;\n}\n",
    },
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { parseQuery } from '../query.js';\n\ntest('basic', () => assert.deepEqual(parseQuery('x=1&y=2'), { x: '1', y: '2' }));\n",
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { parseQuery } from './query.js';\n\ntest('repeat', () => assert.deepEqual(parseQuery('?a=1&a=2&b=hello+world%21'), { a: ['1', '2'], b: 'hello world!' }));\n",
    { "query.js": "export function parseQuery(qs) {\n  const out = {};\n  for (const part of qs.replace(/^\\?/, '').split('&')) {\n    if (!part) continue;\n    const [k, v = ''] = part.split('=').map((x) => decodeURIComponent(x.replace(/\\+/g, ' ')));\n    if (k in out) out[k] = [].concat(out[k], v);\n    else out[k] = v;\n  }\n  return out;\n}\n" }
  ),
  js(
    "js-dates",
    "daysBetween(a, b) in dates.js returns wrong answers across a daylight saving change because it divides milliseconds by 86400000 and floors. Make it count calendar days between two 'YYYY-MM-DD' strings correctly (b minus a, can be negative).",
    {
      "dates.js":
        "export function daysBetween(a, b) {\n  return Math.floor((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);\n}\n",
    },
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { daysBetween } from '../dates.js';\n\ntest('simple', () => assert.equal(daysBetween('2024-01-01', '2024-01-31'), 30));\n",
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { daysBetween } from './dates.js';\n\nprocess.env.TZ = 'America/New_York';\ntest('dst', () => assert.equal(daysBetween('2024-03-09', '2024-03-11'), 2));\ntest('neg', () => assert.equal(daysBetween('2024-03-11', '2024-03-01'), -10));\n",
    { "dates.js": "export function daysBetween(a, b) {\n  const utc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };\n  return Math.round((utc(b) - utc(a)) / 86400000);\n}\n" }
  ),
];
