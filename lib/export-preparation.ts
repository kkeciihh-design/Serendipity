import { checklistGroups } from "./checklist";
import type { ChecklistItem } from "./checklist";
import type { ExportSnapshot } from "./export-snapshot";
import { sanitizeTravelerText } from "./content-sanitizer";

export type PreparationEntry = {
  checkbox: boolean;
  completed: boolean;
  group: string;
  title: string;
  date: string | null;
  note: string[];
  changeNote: string | null;
};

const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();
const reminderKey = (value: string) => normalize(value)
  .replace(/\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g, "")
  .replace(/\d{1,2}[-/.月]\d{1,2}日?/g, "")
  .replace(/[，。；：、,.!?！？（）()【】[\]「」“”"'·\-—]/g, "")
  .replace(/请提前|请务必|记得|务必|建议|需要|可以|提前|确认|预约/g, "");

function sameReminder(leftTitle: string, rightTitle: string, leftDate: string | null, rightDate: string | null) {
  if (leftDate && rightDate && leftDate !== rightDate) return false;
  const left = reminderKey(leftTitle), right = reminderKey(rightTitle);
  if (!left || !right) return false;
  return left === right || (Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left)));
}

const genericStorageReminder = "联系酒店确认寄存时段、费用和大件限制，或安排其他寄存点。";
function cleanPreparationText(value: string | null | undefined) {
  let text = sanitizeTravelerText(value);
  if (text.includes(genericStorageReminder)) {
    const remainder = text.replaceAll(genericStorageReminder, "");
    text = /(?:核对|确认|核实)[^。；]*(?:行李寄存|寄存行李|寄存)/.test(remainder)
      ? remainder : text.replaceAll(genericStorageReminder, "核对行李寄存时段、费用与大件限制。");
  }
  return text
    .replace(/(?:关联日期、安排或票据已变化|关联(?:日期|安排|票据)[^。；]*已变化)[，,]?请重新核对[。；]?/g, "")
    .replace(/用户已标记已知。/g, "")
    .replace(/建议提前在\s*12306\s*或购票平台预订车票，并核对票面信息。/g, "12306 核对班次、站点与票面。")
    .replace(/按实际乘车、入住和预约要求准备；无需在这里填写证件号码。/g, "按乘车、入住和预约要求携带。")
    .replace(/确认能查看票面和行程；其他随身物品可按需添加。/g, "离线保存票面与行程，充足电量。")
    .replace(/第\s*\d+\s*天已改为[^；。]+[；。]/g, "")
    .replace(/请核实新地点/g, "核对")
    .replace(/需确认可寄存行李、隔音和退房时间，控制两晚住宿在预算内，并方便步行游览[^。]+。?/g, "核对寄存、隔音、退房及两晚住宿预算。")
    .replace(/([。；])\s*[；。]+/g, "$1").trim();
}

function conciseTitle(title: string) {
  return cleanPreparationText(title)
    .replace(/^确认是否需要预约[：:]\s*(.+)$/, "$1预约核对")
    .replace(/^确认住宿[：:]\s*(.+)$/, (_, place: string) => `${place.replace(/住宿(?:片区|区域)$/, "片区").replace(/住宿$/, "")}住宿`)
    .replace(/^(去程|返程)票[：:]核对日期、站点与同行人数$/, "$1车票核对")
    .replace(/^确认开放(?:时间)?[：:]\s*(.+)$/, "$1开放核对");
}

