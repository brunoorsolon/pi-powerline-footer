import { visibleWidth } from "@earendil-works/pi-tui";
import type { BuiltinStatusLineSegmentId, ColorValue, CustomItemPosition, CustomStatusItem, PresetDef, StatusLineLayout, StatusLinePreset, StatusLineSegmentId } from "./types.ts";

export interface PowerlineConfig {
  preset: StatusLinePreset;
  customItems: CustomStatusItem[];
  layout: StatusLineLayout | null;
  mouseScroll: boolean;
  fixedEditor: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePreset(value: unknown, presets: readonly StatusLinePreset[]): StatusLinePreset | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return (presets as readonly string[]).includes(normalized) ? (normalized as StatusLinePreset) : null;
}

function normalizeCustomItemId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return /^[a-zA-Z0-9_-]+$/.test(normalized) ? normalized : null;
}

const BUILTIN_SEGMENT_IDS = new Set<BuiltinStatusLineSegmentId>([
  "model",
  "shell_mode",
  "path",
  "git",
  "subagents",
  "token_in",
  "token_out",
  "token_total",
  "cost",
  "context_pct",
  "context_total",
  "time_spent",
  "time",
  "session",
  "hostname",
  "cache_read",
  "cache_write",
  "thinking",
  "extension_statuses",
]);

function normalizeLayoutSegmentId(value: unknown): StatusLineSegmentId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (BUILTIN_SEGMENT_IDS.has(normalized as BuiltinStatusLineSegmentId)) {
    return normalized as BuiltinStatusLineSegmentId;
  }

  if (!normalized.startsWith("custom:")) return null;
  const customId = normalizeCustomItemId(normalized.slice("custom:".length));
  return customId ? `custom:${customId}` : null;
}

function normalizeLayoutSegments(raw: unknown): StatusLineSegmentId[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const segments: StatusLineSegmentId[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const segmentId = normalizeLayoutSegmentId(entry);
    if (!segmentId || seen.has(segmentId)) continue;
    seen.add(segmentId);
    segments.push(segmentId);
  }

  return segments;
}

function normalizeLayout(raw: unknown): StatusLineLayout | null {
  if (!isRecord(raw)) return null;

  const layout: StatusLineLayout = {};
  const left = normalizeLayoutSegments(raw.left ?? raw.leftSegments);
  const right = normalizeLayoutSegments(raw.right ?? raw.rightSegments);
  const secondary = normalizeLayoutSegments(raw.secondary ?? raw.secondarySegments);

  if (left) layout.leftSegments = left;
  if (right) layout.rightSegments = right;
  if (secondary) layout.secondarySegments = secondary;

  return layout.leftSegments || layout.rightSegments || layout.secondarySegments ? layout : null;
}

function normalizeCustomItemPosition(value: unknown): CustomItemPosition {
  if (value === "left" || value === "right" || value === "secondary") return value;
  return "right";
}

function normalizeCustomColor(value: unknown): ColorValue | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? (normalized as ColorValue) : undefined;
}

function normalizeCustomPrefix(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeCustomStatusItem(raw: unknown, idOverride?: string): CustomStatusItem | null {
  if (!isRecord(raw)) return null;
  const id = normalizeCustomItemId(idOverride ?? raw.id);
  if (!id) return null;

  const statusKey = typeof raw.statusKey === "string" && raw.statusKey.trim() ? raw.statusKey.trim() : id;

  return {
    id,
    statusKey,
    position: normalizeCustomItemPosition(raw.position),
    color: normalizeCustomColor(raw.color),
    prefix: normalizeCustomPrefix(raw.prefix),
    hideWhenMissing: raw.hideWhenMissing !== false,
    excludeFromExtensionStatuses: raw.excludeFromExtensionStatuses !== false,
  };
}

function normalizeCustomItems(raw: unknown): CustomStatusItem[] {
  const normalized: CustomStatusItem[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const item = normalizeCustomStatusItem(entry);
      if (item) normalized.push(item);
    }
  } else if (isRecord(raw)) {
    for (const [id, entry] of Object.entries(raw)) {
      const item = normalizeCustomStatusItem(entry, id);
      if (item) normalized.push(item);
    }
  }

  const deduped = new Map<string, CustomStatusItem>();
  for (const item of normalized) {
    deduped.set(item.id, item);
  }

  return [...deduped.values()];
}

