import { readFile, writeFile } from "node:fs/promises";

const DEFAULT_SOURCE = "https://blog.evanzhou.org/api/series/te-weekly";
const START = "<!-- BEGIN:te-weekly-archive -->";
const END = "<!-- END:te-weekly-archive -->";

async function loadJson(source) {
  if (/^https?:\/\//.test(source)) {
    const response = await fetch(source, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`Could not fetch ${source}: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  return JSON.parse(await readFile(source, "utf8"));
}

function assertString(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected a non-empty string at ${path}.`);
  }
}

function validate(data) {
  if (data?.schemaVersion !== 1) {
    throw new Error(`Unsupported schemaVersion: ${data?.schemaVersion ?? "missing"}.`);
  }
  if (data.id !== "te-weekly" || !Array.isArray(data.issues)) {
    throw new Error("The source is not a TE Weekly issue feed.");
  }

  for (const [index, issue] of data.issues.entries()) {
    if (!Number.isInteger(issue.issue) || issue.issue < 1) {
      throw new Error(`Expected a positive issue number at issues[${index}].issue.`);
    }
    assertString(issue.editionDate, `issues[${index}].editionDate`);
    for (const locale of ["en", "zh"]) {
      const translation = issue.translations?.[locale];
      if (!translation) continue;
      assertString(translation.title, `issues[${index}].translations.${locale}.title`);
      assertString(translation.url, `issues[${index}].translations.${locale}.url`);
    }
  }
}

function escapeCell(value) {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function dateParts(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) throw new Error(`Invalid editionDate: ${isoDate}.`);
  return { year: match[1], month: Number(match[2]), day: Number(match[3]) };
}

function englishDate(isoDate) {
  const { month, day } = dateParts(isoDate);
  const name = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
  return `${name} ${day}`;
}

function chineseDate(isoDate) {
  const { month, day } = dateParts(isoDate);
  return `${month} 月 ${day} 日`;
}

function groupByYear(issues) {
  const groups = new Map();
  for (const issue of [...issues].sort((a, b) => b.issue - a.issue)) {
    const { year } = dateParts(issue.editionDate);
    const group = groups.get(year) ?? [];
    group.push(issue);
    groups.set(year, group);
  }
  return groups;
}

function link(label, url) {
  return url ? `[${escapeCell(label)}](${url})` : "—";
}

function renderEnglish(data) {
  const sections = [];
  for (const [year, issues] of groupByYear(data.issues)) {
    const rows = issues.map((issue) => {
      const en = issue.translations.en;
      const zh = issue.translations.zh;
      return `| ${String(issue.issue).padStart(2, "0")} | ${englishDate(issue.editionDate)} | ${en ? link(en.title, en.url) : "—"} | ${zh ? link("中文版", zh.url) : "—"} |`;
    });
    sections.push(
      `### ${year}\n\n| No. | Edition | Review | 中文 |\n| ---: | --- | --- | --- |\n${rows.join("\n")}`,
    );
  }

  return `${START}\n${sections.join("\n\n")}\n\n### [Read the series on Cell by Cell →](${data.series.en.url})\n${END}`;
}

function renderChinese(data) {
  const sections = [];
  for (const [year, issues] of groupByYear(data.issues)) {
    const rows = issues.map((issue) => {
      const en = issue.translations.en;
      const zh = issue.translations.zh;
      return `| ${String(issue.issue).padStart(2, "0")} | ${chineseDate(issue.editionDate)} | ${zh ? link(zh.title, zh.url) : "—"} | ${en ? link("English", en.url) : "—"} |`;
    });
    sections.push(
      `### ${year}\n\n| 期号 | 出刊日期 | Review | English |\n| ---: | --- | --- | --- |\n${rows.join("\n")}`,
    );
  }

  return `${START}\n${sections.join("\n\n")}\n\n### [在 Cell by Cell 阅读本栏目 →](${data.series.zh.url})\n${END}`;
}

async function replaceBlock(file, generated) {
  const current = await readFile(file, "utf8");
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${file} is missing a valid generated archive block.`);
  }

  const next = `${current.slice(0, start)}${generated}${current.slice(end + END.length)}`;
  if (next !== current) await writeFile(file, next, "utf8");
}

const source = process.argv[2] ?? process.env.TE_WEEKLY_API_URL ?? DEFAULT_SOURCE;
const data = await loadJson(source);
validate(data);
await Promise.all([
  replaceBlock("README.md", renderEnglish(data)),
  replaceBlock("README_CN.md", renderChinese(data)),
]);

console.log(`Synced ${data.issues.length} TE Weekly issues from ${source}.`);
