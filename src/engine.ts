// 필체크 판정 엔진
// 원칙: 추출은 AI, 판정은 규칙. 이 파일은 추출된 값과 규칙 파일만 보고 판정한다.
// 같은 입력이면 항상 같은 결과가 나와야 하므로 시간·난수·외부 호출을 쓰지 않는다.

export type Status = "적합" | "주의" | "확인 필요" | "정보";

export interface Standard {
  ingredient: string;      // 예: "EPA 및 DHA 함유 유지"
  function: string;        // 예: "혈중 중성지질 개선·혈행 개선에 도움을 줄 수 있음"
  min: number;
  max: number | null;
  unit: string;            // mg, μg, CFU ...
  source?: string;
}

export interface Ingredient {
  name: string;            // 기준값(Standard.ingredient)과 같은 이름으로 정규화된 이름
  functional: boolean;     // 기능성 원료인지 (품목제조신고 기준)
  perDay: number | null;   // 1일 섭취량 기준 함량
  perUnit?: number | null; // 1정(1포)당 함량
  unit: string;
  form?: string;           // 예: "산화마그네슘"
}

export interface ExtractedProduct {
  name: string;
  sellerName: string;
  productType: "건강기능식품" | "기능성표시식품" | "일반식품" | "알 수 없음";
  hasHealthMark: boolean | null;
  reportNo?: string | null;
  calledSupplement: boolean;          // 페이지가 '영양제'·'건강기능식품'이라고 부르는지
  adText: string;                     // 상세페이지 광고 문구 전체
  headlineIngredients: string[];      // 제목·상단에서 앞세운 원료
  ingredients: Ingredient[];
  claimedFunctions: string[];         // 페이지가 내세운 기능성 (Standard.function 이름)
  units: { total: number | null; perDay: number | null; label: string }; // 예: 60정, 1일 2정
  price: { sale: number | null; shipping: number; member?: { price: number; label: string } };
  platform: { officialBadge: boolean; inBrandOfficialList: boolean; rocket: boolean; majorRetailer: boolean };
  salesRegistration: boolean | null;  // 건강기능식품 판매업 신고 확인 결과 (null = 조회 불가)
  signals: Record<string, boolean>;   // sellers.json signals[].id
  omega3?: { capsuleMg?: number | null; epaDhaShown: boolean };
  probiotics?: { guaranteedCfu: number | null; inputCfu: number | null };
}

export interface Reference {           // 기준 상품 (품목제조신고 I0030 등)
  manufacturer?: string;
  distributor?: string;               // 판매원·유통전문판매원
  officialDailyPrice?: number | null; // 공식 판매처 1일분 가격 (원)
}

export interface Rules {
  standards: Standard[];
  expressions: { rules: { id: string; group: string; level: "금지" | "참고"; pattern: string; explain: string; source: string }[] };
  sellers: {
    warningText: string;
    tiers: Record<"official" | "authorized" | "general" | "check", string>;
    decision: { strongAtLeast: number; mediumAtLeast: number; discountMedium: number };
    signals: { id: string; label: string; strength: "strong" | "medium" | "weak" }[];
  };
  notes: { notes: { id: string; ingredient: string; when: { formIncludes?: string; perUnitOver?: number; unit?: string }; text: string; source: string }[] };
}

export interface Item { status: Status; title: string; reasons: string[] }

const fmt = (n: number) => n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
const worst = (list: Status[]): Status =>
  list.includes("주의") ? "주의" : list.includes("확인 필요") ? "확인 필요" : list.length ? list[0] : "확인 필요";

// 1. 제품 구분
export function judgeType(p: ExtractedProduct): Item {
  const title = "제품 구분";
  if (p.productType === "건강기능식품") {
    if (p.hasHealthMark === false)
      return { status: "확인 필요", title, reasons: ["건강기능식품으로 판매되지만 인증마크·'건강기능식품' 표시가 확인되지 않습니다."] };
    return { status: "적합", title, reasons: [`건강기능식품${p.reportNo ? ` (품목제조신고번호 ${p.reportNo})` : ""}`] };
  }
  if (p.productType === "알 수 없음")
    return { status: "확인 필요", title, reasons: ["페이지에서 식품 유형을 확인하지 못했습니다."] };
  if (p.calledSupplement)
    return { status: "주의", title, reasons: [`${p.productType}인데 '영양제'·'건강기능식품'처럼 표현하고 있습니다.`] };
  return { status: "정보", title, reasons: [`${p.productType}입니다. 건강기능식품이 아닙니다.`] };
}

