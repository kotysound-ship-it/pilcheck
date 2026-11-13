// 식품안전나라 OpenAPI 원본 내려받기
// 사용: node --env-file=.env.local scripts/fetch-foodsafety.ts I2710
// 결과: data/raw/<서비스ID>.json 에 전체 행 저장, 첫 행의 필드 이름을 화면에 출력
import { mkdirSync, writeFileSync } from "node:fs";

const service = process.argv[2] ?? "I2710";
const key = process.env.FOODSAFETY_API_KEY;
if (!key) {
  console.error("FOODSAFETY_API_KEY 가 없습니다. .env.example 을 복사해 .env.local 을 만들고 키를 넣어 주세요.");
  process.exit(1);
}

const PAGE = 1000; // 한 번에 받을 행 수
// 문서 예시는 http 주소다. https 가 안 되면 http 로 바꿔 시도한다.
const base = `https://openapi.foodsafetykorea.go.kr/api/${key}/${service}/json`;

async function page(start: number, end: number) {
  const res = await fetch(`${base}/${start}/${end}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} (${start}~${end})`);
  const body = await res.json() as Record<string, any>;
  const block = body[service] ?? Object.values(body)[0];
  const code = block?.RESULT?.CODE;
  if (code && code !== "INFO-000" && code !== "INFO-200") throw new Error(`${code}: ${block?.RESULT?.MSG}`);
  return { total: Number(block?.total_count ?? 0), rows: (block?.row ?? []) as Record<string, unknown>[] };
}

const first = await page(1, PAGE);
const rows = [...first.rows];
for (let s = PAGE + 1; s <= first.total; s += PAGE) {
  const p = await page(s, Math.min(s + PAGE - 1, first.total));
  rows.push(...p.rows);
  process.stdout.write(`\r${rows.length}/${first.total}행`);
}
console.log(`\n${service}: 총 ${rows.length}행`);

mkdirSync("data/raw", { recursive: true });
writeFileSync(`data/raw/${service}.json`, JSON.stringify({ service, fetchedAt: new Date().toISOString(), total: first.total, rows }, null, 1));
console.log(`저장: data/raw/${service}.json`);
if (rows[0]) console.log("필드 이름:", Object.keys(rows[0]).join(", "));