export function parsePowerlineConfig(value: unknown, presets: readonly StatusLinePreset[]): PowerlineConfig {
  const defaultConfig: PowerlineConfig = {
    preset: "default",
    customItems: [],
    layout: null,
    mouseScroll: true,
    fixedEditor: true,
  };

  const directPreset = normalizePreset(value, presets);
  if (directPreset) return { ...defaultConfig, preset: directPreset };

  if (!isRecord(value)) return defaultConfig;

  return {
    preset: normalizePreset(value.preset, presets) ?? defaultConfig.preset,
    customItems: normalizeCustomItems(value.customItems),
    layout: normalizeLayout(value.layout),
    mouseScroll: value.mouseScroll !== false,
    fixedEditor: value.fixedEditor !== false,
  };
}

function appendCustomItems(
  segments: StatusLineSegmentId[],
  customItems: readonly CustomStatusItem[],
  position: CustomItemPosition,
): StatusLineSegmentId[] {
  const merged = [...segments];
  const seen = new Set(merged);

  for (const item of customItems) {
    if (item.position !== position) continue;
    const segmentId: StatusLineSegmentId = `custom:${item.id}`;
    if (seen.has(segmentId)) continue;
    seen.add(segmentId);
    merged.push(segmentId);
  }

  return merged;
}

export function mergeSegmentsWithCustomItems(
  presetDef: PresetDef,
  customItems: readonly CustomStatusItem[],
  layout: StatusLineLayout | null = null,
): {
  leftSegments: StatusLineSegmentId[];
  rightSegments: StatusLineSegmentId[];
  secondarySegments: StatusLineSegmentId[];
} {
  const leftBase: StatusLineSegmentId[] = layout?.leftSegments ?? presetDef.leftSegments;
  const rightBase: StatusLineSegmentId[] = layout?.rightSegments ?? presetDef.rightSegments;
  const secondaryBase: StatusLineSegmentId[] = layout?.secondarySegments ?? (presetDef.secondarySegments ?? []);

  const left = layout?.leftSegments ? [...leftBase] : appendCustomItems(leftBase, customItems, "left");
  const right = layout?.rightSegments ? [...rightBase] : appendCustomItems(rightBase, customItems, "right");
  const secondary = layout?.secondarySegments ? [...secondaryBase] : appendCustomItems(secondaryBase, customItems, "secondary");

  return { leftSegments: left, rightSegments: right, secondarySegments: secondary };
}

export function nextPowerlineSettingWithPreset(existingPowerlineSetting: unknown, preset: StatusLinePreset): unknown {
  if (!isRecord(existingPowerlineSetting)) {
    return preset;
  }
  return { ...existingPowerlineSetting, preset };
}

export function nextPowerlineSettingWithOptions(
  existingPowerlineSetting: unknown,
  updates: Partial<Pick<PowerlineConfig, "mouseScroll" | "fixedEditor">>,
  currentPreset: StatusLinePreset,
): unknown {
  if (!isRecord(existingPowerlineSetting)) {
    return { preset: currentPreset, ...updates };
  }
  return { ...existingPowerlineSetting, ...updates };
}

export function collectHiddenExtensionStatusKeys(customItems: readonly CustomStatusItem[]): Set<string> {
  const hidden = new Set<string>();
  for (const item of customItems) {
    if (item.excludeFromExtensionStatuses) hidden.add(item.statusKey);
  }
  return hidden;
}

export function isNotificationExtensionStatus(value: string): boolean {
  return value.trimStart().startsWith("[");
}

export function getNotificationExtensionStatuses(
  statuses: ReadonlyMap<string, string>,
  hiddenKeys: ReadonlySet<string>,
): string[] {
  const notifications: string[] = [];
  for (const [statusKey, value] of statuses.entries()) {
    if (hiddenKeys.has(statusKey) || !value || !isNotificationExtensionStatus(value)) {
      continue;
    }
    notifications.push(value);
  }
  return notifications;
}

export function normalizeExtensionStatusValue(value: string): string | null {
  if (!value || visibleWidth(value) <= 0) {
    return null;
  }

  const stripped = value.replace(/(\x1b\[[0-9;]*m|\s|·|[|])+$/, "");
  return visibleWidth(stripped) > 0 ? stripped : null;
}

export function normalizeCompactExtensionStatus(value: string): string | null {
  if (isNotificationExtensionStatus(value)) {
    return null;
  }

  return normalizeExtensionStatusValue(value);
}
