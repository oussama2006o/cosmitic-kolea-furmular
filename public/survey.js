export const products = {
  lips: "أحمر الشفاه أو ملمّع الشفاه",
  eyes: "الماسكارا أو محدّد العيون",
  face: "كريم الأساس أو خافي العيوب",
  blush: "أحمر الخدود",
  sun: "واقي الشمس",
  skin: "غسول البشرة أو المرطّب",
  hair: "منتجات العناية بالشعر",
  other: "أخرى"
};
export const spending = {
  none: "لم أشترِ شيئًا",
  low: "أقل من 1,000 دج",
  medium: "من 1,000 إلى أقل من 3,000 دج",
  high: "من 3,000 إلى أقل من 5,000 دج",
  highest: "5,000 دج أو أكثر"
};
export const alternatives = { current: "لا أشتري حاليًا", wanted: "ليس لدي تفضيل" };
const clean = value => typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";

export function validate(input) {
  const errors = {};
  const selected = input?.products;
  if (!Array.isArray(selected) || selected.length < 1 || selected.length > 3 ||
      new Set(selected).size !== selected.length ||
      !selected.every(key => typeof key === "string" && Object.hasOwn(products, key))) {
    errors.products = "اختاري من منتج واحد إلى ثلاثة منتجات.";
  }
  const other = clean(input?.other);
  if (Array.isArray(selected) && selected.includes("other") && (!other || other.length > 200)) {
    errors.other = "اكتبي اسم المنتج الآخر في حدود ٢٠٠ حرف.";
  }
  const data = { products: selected, other: Array.isArray(selected) && selected.includes("other") ? other : "" };
  for (const key of Object.keys(alternatives)) {
    const group = input?.[key];
    if (!group || typeof group.none !== "boolean" || !Array.isArray(group.names) ||
        group.names.length > 3 || !group.names.every(name => typeof name === "string")) {
      errors[key] = "راجعي أسماء الماركات المدخلة.";
      continue;
    }
    const names = group.names.map(clean).filter(Boolean);
    if ((group.none && names.length) || (!group.none && !names.length) || names.some(name => name.length > 100)) {
      errors[key] = "اكتبي حتى ثلاث ماركات، لا يتجاوز كل اسم ١٠٠ حرف، أو اختاري «" + alternatives[key] + "».";
    }
    data[key] = { none: group.none, names };
  }
  if (typeof input?.spending !== "string" || !Object.hasOwn(spending, input.spending)) {
    errors.spending = "اختاري فئة الإنفاق خلال آخر شهر.";
  }
  data.spending = input?.spending;
  return { errors, data };
}
