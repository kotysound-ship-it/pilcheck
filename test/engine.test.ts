// 엔진 동작 확인용 테스트. 제품명·수치는 모두 가상이며, 기준값도 테스트 전용이다(실제 판정에는 I2710 동기화 값을 쓴다).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { judge, type ExtractedProduct, type Rules, type Standard } from "../src/engine.ts";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../rules/${f}`, import.meta.url), "utf8"));
const TEST_STANDARDS: Standard[] = [
  { ingredient: "EPA 및 DHA 함유 유지", function: "혈중 중성지질 개선·혈행 개선에 도움을 줄 수 있음", min: 500, max: 2000, unit: "mg" },
  { ingredient: "EPA 및 DHA 함유 유지", function: "기억력 개선에 도움을 줄 수 있음", min: 900, max: 2000, unit: "mg" },
  { ingredient: "프로바이오틱스", function: "유익균 증식 및 유해균 억제에 도움을 줄 수 있음", min: 100000000, max: null, unit: "CFU" },
  { ingredient: "마그네슘", function: "에너지 이용에 필요", min: 94.5, max: 250, unit: "mg" },
];
const rules: Rules = { standards: TEST_STANDARDS, expressions: load("expressions.json"), sellers: load("sellers.json"), notes: load("notes.json") };

const base = (o: Partial<ExtractedProduct>): ExtractedProduct => ({
  name: "테스트 오메가3", sellerName: "가상헬스", productType: "건강기능식품", hasHealthMark: true, reportNo: "2000000000-000",
  calledSupplement: true, adText: "", headlineIngredients: [], ingredients: [], claimedFunctions: [],
  units: { total: 60, perDay: 1, label: "60캡슐, 1일 1캡슐" }, price: { sale: 18000, shipping: 0 },
  platform: { officialBadge: false, inBrandOfficialList: false, rocket: false, majorRetailer: false },
  salesRegistration: true, signals: {}, ...o,
});
const omega = (perDay: number) => [{ name: "EPA 및 DHA 함유 유지", functional: true, perDay, unit: "mg" }];
const ref = { manufacturer: "가상바이오텍", distributor: "가상헬스", officialDailyPrice: 300 };

test("정식 판매처 + 기준 충족 → 추천 후보", () => {
  const v = judge(base({ ingredients: omega(1000), claimedFunctions: ["기억력 개선에 도움을 줄 수 있음"] }), ref, rules);
  assert.equal(v.seller.tier, "official");
  assert.equal(v.items[2].status, "적합");
  assert.equal(v.daily, 300);
  assert.equal(v.recommendable, true);
});

test("Koty 테스트 링크 패턴: 상세페이지·함량표 없는 리셀러 → 확인 필요 + 주의 문구", () => {
  const v = judge(base({ sellerName: "아무개상사", ingredients: omega(1000), signals: { noDetail: true, noNutritionTable: true, lowResImages: true } }), ref, rules);
  assert.equal(v.seller.tier, "check");
  assert.equal(v.seller.warning, "*정식 판매처의 상품이 아닐 수 있습니다.");
  assert.equal(v.recommendable, false);
});

test("주장한 기능성의 하한 미달 → 주의, 표시값과 기준을 나란히", () => {
  const v = judge(base({ ingredients: omega(520), claimedFunctions: ["기억력 개선에 도움을 줄 수 있음"] }), ref, rules);
  assert.equal(v.items[2].status, "주의");
  assert.match(v.items[2].reasons.join(), /표시된 1일 EPA 및 DHA 함유 유지 520mg, '기억력 개선에 도움을 줄 수 있음' 기준 900mg 미달/);
});

test("EPA+DHA 합 없이 캡슐 내용량만 → 확인 필요", () => {
  const v = judge(base({ ingredients: [{ name: "EPA 및 DHA 함유 유지", functional: true, perDay: null, unit: "mg" }], omega3: { capsuleMg: 1000, epaDhaShown: false } }), ref, rules);
  assert.equal(v.items[2].status, "확인 필요");
  assert.match(v.items[2].reasons[0], /캡슐 내용량/);
});

test("금지 표현 탐지, 유산균 인정 문구의 '억제'는 통과", () => {
  const v = judge(base({
    name: "테스트 유산균", adText: "유익균 증식 및 유해균 억제에 도움을 줄 수 있음. 장 질환 치료에 좋은 유산균! 단 3일 만에 변화. 2세대 공법",
    ingredients: [{ name: "프로바이오틱스", functional: true, perDay: 10000000000, unit: "CFU" }],
    probiotics: { guaranteedCfu: 10000000000, inputCfu: null },
  }), ref, rules);
  const claims = v.items[1];
  assert.equal(claims.status, "주의");
  assert.match(claims.reasons.join(), /치료/);
  assert.match(claims.reasons.join(), /단 3일 만에/);
  assert.doesNotMatch(claims.reasons.join(), /억제/);
});

test("투입균수만 표시 → 확인 필요", () => {
  const v = judge(base({ ingredients: [{ name: "프로바이오틱스", functional: true, perDay: 10000000000, unit: "CFU" }], probiotics: { guaranteedCfu: null, inputCfu: 50000000000 } }), ref, rules);
  assert.equal(v.items[2].status, "확인 필요");
});

test("일반식품을 영양제로 표현 → 주의", () => {
  const v = judge(base({ productType: "일반식품", hasHealthMark: false, calledSupplement: true }), ref, rules);
  assert.equal(v.items[0].status, "주의");
});

test("부원료 앞세우기 탐지 (c5-5)", () => {
  const v = judge(base({ headlineIngredients: ["NMN"], ingredients: [...omega(1000), { name: "NMN", functional: false, perDay: 5, unit: "mg" }] }), ref, rules);
  assert.match(v.items[1].reasons.join(), /기능성 원료가 아닌 'NMN'/);
});

test("고시 외 기준은 참고 정보로만 (판정 영향 없음)", () => {
  const v = judge(base({ name: "테스트 마그네슘", ingredients: [{ name: "마그네슘", functional: true, perDay: 200, unit: "mg", form: "산화마그네슘" }] }), ref, rules);
  assert.equal(v.items[2].status, "적합");
  assert.match(v.notes.join(), /흡수율/);
});

test("배송비·멤버십가 반영, 공식가보다 15% 이상 싸면 할인 신호", () => {
  const v = judge(base({ sellerName: "다른상점", ingredients: omega(1000), price: { sale: 12000, shipping: 3000, member: { price: 11000, label: "와우 회원가" } }, signals: { unofficialBundle: true } }), ref, rules);
  assert.equal(v.daily, 250);
  assert.equal(v.memberDaily, 233);
  assert.ok(v.seller.signals.includes("공식 판매처 1일분 가격보다 크게 저렴함"));
  assert.equal(v.seller.tier, "check"); // 중간 신호 2개
});

test("로켓배송은 공인 유통", () => {
  const v = judge(base({ sellerName: "쿠팡", ingredients: omega(1000), platform: { officialBadge: false, inBrandOfficialList: false, rocket: true, majorRetailer: false } }), ref, rules);
  assert.equal(v.seller.tier, "authorized");
});

test("같은 입력이면 같은 결과", () => {
  const p = base({ ingredients: omega(700), adText: "혈관 청소! 최고의 오메가3" });
  assert.deepEqual(judge(p, ref, rules), judge(p, ref, rules));
});
