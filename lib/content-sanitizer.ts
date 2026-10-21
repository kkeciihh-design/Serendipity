const INTERNAL_DATABASE_ID = /\s*[（(]\s*OSM\s+\d+\s*[）)]/gi;
const INTERNAL_COORDINATE_CALIBRATION = /；+[^。；]*?(?:基准校准|区域参考点|仍为待核实建议标点)[^。]*/g;
const SOFTWARE_OPERATION_COPY: readonly [RegExp, string][] = [
  [/在官方入口核对本次要求及本人预约结果，再到出发前清单确认。/g, "建议提前在官方渠道核对预约要求与本人预约结果。"],
  [/向酒店核对能否提前进房，再通过住宿推荐或活动编辑调整到店安排。/g, "建议提前联系酒店确认入住与寄存时段。"],
  [/请先在购票平台办理，再在门到门交通中确认票面。/g, "建议提前在 12306 或购票平台预订车票，并核对票面信息。"],
  [/先通过活动编辑或推荐入口调整；标记已知不会解除关闭限制。/g, "建议先核对开放信息，再按实际条件调整安排；标记已知不会解除关闭限制。"],
  [/通过活动编辑或景点推荐调整；已知标记不会使场馆开放。/g, "建议按开放信息调整安排；已知标记不会使场馆开放。"],
  [/在地图路线或门到门交通入口重查运营与接驳，保留已确认票面。/g, "建议提前核对运营与接驳信息，并保留确认后的票面。"],
  [/通过门到门交通查看票面。/g, "出发前核对票面与接驳信息。"],
];

/** Removes internal map-database node IDs from traveller-facing copy. */
export function removeInternalDatabaseIds(value: string | null | undefined) {
  return (value ?? "").replace(INTERNAL_DATABASE_ID, "");
}

/**
 * Keeps traveller copy free of map-authoring language. This is applied at the
 * storage/read projection and again at export boundaries so legacy rows are
 * cleaned without requiring a one-off database migration.
 */
export function sanitizeTravelerText(value: string | null | undefined) {
  const hadCalibration = (value ?? "").search(INTERNAL_COORDINATE_CALIBRATION) >= 0;
  const cleaned = removeInternalDatabaseIds(value)
    .replace(INTERNAL_COORDINATE_CALIBRATION, "")
    .replace(/(?:^|[\s。])；+/g, (match) => match === "；" ? "" : match[0])
    .replace(/。{2,}/g, "。")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  const travelerCopy = SOFTWARE_OPERATION_COPY.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    cleaned,
  );
  return hadCalibration && travelerCopy && !/[。！？!?]$/.test(travelerCopy) ? `${travelerCopy}。` : travelerCopy;
}