// 2. 광고 문구
export function judgeClaims(p: ExtractedProduct, rules: Rules): { item: Item; notes: string[] } {
  const title = "광고 문구";
  // 인정된 기능성 문구는 허용 표현이므로 먼저 지운다 (예: 유산균 '유해균 억제에 도움')
  let text = p.adText;
  const mine = rules.standards.filter(s => p.ingredients.some(i => i.name === s.ingredient));
  for (const s of mine) text = text.split(s.function).join(" ");

  const reasons: string[] = [], notes: string[] = [];
  for (const r of rules.expressions.rules) {
    const m = text.match(new RegExp(r.pattern, "g"));
    if (!m) continue;
    const found = [...new Set(m)].slice(0, 3).map(x => `"${x.trim()}"`).join(", ");
    if (r.level === "금지") reasons.push(`${r.explain}: ${found}`);
    else notes.push(`${r.explain} (${found})`);
  }
  // 부원료 앞세우기 (c5-5): 앞세운 원료가 기능성 원료가 아님
  const functional = new Set(p.ingredients.filter(i => i.functional).map(i => i.name));
  const named = new Set(p.ingredients.map(i => i.name));
  for (const h of p.headlineIngredients) {
    if (named.has(h) && !functional.has(h))
      reasons.push(`기능성 원료가 아닌 '${h}'을(를) 앞세우고 있습니다. 인정 기능성은 다른 원료 기준입니다.`);
  }
  const item: Item = reasons.length
    ? { status: "주의", title, reasons }
    : { status: "적합", title, reasons: ["금지 표현이 발견되지 않았습니다."] };
  return { item, notes };
}

// 3. 함량 충족
export function judgeContent(p: ExtractedProduct, rules: Rules): Item {
  const title = "함량 충족";
  const reasons: string[] = [], st: Status[] = [];
  const functional = p.ingredients.filter(i => i.functional);
  if (!functional.length) return { status: "확인 필요", title, reasons: ["기능성 원료를 확인하지 못했습니다."] };

  if (p.omega3 && !p.omega3.epaDhaShown) {
    st.push("확인 필요");
    reasons.push(`EPA+DHA 합이 표시되지 않았습니다.${p.omega3.capsuleMg ? ` 전면의 ${fmt(p.omega3.capsuleMg)}mg은 캡슐 내용량일 수 있습니다.` : ""}`);
  }
  if (p.probiotics && p.probiotics.guaranteedCfu == null && p.probiotics.inputCfu != null) {
    st.push("확인 필요");
    reasons.push("보장균수가 아닌 투입균수만 표시돼 있습니다. 섭취 시점에 살아 있는 균 수는 보장균수로 판단합니다.");
  }

  for (const ing of functional) {
    const stds = rules.standards.filter(s => s.ingredient === ing.name);
    if (!stds.length) { st.push("확인 필요"); reasons.push(`${ing.name}: 등록된 기준값이 없습니다.`); continue; }
    if (ing.perDay == null) { st.push("확인 필요"); reasons.push(`${ing.name}: 1일 섭취량 기준 함량이 표시되지 않았습니다.`); continue; }
    const claimed = p.claimedFunctions.length ? stds.filter(s => p.claimedFunctions.includes(s.function)) : stds;
    const targets = claimed.length ? claimed : stds;
    for (const s of targets) {
      if (s.unit !== ing.unit) { st.push("확인 필요"); reasons.push(`${ing.name}: 단위가 기준(${s.unit})과 다릅니다(${ing.unit}).`); continue; }
      const head = `표시된 1일 ${ing.name} ${fmt(ing.perDay)}${ing.unit}`;
      if (ing.perDay < s.min) {
        st.push(claimed.length ? "주의" : "정보");
        reasons.push(`${head}, '${s.function}' 기준 ${fmt(s.min)}${s.unit} 미달`);
      } else if (s.max != null && ing.perDay > s.max) {
        st.push("주의");
        reasons.push(`${head}, '${s.function}' 상한 ${fmt(s.max)}${s.unit} 초과`);
      } else {
        st.push("적합");
        reasons.push(`${head}, '${s.function}' 기준(${fmt(s.min)}~${s.max != null ? fmt(s.max) : ""}${s.unit}) 충족`);
      }
    }
  }
  const nonInfo = st.filter(s => s !== "정보");
  return { status: nonInfo.length ? worst(nonInfo) : "정보", title, reasons };
}