const topics = (text: string) => [...text.matchAll(/预约|开放|闭馆|票价|价格|班次|站名|站点|房态|房型|入住|退房|寄存|集合|末班|行李|人数|天气/g)].map(([word]) => word.replace(/票价/, "价格").replace(/站名/, "站点"));
// Only generic instructions can be subsumed by an existing concrete note.
// Sharing a topic does not make facts such as two booking channels equivalent.
function genericInstruction(text: string) {
  return !normalize(text)
    .replace(/预约|开放时间|开放|闭馆日|闭馆|票价|价格|班次|站名|站点|房态|房型|入住|退房时间|退房|寄存行李|寄存|集合点|集合时间|集合|末班车|末班|行李|同行人数|人数|天气/g, "")
    .replace(/请|提前|务必|记得|建议|需要|确认|核对|核实|了解|是否|要求|本人|本次|实际|最新|当日|信息|结果|与|及|和|的|在|并/g, "")
    .replace(/[\s，。；：、,.!?！？（）()【】[\]「」“”"']/g, "");
}
function checkTerms(text: string) {
  const match = text.match(/^(?:请|提前|建议)*(?:核对|确认|核实)(.+?)(?:条件|事项|信息)?[。；;]?$/);
  // Merge only short enumerations, never clauses with factual requirements.
  if (!match || /[\d:：]|不可|不能|禁止|至少|最晚|截止|需|须|通过|仅|成功|失败|凭证|实名|押金|退款|取消/.test(match[1])) return null;
  const terms = match[1].split(/[、，,]|及|与|和/).map((term) => term.trim()).filter(Boolean);
  return terms.length > 1 && terms.every((term) => term.length <= 8) ? terms : null;
}
function appendUnique(values: string[], value: string) {
  if (value.includes(genericStorageReminder) && values.some((item) => /(?:核对|确认|核实)[^。；]*寄存/.test(item))) value = value.replaceAll(genericStorageReminder, "");
  for (const sentence of cleanPreparationText(value).split(/(?<=[。；;])\s*/).filter(Boolean)) {
    const key = reminderKey(sentence);
    if (!key) continue;
    const details = sentence.match(/\d[\d:./-]*|https?:\/\/\S+/g) ?? [];
    const subject = topics(sentence);
    const duplicate = values.some((item) => {
      if (normalize(item).includes(normalize(sentence)) || reminderKey(item) === key) return true;
      return genericInstruction(sentence) && subject.length > 0 && subject.every((topic) => topics(item).includes(topic)) &&
        details.every((detail) => item.includes(detail)) &&
        !/不可|不能|禁止|至少|最晚|截止|成功|失败|凭证|实名|押金|取消|退款/.test(sentence);
    });
    if (duplicate) continue;
    const terms = checkTerms(sentence);
    const termKey = (term: string) => term.replace(/^(?:行李寄存|寄存行李)$/, "寄存").replace(/^退房时间$/, "退房");
    const mergeIndex = terms ? values.findIndex((item) => checkTerms(item)?.some((term) => terms.some((next) => termKey(term) === termKey(next)))) : -1;
    if (terms && mergeIndex !== -1) {
      const combined = checkTerms(values[mergeIndex])!;
      for (const term of terms) if (!combined.some((item) => termKey(item) === termKey(term))) combined.push(term);
      values[mergeIndex] = `核对${combined.join("、")}。`;
      continue;
    }
    for (let index = values.length - 1; index >= 0; index -= 1) {
      if (normalize(sentence).includes(normalize(values[index]))) values.splice(index, 1);
    }
    values.push(sentence);
  }
}

function coveredPendingRows(snapshot: ExportSnapshot, checklist: ChecklistItem[], pending: ExportSnapshot["plan"]["pendingItems"][number]) {
  const events = new Map(snapshot.plan.events.map((event) => [event.id, event]));
  const subject = (text: string) => normalize(text).replace(/海交馆/g, "海外交通史博物馆")
    .replace(/站|住宿片区|住宿区域|酒店|民宿|附近|片区|区域/g, "");
  const pendingSubject = subject(pending.title);
  const rows = checklist.filter((item) => item.eventIds.some((id) => {
    const event = events.get(id);
    const place = event ? subject(event.locationName ?? "") : "";
    return place.length >= 2 && pendingSubject.includes(place);
  }));
  if (pending.category === "transport_ticket") {
    const transport = checklist.filter((item) => item.group === "transport" && item.eventIds.some((id) => {
      const event = events.get(id);
      const place = event ? subject(event.locationName ?? "") : "";
      return event && ["departure_transport", "return_transport"].includes(event.type) && place.length >= 2 && pendingSubject.includes(place);
    }));
    const types = new Set(transport.flatMap((item) => item.eventIds.map((id) => events.get(id)?.type)));
    const roundTrip = /往返|来回/.test(pending.title) || (pending.title.match(/[—→]/g)?.length ?? 0) >= 2;
    if (roundTrip) return types.has("departure_transport") && types.has("return_transport") ? transport : [];
    if (/返程|回程/.test(pending.title)) return transport.filter((item) => item.eventIds.some((id) => events.get(id)?.type === "return_transport"));
    if (/去程|出发/.test(pending.title)) return transport.filter((item) => item.eventIds.some((id) => events.get(id)?.type === "departure_transport"));
    return types.has("departure_transport") && types.has("return_transport") ? transport : [];
  }
  if (pending.category === "accommodation") {
    const stays = rows.filter((item) => item.group === "accommodation");
    const nights = Number(pending.title.match(/(\d+)\s*晚/)?.[1] ?? 1);
    return new Set(stays.map((item) => item.date)).size >= nights ? stays : [];
  }
  if (pending.category === "reservation" || pending.category === "route") {
    // Matching the place alone must not swallow an independent transport or
    // weather reminder about that same place.
    if (pending.category === "route" && !/开放|闭馆|预约|最新安排/.test(`${pending.title} ${pending.reason}`)) return [];
    return rows.filter((item) => item.group === "reservation");
  }
  return [];
}

/**
 * Projects checklist rows, pending notes and advisories into one preparation
 * chapter. Linked advisories enrich their checklist row instead of creating a
 * second copy of the same reminder.
 */
export function projectPreparation(
  snapshot: ExportSnapshot,
  dates: readonly string[],
  selectedEventIds: ReadonlySet<string>,
  allDates: readonly string[],
) {
  const checklist = snapshot.checklist.items.filter((item) => !item.deleted && !item.orphaned && (
    dates.includes(item.date ?? "") || !item.date || item.date < allDates[0] ||
    item.eventIds.some((id) => selectedEventIds.has(id))
  ));
  const byId = new Map(checklist.map((item) => [item.id, item]));
  const byEventId = new Map<string, ChecklistItem>();
  for (const item of checklist) for (const eventId of item.eventIds) byEventId.set(eventId, item);

  const entries: PreparationEntry[] = checklist.map((item) => ({
    checkbox: true,
    completed: item.completed,
    group: checklistGroups[item.group],
    title: conciseTitle(item.title),
    date: item.date,
    note: [],
    changeNote: cleanPreparationText(item.changeNote) || null,
  }));
  entries.forEach((entry, index) => appendUnique(entry.note, checklist[index].note));
  const entryBySource = new Map(entries.map((entry, index) => [checklist[index].id, entry]));

  for (const advisory of snapshot.advisories?.items ?? []) {
    if (!dates.includes(advisory.date)) continue;
    const target = advisory.checklistItemId ? byId.get(advisory.checklistItemId) :
      advisory.eventIds.map((id) => byEventId.get(id)).find(Boolean);
    const entry = target ? entryBySource.get(target.id) : undefined;
    if (entry) {
      // A linked checklist already contains the concrete action (or points to
      // its full guide). Generic "confirm the reservation" adds no useful step.
      const generic = /^(?:建议提前在官方渠道核对预约要求与本人预约结果|建议提前联系酒店确认入住与寄存时段)[。；]?$/.test(cleanPreparationText(advisory.recommendation));
      if (!generic || !entry.note.length) appendUnique(entry.note, advisory.recommendation);
      if (advisory.severity === "action") appendUnique(entry.note, advisory.reason);
      continue;
    }
    const notes: string[] = [];
    appendUnique(notes, advisory.recommendation || advisory.reason);
    if (advisory.severity === "action") appendUnique(notes, advisory.reason);
    entries.push({
      checkbox: false,
      completed: false,
      group: "关键提醒",
      title: conciseTitle(advisory.title),
      date: advisory.date,
      note: notes,
      changeNote: null,
    });
  }

  for (const pending of snapshot.plan.pendingItems) {
    const date = pending.requiredBefore ?? null;
    const covered = coveredPendingRows(snapshot, checklist, pending);
    if (covered.length) {
      const entry = entryBySource.get(covered[0].id);
      if (entry) {
        if (date && (!entry.date || date < entry.date)) appendUnique(entry.note, `${date} 前核对。`);
        appendUnique(entry.note, pending.reason ?? "");
      }
      continue;
    }
    if (entries.some((entry) => sameReminder(entry.title, pending.title, entry.date, date))) continue;
    entries.push({
      checkbox: false,
      completed: false,
      group: "待确认",
      title: conciseTitle(pending.title),
      date,
      note: pending.reason ? [cleanPreparationText(pending.reason)].filter(Boolean) : [],
      changeNote: null,
    });
  }

  for (const note of [...snapshot.plan.validationResults.errors, ...snapshot.plan.validationResults.warnings]) {
    if (!cleanPreparationText(note)) continue;
    if (entries.some((entry) => sameReminder(entry.title, note, entry.date, null) || entry.note.some((item) => sameReminder(item, note, null, null)))) continue;
    entries.push({
      checkbox: false,
      completed: false,
      group: "计划核对",
      title: cleanPreparationText(note),
      date: null,
      note: [],
      changeNote: null,
    });
  }

  const unique: PreparationEntry[] = [];
  for (const entry of entries) {
    const duplicate = unique.find((item) => sameReminder(item.title, entry.title, item.date, entry.date));
    if (!duplicate) {
      unique.push({ ...entry, note: [...entry.note] });
      continue;
    }
    duplicate.completed = duplicate.completed && entry.completed;
    duplicate.checkbox = duplicate.checkbox || entry.checkbox;
    for (const note of entry.note) appendUnique(duplicate.note, note);
    duplicate.changeNote ??= entry.changeNote;
  }
  return unique;
}
