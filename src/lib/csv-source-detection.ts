export interface ImportSourceCandidate {
  value: string;
  name: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function trailingFourDigits(value: string): string | null {
  const match = value.match(/(\d{4})\D*$/);
  return match?.[1] ?? null;
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"' && quoted) {
      value += '"';
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value.trim());
  return values;
}

export function detectCsvImportSource(
  fileName: string,
  csvText: string,
  sources: ImportSourceCandidate[]
): string | null {
  const normalizedFileName = normalize(fileName);
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  const headers = lines.length > 0 ? parseCsvLine(lines[0]).map(normalize) : [];
  const accountNumberColumns = headers.flatMap((header, index) =>
    /^(account|card)(number|no|last4|lastfour|lastfourdigits|ending)$/.test(header) ||
    /^(account|card)(number|no|last4|lastfour|lastfourdigits|ending)/.test(header)
      ? [index]
      : []
  );
  const accountNumberValues = new Set<string>();

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    for (const column of accountNumberColumns) {
      const digits = cells[column]?.replace(/\D/g, "") ?? "";
      if (digits.length >= 4) accountNumberValues.add(digits.slice(-4));
    }
  }

  const scores = new Map<string, number>();
  for (const source of sources) {
    const normalizedName = normalize(source.name);
    const lastFour = trailingFourDigits(source.name);
    let score = 0;

    if (normalizedName.length >= 4 && normalizedFileName.includes(normalizedName)) {
      score = 3;
    }
    if (
      lastFour &&
      new RegExp(`(?:^|\\D)${lastFour}(?:\\D|$)`).test(fileName)
    ) {
      score = Math.max(score, 3);
    }
    if (lastFour && accountNumberValues.has(lastFour)) {
      score = Math.max(score, 2);
    }

    if (score > 0) scores.set(source.value, score);
  }

  if (scores.size === 0) return null;
  const highestScore = Math.max(...scores.values());
  const matches = [...scores.entries()].filter(([, score]) => score === highestScore);
  return matches.length === 1 ? matches[0][0] : null;
}
