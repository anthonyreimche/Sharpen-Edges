// Sharpen Edges, a Safelight extension (GPL-3.0-or-later).
//
// A port of RawTherapee 5.13's Sharpen Edges (rtengine/ipsharpenedges.cc,
// MLsharpen; © 2004-2020 Gabor Horvath, the algorithm Manuel Llorens', who has
// waived his rights to it): multi-pass edge sharpening in CIE Lab. Registers
// the display-phase stage (stage.ts) and the Develop panel (Panel.tsx), which
// also edits a mask's in the Masking panel.

import { SharpenEdgesPanel } from "./Panel";
import { DRAWS_KEY, EDIT_KEYS, EXT_ID, qualified, rederivePatch, resetPatch } from "./params";
import { api, initRuntime } from "./rt";
import type { DevelopState, SafelightAPI } from "./safelight";
import { edgesStage } from "./stage";

export const PANEL_ID = `${EXT_ID}.panel`;

let unsubscribe: (() => void) | null = null;

function reset(): void {
  const dev = api.stores.useDevelopStore.getState();
  dev.setDynParams(resetPatch());
  void dev.commitEdit("Sharpen Edges reset");
}

export function activate(host: SafelightAPI): void {
  initRuntime(host);
  host.registerProcessingStage(edgesStage());
  host.registerPanel({
    id: PANEL_ID,
    title: "Sharpen Edges",
    component: SharpenEdgesPanel,
    defaultDock: { module: "develop", direction: "right", width: 280 },
    onReset: reset,
    mask: { component: SharpenEdgesPanel, owns: [...EDIT_KEYS.map(qualified), qualified(DRAWS_KEY)] },
  });

  unsubscribe?.();
  // A bag whose draw count disagrees with its edit (a preset or paste that
  // carried only some keys) is re-derived live, the photo's and each mask's.
  unsubscribe = host.stores.useDevelopStore.subscribe((state: DevelopState, prev: DevelopState) => {
    if (state.params.masks !== prev.params.masks) {
      for (const mask of state.params.masks) {
        if (prev.params.masks.some((m) => m.id === mask.id && m.bag === mask.bag)) continue;
        const patch = mask.bag ? rederivePatch(mask.bag) : null;
        if (patch) state.updateMaskBag(mask.id, patch);
      }
    }
    if (state.paramBag === prev.paramBag) return;
    const patch = rederivePatch(state.paramBag);
    if (patch) state.setDynParams(patch);
  });
}

/** The host sweeps the stage and the panel after every deactivate. */
export function deactivate(): void {
  unsubscribe?.();
  unsubscribe = null;
}
