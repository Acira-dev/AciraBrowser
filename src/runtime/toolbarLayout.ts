import type { Settings } from "./types";

export type ToolbarLayout = "expanded" | "automatic";
export function toolbarLayout(settings: Partial<Settings>): ToolbarLayout {
  if (
    settings.toolbarLayout === "expanded" ||
    settings.toolbarLayout === "automatic"
  )
    return settings.toolbarLayout;
  const legacy = settings as {
    automaticCompact?: boolean;
    pinExpanded?: boolean;
  };
  return legacy.automaticCompact && !legacy.pinExpanded
    ? "automatic"
    : "expanded";
}
/** Compatibility only for a running preview that predates the native migration. */
export function toolbarLayoutPatch(
  settings: Settings,
  value: ToolbarLayout,
): Partial<Settings> {
  return settings.toolbarLayout
    ? { toolbarLayout: value }
    : ({
        automaticCompact: value === "automatic",
        pinExpanded: false,
      } as Partial<Settings>);
}