// 4. 1일 가격 (r5: 배송비 포함, 멤버십가는 조건과 함께 표시)
export interface PriceResult { item: Item; daily: number | null; memberDaily: number | null; per1000: { ingredient: string; value: number } | null }
export function judgePrice(p: ExtractedProduct): PriceResult {
  const title = "1일 가격";
  const { total, perDay } = p.units;
  if (p.price.sale == null || !total || !perDay)
    return { item: { status: "확인 필요", title, reasons: ["가격이나 총량·1일 섭취량을 확인하지 못해 계산하지 않았습니다."] }, daily: null, memberDaily: null, per1000: null };
  const days = total / perDay;
  const daily = Math.round((p.price.sale + p.price.shipping) / days);
  const memberDaily = p.price.member ? Math.round((p.price.member.price + p.price.shipping) / days) : null;
  const reasons = [`${fmt(days)}일분, 배송비 포함 하루 ${fmt(daily)}원`];
  if (p.price.member && memberDaily != null) reasons.push(`${p.price.member.label} 기준 하루 ${fmt(memberDaily)}원`);
  let per1000: PriceResult["per1000"] = null;
  const main = p.ingredients.find(i => i.functional && i.perDay && i.unit === "mg");
  if (main && main.perDay) {
    per1000 = { ingredient: main.name, value: Math.round(daily / main.perDay * 1000) };
    reasons.push(`${main.name} 1,000mg당 ${fmt(per1000.value)}원`);
  }
  return { item: { status: "정보", title, reasons }, daily, memberDaily, per1000 };
}

// 판매처 3단계 분류 (r1·r2·r3)
const norm = (s = "") => s.replace(/\(주\)|㈜|주식회사|\s|\(|\)/g, "").toLowerCase();
export interface SellerResult { tier: "official" | "authorized" | "general" | "check"; label: string; warning: string | null; signals: string[] }
export function classifySeller(p: ExtractedProduct, ref: Reference, rules: Rules, daily: number | null): SellerResult {
  const R = rules.sellers;
  const on = new Set(Object.entries(p.signals).filter(([, v]) => v).map(([k]) => k));
  if (p.salesRegistration === false) on.add("noSalesRegistration");
  if (daily != null && ref.officialDailyPrice && daily < ref.officialDailyPrice * (1 - R.decision.discountMedium)) on.add("deepDiscount");
  const hit = R.signals.filter(s => on.has(s.id));
  const labels = hit.map(s => s.label);

  const seller = norm(p.sellerName);
  const matches = [ref.distributor, ref.manufacturer].some(n => n && norm(n) && (seller.includes(norm(n)) || norm(n).includes(seller)));
  if (matches || p.platform.officialBadge || p.platform.inBrandOfficialList)
    return { tier: "official", label: R.tiers.official, warning: null, signals: labels };

  const strong = hit.filter(s => s.strength === "strong").length;
  const medium = hit.filter(s => s.strength === "medium").length;
  if (strong >= R.decision.strongAtLeast || medium >= R.decision.mediumAtLeast)
    return { tier: "check", label: R.tiers.check, warning: R.warningText, signals: labels };
  if (p.platform.rocket || p.platform.majorRetailer)
    return { tier: "authorized", label: R.tiers.authorized, warning: null, signals: labels };
  return { tier: "general", label: R.tiers.general, warning: null, signals: labels };
}

// 참고 정보 (판정과 분리)
export function referenceNotes(p: ExtractedProduct, rules: Rules): string[] {
  const out: string[] = [];
  for (const n of rules.notes.notes) {
    const ing = p.ingredients.find(i => i.name.includes(n.ingredient));
    if (!ing) continue;
    if (n.when.formIncludes && ing.form?.includes(n.when.formIncludes)) out.push(n.text);
    if (n.when.perUnitOver != null && ing.unit === n.when.unit && (ing.perUnit ?? 0) > n.when.perUnitOver) out.push(n.text);
  }
  return out;
}

export interface Verdict {
  product: string;
  seller: SellerResult;
  items: Item[];
  daily: number | null;
  memberDaily: number | null;
  per1000: PriceResult["per1000"];
  notes: string[];
  recommendable: boolean;   // c3: 대안 배너 후보 조건
}

export function judge(p: ExtractedProduct, ref: Reference, rules: Rules, opts: { recalled?: boolean } = {}): Verdict {
  const type = judgeType(p);
  const claims = judgeClaims(p, rules);
  const content = judgeContent(p, rules);
  const price = judgePrice(p);
  const seller = classifySeller(p, ref, rules, price.daily);
  // c3: 건기식 마크 + 목표 기능성 함량 충족 + 회수·부적합 이력 없음 + 정식 판매처
  const recommendable =
    type.status === "적합" && content.status === "적합" && !opts.recalled &&
    (seller.tier === "official" || seller.tier === "authorized");
  return {
    product: p.name, seller, items: [type, claims.item, content, price.item],
    daily: price.daily, memberDaily: price.memberDaily, per1000: price.per1000,
    notes: [...claims.notes, ...referenceNotes(p, rules)], recommendable,
  };
}
